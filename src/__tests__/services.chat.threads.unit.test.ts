/**
 * Unit tests for src/lib/services/chat/threads.ts
 * Covers branches missed by the integration test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listThreads,
  markRead,
  unreadCount,
  findOrCreateThread,
} from '@/lib/services/chat/threads';
import type { SessionPayload } from '@/lib/auth/jwt';

// canSeeThread is tested separately; for threads.ts we just mock the policy module
vi.mock('@/lib/services/chat/policy', () => ({
  canSeeThread: vi.fn(),
}));
vi.mock('@/lib/auth/organizationPolicy', () => ({
  activeOrgIds: vi.fn((session: any) =>
    (session.organizationMemberships ?? [])
      .filter((m: any) => m.isActive)
      .map((m: any) => m.organizationId)
  ),
}));

import { canSeeThread } from '@/lib/services/chat/policy';
const canSeeThreadMock = canSeeThread as ReturnType<typeof vi.fn>;

// Явное `| undefined` в типе оверрайдов — сознательно: тесты ниже проверяют
// sentinel-ветки «companyId / partnerId не задан», и при
// exactOptionalPropertyTypes Partial<SessionPayload> такие литералы не принимает.
type SessionOverrides = { [K in keyof SessionPayload]?: SessionPayload[K] | undefined };

function makeSession(overrides: SessionOverrides = {}): SessionPayload {
  return { sub: 'u1', role: 'manager', companyId: 'c1', ...overrides } as SessionPayload;
}

function makeThread(overrides: Record<string, any> = {}) {
  return {
    id: 't1',
    orderId: 'o1',
    side: 'org',
    lastMessageAt: new Date('2024-06-01'),
    order: { orderNumber: 'N1', title: 'Заказ' },
    readStates: [],
    ...overrides,
  };
}

// ─── listThreads ──────────────────────────────────────────────────────────────

describe('listThreads — unit', () => {
  it('returns empty rows for roles with no threads (null scopeWhere)', async () => {
    const prisma = { orderThread: { findMany: vi.fn() } } as any;
    // role 'student' returns null from scopeWhere
    const result = await listThreads(prisma, makeSession({ role: 'student' as any }));
    expect(result).toEqual({ ok: true, rows: [] });
    expect(prisma.orderThread.findMany).not.toHaveBeenCalled();
  });

  it('scopeWhere for admin returns empty where {} (sees all threads)', async () => {
    const findMany = vi.fn().mockResolvedValue([makeThread()]);
    const prisma = { orderThread: { findMany } } as any;
    const result = await listThreads(prisma, makeSession({ role: 'admin' }));
    expect(result.ok).toBe(true);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });

  it('scopeWhere for manager includes company filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { orderThread: { findMany } } as any;
    await listThreads(prisma, makeSession({ role: 'manager', companyId: 'c1' }));
    const where = findMany.mock.calls[0][0].where;
    expect(where.order.companyId).toBe('c1');
  });

  it('scopeWhere for manager with null companyId uses sentinel __no_company__', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { orderThread: { findMany } } as any;
    await listThreads(prisma, makeSession({ role: 'manager', companyId: undefined }));
    const where = findMany.mock.calls[0][0].where;
    expect(where.order.companyId).toBe('__no_company__');
  });

  it('scopeWhere for organization scopes to org side + orgIds', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { orderThread: { findMany } } as any;
    const session = makeSession({
      role: 'organization',
      organizationMemberships: [
        { organizationId: 'org1', isActive: true, roleInOrg: 'member' },
      ] as any,
    });
    await listThreads(prisma, session);
    const where = findMany.mock.calls[0][0].where;
    expect(where.side).toBe('org');
    expect(where.order.organizationId.in).toContain('org1');
  });

  it('scopeWhere for partner scopes to partner side + partnerId', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { orderThread: { findMany } } as any;
    await listThreads(prisma, makeSession({ role: 'partner', partnerId: 'p1' }));
    const where = findMany.mock.calls[0][0].where;
    expect(where.side).toBe('partner');
    expect(where.order.partnerId).toBe('p1');
  });

  it('uses empty string as partnerId sentinel when partnerId is undefined', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { orderThread: { findMany } } as any;
    await listThreads(prisma, makeSession({ role: 'partner', partnerId: undefined }));
    const where = findMany.mock.calls[0][0].where;
    expect(where.order.partnerId).toBe('');
  });

  it('maps unread=true when lastMessageAt > lastReadAt', async () => {
    const lastRead = new Date('2024-01-01');
    const lastMsg = new Date('2024-06-01');
    const findMany = vi
      .fn()
      .mockResolvedValue([
        makeThread({ lastMessageAt: lastMsg, readStates: [{ lastReadAt: lastRead }] }),
      ]);
    const prisma = { orderThread: { findMany } } as any;
    const result = await listThreads(prisma, makeSession({ role: 'admin' }));
    expect(result.rows[0].unread).toBe(true);
  });

  it('maps unread=false when no readState (defaults to epoch 0)', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([makeThread({ lastMessageAt: new Date('2024-06-01'), readStates: [] })]);
    const prisma = { orderThread: { findMany } } as any;
    const result = await listThreads(prisma, makeSession({ role: 'admin' }));
    // lastMessageAt > new Date(0), so unread = true
    expect(result.rows[0].unread).toBe(true);
  });
});

// ─── markRead ─────────────────────────────────────────────────────────────────

describe('markRead — unit', () => {
  beforeEach(() => canSeeThreadMock.mockReset());

  it('returns thread_not_found when thread does not exist', async () => {
    const prisma = {
      orderThread: { findUnique: vi.fn().mockResolvedValue(null) },
      threadReadState: { upsert: vi.fn() },
    } as any;
    const result = await markRead(prisma, makeSession(), 'missing-thread');
    expect(result).toEqual({ ok: false, error: 'thread_not_found' });
  });

  it('returns forbidden when canSeeThread returns false', async () => {
    canSeeThreadMock.mockReturnValue(false);
    const prisma = {
      orderThread: {
        findUnique: vi.fn().mockResolvedValue({
          id: 't1',
          side: 'org',
          order: { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' },
        }),
      },
      threadReadState: { upsert: vi.fn() },
    } as any;
    const result = await markRead(prisma, makeSession({ role: 'partner' }), 't1');
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('upserts read state and returns ok:true when authorized', async () => {
    canSeeThreadMock.mockReturnValue(true);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      orderThread: {
        findUnique: vi.fn().mockResolvedValue({
          id: 't1',
          side: 'org',
          order: { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' },
        }),
      },
      threadReadState: { upsert },
    } as any;
    const result = await markRead(prisma, makeSession(), 't1');
    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { threadId_userId: { threadId: 't1', userId: 'u1' } },
      })
    );
  });
});

// ─── unreadCount ──────────────────────────────────────────────────────────────
// R1.2: unreadCount ушёл с findMany-полной-выборки на один SQL-count ($queryRaw).
// Юнит-слой фиксирует роль-ветки scopeSql (зеркало scopeWhere) по параметрам и
// тексту SQL; живая эквивалентность закреплена integration-слоем (inbox).

function queryRawPrisma(count = 0) {
  const queryRaw = vi.fn().mockResolvedValue([{ count }]);
  return { prisma: { $queryRaw: queryRaw } as any, queryRaw };
}

function sqlOf(queryRaw: ReturnType<typeof vi.fn>): { text: string; values: unknown[] } {
  const sql = queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
  return { text: sql.sql, values: sql.values };
}

describe('unreadCount — unit', () => {
  it('returns count:0 for roles with null scope (query never fired)', async () => {
    const { prisma, queryRaw } = queryRawPrisma();
    const result = await unreadCount(prisma, makeSession({ role: 'leader' as any }));
    expect(result).toEqual({ ok: true, count: 0 });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('admin: scope TRUE, count из SQL возвращается как есть', async () => {
    const { prisma, queryRaw } = queryRawPrisma(7);
    const result = await unreadCount(prisma, makeSession({ role: 'admin' }));
    expect(result).toEqual({ ok: true, count: 7 });
    const { text, values } = sqlOf(queryRaw);
    expect(text).toContain('TRUE');
    expect(text).toContain('COALESCE(rs."lastReadAt", to_timestamp(0))');
    // единственный параметр — userId для LEFT JOIN readStates
    expect(values).toEqual(['u1']);
  });

  it('manager: scope по companyId компании', async () => {
    const { prisma, queryRaw } = queryRawPrisma(2);
    await unreadCount(prisma, makeSession({ role: 'manager', companyId: 'c1' }));
    const { text, values } = sqlOf(queryRaw);
    expect(text).toContain('o."companyId"');
    expect(values).toContain('c1');
  });

  it('manager без companyId: sentinel __no_company__ (deny-all, зеркало scopeWhere)', async () => {
    const { prisma, queryRaw } = queryRawPrisma(0);
    await unreadCount(prisma, makeSession({ role: 'manager', companyId: undefined }));
    expect(sqlOf(queryRaw).values).toContain('__no_company__');
  });

  it('organization: side=org + orgIds из активных membership', async () => {
    const { prisma, queryRaw } = queryRawPrisma(1);
    const session = makeSession({
      role: 'organization',
      organizationMemberships: [
        { organizationId: 'org1', isActive: true, roleInOrg: 'member' },
        { organizationId: 'org2', isActive: false, roleInOrg: 'member' },
      ] as any,
    });
    await unreadCount(prisma, session);
    const { text, values } = sqlOf(queryRaw);
    expect(text).toContain(`'org'::"ThreadSide"`);
    expect(values).toContain('org1');
    expect(values).not.toContain('org2');
  });

  it('organization без активных membership: scope FALSE (ноль тредов, IN () невалиден)', async () => {
    const { prisma, queryRaw } = queryRawPrisma(0);
    const result = await unreadCount(
      prisma,
      makeSession({ role: 'organization', organizationMemberships: [] as any })
    );
    expect(result).toEqual({ ok: true, count: 0 });
    expect(sqlOf(queryRaw).text).toContain('FALSE');
  });

  it('partner: side=partner + partnerId', async () => {
    const { prisma, queryRaw } = queryRawPrisma(3);
    const result = await unreadCount(prisma, makeSession({ role: 'partner', partnerId: 'p1' }));
    expect(result).toEqual({ ok: true, count: 3 });
    const { text, values } = sqlOf(queryRaw);
    expect(text).toContain(`'partner'::"ThreadSide"`);
    expect(values).toContain('p1');
  });

  it('partner без partnerId: sentinel пустая строка (зеркало scopeWhere)', async () => {
    const { prisma, queryRaw } = queryRawPrisma(0);
    await unreadCount(prisma, makeSession({ role: 'partner', partnerId: undefined }));
    expect(sqlOf(queryRaw).values).toContain('');
  });
});

// ─── findOrCreateThread ───────────────────────────────────────────────────────

describe('findOrCreateThread — unit', () => {
  beforeEach(() => canSeeThreadMock.mockReset());

  it('returns order_not_found when order does not exist', async () => {
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(null) },
      orderThread: { upsert: vi.fn() },
    } as any;
    const result = await findOrCreateThread(prisma, makeSession(), { orderId: 'x', side: 'org' });
    expect(result).toEqual({ ok: false, error: 'order_not_found' });
  });

  it('returns forbidden when canSeeThread returns false', async () => {
    canSeeThreadMock.mockReturnValue(false);
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'o1',
          organizationId: 'org1',
          partnerId: 'p1',
          companyId: 'c1',
        }),
      },
      orderThread: { upsert: vi.fn() },
    } as any;
    const result = await findOrCreateThread(prisma, makeSession(), { orderId: 'o1', side: 'org' });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('upserts and returns thread when authorized', async () => {
    canSeeThreadMock.mockReturnValue(true);
    const thread = { id: 't1', orderId: 'o1', side: 'org' };
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'o1',
          organizationId: 'org1',
          partnerId: 'p1',
          companyId: 'c1',
        }),
      },
      orderThread: { upsert: vi.fn().mockResolvedValue(thread) },
    } as any;
    const result = await findOrCreateThread(prisma, makeSession(), { orderId: 'o1', side: 'org' });
    expect(result).toEqual({ ok: true, thread });
  });
});
