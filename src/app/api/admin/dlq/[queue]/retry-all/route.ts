import { NextResponse } from 'next/server';
import { requireAdmin, requireSession } from '@/lib/auth/guard';
import { QUEUE_NAMES, type QueueName } from '@/lib/jobs/queues';
import { retryAllDlq } from '@/lib/services/admin/queueStats';
import { recordAudit } from '@/lib/auth/audit';
import { prisma } from '@/lib/db/prisma';

type Params = { params: Promise<{ queue: string }> };

function isKnownQueue(name: string): name is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(name);
}

export async function POST(_req: Request, { params }: Params) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const adminGuard = requireAdmin(sessionResult.value);
  if (!adminGuard.ok) return adminGuard.response;

  const { queue } = await params;
  if (!isKnownQueue(queue)) {
    return NextResponse.json({ error: 'UNKNOWN_QUEUE' }, { status: 400 });
  }

  const result = await retryAllDlq(queue);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  await recordAudit(prisma, {
    userId: sessionResult.value.sub,
    action: 'sync_dlq_bulk_retried',
    entity: 'job_queue',
    entityId: queue,
    after: { retried: result.retried, failed: result.failed, truncated: result.truncated },
  }).catch((e) => console.warn('[dlq/retry-all] audit failed', e));

  return NextResponse.json({ retried: result.retried, failed: result.failed, truncated: result.truncated });
}
