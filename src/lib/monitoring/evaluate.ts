import type { QueueStatsRow } from '@/lib/services/admin/queueStats';
import type { SyncLagRow } from '@/lib/services/admin/syncHealth';
import type { Thresholds } from './thresholds';

export type Severity = 'warning' | 'critical';
export type Breach = { key: string; severity: Severity; message: string; value: number };
export type AlertMetrics = { queues: QueueStatsRow[]; syncLag: SyncLagRow[]; pendingDeadLetters: number };

export function evaluate(metrics: AlertMetrics, t: Thresholds): Breach[] {
  const breaches: Breach[] = [];

  for (const { queue, counts } of metrics.queues) {
    if (counts.waiting > t.queueWaitingMax) {
      breaches.push({
        key: `queue_depth:${queue}`,
        severity: 'warning',
        message: `Очередь ${queue}: ${counts.waiting} задач в ожидании (порог ${t.queueWaitingMax})`,
        value: counts.waiting
      });
    }
    if (counts.failed > t.dlqMax) {
      breaches.push({
        key: `dlq:${queue}`,
        severity: 'critical',
        message: `Очередь ${queue}: ${counts.failed} упавших задач в DLQ (порог ${t.dlqMax})`,
        value: counts.failed
      });
    }
  }

  for (const row of metrics.syncLag) {
    if (row.lagMs !== null && row.lagMs > t.syncLagMaxMs) {
      const lagHours = Math.floor(row.lagMs / 3600_000);
      const maxHours = Math.floor(t.syncLagMaxMs / 3600_000);
      breaches.push({
        key: `sync_lag:${row.entity}`,
        severity: 'critical',
        message: `Синхронизация ${row.entity}: лаг ${lagHours}ч (порог ${maxHours}ч)`,
        value: row.lagMs
      });
    }
  }

  if (metrics.pendingDeadLetters > t.oneCDeadLetterMax) {
    breaches.push({
      key: 'onec_dead_letters',
      severity: 'critical',
      message: `1С: ${metrics.pendingDeadLetters} записей не удалось применить (dead-letter, порог ${t.oneCDeadLetterMax})`,
      value: metrics.pendingDeadLetters,
    });
  }

  return breaches;
}
