import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, forbiddenResponse } = vi.hoisted(() => ({
  getSession: vi.fn(),
  forbiddenResponse: vi.fn((msg: string) =>
    Response.json({ code: 'FORBIDDEN', message: msg }, { status: 403 })
  ),
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/auth/policy', () => ({ forbiddenResponse }));

import { GET } from '@/app/api/dashboard/route';

describe('GET /api/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no session exists', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when the session role is student', async () => {
    getSession.mockResolvedValue({ sub: 'u-student', role: 'student' });
    const res = await GET();
    expect(forbiddenResponse).toHaveBeenCalledWith('Students do not have dashboard access');
    expect(res.status).toBe(403);
  });

  it('returns 200 with ok:true for a partner session', async () => {
    getSession.mockResolvedValue({ sub: 'u-partner', role: 'partner', partnerId: 'p1' });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 200 with ok:true for a manager session', async () => {
    getSession.mockResolvedValue({ sub: 'u-mgr', role: 'manager', managedOrgIds: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 200 with ok:true for an admin session', async () => {
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin' });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 200 with ok:true for an organization session', async () => {
    getSession.mockResolvedValue({ sub: 'u-org', role: 'organization', organizationId: 'org-1' });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
