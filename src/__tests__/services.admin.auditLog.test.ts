import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { listAudit, listAuditFilters } from '@/lib/services/admin/auditLog';

// ---------------------------------------------------------------------------
// Prisma mock factory
// ---------------------------------------------------------------------------
function makePrisma(
  findManyImpl?: ReturnType<typeof vi.fn>,
  queryRawImpl?: ReturnType<typeof vi.fn>,
) {
  return {
    auditLog: {
      findMany: findManyImpl ?? vi.fn().mockResolvedValue([]),
    },
    $queryRaw: queryRawImpl ?? vi.fn().mockResolvedValue([]),
  } as unknown as PrismaClient;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    createdAt: new Date('2026-05-01T10:00:00Z'),
    updatedAt: new Date('2026-05-01T10:00:00Z'),
    action: 'lead_created',
    entity: 'lead',
    entityId: 'lead-1',
    userId: 'user-1',
    meta: { status: 'success' },
    user: { id: 'user-1', email: 'admin@example.com', name: 'Admin' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------
describe('listAudit() — cursor pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns exactly `take` rows and a non-null nextCursor when findMany returns take+1 rows', async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      makeRow({ id: `row-${i + 1}` })
    );
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = makePrisma(findMany);

    const result = await listAudit(prisma, { take: 50 });

    expect(result.rows).toHaveLength(50);
    expect(result.nextCursor).not.toBeNull();
    // nextCursor should be the id of the last row in the returned page (index 49)
    expect(result.nextCursor).toBe('row-50');
  });

  it('returns null nextCursor when findMany returns fewer than take+1 rows', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeRow({ id: `row-${i + 1}` })
    );
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = makePrisma(findMany);

    const result = await listAudit(prisma, { take: 50 });

    expect(result.rows).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it('passes cursor + skip:1 when cursor filter is provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, { cursor: 'row-42' });

    const arg = findMany.mock.calls[0][0];
    expect(arg.cursor).toEqual({ id: 'row-42' });
    expect(arg.skip).toBe(1);
  });

  it('does NOT include cursor/skip when no cursor is provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, {});

    const arg = findMany.mock.calls[0][0];
    expect(arg.cursor).toBeUndefined();
    expect(arg.skip).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Filters → where clause translation
// ---------------------------------------------------------------------------
describe('listAudit() — filter translation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes entity filter into where.entity', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, { entity: 'order' });

    const { where } = findMany.mock.calls[0][0];
    expect(where.entity).toBe('order');
  });

  it('passes action filter into where.action', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, { action: 'lead_created' });

    const { where } = findMany.mock.calls[0][0];
    expect(where.action).toBe('lead_created');
  });

  it('passes actorUserId into where.userId', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, { actorUserId: 'user-99' });

    const { where } = findMany.mock.calls[0][0];
    expect(where.userId).toBe('user-99');
  });

  it('passes from/to into where.createdAt with gte/lte', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    const from = new Date('2026-05-01T00:00:00Z');
    const to = new Date('2026-05-31T23:59:59Z');
    await listAudit(prisma, { from, to });

    const { where } = findMany.mock.calls[0][0];
    expect(where.createdAt).toMatchObject({ gte: from, lte: to });
  });

  it('passes from only (no lte) when to is absent', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    const from = new Date('2026-05-01T00:00:00Z');
    await listAudit(prisma, { from });

    const { where } = findMany.mock.calls[0][0];
    expect(where.createdAt).toMatchObject({ gte: from });
    expect((where.createdAt as Record<string, unknown>).lte).toBeUndefined();
  });

  it('resolves q via a raw meta::text scan and constrains where.id to the matches', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    const prisma = makePrisma(findMany, queryRaw);

    await listAudit(prisma, { q: 'sometext' });

    // q is no longer a (broken) JsonFilter — it runs one parameterised raw query…
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const { where } = findMany.mock.calls[0][0];
    // …and the main query is scoped to the matching ids.
    expect(where.id).toMatchObject({ in: ['a1', 'a2'] });
    expect(where.meta).toBeUndefined();
  });

  it('does not include unset filters in where', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, {});

    const { where } = findMany.mock.calls[0][0];
    expect(where.entity).toBeUndefined();
    expect(where.action).toBeUndefined();
    expect(where.userId).toBeUndefined();
    expect(where.createdAt).toBeUndefined();
    expect(where.meta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// orderBy
// ---------------------------------------------------------------------------
describe('listAudit() — orderBy', () => {
  it('always orders by createdAt desc then id desc', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, {});

    const { orderBy } = findMany.mock.calls[0][0];
    expect(orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------
describe('listAudit() — row mapping', () => {
  it('maps actor from included user', async () => {
    const now = new Date('2026-05-10T12:00:00Z');
    const findMany = vi.fn().mockResolvedValue([
      makeRow({
        id: 'r1',
        createdAt: now,
        action: 'order_updated',
        entity: 'order',
        entityId: 'ord-1',
        meta: { status: 'success' },
        user: { id: 'u1', email: 'mgr@example.com', name: 'Менеджер' },
      }),
    ]);
    const prisma = makePrisma(findMany);

    const result = await listAudit(prisma, {});

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.id).toBe('r1');
    expect(row.createdAt).toBe(now);
    expect(row.action).toBe('order_updated');
    expect(row.entity).toBe('order');
    expect(row.entityId).toBe('ord-1');
    expect(row.meta).toEqual({ status: 'success' });
    expect(row.actor).toEqual({ id: 'u1', email: 'mgr@example.com', name: 'Менеджер' });
  });

  it('sets actor to null when user is null', async () => {
    const findMany = vi.fn().mockResolvedValue([
      makeRow({ user: null }),
    ]);
    const prisma = makePrisma(findMany);

    const result = await listAudit(prisma, {});

    expect(result.rows[0].actor).toBeNull();
  });

  it('includes user in findMany via include select with id, email, name', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, {});

    const { include } = findMany.mock.calls[0][0];
    expect(include).toEqual({
      user: { select: { id: true, email: true, name: true } },
    });
  });
});

// ---------------------------------------------------------------------------
// take clamping
// ---------------------------------------------------------------------------
describe('listAudit() — take clamping', () => {
  it('defaults take to 50 when not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, {});

    // take + 1 sentinel
    expect(findMany.mock.calls[0][0].take).toBe(51);
  });

  it('clamps take to max 100 (+1 sentinel = 101)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, { take: 999 });

    expect(findMany.mock.calls[0][0].take).toBe(101);
  });

  it('clamps take to min 1 (+1 sentinel = 2)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);

    await listAudit(prisma, { take: 0 });

    expect(findMany.mock.calls[0][0].take).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// listAuditFilters
// ---------------------------------------------------------------------------
function makeFiltersPrisma(
  auditLogFindMany: ReturnType<typeof vi.fn>,
  userFindMany: ReturnType<typeof vi.fn>
) {
  return {
    auditLog: { findMany: auditLogFindMany },
    user: { findMany: userFindMany },
  } as unknown as PrismaClient;
}

describe('listAuditFilters() — query args', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues entity distinct query with correct distinct/select/orderBy', async () => {
    const auditFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ entity: 'lead' }])   // entity distinct
      .mockResolvedValueOnce([{ action: 'lead_created' }]) // action distinct
      .mockResolvedValueOnce([]); // userId distinct
    const userFindMany = vi.fn().mockResolvedValue([]);
    const prisma = makeFiltersPrisma(auditFindMany, userFindMany);

    await listAuditFilters(prisma);

    // First two calls are done via Promise.all so order is positional (entity=0, action=1)
    const entityCall = auditFindMany.mock.calls[0][0];
    expect(entityCall.distinct).toEqual(['entity']);
    expect(entityCall.select).toEqual({ entity: true });
    expect(entityCall.orderBy).toEqual({ entity: 'asc' });
  });

  it('issues action distinct query with correct distinct/select/orderBy', async () => {
    const auditFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ entity: 'order' }])
      .mockResolvedValueOnce([{ action: 'order_updated' }])
      .mockResolvedValueOnce([]);
    const userFindMany = vi.fn().mockResolvedValue([]);
    const prisma = makeFiltersPrisma(auditFindMany, userFindMany);

    await listAuditFilters(prisma);

    const actionCall = auditFindMany.mock.calls[1][0];
    expect(actionCall.distinct).toEqual(['action']);
    expect(actionCall.select).toEqual({ action: true });
    expect(actionCall.orderBy).toEqual({ action: 'asc' });
  });

  it('issues userId distinct query with distinct/select/take:200', async () => {
    const auditFindMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const userFindMany = vi.fn().mockResolvedValue([]);
    const prisma = makeFiltersPrisma(auditFindMany, userFindMany);

    await listAuditFilters(prisma);

    const userIdCall = auditFindMany.mock.calls[2][0];
    expect(userIdCall.distinct).toEqual(['userId']);
    expect(userIdCall.select).toEqual({ userId: true });
    expect(userIdCall.take).toBe(200);
  });
});

