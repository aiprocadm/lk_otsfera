import { NextResponse } from 'next/server';
import { requireAdmin, requireSession } from '@/lib/auth/guard';
import { QUEUE_NAMES, type QueueName } from '@/lib/jobs/queues';
import { retryDlqJob } from '@/lib/services/admin/queueStats';

type Params = { params: Promise<{ queue: string; jobId: string }> };

function isKnownQueue(name: string): name is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(name);
}

export async function POST(_req: Request, { params }: Params) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const adminGuard = requireAdmin(sessionResult.value);
  if (!adminGuard.ok) return adminGuard.response;

  const { queue, jobId } = await params;
  if (!isKnownQueue(queue)) {
    return NextResponse.json({ error: 'UNKNOWN_QUEUE' }, { status: 400 });
  }
  if (!jobId || jobId.trim() === '') {
    return NextResponse.json({ error: 'JOB_ID_REQUIRED' }, { status: 400 });
  }

  const result = await retryDlqJob(queue, jobId);
  if (!result.ok) {
    const status = result.reason === 'JOB_NOT_FOUND' ? 404 : 500;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ retried: { queue: result.queue, jobId: result.jobId } });
}
