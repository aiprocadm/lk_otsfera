import { describe, it, expect, vi } from 'vitest';
import { CERT_EXPIRY_SCHEDULES, registerCertExpirySchedules } from '@/lib/jobs/scheduling';

describe('cert expiry schedule', () => {
  it('зарегистрировано ежедневное расписание', () => {
    expect(CERT_EXPIRY_SCHEDULES).toHaveLength(1);
    expect(CERT_EXPIRY_SCHEDULES[0].pattern).toBe('0 7 * * *');
    expect(CERT_EXPIRY_SCHEDULES[0].queueName).toBe('notifications.certificateExpiry');
  });

  it('registerCertExpirySchedules вызывает upsertJobScheduler', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const getQueue = vi.fn().mockReturnValue({ upsertJobScheduler: upsert });
    const res = await registerCertExpirySchedules(getQueue as any);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(res[0].schedulerId).toBe('notifications.certificateExpiry.cron');
  });
});