describe('listAuditFilters() — return shape', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps entity rows to entities array and action rows to actions array', async () => {
    const auditFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ entity: 'lead' }, { entity: 'order' }])
      .mockResolvedValueOnce([{ action: 'lead_created' }, { action: 'order_updated' }])
      .mockResolvedValueOnce([{ userId: 'user-1' }]);
    const userFindMany = vi
      .fn()
      .mockResolvedValue([{ id: 'user-1', name: 'Иван', email: 'ivan@example.com' }]);
    const prisma = makeFiltersPrisma(auditFindMany, userFindMany);

    const result = await listAuditFilters(prisma);

    expect(result.entities).toEqual(['lead', 'order']);
    expect(result.actions).toEqual(['lead_created', 'order_updated']);
  });

  it('passes correct where.id.in to user.findMany with the distinct userId list', async () => {
    const auditFindMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: 'u-1' }, { userId: 'u-2' }]);
    const actor1 = { id: 'u-1', name: 'Анна', email: 'anna@example.com' };
    const actor2 = { id: 'u-2', name: 'Борис', email: 'boris@example.com' };
    const userFindMany = vi.fn().mockResolvedValue([actor1, actor2]);
    const prisma = makeFiltersPrisma(auditFindMany, userFindMany);

    const result = await listAuditFilters(prisma);

    const userCall = userFindMany.mock.calls[0][0];
    expect(userCall.where).toEqual({ id: { in: ['u-1', 'u-2'] } });
    expect(userCall.select).toEqual({ id: true, name: true, email: true });
    expect(userCall.orderBy).toEqual({ name: 'asc' });
    expect(result.actors).toEqual([actor1, actor2]);
  });

  it('does NOT call user.findMany and returns actors:[] when userId distinct is empty', async () => {
    const auditFindMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // no userId rows
    const userFindMany = vi.fn();
    const prisma = makeFiltersPrisma(auditFindMany, userFindMany);

    const result = await listAuditFilters(prisma);

    expect(userFindMany).not.toHaveBeenCalled();
    expect(result.actors).toEqual([]);
  });
});
