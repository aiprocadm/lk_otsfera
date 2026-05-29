import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { listPartners, AdminPartnerError } from '@/lib/services/admin/partners';

// ---------------------------------------------------------------------------
// Prisma mock factory
// ---------------------------------------------------------------------------
function makePartner(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Тест Партнёр',
    slug: 'test-partner',
    commissionRate: new Prisma.Decimal('0.05'),
    isActive: true,
    ...overrides
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    partner: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0)
    },
    organization: {
      count: vi.fn().mockResolvedValue(0)
    },
    commissionStatement: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalCommissionAmount: null } })
    },
    ...overrides
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// listPartners()
// ---------------------------------------------------------------------------
describe('listPartners()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty rows and total=0 when no partners', async () => {
    const prisma = makePrisma();
    const result = await listPartners(prisma, {});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('filter active:true maps to where.isActive=true', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, { active: true });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.isActive).toBe(true);
  });

  it('filter active:false maps to where.isActive=false', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, { active: false });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.isActive).toBe(false);
  });

  it('filter norate maps to where.commissionRate={ equals: 0 }', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, { filter: 'norate' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.commissionRate).toEqual({ equals: 0 });
  });

  it('q produces OR clause with name+slug ILIKE', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, { q: 'foo' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toEqual([
      { name: { contains: 'foo', mode: 'insensitive' } },
      { slug: { contains: 'foo', mode: 'insensitive' } }
    ]);
  });

  it('no q produces no OR clause', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, {});

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeUndefined();
  });

  it('take defaults to 50 and is clamped to 100', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, {});
    expect(findMany.mock.calls[0][0].take).toBe(50);

    findMany.mockClear();
    await listPartners(prisma, { take: 200 });
    expect(findMany.mock.calls[0][0].take).toBe(100);

    findMany.mockClear();
    await listPartners(prisma, { take: 0 });
    expect(findMany.mock.calls[0][0].take).toBe(1);
  });

  it('skip defaults to 0 and is floored at 0', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, { skip: -5 });
    expect(findMany.mock.calls[0][0].skip).toBe(0);

    findMany.mockClear();
    await listPartners(prisma, { skip: 10 });
    expect(findMany.mock.calls[0][0].skip).toBe(10);
  });

  it('orderBy is [isActive desc, name asc]', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, {});

    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { isActive: 'desc' },
      { name: 'asc' }
    ]);
  });

  it('maps a partner row: nonzero commissionRate is preserved as number', async () => {
    const partner = makePartner({ commissionRate: new Prisma.Decimal('0.05') });
    const findMany = vi.fn().mockResolvedValue([partner]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = makePrisma({ partner: { findMany, count } });

    const result = await listPartners(prisma, {});

    expect(result.total).toBe(1);
    expect(result.rows[0].id).toBe('p1');
    expect(result.rows[0].commissionRate).toBeCloseTo(0.05);
    expect(result.rows[0].isActive).toBe(true);
  });

  it('maps a partner row: commissionRate=0 is returned as null (no rate set)', async () => {
    const partner = makePartner({ commissionRate: new Prisma.Decimal('0') });
    const findMany = vi.fn().mockResolvedValue([partner]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = makePrisma({ partner: { findMany, count } });

    const result = await listPartners(prisma, {});

    expect(result.rows[0].commissionRate).toBeNull();
  });

  it('null slug is coerced to empty string', async () => {
    const partner = makePartner({ slug: null });
    const findMany = vi.fn().mockResolvedValue([partner]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = makePrisma({ partner: { findMany, count } });

    const result = await listPartners(prisma, {});

    expect(result.rows[0].slug).toBe('');
  });

  it('activeOrgCount comes from organization.count per partner', async () => {
    const partner = makePartner();
    const partnerFindMany = vi.fn().mockResolvedValue([partner]);
    const partnerCount = vi.fn().mockResolvedValue(1);
    const orgCount = vi.fn().mockResolvedValue(3);
    const prisma = makePrisma({
      partner: { findMany: partnerFindMany, count: partnerCount },
      organization: { count: orgCount }
    });

    const result = await listPartners(prisma, {});

    expect(orgCount).toHaveBeenCalledWith({
      where: { orders: { some: { partnerId: 'p1' } } }
    });
    expect(result.rows[0].activeOrgCount).toBe(3);
  });

  it('paidYTD aggregates paid commission statements for the year', async () => {
    const partner = makePartner();
    const partnerFindMany = vi.fn().mockResolvedValue([partner]);
    const partnerCount = vi.fn().mockResolvedValue(1);
    const csAggregate = vi.fn().mockResolvedValue({
      _sum: { totalCommissionAmount: new Prisma.Decimal('12500.00') }
    });
    const prisma = makePrisma({
      partner: { findMany: partnerFindMany, count: partnerCount },
      commissionStatement: { aggregate: csAggregate }
    });

    const result = await listPartners(prisma, {});

    expect(csAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ partnerId: 'p1', status: 'paid' })
      })
    );
    // Prisma.Decimal.toString() strips trailing zeros: '12500.00' → '12500'
    expect(result.rows[0].paidYTD).toBe('12500');
  });

  it('paidYTD is "0" when no paid statements exist', async () => {
    const partner = makePartner();
    const findMany = vi.fn().mockResolvedValue([partner]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = makePrisma({ partner: { findMany, count } });

    const result = await listPartners(prisma, {});

    expect(result.rows[0].paidYTD).toBe('0');
  });

  it('active:true and norate can be combined', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, { active: true, filter: 'norate' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.isActive).toBe(true);
    expect(whereArg.commissionRate).toEqual({ equals: 0 });
  });

  it('q and active can be combined without OR-bleed', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ partner: { findMany, count } });

    await listPartners(prisma, { active: true, q: 'bar' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.isActive).toBe(true);
    expect(whereArg.OR).toEqual([
      { name: { contains: 'bar', mode: 'insensitive' } },
      { slug: { contains: 'bar', mode: 'insensitive' } }
    ]);
    // active uses isActive, not OR — no bleed
    expect(whereArg.OR).toHaveLength(2);
  });

  it('AdminPartnerError has correct code and name', () => {
    const err = new AdminPartnerError('not_found');
    expect(err.code).toBe('not_found');
    expect(err.name).toBe('AdminPartnerError');
    expect(err).toBeInstanceOf(Error);
  });
});
