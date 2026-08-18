/**
 * Task C1 (parity) — GET /api/notifications/unread: счётчик непрочитанных
 * уведомлений в скоупе сессии. Гейты и scope байт-в-байт как у
 * GET /api/notifications (общий buildNotificationScopeWhere), поверх скоупа —
 * фильтр { isRead: false }. Мок-паттерн скопирован из api.notifications.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notificationCount, orderFindMany, queryRaw, requireSession, requireRole } = vi.hoisted(
  () => ({
    notificationCount: vi.fn(),
    orderFindMany: vi.fn(),
    queryRaw: vi.fn(),
    requireSession: vi.fn(),
    requireRole: vi.fn(),
  })
);

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notification: { count: notificationCount },
    order: { findMany: orderFindMany },
    $queryRaw: queryRaw,
  },
}));
vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));

import { GET } from '@/app/api/notifications/unread/route';

// ─────────────── session fixtures ───────────────
const adminSession = { sub: 'u-admin', role: 'admin' as const };
const managerSession = {
  sub: 'mgr-1',
  role: 'manager' as const,
  managedOrgIds: ['orgA'],
  companyId: 'cmp-1',
};
const partnerSession = {
  sub: 'u-partner',
  role: 'partner' as const,
  partnerId: 'p1',
};
const orgSession = {
  sub: 'u-org',
  role: 'organization' as const,
  organizationId: 'org-1',
};

const unauthorizedResponse = Response.json({ error: 'Unauthorized' }, { status: 401 });
const forbiddenResponse = Response.json({ error: 'Forbidden' }, { status: 403 });

/** where-аргумент единственного вызова count: { AND: [scope, { isRead: false }] } */
function countWhere(): { AND: Array<Record<string, unknown>> } {
  return notificationCount.mock.calls[0][0].where as { AND: Array<Record<string, unknown>> };
}

describe('GET /api/notifications/unread', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    notificationCount.mockResolvedValue(0);
    orderFindMany.mockResolvedValue([]);
    queryRaw.mockResolvedValue([]);
  });

  it('returns 401 when requireSession fails (как у GET /api/notifications)', async () => {
    requireSession.mockResolvedValue({ ok: false, response: unauthorizedResponse });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(notificationCount).not.toHaveBeenCalled();
  });

  it('returns 403 when requireRole fails (student role) — тот же список ролей', async () => {
    const studentSession = { sub: 'u-student', role: 'student' as const };
    requireSession.mockResolvedValue({ ok: true, value: studentSession });
    requireRole.mockReturnValue({ ok: false, response: forbiddenResponse });

    const res = await GET();
    expect(res.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(studentSession, [
      'admin',
      'manager',
      'leader',
      'partner',
      'organization',
    ]);
    expect(notificationCount).not.toHaveBeenCalled();
  });

  it('admin: пустой scope {} + isRead:false, отдаёт {count}', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    notificationCount.mockResolvedValue(7);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body).toEqual({ count: 7 });

    // Считаются ТОЛЬКО непрочитанные: AND = [пустой scope, { isRead: false }]
    expect(countWhere()).toEqual({ AND: [{}, { isRead: false }] });
  });

  it('manager: scope = userId + managedOrgIds + id-ветка meta-orderId кандидатов (R1.2)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: managerSession });
    requireRole.mockReturnValue({ ok: true, value: managerSession });
    orderFindMany.mockResolvedValue([{ id: 'order-1' }]);
    queryRaw.mockResolvedValue([{ id: 'n-meta-1' }]);
    notificationCount.mockResolvedValue(3);

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()) as { count: number }).toEqual({ count: 3 });

    const where = countWhere();
    const orBranches = (where.AND[0] as { OR: Array<Record<string, unknown>> }).OR;
    expect(orBranches).toContainEqual({ userId: 'mgr-1' });
    expect(orBranches).toContainEqual({ organizationId: { in: ['orgA'] } });
    expect(orBranches).toContainEqual({ id: { in: ['n-meta-1'] } });
    expect(orBranches.some((b) => 'meta' in b)).toBe(false);
    expect(where.AND[1]).toEqual({ isRead: false });
  });

  it('manager без managedOrgIds и заказов: только userId-ветка, raw-запрос не выполняется', async () => {
    const noOrgManagerSession = {
      sub: 'mgr-2',
      role: 'manager' as const,
      managedOrgIds: [] as string[],
      companyId: 'cmp-1',
    };
    requireSession.mockResolvedValue({ ok: true, value: noOrgManagerSession });
    requireRole.mockReturnValue({ ok: true, value: noOrgManagerSession });
    orderFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    expect(queryRaw).not.toHaveBeenCalled();
    const orBranches = (countWhere().AND[0] as { OR: Array<Record<string, unknown>> }).OR;
    expect(orBranches).toEqual([{ userId: 'mgr-2' }]);
  });

  it('partner: scope = userId OR partnerId + isRead:false', async () => {
    requireSession.mockResolvedValue({ ok: true, value: partnerSession });
    requireRole.mockReturnValue({ ok: true, value: partnerSession });
    notificationCount.mockResolvedValue(2);

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()) as { count: number }).toEqual({ count: 2 });

    const where = countWhere();
    const orBranches = (where.AND[0] as { OR: Array<Record<string, unknown>> }).OR;
    expect(orBranches).toContainEqual({ userId: 'u-partner' });
    expect(orBranches).toContainEqual({ partnerId: 'p1' });
    expect(where.AND[1]).toEqual({ isRead: false });
  });

  it('organization: scope = userId OR organizationId + isRead:false', async () => {
    requireSession.mockResolvedValue({ ok: true, value: orgSession });
    requireRole.mockReturnValue({ ok: true, value: orgSession });
    notificationCount.mockResolvedValue(5);

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()) as { count: number }).toEqual({ count: 5 });

    const where = countWhere();
    const orBranches = (where.AND[0] as { OR: Array<Record<string, unknown>> }).OR;
    expect(orBranches).toContainEqual({ userId: 'u-org' });
    expect(orBranches).toContainEqual({ organizationId: 'org-1' });
    expect(where.AND[1]).toEqual({ isRead: false });
  });
});
