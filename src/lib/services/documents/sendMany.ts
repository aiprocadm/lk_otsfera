import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { canReadDocument } from '@/lib/auth/policy';
import { canSendFromStatus, isLifecycleType } from '@/lib/documents/statusMatrix';
import { sendDocumentToCustomer } from './send';

/**
 * Массовая отправка документов заказчику (`У-258`, этап 8).
 *
 * Сотрудник отмечает галочками несколько бумаг и отправляет их разом. До этого
 * шага кнопка была только в карточке документа: чтобы отправить клиенту счёт,
 * акт и договор, приходилось открывать три карточки подряд.
 *
 * **Одно письмо на организацию** (`В-8-6`): три бумаги одному клиенту — одно
 * письмо с тремя вложениями, а не три письма подряд. Три письма за минуту
 * человек читает как сбой рассылки.
 *
 * **Отбор — до отправки, а не в процессе.** Документ не того типа, чужой,
 * в неподходящем состоянии или заражённый в письмо не попадает вовсе и
 * возвращается в списке пропущенных с причиной. Молча отправить часть и
 * промолчать про остальное — худший из вариантов: сотрудник будет уверен, что
 * клиент получил всё.
 */

export type SendManyResult =
  | {
      ok: true;
      /** Скольким организациям ушли письма. */
      organizations: number;
      /** Сколько документов реально отправлено. */
      sent: number;
      /** Что не отправили и почему. */
      skipped: Array<{ documentId: string; reason: SendManySkipReason }>;
    }
  | { ok: false; error: 'forbidden' | 'no_documents' };

/** Почему бумага не ушла. Коды стабильные (§3) — русские строки у экрана. */
type SendManySkipReason =
  | 'not_found'
  | 'not_sendable'
  | 'infected'
  | 'no_recipients'
  | 'email_disabled'
  | 'forbidden'
  /** `У-151`: бумагу заменили новой версией — клиенту едет действующая. */
  | 'superseded';

/** Не больше, чем помещается в одно осмысленное письмо и одну транзакцию почты. */
export const SEND_MANY_LIMIT = 50;

type Candidate = {
  id: string;
  organizationId: string;
};

export async function sendDocumentsToClients(
  prisma: PrismaClient,
  session: SessionPayload,
  documentIds: string[]
): Promise<SendManyResult> {
  // Отправляет сотрудник исполнителя — то же правило, что у одиночной кнопки.
  if (!(session.role === 'admin' || isStaffManagerSide(session))) {
    return { ok: false, error: 'forbidden' };
  }
  const ids = [...new Set(documentIds.filter(Boolean))].slice(0, SEND_MANY_LIMIT);
  if (ids.length === 0) return { ok: false, error: 'no_documents' };

  const rows = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      type: true,
      status: true,
      scanStatus: true,
      counterpartyType: true,
      counterpartyId: true,
      companyId: true,
      orderId: true,
      number: true,
      createdAt: true,
      // `У-151`: заменённая версия клиенту не отправляется — у неё уже есть
      // преемник. Отфильтровать её в запросе было бы тише, но человек тогда
      // увидел бы «документ не найден» там, где документ есть и просто устарел.
      supersededAt: true,
      order: { select: { companyId: true } },
    },
  });

  const skipped: Array<{ documentId: string; reason: SendManySkipReason }> = [];
  const byOrg = new Map<string, Candidate[]>();
  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) skipped.push({ documentId: id, reason: 'not_found' });
  }

  for (const doc of rows) {
    // Скоуп — тем же гейтом, что у скачивания и у одиночной отправки (§4).
    if (!(await canReadDocument(session, doc))) {
      skipped.push({ documentId: doc.id, reason: 'not_found' });
      continue;
    }
    if (doc.scanStatus === 'infected') {
      skipped.push({ documentId: doc.id, reason: 'infected' });
      continue;
    }
    if (doc.supersededAt !== null) {
      skipped.push({ documentId: doc.id, reason: 'superseded' });
      continue;
    }
    // Отправляют бумаги с жизненным циклом и только заказчику: у скана и
    // отчёта адресата нет, у документа партнёра — тоже (`У-155`).
    if (
      !isLifecycleType(doc.type) ||
      doc.counterpartyType !== 'organization' ||
      !doc.counterpartyId ||
      !canSendFromStatus(doc.type, doc.status)
    ) {
      skipped.push({ documentId: doc.id, reason: 'not_sendable' });
      continue;
    }
    const list = byOrg.get(doc.counterpartyId) ?? [];
    list.push({ id: doc.id, organizationId: doc.counterpartyId });
    byOrg.set(doc.counterpartyId, list);
  }

  let sent = 0;
  let organizations = 0;
  for (const [, docs] of byOrg) {
    const head = docs[0];
    if (!head) continue;
    /**
     * Первый документ организации несёт письмо, остальные едут приложениями
     * к нему. Механизм тот же, что у одиночной кнопки (`У-149`): статус,
     * отметка «отправлен» и событие журнала ставятся каждому документу
     * отдельно — иначе в карточке второй бумаги было бы «не отправляли».
     */
    const result = await sendDocumentToCustomer(prisma, session, head.id, {
      alsoDocumentIds: docs.slice(1).map((d) => d.id),
    });
    if (!result.ok) {
      for (const doc of docs) skipped.push({ documentId: doc.id, reason: result.error });
      continue;
    }
    organizations += 1;
    sent += docs.length;
  }

  return { ok: true, organizations, sent, skipped };
}
