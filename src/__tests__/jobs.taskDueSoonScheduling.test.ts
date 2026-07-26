import { describe, it, expect, vi } from 'vitest';
import { TASK_DUE_SOON_SCHEDULES, registerTaskDueSoonSchedules } from '@/lib/jobs/scheduling';

// Этап 7 (ФТ-7.2) — дневное расписание «скоро срок задачи» (зеркало certExpiry).
describe('task due soon schedule', () => {
  it('зарегистрировано ежедневное расписание', () => {
    expect(TASK_DUE_SOON_SCHEDULES).toHaveLength(1);
    expect(TASK_DUE_SOON_SCHEDULES[0]!.pattern).toBe('0 7 * * *');
    expect(TASK_DUE_SOON_SCHEDULES[0]!.queueName).toBe('notifications.taskDueSoon');
    expect(TASK_DUE_SOON_SCHEDULES[0]!.tz).toBe('Europe/Moscow');
  });

  it('registerTaskDueSoonSchedules вызывает upsertJobScheduler', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const getQueue = vi.fn().mockReturnValue({ upsertJobScheduler: upsert });
    const res = await registerTaskDueSoonSchedules(getQueue as never);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(getQueue).toHaveBeenCalledWith('notifications.taskDueSoon');
    expect(res[0]!.schedulerId).toBe('notifications.taskDueSoon.cron');
  });
});
