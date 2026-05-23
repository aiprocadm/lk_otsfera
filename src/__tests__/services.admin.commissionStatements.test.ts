import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  getAdminStatement,
  getStatementAuditLog,
  listAdminStatements,
  listPartnersForFilter,
} from '@/lib/services/admin/commissionStatements';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    commissionStatement: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    partner: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

describe('listAdminStatements', () => {
  it('defaults status filter to approved+paid (no drafts)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ commissionStatement: { findMany } });

    await listAdminStatements(prisma);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      supersededBy: null,
      status: { in: ['approved', 'paid'] },
    });
    expect(arg.where.partnerId).toBeUndefined();
    expect(arg.take).toBe(50);
  });

  it('honours explicit status, partnerId, and date range', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ commissionStatement: { findMany } });
    const from = new Date('2026-01-01');
    const to = new Date('2026-04-01');

    await listAdminStatements(prisma, {
      status: 'draft',
      partnerId: 'p1',
      from,
      to,
      take: 10,
    });

    const arg = findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('draft');
    expect(arg.where.partnerId).toBe('p1');
    expect(arg.where.periodFrom).toEqual({ gte: from, lte: to });
    expect(arg.take).toBe(10);
  });

  it('maps _count.items → itemCount and flattens partner', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 's1',
        status: 'approved',
        partnerId: 'p1',
        periodFrom: new Date('2026-04-01'),
        periodTo: new Date('2026-04-30'),
        totalBaseAmount: '100000',
        totalCommissionAmount: '5000',
        pdfPath: 'p.pdf',
        xlsxPath: 'p.xlsx',
        supersededBy: null,
        approvedByUserId: 'u1',
        approvedAt: new Date(),
        paidAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        notes: null,
        _count: { items: 3 },
        partner: { id: 'p1', name: 'Alpha LLC', slug: 'alpha' },
      },
    ]);
    const prisma = makePrisma({ commissionStatement: { findMany } });

    const rows = await listAdminStatements(prisma);

    expect(rows).toHaveLength(1);
    expect(rows[0].itemCount).toBe(3);
    expect(rows[0].partner).toEqual({ id: 'p1', name: 'Alpha LLC', slug: 'alpha' });
    expect((rows[0] as unknown as { _count?: unknown })._count).toBeUndefined();
  });
});

describe('getAdminStatement', () => {
  it('fetches by id without partner constraint and includes items + partner', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1', items: [], partner: { id: 'p1' } });
    const prisma = makePrisma({ commissionStatement: { findUnique } });

    await getAdminStatement(prisma, 's1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 's1' },
      include: expect.objectContaining({
        items: expect.any(Object),
        partner: { select: { id: true, name: true, slug: true } },
      }),
    });
  });
});

describe('getStatementAuditLog', () => {
  it('returns audit entries scoped to CommissionStatement entity', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'a1',
        action: 'commission_statement_approved',
        createdAt: new Date('2026-05-01T10:00:00Z'),
        userId: 'u1',
        user: { name: 'Анна' },
        meta: { partnerId: 'p1' },
      },
      {
        id: 'a2',
        action: 'commission_statement_paid',
        createdAt: new Date('2026-05-10T15:00:00Z'),
        userId: 'u2',
        user: null,
        meta: null,
      },
    ]);
    const prisma = makePrisma({ auditLog: { findMany } });

    const entries = await getStatementAuditLog(prisma, 's1');

    expect(findMany).toHaveBeenCalledWith({
      where: { entity: 'CommissionStatement', entityId: 's1' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { name: true } } },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: 'a1',
      action: 'commission_statement_approved',
      userName: 'Анна',
    });
    expect(entries[1].userName).toBeNull();
    expect(entries[1].meta).toBeNull();
  });
});

describe('listPartnersForFilter', () => {
  it('returns partners ordered by name with minimal columns', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ]);
    const prisma = makePrisma({ partner: { findMany } });

    const result = await listPartnersForFilter(prisma);

    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    expect(result).toEqual([
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ]);
  });
});
