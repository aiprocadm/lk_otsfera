import { describe, it, expect, vi } from 'vitest';
import {
  ALL_SCHEDULES,
  PROPOSAL_EXPIRY_SCHEDULES,
  registerProposalExpirySchedules,
} from '@/lib/jobs/scheduling';

/**
 * `У-164` (этап 7) — расписание задачи «истёк срок коммерческого предложения».
 */
describe('расписание истечения КП', () => {
  it('ночью в 01:00 по Москве, а не утром вместе с остальными', () => {
    // Расчёт «истекло» на экране переворачивается в московскую полночь. Чем
    // позже отработает задача, тем дольше карточка говорит «истёк срок», а в
    // базе ещё «отправлен». Час — запас на перевод часов и дрейф времени.
    expect(PROPOSAL_EXPIRY_SCHEDULES).toHaveLength(1);
    expect(PROPOSAL_EXPIRY_SCHEDULES[0]!.pattern).toBe('0 1 * * *');
    expect(PROPOSAL_EXPIRY_SCHEDULES[0]!.tz).toBe('Europe/Moscow');
    expect(PROPOSAL_EXPIRY_SCHEDULES[0]!.queueName).toBe('docs.expireProposals');
  });

  it('регистрация идемпотентна: фиксированный id планировщика', async () => {
    // Перезапуск воркера не должен плодить дубли расписания.
    const upsert = vi.fn().mockResolvedValue(undefined);
    const getQueue = vi.fn().mockReturnValue({ upsertJobScheduler: upsert });
    const res = await registerProposalExpirySchedules(getQueue as never);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(res[0]!.schedulerId).toBe('docs.expireProposals.cron');
  });

  it('попадает в общий реестр и НЕ правится из интерфейса', () => {
    // Без записи в общем реестре расписание не покажется на экране
    // «Автообмен» — задача выглядела бы несуществующей. Правится оно не
    // человеком: время привязано к границе суток, а не к удобству.
    const row = ALL_SCHEDULES.find((s) => s.schedulerId === 'docs.expireProposals.cron');
    expect(row).toBeTruthy();
    expect(row!.editable).toBe(false);
  });
});
