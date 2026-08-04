import { NextResponse } from 'next/server';
import { jsonError, routeParams } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { requireAdmin } from '@/lib/auth/guard';
import { QUEUE_NAMES, type QueueName } from '@/lib/jobs/queues';
import { retryDlqJob } from '@/lib/services/admin/queueStats';

function isKnownQueue(name: string): name is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(name);
}

export const POST = withAuth({ guard: requireAdmin }, async ({ params }) => {
  // Next.js всегда даёт сегменты [queue]/[jobId] для этого файла роута; withAuth типизирует
  // params как Record<string,string>, которая под noUncheckedIndexedAccess сужение теряет.
  const { queue, jobId } = await routeParams<{ queue: string; jobId: string }>(params);
  if (!isKnownQueue(queue)) {
    return jsonError('UNKNOWN_QUEUE', 400);
  }
  if (!jobId || jobId.trim() === '') {
    return jsonError('JOB_ID_REQUIRED', 400);
  }

  const result = await retryDlqJob(queue, jobId);
  if (!result.ok) {
    const status = result.reason === 'JOB_NOT_FOUND' ? 404 : 500;
    return jsonError(result.reason, status);
  }
  return NextResponse.json({ retried: { queue: result.queue, jobId: result.jobId } });
});
