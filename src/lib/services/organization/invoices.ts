import type { PrismaClient, Prisma } from '@prisma/client';
import { organizationChannelWhere } from '@/lib/auth/documentChannelPolicy';
import { moscowDayRange } from '@/lib/dates/calendar';
import type { OrgOrderScope } from '@/lib/auth/organizationPolicy';
import {
  invoicePaymentState,
  PAYMENT_STATE_LABELS,
  type InvoicePaymentPayment,
  type InvoicePaymentState,
} from '@/lib/documents/invoicePayment';

/**
 * Счета заказчика (этап 6 ТЗ 12.09.2026, `У-235`).
 *
 * Признак оплаты — тот же расчёт, что в карточке документа (`У-148`,
 * `invoicePaymentState`): по платежам заказа с привязкой «платёж → счёт»
 * через назначение платежа. Второго расчёта не заводим: два расчёта разошлись
 * бы, и карточка счёта говорила бы одно, а список — другое.
 *
 * `unknown` — «признак не показываем»: у счёта нет номера, нет итоговой суммы
 * (документы до этапа 6) или нет заказа. Это не «не оплачен»: утверждать об
 * оплате, не имея по чему судить, нельзя.
 */
export type OrgInvoiceState = InvoicePaymentState | 'unknown';

export const ORG_INVOICE_STATES: OrgInvoiceState[] = [
  'unpaid',
  'partially_paid',
  'paid',
  'unknown',
];

export const ORG_INVOICE_STATE_LABELS: Record<OrgInvoiceState, string> = {
  ...PAYMENT_STATE_LABELS,
  unknown: 'Не определено',
};

export type OrgInvoiceRow = {
  id: string;
  number: string | null;
  name: string;
  issuedAt: Date;
  orderId: string | null;
  orderNumber: string | null;
  orderTitle: string | null;
  /** Итог с НДС; строкой — Decimal через границу server→client не проходит. */
  amountGross: string | null;
  /** Зачтено по счёту; `null`, когда признак не считается. */
  paid: string | null;
  /** Остаток к оплате; `null`, когда признак не считается. */
  due: string | null;
  state: OrgInvoiceState;
  /** Хотя бы один платёж сослался на этот счёт. */
  matched: boolean;
  /** Был платёж, назвавший несколько счетов сразу, — деньги не разнесены. */
  ambiguous: boolean;
};

export type OrgInvoicesFilter = {
  organizationId: string;
  from?: Date | undefined;
  /** Верх периода, не включая его: полночь по Москве после дня «по». */
  to?: Date | undefined;
  state?: OrgInvoiceState | undefined;
  /** `У-236`: граница видимости участника; `null` — видно всё по организации. */
  scope: OrgOrderScope;
};

export type OrgInvoicesResult = {
  rows: OrgInvoiceRow[];
  /** Счетов за период до фильтра по состоянию. */
  total: number;
  /** Сумма остатков по неоплаченным и частично оплаченным счетам периода, ₽. */
  toPay: string;
  counts: Record<OrgInvoiceState, number>;
};

/** Верхняя граница выборки: экран и выгрузка показывают не больше. */
export const ORG_INVOICES_TAKE = 200;

export function parseInvoiceState(raw: string | undefined): OrgInvoiceState | undefined {
  return ORG_INVOICE_STATES.find((s) => s === raw);
}

/**
 * `YYYY-MM-DD` из строки запроса → граница московских суток: `from` — их
 * начало (включительно), `to` — полночь следующих суток (не включая, `lt`).
 * Мусор и несуществующий день — «без границы».
 *
 * Прогон сопровождения №36: раньше сутки считались по Гринвичу. Счёт,
 * выставленный 31.08 в 01:30 по Москве (30.08 22:30 по Гринвичу), не попадал в
 * период «с 31.08», а выставленный 01.09 в 01:30 МСК попадал в «по 31.08».
 */
export function parseInvoiceDate(raw: string | undefined, edge: 'from' | 'to'): Date | undefined {
  const day = raw ? moscowDayRange(raw) : null;
  if (!day) return undefined;
  return edge === 'from' ? day.gte : day.lt;
}

type InvoiceDoc = {
  id: string;
  number: string | null;
  name: string;
  createdAt: Date;
  amountGross: Prisma.Decimal | null;
  orderId: string | null;
  order: { orderNumber: string | null; title: string } | null;
};

