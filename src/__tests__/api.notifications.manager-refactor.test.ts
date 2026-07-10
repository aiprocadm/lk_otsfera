import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  notificationFindMany,
  notificationUpdateMany,
  orderFindMany,
  organizationUserFindMany,
  queryRaw,
  requireSession,
  requireRole
} = vi.hoisted(() => ({
  notificationFindMany: vi.fn(),
  notificationUpdateMany: vi.fn(),
  orderFindMany: vi.fn(),
  organizationUserFindMany: vi.fn(),
  queryRaw: vi.fn(),
  requireSession: vi.fn(),
  requireRole: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notification: { findMany: notificationFindMany, updateMany: notificationUpdateMany },
    order: { findMany: orderFindMany },
    organizationUser: { findMany: organizationUserFindMany },
    $queryRaw: queryRaw
  }
}));
vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));

import { GET, PATCH } from '@/app/api/notifications/route';
import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';

const managerSession = {
  sub: 'mgr-1',
  role: 'manager' as const,
  managedOrgIds: ['orgA']
};

/** Prisma.Sql хранит подставленные значения в .values — по ним ассертим параметры. */
function sqlValues(callIndex = 0): unknown[] {
  return (queryRaw.mock.calls[callIndex][0] as { values: unknown[] }).values;
}

describe('GET /api/notifications — manager branch (Task 5b + R1.2 candidate query)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: managerSession });
    requireRole.mockReturnValue({ ok: true, value: managerSession });
    notificationFindMany.mockResolvedValue([]);
    queryRaw.mockResolvedValue([]);
  });

  it('uses session.managedOrgIds (not OrganizationUser) for per-org scope', async () => {
    orderFindMany.mockResolvedValue([]);

    await GET();

    expect(organizationUserFindMany).not.toHaveBeenCalled();
    // Нет видимых заказов → raw-запрос кандидатов даже не выполняется.
    expect(queryRaw).not.toHaveBeenCalled();
    expect(notificationFindMany).toHaveBeenCalledTimes(1);
    const where = notificationFindMany.mock.calls[0][0].where as {
      OR: Array<Record<string, unknown>>;
    };
    expect(where.OR).toContainEqual({ userId: 'mgr-1' });
    expect(where.OR).toContainEqual({ organizationId: { in: ['orgA'] } });
  });

  it('hydrates in-scope order ids via managerOrderScopeFilter and matches meta.orderId candidates in ONE raw query', async () => {
    orderFindMany.mockResolvedValue([{ id: 'order-mine-foreign-org' }, { id: 'order-in-my-org' }]);
    queryRaw.mockResolvedValue([{ id: 'n-meta-1' }, { id: 'n-meta-2' }]);

    await GET();

    // managerOrderScopeFilter is the where clause used to find visible orders
    expect(orderFindMany).toHaveBeenCalledWith({
      where: managerOrderScopeFilter(managerSession),
      select: { id: true }
    });

    // R1.2: ровно один raw-запрос со ВСЕМИ in-scope order ids в параметрах —
    // вместо OR-ветки с JSONB-путём на каждый заказ.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlValues()).toEqual(
      expect.arrayContaining(['order-mine-foreign-org', 'order-in-my-org'])
    );

    const where = notificationFindMany.mock.calls[0][0].where as {
      OR: Array<Record<string, unknown>>;
    };
    // Кандидаты входят в scope одной id-веткой; per-order meta-веток больше нет.
    expect(where.OR).toContainEqual({ id: { in: ['n-meta-1', 'n-meta-2'] } });
    expect(where.OR.some((b) => 'meta' in b)).toBe(false);
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

  it('feeds ONLY in-scope order ids into the candidate query; empty candidates → no id branch', async () => {
    orderFindMany.mockResolvedValue([{ id: 'in-scope-1' }]);
    queryRaw.mockResolvedValue([]);

    await GET();

    expect(sqlValues()).toContain('in-scope-1');
    expect(sqlValues()).not.toContain('out-of-scope');
    const where = notificationFindMany.mock.calls[0][0].where as {
      OR: Array<Record<string, unknown>>;
    };
    expect(where.OR.some((b) => 'id' in b)).toBe(false);
    expect(where.OR.some((b) => 'meta' in b)).toBe(false);
  });
});

describe('PATCH /api/notifications — manager candidate query stays bounded (R1.2)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: managerSession });
    requireRole.mockReturnValue({ ok: true, value: managerSession });
    notificationUpdateMany.mockResolvedValue({ count: 1 });
    queryRaw.mockResolvedValue([]);
  });

  function patchReq(body: unknown): Request {
    return new Request('http://x/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' }
    });
  }

  it('кандидаты ограничены переданными ids (в SQL уходят и ids, и order ids)', async () => {
    orderFindMany.mockResolvedValue([{ id: 'order-1' }]);
    queryRaw.mockResolvedValue([{ id: 'n1' }]);

    await PATCH(patchReq({ id: 'n1' }));

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlValues()).toEqual(expect.arrayContaining(['n1', 'order-1']));

    const call = notificationUpdateMany.mock.calls[0][0];
    const scope = (call.where.AND as Array<Record<string, unknown>>)[1] as {
      OR: Array<Record<string, unknown>>;
    };
    expect(scope.OR).toContainEqual({ id: { in: ['n1'] } });
  });
});
