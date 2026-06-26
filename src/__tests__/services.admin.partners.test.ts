import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import {
  listPartners,
  getPartner,
  updatePartner,
  deactivatePartner,
  reactivatePartner,
  createPartnerWithAdmin,
  AdminPartnerError
} from '@/lib/services/admin/partners';

const { recordAuditMock, createInviteTokenMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  createInviteTokenMock: vi.fn()
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/auth/passwordReset', () => ({ createInviteToken: createInviteTokenMock }));

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

  it('activeOrgCount counts organizations by partnerId (current assignment)', async () => {
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
      where: { partnerId: 'p1' }
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

// ---------------------------------------------------------------------------
// getPartner()
// ---------------------------------------------------------------------------
describe('getPartner()', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeFullPartner() {
    return {
      id: 'p1',
      name: 'Тест Партнёр',
      slug: 'test-partner',
      commissionRate: new Prisma.Decimal('0.05'),
      isActive: true,
      partnerUsers: [
        {
          id: 'pu1',
          userId: 'u1',
          user: {
            id: 'u1',
            email: 'admin@test.com',
            name: 'Admin User',
            isActive: true,
            createdAt: new Date('2025-01-01')
          }
        }
      ]
    };
  }

  function makePrismaForGet(partnerData: unknown) {
    return {
      partner: {
        findUnique: vi.fn().mockResolvedValue(partnerData)
      },
      organization: {
        count: vi.fn().mockResolvedValue(2)
      },
      commissionStatement: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { totalCommissionAmount: new Prisma.Decimal('5000.00') }
        })
      }
    } as unknown as PrismaClient;
  }

  it('returns null when partner does not exist', async () => {
    const prisma = makePrismaForGet(null);
    const result = await getPartner(prisma, 'missing');
    expect(result).toBeNull();
  });

  it('returns PartnerDetail with correct shape and admins array', async () => {
    const prisma = makePrismaForGet(makeFullPartner());
    const result = await getPartner(prisma, 'p1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('p1');
    expect(result!.name).toBe('Тест Партнёр');
    expect(result!.slug).toBe('test-partner');
    expect(result!.commissionRate).toBeCloseTo(0.05);
    expect(result!.isActive).toBe(true);
    expect(result!.activeOrgCount).toBe(2);
    expect(result!.paidYTD).toBe('5000');
    expect(result!.admins).toHaveLength(1);
    expect(result!.admins[0]).toMatchObject({
      partnerUserId: 'pu1',
      userId: 'u1',
      email: 'admin@test.com',
      name: 'Admin User',
      isActive: true
    });
  });

  it('null slug is coerced to empty string', async () => {
    const partner = { ...makeFullPartner(), slug: null };
    const prisma = makePrismaForGet(partner);
    const result = await getPartner(prisma, 'p1');
    expect(result!.slug).toBe('');
  });

  it('commissionRate=0 is returned as null', async () => {
    const partner = { ...makeFullPartner(), commissionRate: new Prisma.Decimal('0') };
    const prisma = makePrismaForGet(partner);
    const result = await getPartner(prisma, 'p1');
    expect(result!.commissionRate).toBeNull();
  });

  it('empty partnerUsers produces empty admins array', async () => {
    const partner = { ...makeFullPartner(), partnerUsers: [] };
    const prisma = makePrismaForGet(partner);
    const result = await getPartner(prisma, 'p1');
    expect(result!.admins).toEqual([]);
  });

  it('activeOrgCount queries organizations by partnerId (current assignment, not order history)', async () => {
    const orgCount = vi.fn().mockResolvedValue(1);
    const prisma = {
      partner: { findUnique: vi.fn().mockResolvedValue(makeFullPartner()) },
      organization: { count: orgCount },
      commissionStatement: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalCommissionAmount: null } })
      }
    } as unknown as PrismaClient;

    await getPartner(prisma, 'p1');

    expect(orgCount).toHaveBeenCalledWith({
      where: { partnerId: 'p1' }
    });
  });
});

