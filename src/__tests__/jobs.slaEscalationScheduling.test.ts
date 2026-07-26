import { describe, it, expect, vi } from 'vitest';
import { SLA_ESCALATION_SCHEDULES, registerSlaEscalationSchedules } from '@/lib/jobs/scheduling';

// Этап 7 (ФТ-8.5, PR-3) — расписание SLA-эскалации каждые 30 минут.
describe('sla escalation schedule', () => {
  it('зарегистрировано получасовое расписание', () => {
    expect(SLA_ESCALATION_SCHEDULES).toHaveLength(1);
    expect(SLA_ESCALATION_SCHEDULES[0]!.pattern).toBe('*/30 * * * *');
    expect(SLA_ESCALATION_SCHEDULES[0]!.queueName).toBe('monitoring.slaEscalation');
    expect(SLA_ESCALATION_SCHEDULES[0]!.tz).toBe('Europe/Moscow');
  });

  it('registerSlaEscalationSchedules вызывает upsertJobScheduler', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const getQueue = vi.fn().mockReturnValue({ upsertJobScheduler: upsert });
    const res = await registerSlaEscalationSchedules(getQueue as never);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(getQueue).toHaveBeenCalledWith('monitoring.slaEscalation');
    expect(res[0]!.schedulerId).toBe('monitoring.slaEscalation.cron');
  });
});
