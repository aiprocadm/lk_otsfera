/**
 * Unit tests for src/lib/services/manager/messages.ts — listIncomingComments.
 * The integration test (services.manager.messages.test.ts) requires live Postgres.
 * This file covers service branches via mocked prisma:
 *   - withOutgoing=false → role: 'organization' filter
 *   - withOutgoing=true → role: { in: ['organization', 'manager'] } filter
 *   - since defaults to 30d window when not provided
 *   - explicit since passed through
 *   - cursor pagination
 *   - hasMore: nextCursor set when >take rows, null otherwise
 *   - Zod validation rejects take > 100
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managerOrderScope } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn().mockResolvedValue(false),
  managerOrderScope: vi.fn().mockReturnValue({})
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managerOrderScope
}));

import { listIncomingComments } from '@/lib/services/manager/messages';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1'
};

function fakePrisma(rows: unknown[] = []) {
  return {
    comment: { findMany: vi.fn().mockResolvedValue(rows) },
    company: { findUnique: vi.fn() }
  } as never;
}

function commentRow(id: string) {
  return {
    id,
    body: 'test',
    orderId: 'ord-1',
    order: { id: 'ord-1', orderNumber: 'O-1', title: 'T' },
    author: { id: 'u-1', name: 'User', email: 'u@t.local', role: 'organization' }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managerOrderScope.mockReturnValue({});
});

describe('listIncomingComments', () => {
  it('withOutgoing=false applies role="organization" filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { comment: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listIncomingComments(p, { session: SESSION, withOutgoing: false });
    const where = findMany.mock.calls[0][0].where;
    expect(where.author).toEqual({ role: 'organization' });
  });

  it('withOutgoing=true applies role IN [organization, manager] filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { comment: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listIncomingComments(p, { session: SESSION, withOutgoing: true });
    const where = findMany.mock.calls[0][0].where;
    expect(where.author).toEqual({ role: { in: ['organization', 'manager'] } });
  });

  it('uses default 30-day since when not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { comment: { findMany }, company: { findUnique: vi.fn() } } as never;
    const before = Date.now();
    await listIncomingComments(p, { session: SESSION });
    const after = Date.now();
    const where = findMany.mock.calls[0][0].where;
    // since is ~30 days ago
    const sinceDate = where.createdAt.gte as Date;
    const sinceMs = sinceDate.getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(sinceMs).toBeGreaterThanOrEqual(before - thirtyDaysMs - 100);
    expect(sinceMs).toBeLessThanOrEqual(after - thirtyDaysMs + 100);
  });

  it('passes explicit since when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { comment: { findMany }, company: { findUnique: vi.fn() } } as never;
    const since = new Date('2020-01-01');
    await listIncomingComments(p, { session: SESSION, since });
    const where = findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(since);
  });

  it('passes cursor when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { comment: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listIncomingComments(p, { session: SESSION, cursor: 'c-42' });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: 'c-42' });
    expect(call.skip).toBe(1);
  });

  it('does not pass cursor when not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { comment: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listIncomingComments(p, { session: SESSION });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toBeUndefined();
  });

  it('sets nextCursor when more rows than take', async () => {
    const rows = [commentRow('c1'), commentRow('c2'), commentRow('c3')];
    const p = fakePrisma(rows);
    const result = await listIncomingComments(p, { session: SESSION, take: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBe('c2');
  });

  it('nextCursor=null when rows ≤ take', async () => {
    const rows = [commentRow('c1')];
    const p = fakePrisma(rows);
    const result = await listIncomingComments(p, { session: SESSION, take: 2 });
    expect(result.rows).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('rejects take > 100 via Zod', async () => {
    const p = fakePrisma();
    await expect(listIncomingComments(p, { session: SESSION, take: 9999 })).rejects.toThrow();
  });

  it('calls getCompanyTeamVisibility and passes teamMode to managerOrderScope', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const p = fakePrisma();
    await listIncomingComments(p, { session: SESSION });
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(p, 'co-1');
    expect(managerOrderScope).toHaveBeenCalledWith(SESSION, true);
  });
});
