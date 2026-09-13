import type { ExecutionStatus, FinancialStatus } from '@prisma/client';
import type { BitrixDeal } from '../source';
import type { MappingContext, Plan } from './types';

/**
 * Выигранная сделка → заказ (`У-197`, `Р-Б-2`, спека §3.5).
 *
 * Сначала ищем ЗАКАЗ ИЗ 1С той же организации, похожий на эту сделку: если
 * работа уже проведена бухгалтерией, второй заказ создавать нельзя — сделка
 * просто привязывается к нему (действие `linked`, откат снимает связь).
 * Похожесть намеренно грубая: сумма ±1 % и дата ±30 дней. Точнее не выйдет —
 * в Битриксе суммы округляли, а даты ставили «когда вспомнили».
 *
 * Ничего не нашли — заводим заказ-историю: он закрыт, выполнен и БЕЗ денег
 * (`not_billed`, `paidAmount 0`). Деньги считает 1С, и заказы из Битрикса ей
 * не мешают: ключи `bitrix:deal:<id>` с её `externalId` не пересекаются.
 */
export type OrderData = {
  externalId: string;
  title: string;
  companyId: string;
  organizationId: string;
  managerId: string | null;
  totalAmount: string;
  statusId: string | null;
  executionStatus: ExecutionStatus;
  financialStatus: FinancialStatus;
  closedAt: Date | null;
  completedAt: Date | null;
};

/** Заказ ЛК, с которым сравнивается выигранная сделка. */
export type CandidateOrder = {
  id: string;
  externalId: string | null;
  orderNumber: string | null;
  totalAmount: string;
  closedAt: Date | null;
  completedAt: Date | null;
};

export type OrderPlan =
  | Plan<OrderData>
  /** Нашли готовый заказ 1С — сделку привязываем к нему, ничего не создаём. */
  | { action: 'link'; orderId: string; orderLabel: string };

export const AMOUNT_TOLERANCE = 0.01;
export const DAYS_TOLERANCE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Заказ 1С: `externalId` есть и он не наш. Заказы Битрикса в кандидаты не берём. */
export function isOneCOrder(order: CandidateOrder): boolean {
  return Boolean(order.externalId) && !order.externalId!.startsWith('bitrix:');
}

function amountClose(a: number, b: number): boolean {
  if (a === 0 || b === 0) return a === b;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= AMOUNT_TOLERANCE;
}

function dateClose(a: Date | null, b: Date | null): boolean {
  // Без даты сравнивать нечего — тогда решает только сумма.
  if (!a || !b) return true;
  return Math.abs(a.getTime() - b.getTime()) <= DAYS_TOLERANCE * DAY_MS;
}

export function findMatchingOrder(
  deal: { opportunity: string | null; closeDate: Date | null },
  orders: readonly CandidateOrder[]
): CandidateOrder | undefined {
  // `Number('')` — это ноль, а не «нет суммы»: без этой проверки сделка без
  // суммы прилипала бы к любому нулевому заказу той же организации.
  if (!deal.opportunity) return undefined;
  const amount = Number(deal.opportunity);
  if (!Number.isFinite(amount)) return undefined;
  return orders.find((order) => {
    if (!isOneCOrder(order)) return false;
    if (!amountClose(amount, Number(order.totalAmount))) return false;
    return dateClose(deal.closeDate, order.closedAt ?? order.completedAt);
  });
}

export function bitrixOrderExternalId(dealId: string): string {
  return `bitrix:deal:${dealId}`;
}

export function planOrderForWonDeal(
  deal: BitrixDeal,
  ctx: MappingContext,
  args: {
    organizationId: string | null;
    /** Заказы этой организации, уже известные ЛК. */
    orders: readonly CandidateOrder[];
    /** Статус с якорем «закрыт» — заказ-история сразу закрыт. */
    closedStatusId: string | null;
  }
): OrderPlan {
  if (!args.organizationId) return { action: 'skip', reason: 'no_organization' };

  const own = args.orders.find((o) => o.externalId === bitrixOrderExternalId(deal.id));
  if (own) return { action: 'skip', reason: 'already_linked' };

  const match = findMatchingOrder(deal, args.orders);
  if (match) {
    return {
      action: 'link',
      orderId: match.id,
      // `externalId` у кандидата есть всегда — иначе он не прошёл бы `isOneCOrder`.
      orderLabel: match.orderNumber ?? (match.externalId as string),
    };
  }

  return {
    action: 'create',
    data: {
      externalId: bitrixOrderExternalId(deal.id),
      title: deal.title.trim() || `Заказ по сделке Битрикс24 #${deal.id}`,
      companyId: ctx.companyId,
      organizationId: args.organizationId,
      managerId: ctx.resolveUser(deal.assignedById) ?? ctx.defaultManagerId,
      totalAmount: deal.opportunity ?? '0',
      statusId: args.closedStatusId,
      executionStatus: 'completed',
      financialStatus: 'not_billed',
      closedAt: deal.closeDate,
      completedAt: deal.closeDate,
    },
  };
}
