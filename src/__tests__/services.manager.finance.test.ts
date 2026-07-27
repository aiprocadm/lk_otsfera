import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { SessionAccessProfile } from '@/lib/auth/accessProfile';

const orgFinance = vi.hoisted(() => ({
  getOrgFinanceKpisForOrgs: vi.fn(),
  listOrgPaymentsForOrgs: vi.fn(),
  // Этап 10 (PR-2): расчёт комиссии переехал в staff-неймспейс — мок ссылается
  // на новый модуль, но объект общий, чтобы не переписывать ожидания ниже.
  getOrgIntermediaryCommissionForOrgs: vi.fn()
}));
vi.mock('@/lib/services/organization/finance', () => ({
  getOrgFinanceKpisForOrgs: orgFinance.getOrgFinanceKpisForOrgs,
  listOrgPaymentsForOrgs: orgFinance.listOrgPaymentsForOrgs
}));
vi.mock('@/lib/services/manager/orgCommission', () => ({
  getOrgIntermediaryCommissionForOrgs: orgFinance.getOrgIntermediaryCommissionForOrgs
}));

import { getManagerFinanceOverview } from '@/lib/services/manager/finance';

const session = (over: Partial<SessionPayload>): SessionPayload =>
  ({ sub: 'm1', role: 'manager', email: 'm@x', ...over } as unknown as SessionPayload);

const profile = (over: Partial<SessionAccessProfile> = {}): SessionAccessProfile => ({
  id: 'p1',
  name: 'Роль',
  orders: 'all',
  organizations: 'all',
  threads: 'all',
  documents: 'all',
  finance: 'all',
  leads: 'all',
  tasks: 'all',
  capabilities: [],
  ...over
});

function fakePrisma(orgs: Array<{ id: string; name: string }>) {
  return { organization: { findMany: vi.fn().mockResolvedValue(orgs) } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Батч-моки: каждому запрошенному id — одна и та же секция (как раньше per-org).
  orgFinance.getOrgFinanceKpisForOrgs.mockImplementation(async (_prisma: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, { billed: '100.00', paid: '40.00', outstanding: '60.00' }]))
  );
  orgFinance.listOrgPaymentsForOrgs.mockImplementation(async (_prisma: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, [
      { id: 'p1', amount: '40.00', paidAt: new Date('2026-04-01'), method: null, isRefund: false, note: null, orderId: null, orderNumber: null }
    ]]))
  );
  orgFinance.getOrgIntermediaryCommissionForOrgs.mockImplementation(async (_prisma: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, { effectiveRate: '0.1', totalCommission: '10.00', perOrder: [] }]))
  );
});

describe('getManagerFinanceOverview', () => {
  it('plain manager: scoped to managedOrgIds, commission NOT computed', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }, { id: 'o2', name: 'B' }]);
    const res = await getManagerFinanceOverview(prisma, session({ managedOrgIds: ['o1', 'o2'], companyId: 'c1' }), { teamMode: false });

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['o1', 'o2'] } } })
    );
    expect(orgFinance.getOrgIntermediaryCommissionForOrgs).not.toHaveBeenCalled();
    expect(res.canSeeCommission).toBe(false);
    expect(res.sections).toHaveLength(2);
    expect(res.sections.every((s) => s.commission === null)).toBe(true);
    expect(res.summary).toEqual({ billed: '200.00', paid: '80.00', outstanding: '120.00' });
  });

  it('leader with teamMode=ON: company-wide scope + commission computed', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }]);
    const res = await getManagerFinanceOverview(prisma, session({ managerRole: 'leader', companyId: 'c1' }), { teamMode: true });

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } })
    );
    expect(orgFinance.getOrgIntermediaryCommissionForOrgs).toHaveBeenCalledWith(prisma, ['o1']);
    expect(res.canSeeCommission).toBe(true);
    expect(res.sections[0].commission).toEqual({ effectiveRate: '0.1', totalCommission: '10.00', perOrder: [] });
  });

  it('admin: unscoped (no where) + commission computed', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }]);
    const res = await getManagerFinanceOverview(prisma, session({ role: 'admin' }), { teamMode: false });

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
    expect(res.canSeeCommission).toBe(true);
    expect(orgFinance.getOrgIntermediaryCommissionForOrgs).toHaveBeenCalledTimes(1);
  });

  it('profiled leader WITHOUT see_commission: commission hidden (flag overrides leader)', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }]);
    const res = await getManagerFinanceOverview(
      prisma,
      session({ managerRole: 'leader', companyId: 'c1', accessProfile: profile({ capabilities: [] }) }),
      { teamMode: true }
    );
    expect(res.canSeeCommission).toBe(false);
    expect(orgFinance.getOrgIntermediaryCommissionForOrgs).not.toHaveBeenCalled();
    expect(res.sections.every((s) => s.commission === null)).toBe(true);
  });

  it('profiled non-leader WITH see_commission: commission granted', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }]);
    const res = await getManagerFinanceOverview(
      prisma,
      session({ companyId: 'c1', accessProfile: profile({ capabilities: ['see_commission'] }) }),
      { teamMode: false }
    );
    expect(res.canSeeCommission).toBe(true);
    expect(orgFinance.getOrgIntermediaryCommissionForOrgs).toHaveBeenCalledWith(prisma, ['o1']);
  });

  it('empty scope → no sections, zero summary', async () => {
    const prisma = fakePrisma([]);
    const res = await getManagerFinanceOverview(prisma, session({ managedOrgIds: [], companyId: 'c1' }), { teamMode: false });
    expect(res.sections).toEqual([]);
    expect(res.summary).toEqual({ billed: '0.00', paid: '0.00', outstanding: '0.00' });
  });

  it('includePayments:false (R1.2, leaderDashboard): ledger не запрашивается, payments пустые, итоги на месте', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }, { id: 'o2', name: 'B' }]);
    const res = await getManagerFinanceOverview(
      prisma,
      session({ managerRole: 'leader', companyId: 'c1' }),
      { teamMode: true, includePayments: false }
    );

    expect(orgFinance.listOrgPaymentsForOrgs).not.toHaveBeenCalled();
    expect(res.sections).toHaveLength(2);
    expect(res.sections.every((s) => s.payments.length === 0)).toBe(true);
    // Итоги и комиссия не деградируют без ledger'а.
    expect(res.summary).toEqual({ billed: '200.00', paid: '80.00', outstanding: '120.00' });
    expect(res.sections[0].commission).toEqual({ effectiveRate: '0.1', totalCommission: '10.00', perOrder: [] });
  });

  it('без includePayments (страницы финансов): ledger запрашивается как раньше', async () => {
    const prisma = fakePrisma([{ id: 'o1', name: 'A' }]);
    const res = await getManagerFinanceOverview(prisma, session({ role: 'admin' }), { teamMode: false });
    expect(orgFinance.listOrgPaymentsForOrgs).toHaveBeenCalledWith(prisma, ['o1']);
    expect(res.sections[0].payments).toHaveLength(1);
  });
});
