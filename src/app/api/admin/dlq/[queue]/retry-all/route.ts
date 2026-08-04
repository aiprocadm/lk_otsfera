import { NextResponse } from 'next/server';
import { jsonError, routeParams } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { requireAdmin } from '@/lib/auth/guard';
import { QUEUE_NAMES, type QueueName } from '@/lib/jobs/queues';
import { retryAllDlq } from '@/lib/services/admin/queueStats';
import { recordAudit } from '@/lib/auth/audit';
import { prisma } from '@/lib/db/prisma';
import { log } from '@/lib/logging';

function isKnownQueue(name: string): name is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(name);
}

export const POST = withAuth({ guard: requireAdmin }, async ({ session, params }) => {
  // Next.js всегда даёт сегмент [queue] для этого файла роута; withAuth типизирует
  // params как Record<string,string>, которая под noUncheckedIndexedAccess сужение теряет.
  const { queue } = await routeParams<{ queue: string }>(params);
  if (!isKnownQueue(queue)) {
    return jsonError('UNKNOWN_QUEUE', 400);
  }

  const result = await retryAllDlq(queue);
  if (!result.ok) {
    return jsonError(result.error, 503);
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'sync_dlq_bulk_retried',
    entity: 'job_queue',
    entityId: queue,
    after: { retried: result.retried, failed: result.failed, truncated: result.truncated },
  }).catch((e) => log.warn('[dlq/retry-all] audit failed', e));

  return NextResponse.json({
    retried: result.retried,
    failed: result.failed,
    truncated: result.truncated,
  });
});
