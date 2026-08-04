import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Hoist mocks for syncHealth and queueStats before any imports
// ---------------------------------------------------------------------------
const { getSyncLagMock, getDlqMock } = vi.hoisted(() => ({
  getSyncLagMock: vi.fn(),
  getDlqMock: vi.fn(),
}));

vi.mock('@/lib/services/admin/syncHealth', () => ({
  getSyncLag: getSyncLagMock,
}));

vi.mock('@/lib/services/admin/queueStats', () => ({
  getDlq: getDlqMock,
}));

import { kpis, attention, recentEvents } from '@/lib/services/admin/dashboard';

// ---------------------------------------------------------------------------
// Prisma mock factory
// ---------------------------------------------------------------------------
function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    partner: {
      count: vi.fn().mockResolvedValue(0),
    },
    organization: {
      count: vi.fn().mockResolvedValue(0),
    },
    order: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
    },
    commissionStatement: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalCommissionAmount: null } }),
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// kpis()
// ---------------------------------------------------------------------------
describe('kpis()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns exactly 4 tiles with correct labels', async () => {
    const prisma = makePrisma();
    const tiles = await kpis(prisma);

    expect(tiles).toHaveLength(4);
    expect(tiles[0].label).toBe('Партнёры активные');
    expect(tiles[1].label).toBe('Организации');
    expect(tiles[2].label).toBe('Закрытые заказы (месяц)');
    expect(tiles[3].label).toBe('К выплате партнёрам');
  });

  it('all-zero database → values and deltas are zero / positive', async () => {
    const prisma = makePrisma();
    const tiles = await kpis(prisma);

    expect(tiles[0].value).toBe(0);
    expect(tiles[0].delta).toEqual({ value: 0, positive: true });

    expect(tiles[1].value).toBe(0);
    expect(tiles[1].delta).toEqual({ value: 0, positive: true });

    // String tiles
    expect(tiles[2].value).toContain('0');
    expect(tiles[3].value).toContain('0');
  });

  it('positive partner delta when last30 > prev30', async () => {
    // partner.count called multiple times: isActive, last30, prev30, ...
    const partnerCount = vi
      .fn()
      .mockResolvedValueOnce(10) // isActive partners
      .mockResolvedValueOnce(5) // created last 30 days
      .mockResolvedValueOnce(2); // created prev 30 days

    const prisma = makePrisma({ partner: { count: partnerCount } });
    const tiles = await kpis(prisma);

    expect(tiles[0].value).toBe(10);
    expect(tiles[0].delta).toEqual({ value: 3, positive: true });
  });

  it('negative partner delta when last30 < prev30', async () => {
    const partnerCount = vi
      .fn()
      .mockResolvedValueOnce(8) // isActive
      .mockResolvedValueOnce(1) // last30
      .mockResolvedValueOnce(4); // prev30

    const prisma = makePrisma({ partner: { count: partnerCount } });
    const tiles = await kpis(prisma);

    expect(tiles[0].delta).toEqual({ value: -3, positive: false });
  });

  it('closed orders tile includes count and formatted amount', async () => {
    const orderCount = vi.fn().mockResolvedValue(7);
    const orderAggregate = vi.fn().mockResolvedValue({
      _sum: { totalAmount: '150000.00' },
    });

    const prisma = makePrisma({
      order: { count: orderCount, aggregate: orderAggregate },
    });
    const tiles = await kpis(prisma);

    expect(tiles[2].value).toContain('7');
    expect(tiles[2].value).toContain('₽');
    // No delta on closed-orders tile
    expect(tiles[2].delta).toBeUndefined();
  });

  it('pending payouts tile shows formatted amount', async () => {
    const csAggregate = vi.fn().mockResolvedValue({
      _sum: { totalCommissionAmount: '42500.50' },
    });

    const prisma = makePrisma({
      commissionStatement: { aggregate: csAggregate, count: vi.fn().mockResolvedValue(0) },
    });
    const tiles = await kpis(prisma);

    expect(tiles[3].value).toContain('₽');
    expect(tiles[3].delta).toBeUndefined();
  });

  it('issues 9 parallel DB calls via Promise.all', async () => {
    const partnerCount = vi.fn().mockResolvedValue(0);
    const orgCount = vi.fn().mockResolvedValue(0);
    const orderCount = vi.fn().mockResolvedValue(0);
    const orderAgg = vi.fn().mockResolvedValue({ _sum: { totalAmount: null } });
    const csAgg = vi.fn().mockResolvedValue({ _sum: { totalCommissionAmount: null } });

    const prisma = makePrisma({
      partner: { count: partnerCount },
      organization: { count: orgCount },
      order: { count: orderCount, aggregate: orderAgg },
      commissionStatement: { count: vi.fn().mockResolvedValue(0), aggregate: csAgg },
    });

    await kpis(prisma);

    // 3 partner.count + 3 org.count + 1 order.count + 1 order.aggregate + 1 cs.aggregate = 9
    expect(partnerCount).toHaveBeenCalledTimes(3);
    expect(orgCount).toHaveBeenCalledTimes(3);
    expect(orderCount).toHaveBeenCalledTimes(1);
    expect(orderAgg).toHaveBeenCalledTimes(1);
    expect(csAgg).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// attention()
// ---------------------------------------------------------------------------
describe('attention()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSyncLagMock.mockResolvedValue([]);
    getDlqMock.mockResolvedValue([]);
  });

  it('returns empty array when everything is healthy', async () => {
    const prisma = makePrisma();
    const items = await attention(prisma);
    expect(items).toEqual([]);
  });

  it('adds warn item when sync lag is 25–48h', async () => {
    const lagMs = 25 * 60 * 60 * 1000; // 25 hours
    getSyncLagMock.mockResolvedValue([
      { entity: 'order', lagMs, lastSuccessAt: new Date(), successCount24h: 0, errorCount24h: 1 },
    ]);

    const prisma = makePrisma();
    const items = await attention(prisma);

    const lag = items.find((i) => i.id === 'sync_lag');
    expect(lag).toBeDefined();
    expect(lag!.severity).toBe('warn');
    expect(lag!.href).toBe('/admin/settings/system/health');
  });

  it('adds urgent item when sync lag >48h', async () => {
    const lagMs = 49 * 60 * 60 * 1000; // 49 hours
    getSyncLagMock.mockResolvedValue([
      { entity: 'order', lagMs, lastSuccessAt: new Date(), successCount24h: 0, errorCount24h: 1 },
    ]);

    const prisma = makePrisma();
    const items = await attention(prisma);

    const lag = items.find((i) => i.id === 'sync_lag');
    expect(lag!.severity).toBe('urgent');
  });

  it('does not add sync_lag item when lag <=24h', async () => {
    getSyncLagMock.mockResolvedValue([
      {
        entity: 'order',
        lagMs: 23 * 60 * 60 * 1000,
        lastSuccessAt: new Date(),
        successCount24h: 10,
        errorCount24h: 0,
      },
    ]);

    const prisma = makePrisma();
    const items = await attention(prisma);

    expect(items.find((i) => i.id === 'sync_lag')).toBeUndefined();
  });

  it('adds urgent dlq item when DLQ has jobs', async () => {
    getDlqMock.mockResolvedValue([
      {
        queue: 'commission',
        jobId: 'j1',
        name: 'calc',
        failedReason: 'err',
        failedAt: new Date(),
        attemptsMade: 3,
      },
    ]);

    const prisma = makePrisma();
    const items = await attention(prisma);

    const dlq = items.find((i) => i.id === 'dlq');
    expect(dlq).toBeDefined();
    expect(dlq!.severity).toBe('urgent');
    expect(dlq!.href).toBe('/admin/settings/system/health');
    expect(dlq!.title).toContain('1');
  });

  it('adds warn item for old approved statements', async () => {
    const csCount = vi.fn().mockResolvedValue(3);
    const prisma = makePrisma({
      commissionStatement: {
        count: csCount,
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalCommissionAmount: null } }),
      },
    });

    const items = await attention(prisma);

    const old = items.find((i) => i.id === 'old_approved');
    expect(old).toBeDefined();
    expect(old!.severity).toBe('warn');
    expect(old!.href).toContain('/admin/commission-statements');
    expect(old!.title).toContain('3');
  });

  it('adds warn item for active partners without commissionRate', async () => {
    const partnerCount = vi.fn().mockResolvedValue(2);
    const prisma = makePrisma({ partner: { count: partnerCount } });

    const items = await attention(prisma);

    const noRate = items.find((i) => i.id === 'no_rate');
    expect(noRate).toBeDefined();
    expect(noRate!.severity).toBe('warn');
    expect(noRate!.href).toContain('/admin/partners');
    expect(noRate!.title).toContain('2');
  });

  it('continues gracefully when getSyncLag throws', async () => {
    getSyncLagMock.mockRejectedValue(new Error('DB timeout'));

    const prisma = makePrisma();
    // Should not throw
    const items = await attention(prisma);
    expect(items.find((i) => i.id === 'sync_lag')).toBeUndefined();
  });

  it('continues gracefully when getDlq throws', async () => {
    getDlqMock.mockRejectedValue(new Error('Redis down'));

    const prisma = makePrisma();
    const items = await attention(prisma);
    expect(items.find((i) => i.id === 'dlq')).toBeUndefined();
  });

  it('can return all 4 items simultaneously', async () => {
    getSyncLagMock.mockResolvedValue([
      {
        entity: 'order',
        lagMs: 72 * 60 * 60 * 1000,
        lastSuccessAt: new Date(),
        successCount24h: 0,
        errorCount24h: 5,
      },
    ]);
    getDlqMock.mockResolvedValue([
      {
        queue: 'commission',
        jobId: 'j1',
        name: 'calc',
        failedReason: 'err',
        failedAt: new Date(),
        attemptsMade: 3,
      },
    ]);

    const csCount = vi.fn().mockResolvedValue(2);
    const partnerCount = vi.fn().mockResolvedValue(1);

    const prisma = makePrisma({
      commissionStatement: {
        count: csCount,
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalCommissionAmount: null } }),
      },
      partner: { count: partnerCount },
    });

    const items = await attention(prisma);
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.id).sort()).toEqual(
      ['dlq', 'no_rate', 'old_approved', 'sync_lag'].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// recentEvents()
// ---------------------------------------------------------------------------
describe('recentEvents()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty array when no audit rows match', async () => {
    const prisma = makePrisma();
    const events = await recentEvents(prisma);
    expect(events).toEqual([]);
  });

  it('queries with correct action filter and default take=20', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ auditLog: { findMany } });

    await recentEvents(prisma);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];

    expect(arg.take).toBe(20);
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.where.action.in).toEqual(
      expect.arrayContaining([
        'commission_statement_calculated',
        'commission_statement_approved',
        'commission_statement_paid',
        'partner_commission_rate_changed',
        'lead_created',
      ])
    );
  });

  it('respects custom take parameter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ auditLog: { findMany } });

    await recentEvents(prisma, 5);

    expect(findMany.mock.calls[0][0].take).toBe(5);
  });

  it('maps actor from user.name when available', async () => {
    const now = new Date();
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'a1',
        action: 'commission_statement_approved',
        entity: 'commission_statement',
        entityId: 'cs1',
        createdAt: now,
        user: { name: 'Иван Иванов', email: 'ivan@example.com' },
      },
    ]);
    const prisma = makePrisma({ auditLog: { findMany } });

    const events = await recentEvents(prisma);

    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe('Иван Иванов');
    expect(events[0].verb).toBe('commission_statement_approved');
    expect(events[0].entity).toBe('commission_statement');
    expect(events[0].entityRef).toBe('cs1');
    expect(events[0].timestamp).toBe(now);
  });

  it('falls back to user.email when name is empty/null', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'a2',
        action: 'partner_commission_rate_changed',
        entity: 'organization',
        entityId: 'org1',
        createdAt: new Date(),
        user: { name: '', email: 'admin@example.com' },
      },
    ]);
    const prisma = makePrisma({ auditLog: { findMany } });

    const events = await recentEvents(prisma);

    expect(events[0].actor).toBe('admin@example.com');
  });

  it('includes user via select: name + email', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ auditLog: { findMany } });

    await recentEvents(prisma);

    const arg = findMany.mock.calls[0][0];
    expect(arg.include).toEqual({
      user: { select: { name: true, email: true } },
    });
  });

  it('maps multiple rows correctly', async () => {
    const t1 = new Date('2026-05-20T10:00:00Z');
    const t2 = new Date('2026-05-19T08:00:00Z');

    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'e1',
        action: 'commission_statement_paid',
        entity: 'commission_statement',
        entityId: 'cs1',
        createdAt: t1,
        user: { name: 'Менеджер', email: 'mgr@example.com' },
      },
      {
        id: 'e2',
        action: 'lead_created',
        entity: 'lead',
        entityId: 'l1',
        createdAt: t2,
        user: { name: '', email: 'partner@example.com' },
      },
    ]);
    const prisma = makePrisma({ auditLog: { findMany } });

    const events = await recentEvents(prisma);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: 'e1',
      actor: 'Менеджер',
      verb: 'commission_statement_paid',
    });
    expect(events[1]).toMatchObject({
      id: 'e2',
      actor: 'partner@example.com',
      verb: 'lead_created',
    });
  });

  it('falls back to "—" when user is null (actor record deleted)', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'a-null',
        action: 'lead_created',
        entity: 'lead',
        entityId: 'l1',
        createdAt: new Date(),
        user: null, // actor row deleted — covers `r.user?.name || r.user?.email || '—'`
      },
    ]);
    const prisma = makePrisma({ auditLog: { findMany } });

    const events = await recentEvents(prisma);
    expect(events[0].actor).toBe('—');
  });
});
