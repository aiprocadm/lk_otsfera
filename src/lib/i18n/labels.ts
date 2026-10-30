import type { DocumentDirection, ExecutionStatus, FinancialStatus } from '@prisma/client';

/**
 * Словари «код 1С → русская подпись». Коды — свободные строки из 1С,
 * поэтому всегда fallback на исходный код (не падать на новом значении).
 */
const ORDER_TYPE_RU: Record<string, string> = {
  supply: 'Поставка',
  service: 'Услуги',
  training: 'Обучение',
};

export function orderTypeRu(code: string): string {
  return ORDER_TYPE_RU[code] ?? code;
}

const PAYMENT_METHOD_RU: Record<string, string> = {
  wire: 'Банковский перевод',
  card: 'Карта',
  cash: 'Наличные',
};

export function paymentMethodRu(code: string | null | undefined): string {
  if (!code) return '—';
  return PAYMENT_METHOD_RU[code] ?? code;
}

/**
 * `У-328` (`Д-62`, ТЗ 28.10.2026): статусы заказа и направление документа —
 * перечисления базы, а не свободные строки 1С. Тип `Record<перечисление, …>`
 * не даст забыть новое значение: без подписи не соберётся. Один источник для
 * экранов, писем и выгрузок — правило зеркала (одно название везде).
 */
const EXECUTION_STATUS_RU: Record<ExecutionStatus, string> = {
  pending: 'Ожидает старта',
  in_progress: 'В работе',
  on_hold: 'На паузе',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

export function executionStatusRu(code: string): string {
  return EXECUTION_STATUS_RU[code as ExecutionStatus] ?? code;
}

const FINANCIAL_STATUS_RU: Record<FinancialStatus, string> = {
  not_billed: 'Счёт не выставлен',
  billed: 'Счёт выставлен',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  refunded: 'Возврат',
};

export function financialStatusRu(code: string): string {
  return FINANCIAL_STATUS_RU[code as FinancialStatus] ?? code;
}

const DOCUMENT_DIRECTION_RU: Record<DocumentDirection, string> = {
  incoming: 'Входящий',
  outgoing: 'Исходящий',
};

export function documentDirectionRu(code: string): string {
  return DOCUMENT_DIRECTION_RU[code as DocumentDirection] ?? code;
}
