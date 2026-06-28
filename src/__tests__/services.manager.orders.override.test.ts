import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { getCompanyTeamVisibility } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn()
}));

vi.mock('@/lib/auth/managerPolicy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/managerPolicy')>(
    '@/lib/auth/managerPolicy'
  );
  return { ...actual, getCompanyTeamVisibility };
});

import { listOrders } from '@/lib/services/manager/orders';

const session = (over: Partial<SessionPayload>): SessionPayload =>
  ({ sub: 'm1', role: 'manager', email: 'm@x', ...over } as unknown as SessionPayload);

function fakePrisma() {
  return {
    order: { findMany: vi.fn().mockResolvedValue([]) }
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listOrders teamModeOverride', () => {
  it('override=true даёт company-wide where даже при выключенном toggle', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    const prisma = fakePrisma();

    await listOrders(prisma, {
      session: session({ companyId: 'c1', managedOrgIds: [] }),
      teamModeOverride: true
    });

    // toggle ignored — override forces company-wide branch (no DB read needed,
    // but even if read returned false, the where must be company-wide).
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    const call = prisma.order.findMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({ companyId: 'c1' });
  });

  it('без override поведение прежнее (toggle решает): OFF → OR-scope', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    const prisma = fakePrisma();

    await listOrders(prisma, {
      session: session({ companyId: 'c1', managedOrgIds: ['o1'] })
    });

    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(prisma, 'c1');
    const call = prisma.order.findMany.mock.calls[0][0];
    // scoped three-way OR, not company-wide
    expect(call.where.AND[0]).toHaveProperty('OR');
  });

  it('без override, toggle ON → company-wide where', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const prisma = fakePrisma();

    await listOrders(prisma, {
      session: session({ companyId: 'c1', managedOrgIds: [] })
    });

    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(prisma, 'c1');
    const call = prisma.order.findMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({ companyId: 'c1' });
  });
});
