import { describe, it, expect } from 'vitest';
import { getThresholds } from '@/lib/monitoring/thresholds';

describe('getThresholds', () => {
  it('uses documented defaults when env is empty', () => {
    const t = getThresholds({});
    expect(t.queueWaitingMax).toBe(100);
    expect(t.dlqMax).toBe(0);
    expect(t.syncLagMaxMs).toBe(24 * 3600_000);
    expect(t.renotifyCooldownMs).toBe(6 * 3600_000);
    expect(t.oneCDeadLetterMax).toBe(0);
    // `У-174`: по умолчанию терпим ноль невыгруженных документов.
    expect(t.oneCPushFailedMax).toBe(0);
  });

  it('reads overrides from env', () => {
    const t = getThresholds({
      ALERT_QUEUE_WAITING_MAX: '5',
      ALERT_DLQ_MAX: '2',
      ALERT_SYNC_LAG_MAX_HOURS: '1',
      ALERT_RENOTIFY_COOLDOWN_HOURS: '2',
      ALERT_ONEC_DEADLETTER_MAX: '3',
      ALERT_ONEC_PUSH_FAILED_MAX: '4',
    });
    expect(t.queueWaitingMax).toBe(5);
    expect(t.dlqMax).toBe(2);
    expect(t.syncLagMaxMs).toBe(3600_000);
    expect(t.renotifyCooldownMs).toBe(2 * 3600_000);
    expect(t.oneCDeadLetterMax).toBe(3);
    expect(t.oneCPushFailedMax).toBe(4);
  });

  it('falls back to default on non-numeric env', () => {
    const t = getThresholds({ ALERT_QUEUE_WAITING_MAX: 'abc' });
    expect(t.queueWaitingMax).toBe(100);
  });
});
