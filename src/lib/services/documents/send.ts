import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import { getObjectStorage } from '@/lib/storage';
import { getAppBaseUrl } from '@/lib/notifications/shared';
import { sendOrgDocumentSentEmail } from '@/lib/email/send';
import { applyOverride, getTemplateOverride } from '@/lib/email/templateOverrides';
import { documentDownloadName } from '@/lib/documents/fileName';
import { canSendFromStatus, canTransition, isLifecycleType } from '@/lib/documents/statusMatrix';
import { setDocumentStatus } from './status';

/**
 * Этап 6 ТЗ (`У-149`) — отправка документа заказчику письмом.
 *
 * До этого шага «отправить клиенту счёт» означало скачать PDF и переслать
 * его из своей почты: в системе не оставалось ни следа, ни отметки, а поле
 * `sentAt` заполнялось только импортом из 1С. Кнопка закрывает разрыв —
 * письмо уходит из системы, документ помечается отправленным, действие
 * попадает в журнал.
 *
 * **Правило, ради которого всё написано так, а не проще: отметка не
 * опережает письмо.** Ни одного получателя, почта выключена, файл заражён —
 * значит, документ НЕ отправлен, и никакой отметки не появляется. Обратный
 * порядок («пометим, а письмо как получится») тише и хуже: менеджер будет
 * уверен, что клиент документ видел.
 *
 * Вложение — «мягкая» часть: если файл не удалось прочитать из хранилища,
 * письмо со ссылкой в кабинет всё равно полезнее молчания. Об этом честно
 * сообщает `attached: false`, а не тишина в логе.
 */

export type SendDocumentResult =
  | {
      ok: true;
      /** Скольким адресам ушло письмо. */
      recipients: number;
      /** Был ли приложен PDF (файл мог не прочитаться). */
      attached: boolean;
      /** Документ уже отправляли — статус не менялся, событие новое. */
      repeat: boolean;
    }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'not_found'
        | 'not_sendable'
        | 'infected'
        | 'no_recipients'
        | 'email_disabled';
    };

/**
 * `У-258`: попутчики — документы той же организации, которые едут этим же
 * письмом. Механизм массовой отправки (`sendMany.ts`) собирает их сам; у
 * одиночной кнопки список пуст, и поведение не меняется ни на шаг.
 */
export type SendCompanions = { alsoDocumentIds?: string[] | undefined };