function toRow(
  d: InvoiceDoc,
  paymentsByOrder: Map<string, InvoicePaymentPayment[]>
): OrgInvoiceRow {
  const base = {
    id: d.id,
    number: d.number,
    name: d.name,
    issuedAt: d.createdAt,
    orderId: d.orderId,
    orderNumber: d.order?.orderNumber ?? null,
    orderTitle: d.order?.title ?? null,
  };
  const unknown = (amountGross: string | null): OrgInvoiceRow => ({
    ...base,
    amountGross,
    paid: null,
    due: null,
    state: 'unknown',
    matched: false,
    ambiguous: false,
  });
  const gross = d.amountGross;
  // Без заказа судить не по чему: платежи привязаны к заказу (как в карточке документа).
  if (!d.orderId || gross === null) return unknown(gross === null ? null : gross.toFixed(2));
  const grossStr = gross.toFixed(2);
  const result = invoicePaymentState({
    number: d.number,
    amountGross: grossStr,
    payments: paymentsByOrder.get(d.orderId) ?? [],
  });
  if (!result) return unknown(grossStr);
  // Копейки: сравнение сумм не должно зависеть от плавающей точки.
  const grossKopecks = Math.round(Number(grossStr) * 100);
  // Возврат больше оплаты даёт отрицательное «зачтено» — клиенту показываем 0,
  // а остаток не больше самого счёта: должны не больше, чем выставили.
  const paidKopecks = Math.max(0, Math.round(result.paid * 100));
  return {
    ...base,
    amountGross: grossStr,
    paid: (paidKopecks / 100).toFixed(2),
    due: (Math.max(0, grossKopecks - paidKopecks) / 100).toFixed(2),
    state: result.state,
    matched: result.matched,
    ambiguous: result.ambiguous,
  };
}

export async function listOrgInvoices(
  prisma: PrismaClient,
  filter: OrgInvoicesFilter
): Promise<OrgInvoicesResult> {
  const dateFilter: Prisma.DocumentWhereInput =
    filter.from || filter.to
      ? {
          createdAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            // `to` — полночь после последнего дня периода (`parseInvoiceDate`).
            ...(filter.to ? { lt: filter.to } : {}),
          },
        }
      : {};

  const docs = await prisma.document.findMany({
    where: {
      // Канал заказчика: действующая версия, без заражённых, без чужих.
      ...organizationChannelWhere(filter.organizationId),
      type: 'invoice',
      // Отменённый счёт оплате не подлежит — в «к оплате» ему не место.
      status: { not: 'cancelled' },
      // `У-236`: счёт называет заказ, значит границу зрителя держит и он.
      // Счёт без заказа «своим» быть не может — связь его тоже отсекает.
      ...(filter.scope ? { order: filter.scope.where } : {}),
      ...dateFilter,
    },
    // Хвост `id`: пачка документов одного заказа получает общий `createdAt`.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: ORG_INVOICES_TAKE,
    select: {
      id: true,
      number: true,
      name: true,
      createdAt: true,
      amountGross: true,
      orderId: true,
      order: { select: { orderNumber: true, title: true } },
    },
  });

  const orderIds = Array.from(
    new Set(docs.map((d) => d.orderId).filter((id): id is string => id !== null))
  );
  const payments = orderIds.length
    ? await prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, amount: true, isRefund: true, purpose: true, note: true },
      })
    : [];
  const paymentsByOrder = new Map<string, InvoicePaymentPayment[]>();
  for (const p of payments) {
    // `where.orderId.in` не возвращает платежей без заказа — ветка недостижима.
    /* v8 ignore next */
    if (!p.orderId) continue;
    const list = paymentsByOrder.get(p.orderId) ?? [];
    list.push({
      amount: p.amount.toFixed(2),
      isRefund: p.isRefund,
      purpose: p.purpose,
      note: p.note,
    });
    paymentsByOrder.set(p.orderId, list);
  }

  const rows = docs.map((d) => toRow(d, paymentsByOrder));
  const counts: Record<OrgInvoiceState, number> = {
    unpaid: 0,
    partially_paid: 0,
    paid: 0,
    unknown: 0,
  };
  let toPayKopecks = 0;
  for (const r of rows) {
    counts[r.state] += 1;
    if ((r.state === 'unpaid' || r.state === 'partially_paid') && r.due !== null) {
      toPayKopecks += Math.round(Number(r.due) * 100);
    }
  }
  const filtered = filter.state ? rows.filter((r) => r.state === filter.state) : rows;
  return { rows: filtered, total: rows.length, toPay: (toPayKopecks / 100).toFixed(2), counts };
}