// ---------------------------------------------------------------------------
// updatePartner()
// ---------------------------------------------------------------------------
describe('updatePartner()', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeTx(partnerData: unknown, updatedData?: unknown) {
    const defaultUpdated = partnerData ?? {
      id: 'p1',
      name: 'Partner',
      commissionRate: new Prisma.Decimal('0.05'),
      isActive: true
    };
    return {
      partner: {
        findUnique: vi.fn().mockResolvedValue(partnerData),
        update: vi.fn().mockResolvedValue(updatedData ?? defaultUpdated)
      },
      commissionRateChange: {
        create: vi.fn().mockResolvedValue({})
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
  }

  function makePrismaWithTx(tx: ReturnType<typeof makeTx>) {
    return {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx))
    } as unknown as PrismaClient;
  }

  it('throws not_found when partner does not exist', async () => {
    const tx = makeTx(null);
    const prisma = makePrismaWithTx(tx);
    await expect(updatePartner(prisma, 'actor1', 'missing', { name: 'New' }))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('happy path: updates name and records audit', async () => {
    const before = { name: 'Old Name', commissionRate: new Prisma.Decimal('0.05'), isActive: true };
    const updated = { id: 'p1', name: 'New Name', commissionRate: new Prisma.Decimal('0.05'), isActive: true };
    const tx = makeTx(before, updated);
    const prisma = makePrismaWithTx(tx);

    await updatePartner(prisma, 'actor1', 'p1', { name: 'New Name' });

    expect(tx.partner.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { name: 'New Name' } })
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'partner_updated', entityId: 'p1', entity: 'partner' })
    );
  });

  it('null commissionRate is stored as Decimal(0)', async () => {
    const before = { name: 'Partner', commissionRate: new Prisma.Decimal('0.05'), isActive: true };
    const updated = { id: 'p1', name: 'Partner', commissionRate: new Prisma.Decimal('0'), isActive: true };
    const tx = makeTx(before, updated);
    const prisma = makePrismaWithTx(tx);

    await updatePartner(prisma, 'actor1', 'p1', { commissionRate: null });

    const updateCall = tx.partner.update.mock.calls[0][0];
    expect(updateCall.data.commissionRate.equals(new Prisma.Decimal(0))).toBe(true);
  });

  it('numeric commissionRate is stored as Decimal', async () => {
    const before = { name: 'Partner', commissionRate: new Prisma.Decimal('0'), isActive: true };
    const updated = { id: 'p1', name: 'Partner', commissionRate: new Prisma.Decimal('0.08'), isActive: true };
    const tx = makeTx(before, updated);
    const prisma = makePrismaWithTx(tx);

    await updatePartner(prisma, 'actor1', 'p1', { commissionRate: 0.08 });

    const updateCall = tx.partner.update.mock.calls[0][0];
    expect(updateCall.data.commissionRate.equals(new Prisma.Decimal('0.08'))).toBe(true);
  });

  it('audit after snapshot is a full 3-field snapshot matching before shape', async () => {
    const before = { name: 'Partner', commissionRate: new Prisma.Decimal('0.05'), isActive: true };
    const updated = { id: 'p1', name: 'New', commissionRate: new Prisma.Decimal('0.05'), isActive: true };
    const tx = makeTx(before, updated);
    const prisma = makePrismaWithTx(tx);

    await updatePartner(prisma, 'actor1', 'p1', { name: 'New' });

    const auditCall = recordAuditMock.mock.calls[0][1];
    expect(auditCall.after).toEqual({ name: 'New', commissionRate: '0.05', isActive: true });
    expect(auditCall.before).toEqual({ name: 'Partner', commissionRate: '0.05', isActive: true });
  });

  it('audit before and after commissionRate are both strings (type symmetry)', async () => {
    const before = { name: 'Partner', commissionRate: new Prisma.Decimal('0.05'), isActive: true };
    const updated = { id: 'p1', name: 'Partner', commissionRate: new Prisma.Decimal('0.08'), isActive: true };
    const tx = makeTx(before, updated);
    const prisma = makePrismaWithTx(tx);

    await updatePartner(prisma, 'actor1', 'p1', { commissionRate: 0.08 });

    const auditCall = recordAuditMock.mock.calls[0][1];
    expect(typeof auditCall.before.commissionRate).toBe('string');
    expect(typeof auditCall.after.commissionRate).toBe('string');
  });

  it('audit commissionRate is null in both before and after when rate is zero', async () => {
    const before = { name: 'Partner', commissionRate: null, isActive: false };
    const updated = { id: 'p1', name: 'Partner', commissionRate: null, isActive: true };
    const tx = makeTx(before, updated);
    const prisma = makePrismaWithTx(tx);

    await updatePartner(prisma, 'actor1', 'p1', { isActive: true });

    const auditCall = recordAuditMock.mock.calls[0][1];
    expect(auditCall.before.commissionRate).toBeNull();
    expect(auditCall.after.commissionRate).toBeNull();
  });

  it('records a CommissionRateChange only when the rate actually changes', async () => {
    // name-only update → no history row
    const before = { name: 'Partner', commissionRate: new Prisma.Decimal('0.1'), isActive: true };
    const updated = { id: 'p1', name: 'New Name', commissionRate: new Prisma.Decimal('0.1'), isActive: true };
    const tx = makeTx(before, updated);
    const prisma = makePrismaWithTx(tx);

    await updatePartner(prisma, 'actor1', 'p1', { name: 'New Name' });
    expect(tx.commissionRateChange.create).not.toHaveBeenCalled();

    // rate change 0.1 → 0.2 → 1 history row with correct fields
    vi.clearAllMocks();
    const before2 = { name: 'Partner', commissionRate: new Prisma.Decimal('0.1'), isActive: true };
    const updated2 = { id: 'p1', name: 'Partner', commissionRate: new Prisma.Decimal('0.2'), isActive: true };
    const tx2 = makeTx(before2, updated2);
    const prisma2 = makePrismaWithTx(tx2);

    await updatePartner(prisma2, 'actor-x', 'p1', { commissionRate: 0.2 });

    expect(tx2.commissionRateChange.create).toHaveBeenCalledTimes(1);
    const createCall = tx2.commissionRateChange.create.mock.calls[0][0];
    expect(createCall.data.partnerId).toBe('p1');
    expect(createCall.data.oldRate.equals(new Prisma.Decimal('0.1'))).toBe(true);
    expect(createCall.data.newRate.equals(new Prisma.Decimal('0.2'))).toBe(true);
    expect(createCall.data.changedById).toBe('actor-x');
  });

  it('does not record CommissionRateChange when rate is set to the same value', async () => {
    const before = { name: 'Partner', commissionRate: new Prisma.Decimal('0.1'), isActive: true };
    const updated = { id: 'p1', name: 'Partner', commissionRate: new Prisma.Decimal('0.1'), isActive: true };
    const tx = makeTx(before, updated);
    const prisma = makePrismaWithTx(tx);

    await updatePartner(prisma, 'actor1', 'p1', { commissionRate: 0.1 });
    expect(tx.commissionRateChange.create).not.toHaveBeenCalled();
  });

  it('updatePartner writes commissionRateChange with provided effectiveFrom (backdate)', async () => {
    const eff = new Date('2026-04-15T00:00:00Z');
    const created: { effectiveFrom?: Date } = {};
    const tx = {
      partner: {
        findUnique: vi.fn().mockResolvedValue({ name: 'P', commissionRate: new Prisma.Decimal('0.1'), isActive: true }),
        update: vi.fn().mockResolvedValue({ name: 'P', commissionRate: new Prisma.Decimal('0.2'), isActive: true }),
      },
      commissionRateChange: { create: vi.fn().mockImplementation(({ data }) => { created.effectiveFrom = data.effectiveFrom; return {}; }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = { $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as never;
    await updatePartner(db, 'admin-1', 'p1', { commissionRate: 0.2, effectiveFrom: eff });
    expect(created.effectiveFrom).toEqual(eff);
  });
});

// ---------------------------------------------------------------------------
// deactivatePartner()
// ---------------------------------------------------------------------------
describe('deactivatePartner()', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeTx(partnerData: unknown) {
    return {
      partner: {
        findUnique: vi.fn().mockResolvedValue(partnerData),
        update: vi.fn().mockResolvedValue({})
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
  }

  function makePrismaWithTx(tx: ReturnType<typeof makeTx>) {
    return {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx))
    } as unknown as PrismaClient;
  }

  it('throws not_found when partner does not exist', async () => {
    const tx = makeTx(null);
    const prisma = makePrismaWithTx(tx);
    await expect(deactivatePartner(prisma, 'actor1', 'missing'))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('is idempotent: does not update or audit when already inactive', async () => {
    const tx = makeTx({ isActive: false });
    const prisma = makePrismaWithTx(tx);

    await deactivatePartner(prisma, 'actor1', 'p1');

    expect(tx.partner.update).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('happy path: sets isActive=false and records audit', async () => {
    const tx = makeTx({ isActive: true });
    const prisma = makePrismaWithTx(tx);

    await deactivatePartner(prisma, 'actor1', 'p1');

    expect(tx.partner.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isActive: false }
    });
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'partner_deactivated',
        entity: 'partner',
        entityId: 'p1',
        before: { isActive: true },
        after: { isActive: false }
      })
    );
  });
});

