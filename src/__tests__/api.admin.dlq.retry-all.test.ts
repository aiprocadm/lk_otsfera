import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, requireAdmin } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireAdmin: vi.fn(),
}));
const { retryAllDlq } = vi.hoisted(() => ({ retryAllDlq: vi.fn() }));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireAdmin }));
vi.mock('@/lib/services/admin/queueStats', () => ({ retryAllDlq }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/admin/dlq/[queue]/retry-all/route';

function params(queue: string) {
  return { params: Promise.resolve({ queue }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true, value: { sub: 'admin-1', role: 'admin' } });
  requireAdmin.mockReturnValue({ ok: true, value: { sub: 'admin-1' } });
  recordAudit.mockResolvedValue(undefined);
});

describe('POST retry-all', () => {
  it('returns 401 when requireSession fails', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await POST(
      new Request('http://x', { method: 'POST' }),
      params('docs.scanDocument')
    );
    expect(res.status).toBe(401);
    expect(retryAllDlq).not.toHaveBeenCalled();
  });

  it('rejects an unknown queue with 400', async () => {
    const res = await POST(new Request('http://x', { method: 'POST' }), params('bogus.queue'));
    expect(res.status).toBe(400);
    expect(retryAllDlq).not.toHaveBeenCalled();
  });

  it('retries, audits, and returns counts on success', async () => {
    retryAllDlq.mockResolvedValue({ ok: true, retried: 3, failed: 0, truncated: false });
    const res = await POST(
      new Request('http://x', { method: 'POST' }),
      params('docs.scanDocument')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ retried: 3, failed: 0, truncated: false });
    expect(recordAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        entity: 'job_queue',
        entityId: 'docs.scanDocument',
        action: 'sync_dlq_bulk_retried',
      })
    );
  });

  it('maps queue_unavailable to 503', async () => {
    retryAllDlq.mockResolvedValue({ ok: false, error: 'queue_unavailable' });
    const res = await POST(
      new Request('http://x', { method: 'POST' }),
      params('docs.scanDocument')
    );
    expect(res.status).toBe(503);
  });

  it('returns the guard response when not admin', async () => {
    requireAdmin.mockReturnValue({
      ok: false,
      response: new Response('forbidden', { status: 403 }),
    });
    const res = await POST(
      new Request('http://x', { method: 'POST' }),
      params('docs.scanDocument')
    );
    expect(res.status).toBe(403);
    expect(retryAllDlq).not.toHaveBeenCalled();
  });
});
