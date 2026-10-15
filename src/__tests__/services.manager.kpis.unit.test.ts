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

function fakePrismaParallel(activeOrders = 5, attention = 3, unread = 1, urgent = 0) {
  let orderCallIdx = 0;
  // Порядок запросов: в работе, просрочено, (уведомления), срок в 3 дня.
  const counts = [activeOrders, attention, urgent];
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
    const p = fakePrismaParallel(10, 2, 5, 1);
    const result = await kpis(p, SESSION, false);
    expect(result).toEqual({
      activeOrders: 10,
      attentionCount: 2,
      unreadComments: 5,
      urgentDeadlines: 1,
    });
  });

  it('этап 4 ТЗ 13.10.2026 (`У-297`): плитки считаются условиями фокуса списка заказов', async () => {
    const p = fakePrismaParallel() as unknown as { order: { count: ReturnType<typeof vi.fn> } };
    await kpis(p as never, SESSION, false);
    const wheres = p.order.count.mock.calls.map((c) => c[0].where.AND[1]);
    expect(wheres[0]).toEqual({ executionStatus: { in: ['pending', 'in_progress'] } });
    expect(JSON.stringify(wheres[1])).toContain('"lt"');
    expect(JSON.stringify(wheres[2])).toContain('"gte"');
    // Разница «за 30 дней» больше не запрашивается.
    expect(p.order.count).toHaveBeenCalledTimes(3);
  });
});
