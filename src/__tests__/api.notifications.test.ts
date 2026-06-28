import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  notificationFindMany,
  notificationUpdateMany,
  orderFindMany,
  requireSession,
  requireRole
} = vi.hoisted(() => ({
  notificationFindMany: vi.fn(),
  notificationUpdateMany: vi.fn(),
  orderFindMany: vi.fn(),
  requireSession: vi.fn(),
  requireRole: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notification: { findMany: notificationFindMany, updateMany: notificationUpdateMany },
    order: { findMany: orderFindMany }
  }
}));
vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));

import { GET, PATCH } from '@/app/api/notifications/route';

// ─────────────── session fixtures ───────────────
const adminSession = { sub: 'u-admin', role: 'admin' as const };
const managerSession = {
  sub: 'mgr-1',
  role: 'manager' as const,
  managedOrgIds: ['orgA'],
  companyId: 'cmp-1'
};
const partnerSession = {
  sub: 'u-partner',
  role: 'partner' as const,
  partnerId: 'p1'
};
const orgSession = {
  sub: 'u-org',
  role: 'organization' as const,
  organizationId: 'org-1'
};

const unauthorizedResponse = Response.json({ error: 'Unauthorized' }, { status: 401 });
const forbiddenResponse = Response.json({ error: 'Forbidden' }, { status: 403 });

function jsonReq(body: unknown, method = 'PATCH') {
  return new Request('http://x/api/notifications', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  });
}

