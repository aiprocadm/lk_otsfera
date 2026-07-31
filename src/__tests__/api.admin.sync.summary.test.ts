import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/syncSummary', () => ({ getSyncSummary: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { getSyncSummary } from '@/lib/services/syncSummary';
import { GET } from '@/app/api/admin/sync/summary/route';

describe('GET /api/admin/sync/summary', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403 for non-admin (partner)', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u',
      role: 'partner',
      partnerId: 'p1',
    } as never);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('403 for non-admin (organization)', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u',
      role: 'organization',
      organizationId: 'o1',
    } as never);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns rows for admin', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'admin' } as never);
    vi.mocked(getSyncSummary).mockResolvedValue([
      {
        entity: 'order',
        successCount24h: 5,
        warnCount24h: 0,
        errorCount24h: 1,
        lastSuccessAt: new Date('2026-05-22T08:00:00Z'),
        lastErrorAt: null,
        lastErrorMessage: null,
        cursor: null,
        lagMs: null,
      },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].entity).toBe('order');
    expect(body.rows[0].successCount24h).toBe(5);
  });
});
