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

/**
 * Человеческий статус исполнения заказа.
 * Род мужской — «заказ» (канон терминологии: «Заказы» во всех кабинетах).
 */
export function executionStage(s: ExecutionStatus): Stage {
  switch (s) {
    case 'pending':     return { label: 'Новый', tone: 'neutral' };
    case 'in_progress': return { label: 'В работе', tone: 'neutral' };
    case 'on_hold':     return { label: 'На паузе', tone: 'warning' };
    case 'completed':   return { label: 'Завершён', tone: 'success' };
    case 'cancelled':   return { label: 'Отменён', tone: 'danger' };
    default:            return { label: '—', tone: 'neutral' };
  }
}

export type PaymentStageInput = {
  financialStatus: FinancialStatus;
  /** Decimal сериализуется строкой; принимаем и number. */
  amount: string | number;
  paidTotal: string | number;
  /** true когда executionStatus === 'completed' — влияет на тон «счёт не оплачен». */
  completed?: boolean;
};

/**
 * Человеческий статус оплаты. Оплата выводится ИЗ ЧИСЕЛ, не из 1С-статуса
 * (1С-статус бывает рассинхронизирован и подрывает доверие).
 * financialStatus используется только для различения «счёт выставлен / не выставлен».
 * Возвращает самостоятельный бейдж (с заглавной буквы).
 */
export function paymentStage(input: PaymentStageInput): Stage {
  const { financialStatus, completed } = input;
  const amount = Number(input.amount);
  const paid = Number(input.paidTotal);

  if (financialStatus === 'refunded') {
    return { label: 'Возврат', tone: 'danger' };
  }

  if (Number.isFinite(amount) && Number.isFinite(paid) && amount > 0 && paid >= amount) {
    return { label: 'Оплачен', tone: 'success' };
  }

  if (Number.isFinite(paid) && paid > 0) {
    return { label: 'Частично оплачен', tone: 'warning' };
  }

  if (financialStatus === 'billed' || financialStatus === 'paid' || financialStatus === 'partially_paid') {
    // 1С считает, что счёт был выставлен (или даже оплачен) — но платежей нет.
    return { label: 'Счёт выставлен', tone: completed ? 'warning' : 'neutral' };
  }

  return { label: 'Счёт не выставлен', tone: completed ? 'warning' : 'neutral' };
}

/**
 * Человеческий статус заказа. Исполнение — из 1С-статуса; оплата — ИЗ ЧИСЕЛ
 * (1С-статус оплаты бывает рассинхронизирован с платежами и подрывает доверие:
 * «оплачен» рядом с «Долг 100 000 ₽»). financialStatus используется только для
 * различения «счёт выставлен / не выставлен», когда оплат ещё нет.
 * Род мужской — «заказ» (канон терминологии: «Заказы» во всех кабинетах).
 */
export function orderStage(input: OrderStageInput): Stage {
  const { executionStatus, financialStatus } = input;

  // Терминальные статусы исполнения: не показываем финансы
  if (executionStatus === 'cancelled') return executionStage('cancelled');
  if (executionStatus === 'on_hold') return executionStage('on_hold');

  // Возврат — финансовый приоритет над исполнением
  if (financialStatus === 'refunded') return { label: 'Возврат', tone: 'danger' };

  const exec = executionStage(executionStatus);
  const pay = paymentStage({
    financialStatus,
    amount: input.amount,
    paidTotal: input.paidTotal,
    completed: executionStatus === 'completed'
  });

  // Комбинированный бейдж: «Завершён, оплачен» (pay.label с маленькой буквы)
  const payLower = pay.label.charAt(0).toLowerCase() + pay.label.slice(1);
  return { label: `${exec.label}, ${payLower}`, tone: pay.tone };
}
