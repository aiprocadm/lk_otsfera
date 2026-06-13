import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { financeMock, rosterMock } = vi.hoisted(() => ({
  financeMock: vi.fn(),
  rosterMock: vi.fn()
}));
vi.mock('@/lib/services/manager/finance', () => ({ getManagerFinanceOverview: financeMock }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers: rosterMock }));

import { leaderDashboard } from '@/lib/services/leader/dashboard';

const session = (over: Partial<SessionPayload> = {}): SessionPayload =>
  ({ sub: 'leader1', role: 'manager', managerRole: 'leader', companyId: 'c1', ...over } as unknown as SessionPayload);

type GroupRow = {
  managerId: string | null;
  _count: { _all: number };
  _sum: { totalAmount: unknown; paidAmount: unknown };
};

function fakePrisma(opts: {
  activeOrders?: number;
  activeGroup?: GroupRow[];
  overdueGroup?: Array<{ managerId: string | null; _count: { _all: number } }>;
}) {
  const groupBy = vi.fn();
  // The service issues two groupBy calls: [active per-manager (with _sum), overdue per-manager].
  groupBy
    .mockResolvedValueOnce(opts.activeGroup ?? [])
    .mockResolvedValueOnce(opts.overdueGroup ?? []);
  return {
    order: {
      count: vi.fn().mockResolvedValue(opts.activeOrders ?? 0),
      groupBy
    }
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  rosterMock.mockResolvedValue([
    { id: 'm1', name: 'Manager One', email: 'm1@x', isActive: true, managerRole: null, assignments: [] },
    { id: 'm2', name: 'Manager Two', email: 'm2@x', isActive: true, managerRole: null, assignments: [] },
    { id: 'm3', name: 'Manager Three', email: 'm3@x', isActive: true, managerRole: null, assignments: [] },
    { id: 'm4', name: 'Manager Four', email: 'm4@x', isActive: true, managerRole: null, assignments: [] }
  ]);
  financeMock.mockResolvedValue({
    summary: { billed: '1000.00', paid: '400.00', outstanding: '600.00' },
    sections: [{ commission: { totalCommission: '90.00' } }, { commission: null }],
    canSeeCommission: true
  });
});

describe('leaderDashboard', () => {
  it('собирает KPI: менеджеры, активные заказы, долг, комиссия за месяц', async () => {
    const prisma = fakePrisma({ activeOrders: 17 });
    const res = await leaderDashboard(prisma, session());

    expect(res.kpis.managers).toBe(4);
    expect(res.kpis.activeOrders).toBe(17);
    expect(res.kpis.debt).toBe('600.00');
    expect(res.kpis.commission).toBe('90.00');
    // finance overview must be company-wide ALWAYS (teamMode:true), regardless of toggle
    expect(financeMock).toHaveBeenCalledWith(prisma, expect.anything(), { teamMode: true });
  });

  it('perManager: rows aggregated by managerId with names from roster', async () => {
    const prisma = fakePrisma({
      activeOrders: 5,
      activeGroup: [
        { managerId: 'm1', _count: { _all: 3 }, _sum: { totalAmount: '300', paidAmount: '120' } },
        { managerId: 'm2', _count: { _all: 2 }, _sum: { totalAmount: '200', paidAmount: '50' } }
      ],
      overdueGroup: [{ managerId: 'm1', _count: { _all: 1 } }]
    });
    const res = await leaderDashboard(prisma, session());

    expect(res.perManager).toHaveLength(4);
    const m1 = res.perManager.find((r) => r.managerId === 'm1')!;
    expect(m1.name).toBe('Manager One');
    expect(m1.email).toBe('m1@x');
    expect(m1.activeOrders).toBe(3);
    expect(m1.totalAmount).toBe('300');
    expect(m1.paidAmount).toBe('120');
    expect(m1.overdue).toBe(1);

    const m2 = res.perManager.find((r) => r.managerId === 'm2')!;
    expect(m2.activeOrders).toBe(2);
    expect(m2.overdue).toBe(0);

    // manager with no orders → all zeros
    const m3 = res.perManager.find((r) => r.managerId === 'm3')!;
    expect(m3.activeOrders).toBe(0);
    expect(m3.totalAmount).toBe('0');
    expect(m3.paidAmount).toBe('0');
    expect(m3.overdue).toBe(0);
  });

  it('commission=null когда ни на одной организации нет комиссии', async () => {
    const prisma = fakePrisma({ activeOrders: 0 });
    financeMock.mockResolvedValue({
      summary: { billed: '0.00', paid: '0.00', outstanding: '0.00' },
      sections: [{ commission: null }, { commission: null }],
      canSeeCommission: false
    });
    const res = await leaderDashboard(prisma, session());
    expect(res.kpis.commission).toBeNull();
  });

  it('companyId=null -> empty result, no throw', async () => {
    const prisma = fakePrisma({});
    const res = await leaderDashboard(prisma, session({ companyId: null }));
    expect(res.kpis.managers).toBe(0);
    expect(res.kpis.activeOrders).toBe(0);
    expect(res.kpis.commission).toBeNull();
    expect(res.perManager).toEqual([]);
    // no DB / finance work when company is unknown
    expect(financeMock).not.toHaveBeenCalled();
    expect(rosterMock).not.toHaveBeenCalled();
    expect(prisma.order.count).not.toHaveBeenCalled();
  });
});
