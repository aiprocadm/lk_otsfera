import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  notificationFindMany,
  notificationUpdateMany,
  orderFindMany,
  organizationUserFindMany,
  requireSession,
  requireRole
} = vi.hoisted(() => ({
  notificationFindMany: vi.fn(),
  notificationUpdateMany: vi.fn(),
  orderFindMany: vi.fn(),
  organizationUserFindMany: vi.fn(),
  requireSession: vi.fn(),
  requireRole: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notification: { findMany: notificationFindMany, updateMany: notificationUpdateMany },
    order: { findMany: orderFindMany },
    organizationUser: { findMany: organizationUserFindMany }
  }
}));
vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));

import { GET } from '@/app/api/notifications/route';
import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';

const managerSession = {
  sub: 'mgr-1',
  role: 'manager' as const,
  managedOrgIds: ['orgA']
};

describe('GET /api/notifications — manager branch (Task 5b)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: managerSession });
    requireRole.mockReturnValue({ ok: true, value: managerSession });
    notificationFindMany.mockResolvedValue([]);
  });

  it('uses session.managedOrgIds (not OrganizationUser) for per-org scope', async () => {
    orderFindMany.mockResolvedValue([]);

    await GET();

    expect(organizationUserFindMany).not.toHaveBeenCalled();
    expect(notificationFindMany).toHaveBeenCalledTimes(1);
    const where = notificationFindMany.mock.calls[0][0].where as {
      OR: Array<Record<string, unknown>>;
    };
    expect(where.OR).toContainEqual({ userId: 'mgr-1' });
    expect(where.OR).toContainEqual({ organizationId: { in: ['orgA'] } });
  });

  it('hydrates in-scope order ids via managerOrderScopeFilter and matches notifications by meta.orderId', async () => {
    orderFindMany.mockResolvedValue([{ id: 'order-mine-foreign-org' }, { id: 'order-in-my-org' }]);

    await GET();

    // managerOrderScopeFilter is the where clause used to find visible orders
    expect(orderFindMany).toHaveBeenCalledWith({
      where: managerOrderScopeFilter(managerSession),
      select: { id: true }
    });

    const where = notificationFindMany.mock.calls[0][0].where as {
      OR: Array<Record<string, unknown>>;
    };
    // Per-order ownership coverage: notifications referencing those order IDs via meta.orderId.
    expect(where.OR).toContainEqual({
      meta: { path: ['orderId'], equals: 'order-mine-foreign-org' }
    });
    expect(where.OR).toContainEqual({
      meta: { path: ['orderId'], equals: 'order-in-my-org' }
    });
  });

  it('omits organizationId branch when manager has no managedOrgIds', async () => {
    requireSession.mockResolvedValue({
      ok: true,
      value: { sub: 'mgr-1', role: 'manager', managedOrgIds: [] }
    });
    requireRole.mockReturnValue({
      ok: true,
      value: { sub: 'mgr-1', role: 'manager', managedOrgIds: [] }
    });
    orderFindMany.mockResolvedValue([]);

    await GET();

    const where = notificationFindMany.mock.calls[0][0].where as {
      OR: Array<Record<string, unknown>>;
    };
    expect(where.OR).toContainEqual({ userId: 'mgr-1' });
    // No empty-IN org clause leaking through — must be absent entirely.
    expect(
      where.OR.some(
        (b) =>
          'organizationId' in b &&
          JSON.stringify((b as { organizationId: unknown }).organizationId) ===
            JSON.stringify({ in: [] })
      )
    ).toBe(false);
  });

  it('never queries OrganizationUser for the manager branch (old confused model)', async () => {
    orderFindMany.mockResolvedValue([{ id: 'o1' }]);

    await GET();

    expect(organizationUserFindMany).not.toHaveBeenCalled();
  });

  it('does not include notifications for an order outside scope (only in-scope orderIds become branches)', async () => {
    // Simulate the scoped Order query returning only the two visible orders;
    // the route must NOT produce a meta.orderId branch for any other id.
    orderFindMany.mockResolvedValue([{ id: 'in-scope-1' }]);

    await GET();

    const where = notificationFindMany.mock.calls[0][0].where as {
      OR: Array<Record<string, unknown>>;
    };
    const orderIdBranches = where.OR.filter(
      (b) => 'meta' in b
    ) as Array<{ meta: { path: string[]; equals: string } }>;
    const ids = orderIdBranches.map((b) => b.meta.equals);
    expect(ids).toEqual(['in-scope-1']);
    expect(ids).not.toContain('out-of-scope');
  });
});
