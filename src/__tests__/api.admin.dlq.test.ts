import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, requireAdmin } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireAdmin: vi.fn()
}));
const { getDlq, retryDlqJob } = vi.hoisted(() => ({
  getDlq: vi.fn(),
  retryDlqJob: vi.fn()
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireAdmin }));
vi.mock('@/lib/services/admin/queueStats', () => ({ getDlq, retryDlqJob }));
vi.mock('@/lib/jobs/queues', () => ({
  QUEUE_NAMES: ['docs.scanDocument', 'emails.send'],
  getQueue: vi.fn()
}));

import { GET } from '@/app/api/admin/dlq/route';
import { POST } from '@/app/api/admin/dlq/[queue]/[jobId]/retry/route';

const adminSession = { sub: 'admin-1', role: 'admin' };

function retryParams(queue: string, jobId: string) {
  return { params: Promise.resolve({ queue, jobId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true, value: adminSession });
  requireAdmin.mockReturnValue({ ok: true, value: adminSession });
});

// ─── GET /api/admin/dlq ────────────────────────────────────────────────────

describe('GET /api/admin/dlq', () => {
  it('returns rows on success', async () => {
    getDlq.mockResolvedValue([{ queue: 'docs.scanDocument', jobId: 'j1', name: 'scan', failedReason: 'oops', failedAt: null, attemptsMade: 3 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('returns guard response when not authenticated', async () => {
    requireSession.mockResolvedValue({ ok: false, response: new Response('Unauthorized', { status: 401 }) });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getDlq).not.toHaveBeenCalled();
  });

  it('returns guard response when not admin', async () => {
    requireAdmin.mockReturnValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getDlq).not.toHaveBeenCalled();
  });
});

// ─── POST /api/admin/dlq/[queue]/[jobId]/retry ─────────────────────────────

describe('POST /api/admin/dlq/[queue]/[jobId]/retry', () => {
  it('retries job successfully', async () => {
    retryDlqJob.mockResolvedValue({ ok: true, queue: 'docs.scanDocument', jobId: 'j1' });
    const res = await POST(new Request('http://x', { method: 'POST' }), retryParams('docs.scanDocument', 'j1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retried).toEqual({ queue: 'docs.scanDocument', jobId: 'j1' });
  });

  it('400 for unknown queue', async () => {
    const res = await POST(new Request('http://x', { method: 'POST' }), retryParams('unknown.queue', 'j1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('UNKNOWN_QUEUE');
    expect(retryDlqJob).not.toHaveBeenCalled();
  });

  it('400 when jobId is empty string', async () => {
    const res = await POST(new Request('http://x', { method: 'POST' }), retryParams('docs.scanDocument', '   '));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('JOB_ID_REQUIRED');
  });

  it('404 when job not found in DLQ', async () => {
    retryDlqJob.mockResolvedValue({ ok: false, reason: 'JOB_NOT_FOUND' });
    const res = await POST(new Request('http://x', { method: 'POST' }), retryParams('docs.scanDocument', 'missing'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('JOB_NOT_FOUND');
  });

  it('500 on other service failure', async () => {
    retryDlqJob.mockResolvedValue({ ok: false, reason: 'QUEUE_UNAVAILABLE' });
    const res = await POST(new Request('http://x', { method: 'POST' }), retryParams('docs.scanDocument', 'j1'));
    expect(res.status).toBe(500);
  });

  it('returns guard response when not authenticated', async () => {
    requireSession.mockResolvedValue({ ok: false, response: new Response('Unauthorized', { status: 401 }) });
    const res = await POST(new Request('http://x', { method: 'POST' }), retryParams('docs.scanDocument', 'j1'));
    expect(res.status).toBe(401);
    expect(retryDlqJob).not.toHaveBeenCalled();
  });

  it('returns guard response when not admin', async () => {
    requireAdmin.mockReturnValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });
    const res = await POST(new Request('http://x', { method: 'POST' }), retryParams('docs.scanDocument', 'j1'));
    expect(res.status).toBe(403);
    expect(retryDlqJob).not.toHaveBeenCalled();
  });
});
