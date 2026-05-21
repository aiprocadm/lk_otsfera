import type { ExecutionStatus, FinancialStatus } from '@prisma/client';

export type StageTone = 'neutral' | 'success' | 'warning' | 'danger';

export type StageInput = {
  executionStatus: ExecutionStatus;
  financialStatus: FinancialStatus;
};

export type Stage = {
  label: string;
  tone: StageTone;
};

export function humanStage(input: StageInput): Stage {
  const { executionStatus, financialStatus } = input;

  if (executionStatus === 'cancelled') return { label: 'Отменена', tone: 'danger' };
  if (executionStatus === 'on_hold') return { label: 'На паузе', tone: 'warning' };

  if (executionStatus === 'pending' && financialStatus === 'not_billed')
    return { label: 'Новая, счёт не выставлен', tone: 'neutral' };
  if (executionStatus === 'pending' && financialStatus === 'billed')
    return { label: 'Ожидает старта, выставлен счёт', tone: 'neutral' };
  if (executionStatus === 'in_progress' && financialStatus === 'not_billed')
    return { label: 'В работе, счёт не выставлен', tone: 'warning' };
  if (executionStatus === 'in_progress' && financialStatus === 'billed')
    return { label: 'В работе, выставлен счёт', tone: 'neutral' };
  if (executionStatus === 'in_progress' && financialStatus === 'partially_paid')
    return { label: 'В работе, частично оплачена', tone: 'warning' };
  if (executionStatus === 'in_progress' && financialStatus === 'paid')
    return { label: 'В работе, оплачена', tone: 'success' };
  if (executionStatus === 'in_progress' && financialStatus === 'refunded')
    return { label: 'Возврат', tone: 'danger' };
  if (executionStatus === 'completed' && financialStatus === 'paid')
    return { label: 'Завершена, оплачена', tone: 'success' };
  if (executionStatus === 'completed' && financialStatus === 'partially_paid')
    return { label: 'Завершена, частично оплачена', tone: 'warning' };
  if (executionStatus === 'completed' && financialStatus === 'billed')
    return { label: 'Завершена, ожидаем оплату', tone: 'warning' };
  if (executionStatus === 'completed' && financialStatus === 'not_billed')
    return { label: 'Завершена, счёт не выставлен', tone: 'warning' };
  if (executionStatus === 'completed' && financialStatus === 'refunded')
    return { label: 'Возврат', tone: 'danger' };

  // комбинации вроде pending+refunded не встречаются в реальном бизнес-процессе — fallback
  return { label: '—', tone: 'neutral' };
}
