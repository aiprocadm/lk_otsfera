/**
 * §11 ТЗ v0.5 (этап 1, PR-4) — карточка документа.
 *
 * До этого этапа документ жил только строкой в списке: открыть его отдельно
 * было негде, а решение заказчика Q3 (29.07.2026) требует полноценной
 * страницы — на ней и живут настраиваемые поля документа.
 *
 * Доступ **не изобретается заново**: используется тот же предикат
 * `canReadDocument`, что и у роута скачивания (§4 CLAUDE.md,
 * defense-in-depth). Отказ и отсутствие записи неотличимы снаружи — оба дают
 * `not_found`, иначе по коду ответа можно было бы перебором узнать, какие id
 * существуют.
 */

import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { invoicePaymentState, type InvoicePaymentResult } from '@/lib/documents/invoicePayment';
import { proposalDisplayStatus } from '@/lib/documents/proposalExpiry';

type DocumentDetailError = 'not_found';

export type DocumentDetail = {
  id: string;
  name: string;
  type: string;
  direction: string;
  number: string | null;
  version: number;
  size: number | null;
  mimeType: string;
  scanStatus: string;
  scanReason: string | null;
  signedAt: Date | null;
  createdAt: Date;
  uploadedByName: string | null;
  /** Состояние документа (`У-148`): выставлен · отправлен · принят · аннулирован. */
  status: string;
  /** Итог с НДС строкой; у документов до этапа 6 его нет — показываем «—». */
  amountGross: string | null;
  /** Когда и кем документ отправлен клиенту и принят им (`У-149`, `У-150`). */
  sentAt: Date | null;
  /**
   * Признак оплаты счёта (`У-148`) — вычисляемый, по платежам заказа.
   * `null` — судить не по чему: это не счёт, у него нет номера или суммы.
   */
  payment: InvoicePaymentResult | null;
  acceptedAt: Date | null;
  /** Заказ, к которому относится документ (у общих документов — null). */
  order: { id: string; title: string; orderNumber: string | null } | null;
  // `У-161`: у коммерческого предложения лиду контрагента нет — все три поля
  // пустые, карточка показывает прочерк.
  /**
   * `У-165`: почему клиент отказался. Показывается менеджеру и самому
   * клиенту — иначе причина, ради которой отказ и просят пояснить, не видна
   * нигде, кроме базы.
   */
  rejectReason: string | null;
  counterparty: { type: string | null; id: string | null; name: string | null };
};

type Result = { ok: true; document: DocumentDetail } | { ok: false; error: DocumentDetailError };

/** Русское имя контрагента по типу и id (для шапки карточки). */
async function counterpartyName(
  prisma: PrismaClient,
  type: string | null,
  id: string | null
): Promise<string | null> {
  if (!type || !id) return null;
  if (type === 'organization') {
    const org = await prisma.organization.findUnique({ where: { id }, select: { name: true } });
    return org?.name ?? null;
  }
  const partner = await prisma.partner.findUnique({ where: { id }, select: { name: true } });
  return partner?.name ?? null;
}

export async function getDocumentDetail(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string,
  /** «Сейчас» параметром — иначе границу суток нечем проверить в тесте. */
  now?: Date
): Promise<Result> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      type: true,
      direction: true,
      number: true,
      version: true,
      size: true,
      mimeType: true,
      scanStatus: true,
      scanReason: true,
      signedAt: true,
      createdAt: true,
      // `У-148`, `У-150`: состояние, сумма и отметки жизненного цикла.
      status: true,
      // `У-164`: срок действия нужен расчёту «истекло» — карточка показывает
      // его сама, не дожидаясь ночной задачи.
      validUntil: true,
      // `У-165`: причина отказа клиента.
      rejectReason: true,
      amountGross: true,
      sentAt: true,
      acceptedAt: true,
      orderId: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      uploadedBy: { select: { name: true, email: true } },
      order: {
        select: { id: true, title: true, orderNumber: true, companyId: true },
      },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };

  const allowed = await canReadDocument(session, doc);
  if (!allowed) return { ok: false, error: 'not_found' };

  const gross = doc.amountGross ?? null;

  // `У-148`: признак оплаты считается только у счёта и только по платежам
  // ЕГО заказа. Отдельным запросом, а не вложенным select: у остальных типов
  // документов платежи не спрашиваются вовсе.
  let payment: InvoicePaymentResult | null = null;
  if (doc.type === 'invoice' && doc.orderId && doc.number && gross !== null) {
    const payments = await prisma.payment.findMany({
      where: { orderId: doc.orderId },
      select: { amount: true, isRefund: true, purpose: true, note: true },
    });
    payment = invoicePaymentState({
      number: doc.number,
      amountGross: gross.toFixed(2),
      payments: payments.map((p) => ({
        amount: p.amount.toFixed(2),
        isRefund: p.isRefund,
        purpose: p.purpose,
        note: p.note,
      })),
    });
  }

  return {
    ok: true,
    document: {
      id: doc.id,
      name: doc.name,
      type: doc.type,
      direction: doc.direction,
      number: doc.number,
      version: doc.version,
      size: doc.size,
      mimeType: doc.mimeType,
      scanStatus: doc.scanStatus,
      scanReason: doc.scanReason,
      signedAt: doc.signedAt,
      createdAt: doc.createdAt,
      /**
       * `У-164`: состояние ДЛЯ ПОКАЗА. Задача истечения ходит ночью, а карточку
       * могут открыть раньше — показывать «Отправлен» у предложения с
       * вышедшим сроком значит предложить нажать «Принять» и получить отказ.
       * Считаем здесь, на сервере: клиентский компонент, взявший «сейчас»
       * сам, дал бы разные значения при отрисовке на сервере и в браузере.
       */
      status: proposalDisplayStatus(doc, now ?? new Date()),
      // Decimal через границу server→client не проходит. `?? null` покрывает и
      // документы, выпущенные до этапа 6: итогов у них нет (`У-146`).
      amountGross: gross === null ? null : gross.toFixed(2),
      sentAt: doc.sentAt ?? null,
      acceptedAt: doc.acceptedAt ?? null,
      payment,
      uploadedByName: doc.uploadedBy?.name ?? doc.uploadedBy?.email ?? null,
      order: doc.order
        ? { id: doc.order.id, title: doc.order.title, orderNumber: doc.order.orderNumber }
        : null,
      rejectReason: doc.rejectReason,
      counterparty: {
        type: doc.counterpartyType,
        id: doc.counterpartyId,
        name: await counterpartyName(prisma, doc.counterpartyType, doc.counterpartyId),
      },
    },
  };
}
