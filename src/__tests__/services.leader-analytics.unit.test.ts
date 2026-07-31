import { it, expect, vi, beforeEach, describe } from 'vitest';
import { Prisma } from '@prisma/client';

const { recordAudit, listCompanyManagers } = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  listCompanyManagers: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

import {
  monthRange,
  getFunnelAnalytics,
  getPlanFact,
  upsertSalesTarget,
} from '@/lib/services/leader/analytics';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const leaderSession = { sub: 'leader1', role: 'admin', companyId: 'c1' } as never;

function fakePrisma(over: Record<string, unknown> = {}) {
  const base = {
    funnelStage: { findMany: vi.fn().mockResolvedValue([]) },
    lead: { findMany: vi.fn().mockResolvedValue([]) },
    payment: { findMany: vi.fn().mockResolvedValue([]) },
    order: { groupBy: vi.fn().mockResolvedValue([]) },
    deal: { groupBy: vi.fn().mockResolvedValue([]) },
    salesTarget: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  return { ...base, ...over } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  listCompanyManagers.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// monthRange
// ---------------------------------------------------------------------------

describe('monthRange', () => {
  it('returns [1st 00:00, next month 1st) for a normal month', () => {
    const { from, to } = monthRange(2026, 7);
    expect(from).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0));
    expect(to).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
  });

  it('rolls December over into January of the next year', () => {
    const { from, to } = monthRange(2026, 12);
    expect(from).toEqual(new Date(2026, 11, 1, 0, 0, 0, 0));
    expect(to).toEqual(new Date(2027, 0, 1, 0, 0, 0, 0));
  });

  it('[from,to) boundary: `to` itself is excluded, the instant before is included', () => {
    const { from, to } = monthRange(2026, 2);
    const justBefore = new Date(to.getTime() - 1);
    expect(from.getTime() <= justBefore.getTime()).toBe(true);
    expect(justBefore.getTime() < to.getTime()).toBe(true);
    expect(from.getTime() < to.getTime()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getFunnelAnalytics
// ---------------------------------------------------------------------------

describe('getFunnelAnalytics', () => {
  it('non-staff role → forbidden', async () => {
    const session = { sub: 'p1', role: 'partner', companyId: 'c1' } as never;
    const res = await getFunnelAnalytics(fakePrisma(), session, monthRange(2026, 7));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('companyId null → forbidden', async () => {
    const session = { sub: 'a1', role: 'admin', companyId: null } as never;
    const res = await getFunnelAnalytics(fakePrisma(), session, monthRange(2026, 7));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('scope-where: lead.findMany (snapshot + cohort) both carry the §0.8 OR-clause', async () => {
    const lead = { findMany: vi.fn().mockResolvedValue([]) };
    const prisma = fakePrisma({ lead });
    await getFunnelAnalytics(prisma, leaderSession, monthRange(2026, 7));
    expect(lead.findMany).toHaveBeenCalledTimes(2);
    const expectedOr = [{ assignedManagerId: null }, { assignedManager: { companyId: 'c1' } }];
    expect(lead.findMany.mock.calls[0][0].where.OR).toEqual(expectedOr);
    expect(lead.findMany.mock.calls[1][0].where.OR).toEqual(expectedOr);
  });

  it('snapshot buckets open leads into default stages with Decimal-safe sums; empty stage → 0/"0.00"', async () => {
    const lead = {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          { status: 'new', funnelStageId: null, estimatedAmount: D('1000') },
          { status: 'new', funnelStageId: null, estimatedAmount: null },
          { status: 'in_review', funnelStageId: null, estimatedAmount: D('500.5') },
          // no 'qualified' lead — that stage must come back empty
        ])
        .mockResolvedValueOnce([]),
    };
    const prisma = fakePrisma({ lead });
    const res = await getFunnelAnalytics(prisma, leaderSession, monthRange(2026, 7));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot).toEqual([
      { stageId: 'default:new', name: 'Новый лид', color: null, count: 2, estimatedSum: '1000.00' },
      {
        stageId: 'default:in_review',
        name: 'В работе',
        color: null,
        count: 1,
        estimatedSum: '500.50',
      },
      {
        stageId: 'default:qualified',
        name: 'Квалифицирован',
        color: null,
        count: 0,
        estimatedSum: '0.00',
      },
    ]);
  });

  it('custom stage dictionary missing an anchor: unmatched leads are skipped from the snapshot', async () => {
    const funnelStage = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 's-new',
          companyId: 'c1',
          name: 'Свежий',
          position: 0,
          statusAnchor: 'new',
          isTerminal: false,
          color: '#111111',
        },
        // no stage covers 'qualified' — a qualified lead must be skipped, not crash
      ]),
    };
    const lead = {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          { status: 'new', funnelStageId: null, estimatedAmount: D('100') },
          { status: 'qualified', funnelStageId: null, estimatedAmount: D('999') },
        ])
        .mockResolvedValueOnce([]),
    };
    const prisma = fakePrisma({ funnelStage, lead });
    const res = await getFunnelAnalytics(prisma, leaderSession, monthRange(2026, 7));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot).toEqual([
      { stageId: 's-new', name: 'Свежий', color: '#111111', count: 1, estimatedSum: '100.00' },
    ]);
  });

  it('cohort math: 5 leads → 2 promoted / 1 rejected / 2 in work, conversion 40%, rejected 20%, avg days, per-manager + unassigned rows', async () => {
    listCompanyManagers.mockResolvedValue([
      {
        id: 'm1',
        name: 'Иванов',
        email: 'i@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
      {
        id: 'm2',
        name: 'Петров',
        email: 'p@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
      {
        id: 'm3',
        name: 'Сидоров',
        email: 's@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
    ]);
    const cohort = [
      {
        status: 'promoted_to_order',
        estimatedAmount: D('1000'),
        assignedManagerId: 'm1',
        createdAt: new Date('2026-07-01T00:00:00Z'),
        promotedOrder: { createdAt: new Date('2026-07-03T00:00:00Z') }, // +2 days
      },
      {
        status: 'promoted_to_order',
        estimatedAmount: D('2000'),
        assignedManagerId: 'm2',
        createdAt: new Date('2026-07-01T00:00:00Z'),
        promotedOrder: { createdAt: new Date('2026-07-05T00:00:00Z') }, // +4 days
      },
      {
        status: 'rejected',
        estimatedAmount: D('500'),
        assignedManagerId: 'm1',
        createdAt: new Date('2026-07-02T00:00:00Z'),
        promotedOrder: null,
      },
      {
        status: 'new',
        estimatedAmount: null, // must be skipped from estimatedTotal
        assignedManagerId: 'm2',
        createdAt: new Date('2026-07-02T00:00:00Z'),
        promotedOrder: null,
      },
      {
        status: 'in_review',
        estimatedAmount: D('300'),
        assignedManagerId: null, // unassigned lead
        createdAt: new Date('2026-07-02T00:00:00Z'),
        promotedOrder: null,
      },
    ];
    const lead = { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(cohort) };
    const prisma = fakePrisma({ lead });
    const res = await getFunnelAnalytics(prisma, leaderSession, monthRange(2026, 7));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cohort).toEqual({
      total: 5,
      promoted: 2,
      rejected: 1,
      inWork: 2,
      conversionPct: 40,
      rejectedPct: 20,
      avgDaysToPromote: 3,
      estimatedTotal: '3800.00',
      promotedEstimated: '3000.00',
    });
    expect(res.perManager).toEqual([
      { managerId: 'm1', name: 'Иванов', assigned: 2, promoted: 1, rejected: 1, conversionPct: 50 },
      { managerId: 'm2', name: 'Петров', assigned: 2, promoted: 1, rejected: 0, conversionPct: 50 },
      { managerId: 'm3', name: 'Сидоров', assigned: 0, promoted: 0, rejected: 0, conversionPct: 0 },
      {
        managerId: null,
        name: 'Без менеджера',
        assigned: 1,
        promoted: 0,
        rejected: 0,
        conversionPct: 0,
      },
    ]);
  });

  it('empty cohort → zeros, null avg days, no unassigned row', async () => {
    listCompanyManagers.mockResolvedValue([
      {
        id: 'm1',
        name: 'Иванов',
        email: 'i@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
    ]);
    const res = await getFunnelAnalytics(fakePrisma(), leaderSession, monthRange(2026, 7));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cohort).toEqual({
      total: 0,
      promoted: 0,
      rejected: 0,
      inWork: 0,
      conversionPct: 0,
      rejectedPct: 0,
      avgDaysToPromote: null,
      estimatedTotal: '0.00',
      promotedEstimated: '0.00',
    });
    expect(res.perManager).toEqual([
      { managerId: 'm1', name: 'Иванов', assigned: 0, promoted: 0, rejected: 0, conversionPct: 0 },
    ]);
  });

  it('promoted lead without a promotedOrder relation (data drift) is excluded from avgDaysToPromote; null estimatedAmount skips promotedEstimated', async () => {
    const cohort = [
      {
        status: 'promoted_to_order',
        estimatedAmount: null,
        assignedManagerId: 'm1',
        createdAt: new Date('2026-07-01T00:00:00Z'),
        promotedOrder: null,
      },
    ];
    const lead = { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(cohort) };
    const res = await getFunnelAnalytics(fakePrisma({ lead }), leaderSession, monthRange(2026, 7));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cohort.promoted).toBe(1);
    expect(res.cohort.avgDaysToPromote).toBeNull();
    expect(res.cohort.promotedEstimated).toBe('0.00');
    expect(res.cohort.estimatedTotal).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// getPlanFact
// ---------------------------------------------------------------------------

describe('getPlanFact', () => {
  it('non-staff role → forbidden', async () => {
    const session = { sub: 'p1', role: 'partner', companyId: 'c1' } as never;
    const res = await getPlanFact(fakePrisma(), session, { year: 2026, month: 7 });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('companyId null → forbidden', async () => {
    const session = { sub: 'a1', role: 'admin', companyId: null } as never;
    const res = await getPlanFact(fakePrisma(), session, { year: 2026, month: 7 });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('month 13 → invalid_period', async () => {
    const res = await getPlanFact(fakePrisma(), leaderSession, { year: 2026, month: 13 });
    expect(res).toEqual({ ok: false, error: 'invalid_period' });
  });

  it('year 1999 → invalid_period', async () => {
    const res = await getPlanFact(fakePrisma(), leaderSession, { year: 1999, month: 6 });
    expect(res).toEqual({ ok: false, error: 'invalid_period' });
  });

  it('non-integer year → invalid_period', async () => {
    const res = await getPlanFact(fakePrisma(), leaderSession, { year: 2026.5, month: 6 });
    expect(res).toEqual({ ok: false, error: 'invalid_period' });
  });

  it('refund netting, per-manager executionPct, target=0 edge, unassigned present (fact≠0)', async () => {
    listCompanyManagers.mockResolvedValue([
      {
        id: 'm1',
        name: 'Иванов',
        email: 'i@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
      {
        id: 'm2',
        name: 'Петров',
        email: 'p@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
      {
        id: 'm3',
        name: 'Сидоров',
        email: 's@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
    ]);
    const payment = {
      findMany: vi.fn().mockResolvedValue([
        { amount: D('1000'), isRefund: false, order: { managerId: 'm1' } },
        { amount: D('200'), isRefund: true, order: { managerId: 'm1' } },
        { amount: D('150'), isRefund: false, order: { managerId: null } },
        { amount: D('50'), isRefund: false, order: null }, // defensive: relation absent despite where-filter guarantee
      ]),
    };
    const order = {
      groupBy: vi.fn().mockResolvedValue([{ managerId: 'm1', _count: { _all: 1 } }]),
    };
    const salesTarget = {
      findMany: vi.fn().mockResolvedValue([
        { managerId: 'm1', targetAmount: D('1000') },
        { managerId: 'm3', targetAmount: D('0') }, // edge: junk zero target → executionPct null
      ]),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    };
    const prisma = fakePrisma({ payment, order, salesTarget });
    const res = await getPlanFact(prisma, leaderSession, { year: 2026, month: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([
      {
        managerId: 'm1',
        name: 'Иванов',
        email: 'i@x.ru',
        target: '1000.00',
        fact: '800.00',
        completedOrders: 1,
        wonDeals: 0,
        wonAmount: '0.00',
        executionPct: 80,
      },
      {
        managerId: 'm2',
        name: 'Петров',
        email: 'p@x.ru',
        target: null,
        fact: '0.00',
        completedOrders: 0,
        wonDeals: 0,
        wonAmount: '0.00',
        executionPct: null,
      },
      {
        managerId: 'm3',
        name: 'Сидоров',
        email: 's@x.ru',
        target: '0.00',
        fact: '0.00',
        completedOrders: 0,
        wonDeals: 0,
        wonAmount: '0.00',
        executionPct: null,
      },
      {
        managerId: null,
        name: 'Без менеджера',
        email: '',
        target: null,
        fact: '200.00',
        completedOrders: 0,
        wonDeals: 0,
        wonAmount: '0.00',
        executionPct: null,
      },
    ]);
    expect(res.totals).toEqual({
      target: '1000.00',
      fact: '1000.00',
      wonAmount: '0.00',
      executionPct: 100,
    });
  });

  it('no unassigned facts and no unassigned completed orders → "Без менеджера" row absent', async () => {
    listCompanyManagers.mockResolvedValue([
      {
        id: 'm1',
        name: 'Иванов',
        email: 'i@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
    ]);
    const payment = {
      findMany: vi
        .fn()
        .mockResolvedValue([{ amount: D('500'), isRefund: false, order: { managerId: 'm1' } }]),
    };
    const prisma = fakePrisma({ payment });
    const res = await getPlanFact(prisma, leaderSession, { year: 2026, month: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.find((r) => r.managerId === null)).toBeUndefined();
  });

  it('unassigned row appears when only completedOrders>0 (fact stays zero)', async () => {
    listCompanyManagers.mockResolvedValue([]);
    const order = {
      groupBy: vi.fn().mockResolvedValue([{ managerId: null, _count: { _all: 2 } }]),
    };
    const prisma = fakePrisma({ order });
    const res = await getPlanFact(prisma, leaderSession, { year: 2026, month: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([
      {
        managerId: null,
        name: 'Без менеджера',
        email: '',
        target: null,
        fact: '0.00',
        completedOrders: 2,
        wonDeals: 0,
        wonAmount: '0.00',
        executionPct: null,
      },
    ]);
  });

  it('ФТ-4.5: выигранные сделки месяца — по менеджерам, null-amount=0, «Без менеджера», сумма в totals', async () => {
    listCompanyManagers.mockResolvedValue([
      {
        id: 'm1',
        name: 'Иванов',
        email: 'i@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
      {
        id: 'm2',
        name: 'Петров',
        email: 'p@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
    ]);
    const deal = {
      groupBy: vi.fn().mockResolvedValue([
        { managerId: 'm1', _sum: { amount: D('30000') }, _count: { _all: 2 } },
        { managerId: 'm2', _sum: { amount: null }, _count: { _all: 1 } }, // won без суммы → 0.00, но в счётчике
        { managerId: null, _sum: { amount: D('5000') }, _count: { _all: 1 } },
      ]),
    };
    const prisma = fakePrisma({ deal });
    const res = await getPlanFact(prisma, leaderSession, { year: 2026, month: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // where: компания сессии, только won, wonAt в границах месяца
    expect(deal.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['managerId'],
        where: expect.objectContaining({
          companyId: 'c1',
          status: 'won',
          wonAt: expect.anything(),
        }),
      })
    );
    expect(res.rows).toEqual([
      expect.objectContaining({ managerId: 'm1', wonDeals: 2, wonAmount: '30000.00' }),
      expect.objectContaining({ managerId: 'm2', wonDeals: 1, wonAmount: '0.00' }),
      expect.objectContaining({
        managerId: null,
        name: 'Без менеджера',
        wonDeals: 1,
        wonAmount: '5000.00',
      }),
    ]);
    expect(res.totals.wonAmount).toBe('35000.00');
  });

  it('totals.executionPct is null when no manager has a target at all', async () => {
    listCompanyManagers.mockResolvedValue([
      {
        id: 'm1',
        name: 'Иванов',
        email: 'i@x.ru',
        isActive: true,
        managerRole: null,
        assignments: [],
      },
    ]);
    const res = await getPlanFact(fakePrisma(), leaderSession, { year: 2026, month: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totals).toEqual({
      target: '0.00',
      fact: '0.00',
      wonAmount: '0.00',
      executionPct: null,
    });
  });
});

// ---------------------------------------------------------------------------
// upsertSalesTarget
// ---------------------------------------------------------------------------

describe('upsertSalesTarget', () => {
  const args = { managerId: 'm1', year: 2026, month: 7, targetAmount: '1500' as string | null };

  it('manager without managerRole=leader → forbidden', async () => {
    const session = { sub: 'u1', role: 'manager', companyId: 'c1', managerRole: null } as never;
    const res = await upsertSalesTarget(fakePrisma(), session, args);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('companyId null (even for admin) → forbidden', async () => {
    const session = { sub: 'a1', role: 'admin', companyId: null } as never;
    const res = await upsertSalesTarget(fakePrisma(), session, args);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('non-staff role (partner) → forbidden', async () => {
    const session = { sub: 'x1', role: 'partner', companyId: 'c1' } as never;
    const res = await upsertSalesTarget(fakePrisma(), session, args);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('invalid period → invalid_period (before target lookup)', async () => {
    const user = { findUnique: vi.fn() };
    const prisma = fakePrisma({ user });
    const res = await upsertSalesTarget(prisma, leaderSession, { ...args, month: 13 });
    expect(res).toEqual({ ok: false, error: 'invalid_period' });
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('admin → ok (valid upsert)', async () => {
    const user = {
      findUnique: vi.fn().mockResolvedValue({ id: 'm1', role: 'manager', companyId: 'c1' }),
    };
    const salesTarget = {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
    };
    const prisma = fakePrisma({ user, salesTarget });
    const res = await upsertSalesTarget(prisma, leaderSession, args);
    expect(res).toEqual({ ok: true });
    expect(salesTarget.upsert).toHaveBeenCalledOnce();
    const call = salesTarget.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      companyId_managerId_year_month: { companyId: 'c1', managerId: 'm1', year: 2026, month: 7 },
    });
    expect(call.create.targetAmount.toFixed(2)).toBe('1500.00');
    expect(call.create.createdById).toBe('leader1');
    expect(call.update.targetAmount.toFixed(2)).toBe('1500.00');
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'sales_target_set',
        entity: 'user',
        entityId: 'm1',
        userId: 'leader1',
        after: { year: 2026, month: 7, targetAmount: '1500.00' },
      })
    );
  });

  it('leader manager (managerRole=leader) → ok', async () => {
    const session = {
      sub: 'leader2',
      role: 'manager',
      companyId: 'c1',
      managerRole: 'leader',
    } as never;
    const user = {
      findUnique: vi.fn().mockResolvedValue({ id: 'm1', role: 'manager', companyId: 'c1' }),
    };
    const prisma = fakePrisma({ user });
    const res = await upsertSalesTarget(prisma, session, args);
    expect(res).toEqual({ ok: true });
  });

  it('foreign-company manager → forbidden', async () => {
    const user = {
      findUnique: vi.fn().mockResolvedValue({ id: 'm1', role: 'manager', companyId: 'other-co' }),
    };
    const prisma = fakePrisma({ user });
    const res = await upsertSalesTarget(prisma, leaderSession, args);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('unknown user → not_found', async () => {
    const user = { findUnique: vi.fn().mockResolvedValue(null) };
    const prisma = fakePrisma({ user });
    const res = await upsertSalesTarget(prisma, leaderSession, args);
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('target user with role=organization → not_found', async () => {
    const user = {
      findUnique: vi.fn().mockResolvedValue({ id: 'm1', role: 'organization', companyId: 'c1' }),
    };
    const prisma = fakePrisma({ user });
    const res = await upsertSalesTarget(prisma, leaderSession, args);
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it.each(['0', '-5', 'abc', '1000000000000', 'NaN', 'Infinity', '-Infinity'])(
    'targetAmount %s → invalid',
    async (bad) => {
      const user = {
        findUnique: vi.fn().mockResolvedValue({ id: 'm1', role: 'manager', companyId: 'c1' }),
      };
      const salesTarget = { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() };
      const prisma = fakePrisma({ user, salesTarget });
      const res = await upsertSalesTarget(prisma, leaderSession, { ...args, targetAmount: bad });
      expect(res).toEqual({ ok: false, error: 'invalid' });
      expect(salesTarget.upsert).not.toHaveBeenCalled();
    }
  );

  it('targetAmount null → deleteMany + audit sales_target_cleared', async () => {
    const user = {
      findUnique: vi.fn().mockResolvedValue({ id: 'm1', role: 'manager', companyId: 'c1' }),
    };
    const salesTarget = {
      findMany: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn(),
    };
    const prisma = fakePrisma({ user, salesTarget });
    const res = await upsertSalesTarget(prisma, leaderSession, { ...args, targetAmount: null });
    expect(res).toEqual({ ok: true });
    expect(salesTarget.deleteMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', managerId: 'm1', year: 2026, month: 7 },
    });
    expect(salesTarget.upsert).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'sales_target_cleared',
        entity: 'user',
        entityId: 'm1',
        userId: 'leader1',
        after: { year: 2026, month: 7 },
      })
    );
  });
});
