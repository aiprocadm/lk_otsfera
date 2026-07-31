/**
 * Unit tests for src/lib/services/manager/dashboard/kpis.ts — kpis().
 * Also imports from dashboard/index.ts (the barrel) to ensure it is covered.
 * The integration test (services.manager.dashboard.test.ts) requires live Postgres.
 * This file covers service branches via mocked prisma:
 *   - teamModeOverride=true: skips getCompanyTeamVisibility
 *   - teamModeOverride not set: calls getCompanyTeamVisibility
 *   - returns correct KpiData shape
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managerOrderScope } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn().mockResolvedValue(false),
  managerOrderScope: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managerOrderScope,
}));

// Import from barrel index to cover dashboard/index.ts
import { kpis } from '@/lib/services/manager/dashboard';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1',
};

function fakePrismaParallel(
  activeOrders = 5,
  activeOld = 2,
  attention = 3,
  unread = 1,
  urgent = 0
) {
  let orderCallIdx = 0;
  const counts = [activeOrders, activeOld, attention, urgent]; // 3 order counts + urgentDeadlines
  return {
    order: {
      count: vi.fn().mockImplementation(() => Promise.resolve(counts[orderCallIdx++] ?? 0)),
    },
    notification: { count: vi.fn().mockResolvedValue(unread) },
    company: { findUnique: vi.fn() },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managerOrderScope.mockReturnValue({});
});

describe('kpis', () => {
  it('teamModeOverride=true skips getCompanyTeamVisibility', async () => {
    const p = fakePrismaParallel();
    await kpis(p, SESSION, true);
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(managerOrderScope).toHaveBeenCalledWith(SESSION, true);
  });

  it('calls getCompanyTeamVisibility when no override', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    const p = fakePrismaParallel();
    await kpis(p, SESSION);
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(p, 'co-1');
    expect(managerOrderScope).toHaveBeenCalledWith(SESSION, false);
  });

  it('returns correct KpiData shape', async () => {
    const p = fakePrismaParallel(10, 3, 2, 5, 1);
    const result = await kpis(p, SESSION, false);
    expect(result).toMatchObject({
      activeOrders: expect.any(Number),
      activeOrdersDelta: expect.any(Number),
      attentionCount: expect.any(Number),
      unreadComments: expect.any(Number),
      urgentDeadlines: expect.any(Number),
    });
  });

  it('activeOrdersDelta = activeOrders - activeOrders30dAgo', async () => {
    // Active now = 8, active 30d ago = 5, delta = 3
    let orderCall = 0;
    const orderCount = vi.fn().mockImplementation(() => {
      const values = [8, 5, 0, 0]; // activeOrders, activeOrders30dAgo, attentionCount, urgentDeadlines
      return Promise.resolve(values[orderCall++] ?? 0);
    });
    const p = {
      order: { count: orderCount },
      notification: { count: vi.fn().mockResolvedValue(0) },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await kpis(p, SESSION, false);
    expect(result.activeOrdersDelta).toBe(3); // 8 - 5
  });
});
