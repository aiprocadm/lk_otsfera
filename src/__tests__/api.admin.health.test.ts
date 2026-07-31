import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/admin/queueStats', () => ({
  getQueueStats: vi.fn().mockResolvedValue([]),
  getDlq: vi.fn().mockResolvedValue([]),
  retryDlqJob: vi.fn(),
}));

import { getSession } from '@/lib/auth/session';
import { retryDlqJob } from '@/lib/services/admin/queueStats';
import { GET as queuesGet } from '@/app/api/admin/queues/route';
import { GET as dlqGet } from '@/app/api/admin/dlq/route';
import { POST as retryPost } from '@/app/api/admin/dlq/[queue]/[jobId]/retry/route';

function adminSession() {
  return { sub: 'admin1', role: 'admin', partnerId: null, name: 'Admin' } as never;
}

function partnerSession() {
  return { sub: 'u1', role: 'partner', partnerId: 'p1', name: 'P' } as never;
}

beforeEach(() => {
  vi.mocked(getSession).mockReset();
  vi.mocked(retryDlqJob).mockReset();
});

describe('admin auth on /api/admin/* health endpoints', () => {
  it('queues GET returns 401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await queuesGet(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('queues GET returns 403 for non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    const res = await queuesGet(new Request('http://x'));
    expect(res.status).toBe(403);
  });

  it('queues GET returns 200 with rows array for admin', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession());
    const res = await queuesGet(new Request('http://x'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [] });
  });

  it('dlq GET enforces admin RBAC the same way', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    const res = await dlqGet(new Request('http://x'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/dlq/[queue]/[jobId]/retry', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await retryPost(new Request('http://t/'), {
      params: Promise.resolve({ queue: 'docs.scanDocument', jobId: 'j1' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    const res = await retryPost(new Request('http://t/'), {
      params: Promise.resolve({ queue: 'docs.scanDocument', jobId: 'j1' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 UNKNOWN_QUEUE for invalid queue name', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession());
    const res = await retryPost(new Request('http://t/'), {
      params: Promise.resolve({ queue: 'totally.fake', jobId: 'j1' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('UNKNOWN_QUEUE');
  });

  it('returns 404 when retryDlqJob reports JOB_NOT_FOUND', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession());
    vi.mocked(retryDlqJob).mockResolvedValue({ ok: false, reason: 'JOB_NOT_FOUND' });
    const res = await retryPost(new Request('http://t/'), {
      params: Promise.resolve({ queue: 'docs.scanDocument', jobId: 'gone' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 with retried summary on success', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession());
    vi.mocked(retryDlqJob).mockResolvedValue({
      ok: true,
      queue: 'docs.scanDocument',
      jobId: 'j1',
    });
    const res = await retryPost(new Request('http://t/'), {
      params: Promise.resolve({ queue: 'docs.scanDocument', jobId: 'j1' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).retried).toEqual({ queue: 'docs.scanDocument', jobId: 'j1' });
  });
});
