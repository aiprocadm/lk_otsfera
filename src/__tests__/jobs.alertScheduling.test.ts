import { describe, it, expect, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { registerAlertSchedules, ALERT_SCHEDULES } from '@/lib/jobs/scheduling';

describe('registerAlertSchedules', () => {
  it('registers the evaluate-alerts cron with Europe/Moscow tz', async () => {
    const calls: Array<{ id: string; opts: { pattern?: string; tz?: string } }> = [];
    const getQueue = () =>
      ({
        upsertJobScheduler: vi.fn(async (id: string, opts) => {
          calls.push({ id, opts: opts as { pattern?: string; tz?: string } });
          return { id };
        })
      }) as unknown as Queue;

    const result = await registerAlertSchedules(getQueue as never);
    expect(result).toHaveLength(ALERT_SCHEDULES.length);
    expect(result).toHaveLength(1);
    expect(result[0].queueName).toBe('monitoring.evaluateAlerts');
    expect(calls[0].opts.tz).toBe('Europe/Moscow');
    expect(calls[0].opts.pattern).toBe('*/5 * * * *');
  });
});
