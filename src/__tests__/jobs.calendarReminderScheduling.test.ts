import { describe, it, expect, vi } from 'vitest';
import {
  CALENDAR_REMINDER_SCHEDULES,
  registerCalendarReminderSchedules,
} from '@/lib/jobs/scheduling';

describe('calendar reminder schedule (M5)', () => {
  it('зарегистрировано 5-минутное расписание', () => {
    expect(CALENDAR_REMINDER_SCHEDULES).toHaveLength(1);
    expect(CALENDAR_REMINDER_SCHEDULES[0].pattern).toBe('*/5 * * * *');
    expect(CALENDAR_REMINDER_SCHEDULES[0].queueName).toBe('notifications.calendarReminder');
    expect(CALENDAR_REMINDER_SCHEDULES[0].tz).toBe('Europe/Moscow');
  });

  it('registerCalendarReminderSchedules вызывает upsertJobScheduler', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const getQueue = vi.fn().mockReturnValue({ upsertJobScheduler: upsert });
    const res = await registerCalendarReminderSchedules(getQueue as any);
    expect(getQueue).toHaveBeenCalledWith('notifications.calendarReminder');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      'notifications.calendarReminder.cron',
      { pattern: '*/5 * * * *', tz: 'Europe/Moscow' },
      { data: expect.objectContaining({ reason: 'cron' }) }
    );
    expect(res[0].schedulerId).toBe('notifications.calendarReminder.cron');
  });
});