export async function sendDocumentToCustomer(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string,
  companions: SendCompanions = {}
): Promise<SendDocumentResult> {
  // Отправляет сотрудник исполнителя. Заказчику эта дверь не нужна: документ
  // и так лежит в его кабинете.
  if (!(session.role === 'admin' || isStaffManagerSide(session))) {
    return { ok: false, error: 'forbidden' };
  }

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      path: true,
      type: true,
      number: true,
      createdAt: true,
      status: true,
      scanStatus: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      orderId: true,
      order: { select: { id: true, orderNumber: true, title: true, companyId: true } },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  // Тот же предикат, что у скачивания (§4 CLAUDE.md, defense-in-depth):
  // отказ и отсутствие неотличимы снаружи.
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'not_found' };

  if (!isLifecycleType(doc.type)) return { ok: false, error: 'not_sendable' };
  // Партнёр видит документы своего портфеля по скоупу (`У-155`) — рассылать
  // ему письма этой кнопкой не нужно, и адресата у неё нет.
  // `У-161`: у КП, выставленного лиду, контрагента нет вовсе — адресата у
  // кнопки тоже нет. Проверяем оба поля: типы у них независимые, хотя база
  // держит их «оба или ни одного» (`Document_counterparty_both_or_none`).
  if (doc.counterpartyType !== 'organization' || !doc.counterpartyId)
    return { ok: false, error: 'not_sendable' };
  if (!canSendFromStatus(doc.type, doc.status)) return { ok: false, error: 'not_sendable' };
  if (doc.scanStatus === 'infected') return { ok: false, error: 'infected' };

  const org = await prisma.organization.findUnique({
    where: { id: doc.counterpartyId },
    select: {
      id: true,
      name: true,
      companyId: true,
      organizationUsers: {
        where: { isActive: true, user: { isActive: true } },
        select: { user: { select: { id: true, email: true, name: true } } },
      },
    },
  });
  if (!org) return { ok: false, error: 'not_found' };

  const recipients = org.organizationUsers
    .map((m) => m.user)
    .filter((u) => !!u.email)
    .map((u) => ({ id: u.id, email: u.email as string, name: u.name }));
  if (recipients.length === 0) return { ok: false, error: 'no_recipients' };

  /**
   * `У-258`: попутчики уже отобраны вызывающим — здесь только читаем их файлы
   * и имена. Повторно проверять скоуп незачем: массовая отправка спрашивает
   * тот же `canReadDocument` по каждому документу до того, как позвать эту
   * дверь, а из карточки список приходит пустым.
   */
  const companionIds = companions.alsoDocumentIds ?? [];
  const companionDocs = companionIds.length
    ? await prisma.document.findMany({
        // `У-151`: заменённая версия к письму не прикладывается ни при каких
        // вызовах. Массовая отправка отсеивает её раньше и говорит об этом
        // человеку; здесь — вторая линия на случай другого вызывающего
        // (§4, defense-in-depth).
        where: { id: { in: companionIds }, supersededAt: null },
        select: { id: true, name: true, path: true, type: true, number: true, createdAt: true },
      })
    : [];

  const props = {
    organizationName: org.name,
    documentType: doc.type,
    documentNumber: doc.number,
    documentName: doc.name,
    documentUrl: `${getAppBaseUrl()}/organization/documents/${doc.id}`,
    orderNumber: doc.order?.orderNumber ?? null,
    orderTitle: doc.order?.title ?? null,
    ...(companionDocs.length
      ? { alsoDocuments: companionDocs.map((d) => documentDownloadName(d)) }
      : {}),
  };

  // Вложение best-effort: без него письмо остаётся осмысленным.
  const files: { filename: string; content: Buffer }[] = [];
  for (const attachable of [doc, ...companionDocs]) {
    try {
      const content = await getObjectStorage().download(attachable.path);
      files.push({ filename: documentDownloadName(attachable), content });
    } catch (err) {
      log.warn('[documents/send] файл не прочитан — письмо уйдёт без вложения', {
        documentId: attachable.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const attachments = files.length ? files : undefined;

  // `У-128`: свой текст письма пишет компания-продавец (исполнитель), а не
  // компания получателя — как и во всех остальных письмах клиенту.
  const companyId = doc.companyId ?? doc.order?.companyId ?? null;
  const override = await getTemplateOverride(prisma, 'orgDocumentSent', companyId);

  let sent = 0;
  for (const user of recipients) {
    const result = await sendOrgDocumentSentEmail({
      to: user.email,
      ...props,
      ...(attachments ? { attachments } : {}),
      ...(override
        ? {
            override: {
              ...applyOverride('orgDocumentSent', override, props),
              recipientName: user.name ?? 'коллега',
            },
          }
        : {}),
    });
    if (result.status === 'sent') sent += 1;
  }

  if (sent === 0) {
    // Почта выключена или не настроена (`send()` возвращает `skipped`).
    // Документ отправленным не считается — см. правило в шапке файла.
    return { ok: false, error: 'email_disabled' };
  }

  // Первая отправка идёт через единственную дверь к статусу (`У-148`): она
  // же проставляет `sentAt`/`sentById` и пишет смену статуса в журнал.
  // Повторная отправка статус не двигает — обновляем только отметку времени.
  //
  // «Первая» определяется матрицей, а не сравнением с `issued`: у КП начальный
  // статус — `draft` (`У-164`), и прежнее условие сочло бы первую отправку
  // предложения повторной. Документ остался бы черновиком навсегда, а
  // заказчик — с бумагой, которой по системе не отправляли.
  const repeat = !canTransition(doc.type, doc.status, 'sent');
  if (!repeat) {
    await setDocumentStatus(prisma, session, { documentId: doc.id, to: 'sent' });
  } else {
    await prisma.document.update({
      where: { id: doc.id },
      data: { sentAt: new Date(), sentById: session.sub },
    });
  }

  /**
   * `У-258`: попутчики тоже считаются отправленными — каждому свой статус,
   * своя отметка и своё событие журнала. Иначе в карточке второй бумаги
   * стояло бы «не отправляли», хотя клиент держит её в руках.
   */
  for (const companion of companionDocs) {
    const full = await prisma.document.findUnique({
      where: { id: companion.id },
      select: { id: true, type: true, status: true, number: true },
    });
    if (!full) continue;
    // Тип сужаем здесь заново: массовая отправка уже отобрала бумаги с
    // жизненным циклом, но дверь открыта и другим вызывающим, а матрица
    // переходов знает только про них.
    if (isLifecycleType(full.type) && canTransition(full.type, full.status, 'sent')) {
      await setDocumentStatus(prisma, session, { documentId: full.id, to: 'sent' });
    } else {
      await prisma.document.update({
        where: { id: full.id },
        data: { sentAt: new Date(), sentById: session.sub },
      });
    }
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'document_sent',
      entity: 'document',
      entityId: full.id,
      after: { recipients: sent, attached: !!attachments, withDocumentId: doc.id },
    });
  }

  // `У-149`, `У-159`: каждая отправка — своё событие, в том числе повторная.
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'document_sent',
    entity: 'document',
    entityId: doc.id,
    after: {
      recipients: sent,
      attached: !!attachments,
      repeat,
      number: doc.number,
    },
  });

  return { ok: true, recipients: sent, attached: !!attachments, repeat };
}
