import type { ExecutionStatus, FinancialStatus } from '@prisma/client';

// ─── 6-стадийный рабочий статус (§10) ───────────────────────────────────────

/**
 * Единственный источник меток 6-стадийной дорожки.
 * Переименование стадий §10 = правка только этого массива, без миграций.
 */
export const WORKING_STAGE_LABELS = [
  'Новая', // index 1
  'Договор', // index 2
  'Оплата', // index 3
  'Обучение', // index 4
  'Документы', // index 5
  'Закрыт', // index 6
] as const;

export type WorkingStageInput = {
  executionStatus: ExecutionStatus;
  contractSignedAt: Date | string | null;
  completedAt: Date | string | null;
  closedAt: Date | string | null;
  /** totalAmount; Decimal сериализуется строкой — принимаем и number */
  amount: string | number;
  /** paidAmount; Decimal сериализуется строкой — принимаем и number */
  paidTotal: string | number;
};

export type WorkingStage = {
  index: number;
  total: 6;
  label: string;
  tone: StageTone;
  terminal: boolean;
};

function hasValue(v: Date | string | null | undefined): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/**
 * Производная 6-стадийная «дорожка» заказа (spec §10).
 * Монотонная: возвращается САМАЯ дальняя достигнутая веха.
 * Не мутирует enum ExecutionStatus и не зависит от 1С-маппингов.
 */
export function orderWorkingStage(input: WorkingStageInput): WorkingStage {
  const { executionStatus } = input;

  // Терминальные состояния вне дорожки
  if (executionStatus === 'cancelled') {
    return { index: 0, total: 6, label: 'Отменён', tone: 'danger', terminal: true };
  }
  if (executionStatus === 'on_hold') {
    return { index: 0, total: 6, label: 'На паузе', tone: 'warning', terminal: true };
  }

  // Монотонная проверка сверху вниз: первое совпадение = самая дальняя веха
  let index: number;

  if (hasValue(input.closedAt)) {
    index = 6;
  } else if (executionStatus === 'completed') {
    index = 5;
  } else if (executionStatus === 'in_progress') {
    index = 4;
  } else if (Number(input.paidTotal) > 0) {
    index = 3;
  } else if (hasValue(input.contractSignedAt)) {
    index = 2;
  } else {
    index = 1;
  }

  const label = WORKING_STAGE_LABELS[index - 1];
  const tone: StageTone = index === 6 ? 'success' : 'neutral';

  return { index, total: 6, label, tone, terminal: false };
}

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
  /** Этап 12 (ФТ-5.4): момент передачи результата клиенту — финальная точка. */
  resultDeliveredAt?: Date | string | null;
};

/**
 * Человеческий статус исполнения заказа.
 * Род мужской — «заказ» (канон терминологии: «Заказы» во всех кабинетах).
 */
export function executionStage(s: ExecutionStatus): Stage {
  switch (s) {
    case 'pending':
      return { label: 'Новый', tone: 'neutral' };
    case 'in_progress':
      return { label: 'В работе', tone: 'neutral' };
    case 'on_hold':
      return { label: 'На паузе', tone: 'warning' };
    case 'completed':
      return { label: 'Завершён', tone: 'success' };
    case 'cancelled':
      return { label: 'Отменён', tone: 'danger' };
    default:
      return { label: '—', tone: 'neutral' };
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

  if (
    financialStatus === 'billed' ||
    financialStatus === 'paid' ||
    financialStatus === 'partially_paid'
  ) {
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

  // ФТ-5.4: результат передан — финальная точка, важнее прочих формулировок.
  // Отменённый заказ выше по приоритету (передавать там нечего).
  if (input.resultDeliveredAt) return { label: 'Результат передан', tone: 'success' };
  if (executionStatus === 'on_hold') return executionStage('on_hold');

  // Возврат — финансовый приоритет над исполнением
  if (financialStatus === 'refunded') return { label: 'Возврат', tone: 'danger' };

  const exec = executionStage(executionStatus);
  const pay = paymentStage({
    financialStatus,
    amount: input.amount,
    paidTotal: input.paidTotal,
    completed: executionStatus === 'completed',
  });

  // Комбинированный бейдж: «Завершён, оплачен» (pay.label с маленькой буквы)
  const payLower = pay.label.charAt(0).toLowerCase() + pay.label.slice(1);
  return { label: `${exec.label}, ${payLower}`, tone: pay.tone };
}
