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
import { isLifecycleType } from '@/lib/documents/statusMatrix';
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

/** Статусы, из которых документ можно отправить клиенту. */
const SENDABLE_STATUSES = new Set(['issued', 'sent', 'accepted']);

export async function sendDocumentToCustomer(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string
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
  if (doc.counterpartyType !== 'organization') return { ok: false, error: 'not_sendable' };
  if (!SENDABLE_STATUSES.has(doc.status)) return { ok: false, error: 'not_sendable' };
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

  const props = {
    organizationName: org.name,
    documentType: doc.type,
    documentNumber: doc.number,
    documentName: doc.name,
    documentUrl: `${getAppBaseUrl()}/organization/documents/${doc.id}`,
    orderNumber: doc.order?.orderNumber ?? null,
    orderTitle: doc.order?.title ?? null,
  };

  // Вложение best-effort: без него письмо остаётся осмысленным.
  let attachments: { filename: string; content: Buffer }[] | undefined;
  try {
    const content = await getObjectStorage().download(doc.path);
    attachments = [{ filename: documentDownloadName(doc), content }];
  } catch (err) {
    log.warn('[documents/send] файл не прочитан — письмо уйдёт без вложения', {
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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

  // `issued → sent` идёт через единственную дверь к статусу (`У-148`): она
  // же проставляет `sentAt`/`sentById` и пишет смену статуса в журнал.
  // Повторная отправка статус не двигает — обновляем только отметку времени.
  const repeat = doc.status !== 'issued';
  if (!repeat) {
    await setDocumentStatus(prisma, session, { documentId: doc.id, to: 'sent' });
  } else {
    await prisma.document.update({
      where: { id: doc.id },
      data: { sentAt: new Date(), sentById: session.sub },
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