// ---------------------------------------------------------------------------
// reactivatePartner()
// ---------------------------------------------------------------------------
describe('reactivatePartner()', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeTx(partnerData: unknown) {
    return {
      partner: {
        findUnique: vi.fn().mockResolvedValue(partnerData),
        update: vi.fn().mockResolvedValue({})
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
  }

  function makePrismaWithTx(tx: ReturnType<typeof makeTx>) {
    return {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx))
    } as unknown as PrismaClient;
  }

  it('throws not_found when partner does not exist', async () => {
    const tx = makeTx(null);
    const prisma = makePrismaWithTx(tx);
    await expect(reactivatePartner(prisma, 'actor1', 'missing'))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('is idempotent: does not update or audit when already active', async () => {
    const tx = makeTx({ isActive: true });
    const prisma = makePrismaWithTx(tx);

    await reactivatePartner(prisma, 'actor1', 'p1');

    expect(tx.partner.update).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('happy path: sets isActive=true and records audit', async () => {
    const tx = makeTx({ isActive: false });
    const prisma = makePrismaWithTx(tx);

    await reactivatePartner(prisma, 'actor1', 'p1');

    expect(tx.partner.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isActive: true }
    });
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'partner_reactivated',
        entity: 'partner',
        entityId: 'p1',
        before: { isActive: false },
        after: { isActive: true }
      })
    );
  });
});

