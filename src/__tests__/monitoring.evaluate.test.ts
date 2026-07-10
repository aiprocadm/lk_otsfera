import { describe, it, expect } from 'vitest';
import { evaluate, type AlertMetrics } from '@/lib/monitoring/evaluate';
import { getThresholds } from '@/lib/monitoring/thresholds';
import type { Thresholds } from '@/lib/monitoring/thresholds';

const T: Thresholds = {
  queueWaitingMax: 100,
  dlqMax: 0,
  syncLagMaxMs: 24 * 3600_000,
  renotifyCooldownMs: 6 * 3600_000,
  oneCDeadLetterMax: 0
};

const noCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };

function metrics(over: Partial<AlertMetrics>): AlertMetrics {
  return { queues: [], syncLag: [], pendingDeadLetters: 0, ...over };
}

describe('evaluate', () => {
  it('returns nothing when all metrics are within thresholds', () => {
    expect(evaluate(metrics({}), T)).toEqual([]);
  });

  it('flags queue depth over the waiting threshold', () => {
    const r = evaluate(
      metrics({ queues: [{ queue: 'notifications.dispatch', counts: { ...noCounts, waiting: 101 } }] }),
      T
    );
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('queue_depth:notifications.dispatch');
    expect(r[0].value).toBe(101);
  });

  it('flags any DLQ entry (failed > 0)', () => {
    const r = evaluate(
      metrics({ queues: [{ queue: 'docs.scanDocument', counts: { ...noCounts, failed: 1 } }] }),
      T
    );
    expect(r.map((b) => b.key)).toContain('dlq:docs.scanDocument');
    expect(r.find((b) => b.key.startsWith('dlq:'))?.severity).toBe('critical');
  });

  it('flags sync lag over the threshold and ignores null lag', () => {
    const r = evaluate(
      metrics({
        syncLag: [
          { entity: 'order', lastSuccessAt: null, lagMs: 25 * 3600_000, successCount24h: 0, errorCount24h: 0 },
          { entity: 'payment', lastSuccessAt: null, lagMs: null, successCount24h: 0, errorCount24h: 0 }
        ]
      }),
      T
    );
    expect(r.map((b) => b.key)).toEqual(['sync_lag:order']);
  });

  it('flags dead-lettered 1C pending records as critical when above threshold', () => {
    const r = evaluate(
      metrics({ pendingDeadLetters: 1 }),
      getThresholds({})
    );
    const breach = r.find((b) => b.key === 'onec_dead_letters');
    expect(breach).toBeDefined();
    expect(breach?.severity).toBe('critical');
    expect(breach?.value).toBe(1);
  });

  it('does not flag dead-lettered records when count is at or below threshold', () => {
    const r = evaluate(metrics({ pendingDeadLetters: 0 }), getThresholds({}));
    expect(r.find((b) => b.key === 'onec_dead_letters')).toBeUndefined();
  });
});