function badJsonReq() {
  return new Request('http://x/api/notifications', {
    method: 'PATCH',
    body: 'NOT JSON',
    headers: { 'content-type': 'application/json' }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/notifications', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    notificationFindMany.mockResolvedValue([]);
    orderFindMany.mockResolvedValue([]);
  });

  it('returns 401 when requireSession fails', async () => {
    requireSession.mockResolvedValue({ ok: false, response: unauthorizedResponse });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 403 when requireRole fails (e.g. student role)', async () => {
    requireSession.mockResolvedValue({
      ok: true,
      value: { sub: 'u-student', role: 'student' }
    });
    requireRole.mockReturnValue({ ok: false, response: forbiddenResponse });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('admin role receives empty scope {} and returns 200 with notifications array', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    notificationFindMany.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);

    // Admin scope is {} (no where filter beyond empty)
    const call = notificationFindMany.mock.calls[0][0];
    expect(call.where).toEqual({});
  });

  it('manager: uses managedOrgIds + order IDs in OR scope', async () => {
    requireSession.mockResolvedValue({ ok: true, value: managerSession });
    requireRole.mockReturnValue({ ok: true, value: managerSession });
    orderFindMany.mockResolvedValue([{ id: 'order-1' }]);
    notificationFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    const call = notificationFindMany.mock.calls[0][0];
    const orBranches = call.where.OR as Array<Record<string, unknown>>;
    expect(orBranches).toContainEqual({ userId: 'mgr-1' });
    expect(orBranches).toContainEqual({ organizationId: { in: ['orgA'] } });
    expect(orBranches).toContainEqual({ meta: { path: ['orderId'], equals: 'order-1' } });
  });

  it('manager with no managedOrgIds: scope has only userId + order branches (no orgId branch)', async () => {
    const noOrgManagerSession = {
      sub: 'mgr-2',
      role: 'manager' as const,
      managedOrgIds: [] as string[],
      companyId: 'cmp-1'
    };
    requireSession.mockResolvedValue({ ok: true, value: noOrgManagerSession });
    requireRole.mockReturnValue({ ok: true, value: noOrgManagerSession });
    orderFindMany.mockResolvedValue([]);
    notificationFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    const call = notificationFindMany.mock.calls[0][0];
    const orBranches = call.where.OR as Array<Record<string, unknown>>;
    expect(orBranches).toContainEqual({ userId: 'mgr-2' });
    // No organizationId branch when managedOrgIds is empty
    expect(orBranches.some((b) => 'organizationId' in b)).toBe(false);
  });

  it('partner: scopes to userId + partnerId', async () => {
    requireSession.mockResolvedValue({ ok: true, value: partnerSession });
    requireRole.mockReturnValue({ ok: true, value: partnerSession });
    notificationFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    const call = notificationFindMany.mock.calls[0][0];
    const orBranches = call.where.OR as Array<Record<string, unknown>>;
    expect(orBranches).toContainEqual({ userId: 'u-partner' });
    expect(orBranches).toContainEqual({ partnerId: 'p1' });
  });

  it('partner without partnerId: scopes to userId only', async () => {
    const noPartnerIdSession = { sub: 'u-p2', role: 'partner' as const };
    requireSession.mockResolvedValue({ ok: true, value: noPartnerIdSession });
    requireRole.mockReturnValue({ ok: true, value: noPartnerIdSession });
    notificationFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    const call = notificationFindMany.mock.calls[0][0];
    const orBranches = call.where.OR as Array<Record<string, unknown>>;
    expect(orBranches).toContainEqual({ userId: 'u-p2' });
    // No partnerId branch when partnerId is absent
    expect(orBranches.some((b) => 'partnerId' in b)).toBe(false);
  });

  it('organization: scopes to userId + organizationId', async () => {
    requireSession.mockResolvedValue({ ok: true, value: orgSession });
    requireRole.mockReturnValue({ ok: true, value: orgSession });
    notificationFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    const call = notificationFindMany.mock.calls[0][0];
    const orBranches = call.where.OR as Array<Record<string, unknown>>;
    expect(orBranches).toContainEqual({ userId: 'u-org' });
    expect(orBranches).toContainEqual({ organizationId: 'org-1' });
  });

  it('organization without organizationId: scopes to userId only', async () => {
    const noOrgIdSession = { sub: 'u-o2', role: 'organization' as const };
    requireSession.mockResolvedValue({ ok: true, value: noOrgIdSession });
    requireRole.mockReturnValue({ ok: true, value: noOrgIdSession });
    notificationFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    const call = notificationFindMany.mock.calls[0][0];
    const orBranches = call.where.OR as Array<Record<string, unknown>>;
    expect(orBranches).toContainEqual({ userId: 'u-o2' });
    expect(orBranches.some((b) => 'organizationId' in b)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/notifications', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    notificationUpdateMany.mockResolvedValue({ count: 1 });
    orderFindMany.mockResolvedValue([]);
  });

  it('returns 401 when requireSession fails', async () => {
    requireSession.mockResolvedValue({ ok: false, response: unauthorizedResponse });
    const res = await PATCH(jsonReq({ id: 'n1' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when requireRole fails', async () => {
    requireSession.mockResolvedValue({
      ok: true,
      value: { sub: 'u-student', role: 'student' }
    });
    requireRole.mockReturnValue({ ok: false, response: forbiddenResponse });
    const res = await PATCH(jsonReq({ id: 'n1' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 when request body is not valid JSON', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    const res = await PATCH(badJsonReq());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid request');
  });

  it('returns 400 when body passes JSON parse but fails schema (no id or ids)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    const res = await PATCH(jsonReq({ isRead: true }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('id or ids required');
  });

  it('returns 400 when ids is an empty array (fails refine)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    // The refine requires id or (ids && ids.length > 0)
    const res = await PATCH(jsonReq({ ids: [] }));
    expect(res.status).toBe(400);
  });

  it('marks a single notification read by id, returns 200', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    notificationUpdateMany.mockResolvedValue({ count: 1 });

    const res = await PATCH(jsonReq({ id: 'n1', isRead: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(1);

    // id path: updateMany called once with AND filter
    expect(notificationUpdateMany).toHaveBeenCalledTimes(1);
    const call = notificationUpdateMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({ id: 'n1' });
    expect(call.data.isRead).toBe(true);
  });

  it('marks isRead=false when explicitly set to false', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    notificationUpdateMany.mockResolvedValue({ count: 1 });

    await PATCH(jsonReq({ id: 'n1', isRead: false }));
    const call = notificationUpdateMany.mock.calls[0][0];
    expect(call.data.isRead).toBe(false);
  });

  it('defaults isRead to true when not provided', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    notificationUpdateMany.mockResolvedValue({ count: 1 });

    await PATCH(jsonReq({ id: 'n1' }));
    const call = notificationUpdateMany.mock.calls[0][0];
    expect(call.data.isRead).toBe(true);
  });

  it('marks multiple notifications read by ids array, returns 200', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    notificationUpdateMany.mockResolvedValue({ count: 3 });

    const res = await PATCH(jsonReq({ ids: ['n1', 'n2', 'n3'] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(3);

    const call = notificationUpdateMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({ id: { in: ['n1', 'n2', 'n3'] } });
  });

  it('scopes PATCH by-id to the manager session scope (OR includes userId)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: managerSession });
    requireRole.mockReturnValue({ ok: true, value: managerSession });
    orderFindMany.mockResolvedValue([]);
    notificationUpdateMany.mockResolvedValue({ count: 1 });

    await PATCH(jsonReq({ id: 'n1' }));

    const call = notificationUpdateMany.mock.calls[0][0];
    const andClauses = call.where.AND as Array<Record<string, unknown>>;
    // Second element is the scoped where (OR of userId + org branches)
    const scopeWhere = andClauses[1] as { OR: Array<Record<string, unknown>> };
    expect(scopeWhere.OR).toContainEqual({ userId: 'mgr-1' });
  });
});
