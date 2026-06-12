import type { ExecutionStatus, FinancialStatus } from '@prisma/client';

export type StageTone = 'neutral' | 'success' | 'warning' | 'danger';

export type Stage = {
  label: string;
  tone: StageTone;
};

export type OrderStageInput = {
  executionStatus: ExecutionStatus;
  financialStatus: FinancialStatus;
  /** Decimal сериализуется строкой; принимаем и number. */
  amount: string | number;
  paidTotal: string | number;
};

const EXEC_RU: Record<string, string> = {
  pending: 'Новый',
  in_progress: 'В работе',
  completed: 'Завершён'
};

/**
 * Человеческий статус заказа. Исполнение — из 1С-статуса; оплата — ИЗ ЧИСЕЛ
 * (1С-статус оплаты бывает рассинхронизирован с платежами и подрывает доверие:
 * «оплачен» рядом с «Долг 100 000 ₽»). financialStatus используется только для
 * различения «счёт выставлен / не выставлен», когда оплат ещё нет.
 * Род мужской — «заказ» (канон терминологии: «Заказы» во всех кабинетах).
 */
export function orderStage(input: OrderStageInput): Stage {
  const { executionStatus, financialStatus } = input;

  if (executionStatus === 'cancelled') return { label: 'Отменён', tone: 'danger' };
  if (executionStatus === 'on_hold') return { label: 'На паузе', tone: 'warning' };
  if (financialStatus === 'refunded') return { label: 'Возврат', tone: 'danger' };

  const exec = EXEC_RU[executionStatus] ?? '—';
  const amount = Number(input.amount);
  const paid = Number(input.paidTotal);

  let pay: string;
  let tone: StageTone;
  if (Number.isFinite(amount) && Number.isFinite(paid) && amount > 0 && paid >= amount) {
    pay = 'оплачен';
    tone = 'success';
  } else if (Number.isFinite(paid) && paid > 0) {
    pay = 'частично оплачен';
    tone = 'warning';
  } else if (financialStatus === 'billed' || financialStatus === 'paid' || financialStatus === 'partially_paid') {
    // 1С считает, что счёт был выставлен (или даже оплачен) — но платежей нет.
    pay = 'счёт выставлен';
    tone = executionStatus === 'completed' ? 'warning' : 'neutral';
  } else {
    pay = 'счёт не выставлен';
    tone = executionStatus === 'completed' ? 'warning' : 'neutral';
  }

  return { label: `${exec}, ${pay}`, tone };
}
