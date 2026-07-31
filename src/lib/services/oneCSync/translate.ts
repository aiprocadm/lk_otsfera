import type { FinancialStatus, ExecutionStatus } from '@prisma/client';

type Tr<T> = { ok: true; value: T } | { ok: false };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ё/g, 'е');

const FIN: Record<string, FinancialStatus> = {
  'не выставлен': 'not_billed',
  'счет выставлен': 'billed',
  счет: 'billed',
  'частично оплачено': 'partially_paid',
  оплачено: 'paid',
  возврат: 'refunded',
};
const EXEC: Record<string, ExecutionStatus> = {
  новый: 'pending',
  ожидает: 'pending',
  'в работе': 'in_progress',
  выполнен: 'completed',
  отменен: 'cancelled',
  приостановлен: 'on_hold',
};

export function translateFinancialStatus(raw: string): Tr<FinancialStatus> {
  const v = FIN[norm(raw)];
  return v ? { ok: true, value: v } : { ok: false };
}
export function translateExecutionStatus(raw: string): Tr<ExecutionStatus> {
  const v = EXEC[norm(raw)];
  return v ? { ok: true, value: v } : { ok: false };
}