// ---------------------------------------------------------------------------
// createPartnerWithAdmin()
// ---------------------------------------------------------------------------
describe('createPartnerWithAdmin()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createInviteTokenMock.mockResolvedValue({ token: 'invite-token-abc', expiresAt: new Date() });
  });

  function makeTxForCreate({
    slugExists = null,
    emailExists = null,
    createdPartner = { id: 'p2', name: 'New Partner', slug: 'new-partner' },
    createdUser = { id: 'u2', email: 'admin@new.com' }
  }: {
    slugExists?: unknown;
    emailExists?: unknown;
    createdPartner?: { id: string; name: string; slug: string | null };
    createdUser?: { id: string; email: string };
  } = {}) {
    return {
      partner: {
        findUnique: vi.fn().mockResolvedValue(slugExists),
        create: vi.fn().mockResolvedValue(createdPartner)
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(emailExists),
        create: vi.fn().mockResolvedValue(createdUser)
      },
      partnerUser: {
        create: vi.fn().mockResolvedValue({})
      },
      commissionRateChange: {
        create: vi.fn().mockResolvedValue({})
      },
      passwordResetToken: {
        create: vi.fn().mockResolvedValue({})
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
  }

  function makePrismaWithTx(tx: ReturnType<typeof makeTxForCreate>) {
    return {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx))
    } as unknown as PrismaClient;
  }

  const baseArgs = {
    name: 'New Partner',
    slug: 'new-partner',
    commissionRate: 0.05,
    adminEmail: 'admin@new.com',
    adminName: 'Admin User'
  };

  it('throws duplicate_slug before partner.create when slug already exists', async () => {
    const tx = makeTxForCreate({ slugExists: { id: 'existing', slug: 'new-partner' } });
    const prisma = makePrismaWithTx(tx);

    await expect(createPartnerWithAdmin(prisma, 'actor1', baseArgs))
      .rejects.toMatchObject({ code: 'duplicate_slug' });

    expect(tx.partner.create).toHaveBeenCalledTimes(0);
  });

  it('throws duplicate_email before partner.create when email already exists', async () => {
    const tx = makeTxForCreate({ emailExists: { id: 'u-existing', email: 'admin@new.com' } });
    const prisma = makePrismaWithTx(tx);

    await expect(createPartnerWithAdmin(prisma, 'actor1', baseArgs))
      .rejects.toMatchObject({ code: 'duplicate_email' });

    expect(tx.partner.create).toHaveBeenCalledTimes(0);
  });

  it('happy path: calls all 4 operations, records audit, returns expected shape', async () => {
    const tx = makeTxForCreate();
    const prisma = makePrismaWithTx(tx);

    const result = await createPartnerWithAdmin(prisma, 'actor1', baseArgs);

    // All 4 core operations called
    expect(tx.partner.create).toHaveBeenCalledTimes(1);
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.partnerUser.create).toHaveBeenCalledTimes(1);
    expect(createInviteTokenMock).toHaveBeenCalledTimes(1);

    // commissionRate stored as Decimal(0.05)
    const partnerCreateCall = tx.partner.create.mock.calls[0][0];
    expect(partnerCreateCall.data.commissionRate.equals(new Prisma.Decimal('0.05'))).toBe(true);

    // partnerUser created with roleInPartner: 'admin' and empty assignedOrgIds
    expect(tx.partnerUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roleInPartner: 'admin',
          assignedOrgIds: []
        })
      })
    );

    // Audit recorded with correct action and after snapshot
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'partner_created',
        entity: 'partner',
        entityId: 'p2',
        after: expect.objectContaining({
          name: 'New Partner',
          slug: 'new-partner',
          commissionRate: '0.05',
          adminEmail: 'admin@new.com'
        })
      })
    );

    // Return shape
    expect(result).toEqual({
      partner: { id: 'p2', name: 'New Partner', slug: 'new-partner' },
      user: { id: 'u2', email: 'admin@new.com' },
      inviteToken: 'invite-token-abc'
    });
  });

  it('records a CommissionRateChange on creation when starting rate is non-zero', async () => {
    const tx = makeTxForCreate();
    const prisma = makePrismaWithTx(tx);

    await createPartnerWithAdmin(prisma, 'actor1', { ...baseArgs, commissionRate: 0.05 });

    expect(tx.commissionRateChange.create).toHaveBeenCalledTimes(1);
    const createCall = tx.commissionRateChange.create.mock.calls[0][0];
    expect(createCall.data.partnerId).toBe('p2');
    expect(createCall.data.oldRate).toBeNull();
    expect(createCall.data.newRate.equals(new Prisma.Decimal('0.05'))).toBe(true);
    expect(createCall.data.changedById).toBe('actor1');
  });

  it('does not record CommissionRateChange on creation when starting rate is zero', async () => {
    const tx = makeTxForCreate();
    const prisma = makePrismaWithTx(tx);

    await createPartnerWithAdmin(prisma, 'actor1', { ...baseArgs, commissionRate: 0 });

    expect(tx.commissionRateChange.create).not.toHaveBeenCalled();
  });

  it('does not record CommissionRateChange on creation when rate is undefined/null', async () => {
    const tx = makeTxForCreate();
    const prisma = makePrismaWithTx(tx);

    await createPartnerWithAdmin(prisma, 'actor1', { ...baseArgs, commissionRate: undefined });

    expect(tx.commissionRateChange.create).not.toHaveBeenCalled();
  });
});
