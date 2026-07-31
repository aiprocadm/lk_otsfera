/**
 * Unit tests for src/lib/services/manager/documents.ts
 * Covers the branches missed in the integration test:
 *   - listDocuments: teamMode, orderId/type/q filters, cursor, pagination
 *   - getDocumentForDownload: orderId=null paths, teamMode ON/OFF branches,
 *     infected doc, scope check via comments
 *   - listManagerOrderLessDocuments: no companyId, type filter, cursor, pagination
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managerDocumentScope, canSeeOrder } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  managerDocumentScope: vi.fn(),
  canSeeOrder: vi.fn(),
}));

const { managerOrderLessWhere, canReadOrderLessDocument } = vi.hoisted(() => ({
  managerOrderLessWhere: vi.fn(),
  canReadOrderLessDocument: vi.fn(),
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managerDocumentScope,
  canSeeOrder,
}));
vi.mock('@/lib/auth/documentChannelPolicy', () => ({
  managerOrderLessWhere,
  canReadOrderLessDocument,
}));

import {
  listDocuments,
  getDocumentForDownload,
  listManagerOrderLessDocuments,
} from '@/lib/services/manager/documents';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1',
};

function docRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `doc-${id}.pdf`,
    mimeType: 'application/pdf',
    path: `orders/ord-1/${id}.pdf`,
    scanStatus: 'clean',
    scanReason: null,
    orderId: 'ord-1',
    companyId: 'co-1',
    counterpartyType: 'organization',
    counterpartyId: 'org-1',
    type: 'contract',
    direction: 'outgoing',
    signedAt: null,
    createdAt: new Date('2026-06-01'),
    size: 1024,
    order: {
      id: 'ord-1',
      orderNumber: 'O-1',
      title: 'T',
      managerId: 'mgr-1',
      organizationId: 'org-1',
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managerDocumentScope.mockReturnValue({ scanStatus: { not: 'infected' } });
  canSeeOrder.mockReturnValue(true);
  managerOrderLessWhere.mockReturnValue({ orderId: null, companyId: 'co-1' });
  canReadOrderLessDocument.mockReturnValue(true);
});

// ─── listDocuments ─────────────────────────────────────────────────────────────

describe('listDocuments', () => {
  it('returns rows with nextCursor=null when count <= take', async () => {
    const findMany = vi.fn().mockResolvedValue([docRow('d1'), docRow('d2')]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    const result = await listDocuments(p, { session: SESSION, take: 50 });
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('paginates: returns nextCursor when rows > take', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => docRow(`d${i}`));
    const findMany = vi.fn().mockResolvedValue(rows);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    const result = await listDocuments(p, { session: SESSION, take: 50 });
    expect(result.rows).toHaveLength(50);
    expect(result.nextCursor).toBe('d49');
  });

  it('applies orderId filter when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listDocuments(p, { session: SESSION, orderId: 'ord-42' });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ AND: expect.arrayContaining([{ orderId: 'ord-42' }]) });
  });

  it('applies type filter when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listDocuments(p, { session: SESSION, type: 'act' });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ AND: expect.arrayContaining([{ type: 'act' }]) });
  });

  it('applies search filter when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listDocuments(p, { session: SESSION, search: 'договор' });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      AND: expect.arrayContaining([{ name: { contains: 'договор', mode: 'insensitive' } }]),
    });
  });

  it('passes cursor when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listDocuments(p, { session: SESSION, cursor: 'cursor-xyz' });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: 'cursor-xyz' });
    expect(call.skip).toBe(1);
  });

  it('does not pass cursor when not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listDocuments(p, { session: SESSION });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toBeUndefined();
  });
});

// ─── getDocumentForDownload ────────────────────────────────────────────────────

describe('getDocumentForDownload', () => {
  it('returns not_found when doc is null', async () => {
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(null) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'nonexistent');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('orderId=null: returns not_found when canReadOrderLessDocument=false', async () => {
    canReadOrderLessDocument.mockReturnValue(false);
    const doc = docRow('d1', { orderId: null, order: null });
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('orderId=null: returns infected when canRead=true but scanStatus=infected', async () => {
    canReadOrderLessDocument.mockReturnValue(true);
    const doc = docRow('d1', {
      orderId: null,
      order: null,
      scanStatus: 'infected',
      scanReason: 'eicar',
    });
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(result).toEqual({ ok: false, error: 'infected', scanReason: 'eicar' });
  });

  it('orderId=null: returns ok path when canRead=true and clean', async () => {
    canReadOrderLessDocument.mockReturnValue(true);
    const doc = docRow('d1', {
      orderId: null,
      order: null,
      scanStatus: 'clean',
      path: 'order-less/f.pdf',
      mimeType: 'application/pdf',
      name: 'f.pdf',
    });
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(result).toEqual({
      ok: true,
      path: 'order-less/f.pdf',
      mimeType: 'application/pdf',
      name: 'f.pdf',
    });
  });

  it('orderId=null: doc.companyId=null passes null to canReadOrderLessDocument (covers ?? null fallback)', async () => {
    canReadOrderLessDocument.mockReturnValue(true);
    // companyId=null exercises the doc.companyId ?? null right-side
    const doc = docRow('d1', {
      orderId: null,
      order: null,
      companyId: null,
      scanStatus: 'clean',
      path: 'x.pdf',
      mimeType: 'application/pdf',
      name: 'x.pdf',
    });
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(result).toEqual({ ok: true, path: 'x.pdf', mimeType: 'application/pdf', name: 'x.pdf' });
    expect(canReadOrderLessDocument).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ companyId: null })
    );
  });

  it('orderId=null: scanReason defaults to null when not set', async () => {
    canReadOrderLessDocument.mockReturnValue(true);
    const doc = docRow('d1', {
      orderId: null,
      order: null,
      scanStatus: 'infected',
      scanReason: null,
    });
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(result).toMatchObject({ error: 'infected', scanReason: null });
  });

  it('teamMode=ON: skips comment count (companyId check decides)', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    // In teamMode ON, canSeeOrder is called but comment count is skipped
    canSeeOrder.mockReturnValue(true);
    const ord = { managerId: 'someone-else', organizationId: 'org-1', companyId: 'co-1' };
    const doc = docRow('d1', { order: ord });
    const commentCount = vi.fn();
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: commentCount },
      company: { findUnique: vi.fn() },
    } as never;
    await getDocumentForDownload(p, SESSION, 'd1');
    expect(commentCount).not.toHaveBeenCalled();
  });

  it('teamMode=OFF: calls comment.count when managerId and org check both miss', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    canSeeOrder.mockReturnValue(false);
    const ord = { managerId: 'someone-else', organizationId: 'org-foreign', companyId: 'co-1' };
    const doc = docRow('d1', { order: ord });
    const commentCount = vi.fn().mockResolvedValue(0);
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: commentCount },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(commentCount).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('teamMode=OFF: skips comment count when managerId matches session', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    const ord = { managerId: 'mgr-1', organizationId: 'org-foreign', companyId: 'co-1' };
    const doc = docRow('d1', { order: ord });
    const commentCount = vi.fn();
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: commentCount },
      company: { findUnique: vi.fn() },
    } as never;
    await getDocumentForDownload(p, SESSION, 'd1');
    expect(commentCount).not.toHaveBeenCalled();
  });

  it('teamMode=OFF: skips comment count when organizationId is in managedOrgIds', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    const ord = { managerId: 'someone-else', organizationId: 'org-1', companyId: 'co-1' };
    const doc = docRow('d1', { order: ord });
    const commentCount = vi.fn();
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: commentCount },
      company: { findUnique: vi.fn() },
    } as never;
    await getDocumentForDownload(p, SESSION, 'd1');
    // org-1 is in managedOrgIds so comment count is skipped
    expect(commentCount).not.toHaveBeenCalled();
  });

  it('teamMode=OFF: session.managedOrgIds=undefined treated as [] (no org scope)', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    // managedOrgIds ?? [] — covers the null branch
    const sessionNoOrgs = { ...SESSION, managedOrgIds: undefined as never };
    const ord = { managerId: 'someone-else', organizationId: 'org-foreign', companyId: 'co-1' };
    const doc = docRow('d1', { order: ord });
    const commentCount = vi.fn().mockResolvedValue(0);
    canSeeOrder.mockReturnValue(false);
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: commentCount },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, sessionNoOrgs, 'd1');
    // comment count IS called (org not in empty array)
    expect(commentCount).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('orderId=null: doc.companyId non-null passes to canReadOrderLessDocument', async () => {
    canReadOrderLessDocument.mockReturnValue(true);
    // companyId non-null (covers the ?? null false-branch = companyId returned as-is)
    const doc = docRow('d1', {
      orderId: null,
      order: null,
      companyId: 'co-1',
      scanStatus: 'clean',
      path: 'x.pdf',
      mimeType: 'application/pdf',
      name: 'x.pdf',
    });
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(result).toEqual({ ok: true, path: 'x.pdf', mimeType: 'application/pdf', name: 'x.pdf' });
    // canReadOrderLessDocument called with non-null companyId
    expect(canReadOrderLessDocument).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ companyId: 'co-1' })
    );
  });

  it('returns infected for order-level doc with infected scanStatus (scanReason non-null)', async () => {
    const ord = { managerId: 'mgr-1', organizationId: 'org-1', companyId: 'co-1' };
    const doc = docRow('d1', { order: ord, scanStatus: 'infected', scanReason: 'malware' });
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(result).toEqual({ ok: false, error: 'infected', scanReason: 'malware' });
  });

  it('returns infected for order-level doc with null scanReason (covers scanReason ?? null fallback)', async () => {
    const ord = { managerId: 'mgr-1', organizationId: 'org-1', companyId: 'co-1' };
    // scanReason=null → doc.scanReason ?? null uses the right-side fallback
    const doc = docRow('d1', { order: ord, scanStatus: 'infected', scanReason: null });
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(result).toEqual({ ok: false, error: 'infected', scanReason: null });
  });

  it('returns ok with path/mimeType/name for clean in-scope document', async () => {
    const ord = { managerId: 'mgr-1', organizationId: 'org-1', companyId: 'co-1' };
    const doc = docRow('d1', {
      order: ord,
      scanStatus: 'clean',
      path: 'orders/o1/d1.pdf',
      mimeType: 'application/pdf',
      name: 'contract.pdf',
    });
    const p = {
      document: { findUnique: vi.fn().mockResolvedValue(doc) },
      comment: { count: vi.fn() },
      company: { findUnique: vi.fn() },
    } as never;
    const result = await getDocumentForDownload(p, SESSION, 'd1');
    expect(result).toEqual({
      ok: true,
      path: 'orders/o1/d1.pdf',
      mimeType: 'application/pdf',
      name: 'contract.pdf',
    });
  });
});

// ─── listManagerOrderLessDocuments ─────────────────────────────────────────────

describe('listManagerOrderLessDocuments', () => {
  it('returns empty when session.companyId is null', async () => {
    const nullSession = { ...SESSION, companyId: null };
    const p = { document: { findMany: vi.fn() }, company: { findUnique: vi.fn() } } as never;
    const result = await listManagerOrderLessDocuments(p, nullSession as never);
    expect(result).toEqual({ rows: [], nextCursor: null });
  });

  it('applies type filter when opts.type provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listManagerOrderLessDocuments(p, SESSION, { type: 'act' });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ type: 'act' });
  });

  it('does not add type to where when not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listManagerOrderLessDocuments(p, SESSION, {});
    const where = findMany.mock.calls[0][0].where;
    expect(where.type).toBeUndefined();
  });

  it('passes cursor when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listManagerOrderLessDocuments(p, SESSION, { cursor: 'c-1' });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: 'c-1' });
    expect(call.skip).toBe(1);
  });

  it('paginates: nextCursor set when rows > take', async () => {
    const orderLessRow = (id: string) => ({
      id,
      name: `f-${id}.pdf`,
      type: 'contract',
      direction: 'outgoing',
      signedAt: null,
      createdAt: new Date(),
      size: 100,
      counterpartyType: 'organization',
      counterpartyId: 'org-1',
    });
    const rows = Array.from({ length: 6 }, (_, i) => orderLessRow(`d${i}`));
    const findMany = vi.fn().mockResolvedValue(rows);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    const result = await listManagerOrderLessDocuments(p, SESSION, { take: 5 });
    expect(result.rows).toHaveLength(5);
    expect(result.nextCursor).toBe('d4');
  });

  it('nextCursor is null when rows <= take', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    const result = await listManagerOrderLessDocuments(p, SESSION, { take: 50 });
    expect(result.nextCursor).toBeNull();
  });

  it('clamps take to [1, 100] range', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { document: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listManagerOrderLessDocuments(p, SESSION, { take: 0 });
    // take=0 → Math.max(0,1) = 1, then Math.min(1,100) = 1, query with take=1+1=2
    expect(findMany.mock.calls[0][0].take).toBe(2);

    findMany.mockClear();
    await listManagerOrderLessDocuments(p, SESSION, { take: 200 });
    // take=200 → Math.max(200,1)=200, Math.min(200,100)=100, query with take=100+1=101
    expect(findMany.mock.calls[0][0].take).toBe(101);
  });
});
