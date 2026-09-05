import { describe, it, expect } from 'vitest';
import { evaluate, type AlertMetrics } from '@/lib/monitoring/evaluate';
import { getThresholds } from '@/lib/monitoring/thresholds';
import type { Thresholds } from '@/lib/monitoring/thresholds';

const T: Thresholds = {
  queueWaitingMax: 100,
  dlqMax: 0,
  syncLagMaxMs: 24 * 3600_000,
  renotifyCooldownMs: 6 * 3600_000,
  oneCDeadLetterMax: 0,
  oneCPushFailedMax: 0,
};

const noCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };

function metrics(over: Partial<AlertMetrics>): AlertMetrics {
  return { queues: [], syncLag: [], pendingDeadLetters: 0, failedDocumentPushes: 0, ...over };
}

describe('evaluate', () => {
  it('returns nothing when all metrics are within thresholds', () => {
    expect(evaluate(metrics({}), T)).toEqual([]);
  });

  it('flags queue depth over the waiting threshold', () => {
    const r = evaluate(
      metrics({
        queues: [{ queue: 'notifications.dispatch', counts: { ...noCounts, waiting: 101 } }],
      }),
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
          {
            entity: 'order',
            lastSuccessAt: null,
            lagMs: 25 * 3600_000,
            successCount24h: 0,
            errorCount24h: 0,
          },
          {
            entity: 'payment',
            lastSuccessAt: null,
            lagMs: null,
            successCount24h: 0,
            errorCount24h: 0,
          },
        ],
      }),
      T
    );
    expect(r.map((b) => b.key)).toEqual(['sync_lag:order']);
  });

  it('flags dead-lettered 1C pending records as critical when above threshold', () => {
    const r = evaluate(metrics({ pendingDeadLetters: 1 }), getThresholds({}));
    const breach = r.find((b) => b.key === 'onec_dead_letters');
    expect(breach).toBeDefined();
    expect(breach?.severity).toBe('critical');
    expect(breach?.value).toBe(1);
  });

  it('does not flag dead-lettered records when count is at or below threshold', () => {
    const r = evaluate(metrics({ pendingDeadLetters: 0 }), getThresholds({}));
    expect(r.find((b) => b.key === 'onec_dead_letters')).toBeUndefined();
  });

  describe('У-174: документы, которые 1С не приняла', () => {
    it('выше порога — предупреждение с числом и порогом, по-русски', () => {
      const r = evaluate(metrics({ failedDocumentPushes: 3 }), { ...T, oneCPushFailedMax: 2 });
      const breach = r.find((b) => b.key === 'onec_push_failed');
      expect(breach).toEqual({
        key: 'onec_push_failed',
        severity: 'warning',
        message: '1С: 3 документа не выгружено (порог 2)',
        value: 3,
      });
    });

    it('склоняет число: 1 документ не выгружен · 5 документов не выгружено', () => {
      const one = evaluate(metrics({ failedDocumentPushes: 1 }), T);
      expect(one.find((b) => b.key === 'onec_push_failed')?.message).toBe(
        '1С: 1 документ не выгружен (порог 0)'
      );
      const five = evaluate(metrics({ failedDocumentPushes: 5 }), T);
      expect(five.find((b) => b.key === 'onec_push_failed')?.message).toBe(
        '1С: 5 документов не выгружено (порог 0)'
      );
    });

    it('на пороге и ниже — молчит: порог значит «столько терпим»', () => {
      expect(
        evaluate(metrics({ failedDocumentPushes: 2 }), { ...T, oneCPushFailedMax: 2 })
      ).toEqual([]);
      expect(evaluate(metrics({ failedDocumentPushes: 0 }), T)).toEqual([]);
    });

    it('порог из getThresholds: умолчание 0 — один невыгруженный уже тревога', () => {
      const r = evaluate(metrics({ failedDocumentPushes: 1 }), getThresholds({}));
      expect(r.map((b) => b.key)).toEqual(['onec_push_failed']);
    });
  });
});
