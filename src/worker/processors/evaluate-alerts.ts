import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import { getQueueStats } from '@/lib/services/admin/queueStats';
import { getSyncLag } from '@/lib/services/admin/syncHealth';
import { getThresholds } from '@/lib/monitoring/thresholds';
import { evaluate } from '@/lib/monitoring/evaluate';
import { diffAlerts } from '@/lib/monitoring/dedup';
import { deliverAlert } from '@/lib/monitoring/deliver';
import type { SyncJobPayload } from '@/lib/jobs/types';

const INT32_MAX = 2_147_483_647;

export type EvaluateAlertsResult = { fired: number; renotified: number; resolved: number };

export async function evaluateAlertsProcessor(
  _job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<EvaluateAlertsResult> {
  const t = getThresholds();
  const [queues, syncLag, pendingDeadLetters] = await Promise.all([
    getQueueStats(),
    getSyncLag(db),
    db.oneCPendingRecord.count({ where: { status: 'dead' } }),
  ]);
  const breaches = evaluate({ queues, syncLag, pendingDeadLetters }, t);

  const active = await db.alertState.findMany({
    where: { status: 'firing' },
    select: { key: true, lastNotifiedAt: true, message: true },
  });
  const now = new Date();
  const { toFire, toRenotify, toResolve } = diffAlerts(breaches, active, now, t.renotifyCooldownMs);

  for (const b of [...toFire, ...toRenotify]) {
    await deliverAlert(db, { kind: 'fire', message: b.message });
    await db.alertState.upsert({
      where: { key: b.key },
      create: {
        key: b.key,
        status: 'firing',
        severity: b.severity,
        message: b.message,
        value: Math.min(Math.trunc(b.value), INT32_MAX),
        firstSeenAt: now,
        lastNotifiedAt: now,
      },
      update: {
        status: 'firing',
        severity: b.severity,
        message: b.message,
        value: Math.min(Math.trunc(b.value), INT32_MAX),
        lastNotifiedAt: now,
        resolvedAt: null,
      },
    });
  }

  for (const key of toResolve) {
    const prev = active.find((a) => a.key === key);
    /* v8 ignore next -- prev is always found: toResolve keys come from active; ?? key is an unreachable defensive fallback */
    await deliverAlert(db, { kind: 'resolve', message: `Восстановлено: ${prev?.message ?? key}` });
    await db.alertState.update({
      where: { key },
      data: { status: 'resolved', resolvedAt: now },
    });
  }

  return { fired: toFire.length, renotified: toRenotify.length, resolved: toResolve.length };
}
