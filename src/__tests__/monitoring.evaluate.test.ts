import { describe, it, expect } from 'vitest';
import { evaluate, type AlertMetrics } from '@/lib/monitoring/evaluate';
import type { Thresholds } from '@/lib/monitoring/thresholds';

const T: Thresholds = {
  queueWaitingMax: 100,
  dlqMax: 0,
  syncLagMaxMs: 24 * 3600_000,
  renotifyCooldownMs: 6 * 3600_000
};

const noCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };

function metrics(over: Partial<AlertMetrics>): AlertMetrics {
  return { queues: [], syncLag: [], ...over };
}

describe('evaluate', () => {
  it('returns nothing when all metrics are within thresholds', () => {
    expect(evaluate(metrics({}), T)).toEqual([]);
  });

  it('flags queue depth over the waiting threshold', () => {
    const r = evaluate(
      metrics({ queues: [{ queue: 'emails.send', counts: { ...noCounts, waiting: 101 } }] }),
      T
    );
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('queue_depth:emails.send');
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
});
