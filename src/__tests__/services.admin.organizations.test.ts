import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import {
  listOrganizations,
  getOrganization,
  updateOrganization,
  AdminOrgError
} from '@/lib/services/admin/organizations';

const { recordAuditMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn()
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

// ---------------------------------------------------------------------------
// Prisma mock factory
// ---------------------------------------------------------------------------
function makeOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org1',
    name: 'Тест Организация',
    inn: '7700000000',
    externalId: '1C-001',
    partner: { id: 'p1', name: 'Тест Партнёр' },
    _count: { orders: 5, organizationUsers: 2 },
    partnerCommissionRate: new Prisma.Decimal('0.08'),
    ...overrides
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    organization: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null)
    },
    ...overrides
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// listOrganizations()
// ---------------------------------------------------------------------------
describe('listOrganizations()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty rows and total=0 when no organizations', async () => {
    const prisma = makePrisma();
    const result = await listOrganizations(prisma, {});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('q filter produces OR clause with name + inn + externalId ILIKE', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ organization: { findMany, count } });

    await listOrganizations(prisma, { q: 'foo' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toEqual([
      { name: { contains: 'foo', mode: 'insensitive' } },
      { inn: { contains: 'foo', mode: 'insensitive' } },
      { externalId: { contains: 'foo', mode: 'insensitive' } }
    ]);
  });

  it('no q produces no OR clause', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ organization: { findMany, count } });

    await listOrganizations(prisma, {});

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeUndefined();
  });

  it('partnerId filter maps to where.partnerId', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ organization: { findMany, count } });

    await listOrganizations(prisma, { partnerId: 'p42' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.partnerId).toBe('p42');
  });

  it('withRateOverride:true maps to where.partnerCommissionRate = { not: null }', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ organization: { findMany, count } });

    await listOrganizations(prisma, { withRateOverride: true });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.partnerCommissionRate).toEqual({ not: null });
  });

  it('withRateOverride:false maps to where.partnerCommissionRate = null', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ organization: { findMany, count } });

    await listOrganizations(prisma, { withRateOverride: false });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.partnerCommissionRate).toBeNull();
  });

  it('withRateOverride undefined does not set partnerCommissionRate filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ organization: { findMany, count } });

    await listOrganizations(prisma, {});

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.partnerCommissionRate).toBeUndefined();
  });

  it('take defaults to 50 and is clamped to 100', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ organization: { findMany, count } });

    await listOrganizations(prisma, {});
    expect(findMany.mock.calls[0][0].take).toBe(50);

    findMany.mockClear();
    await listOrganizations(prisma, { take: 200 });
    expect(findMany.mock.calls[0][0].take).toBe(100);

    findMany.mockClear();
    await listOrganizations(prisma, { take: 0 });
    expect(findMany.mock.calls[0][0].take).toBe(1);
  });

  it('skip defaults to 0 and is floored at 0', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ organization: { findMany, count } });

    await listOrganizations(prisma, { skip: -5 });
    expect(findMany.mock.calls[0][0].skip).toBe(0);

    findMany.mockClear();
    await listOrganizations(prisma, { skip: 20 });
    expect(findMany.mock.calls[0][0].skip).toBe(20);
  });

  it('row mapping: partnerCommissionRate Decimal converted to number', async () => {
    const org = makeOrg({ partnerCommissionRate: new Prisma.Decimal('0.08') });
    const findMany = vi.fn().mockResolvedValue([org]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = makePrisma({ organization: { findMany, count } });

    const result = await listOrganizations(prisma, {});

    expect(result.total).toBe(1);
    expect(result.rows[0].id).toBe('org1');
    expect(result.rows[0].partnerCommissionRate).toBeCloseTo(0.08);
    expect(result.rows[0].partner).toEqual({ id: 'p1', name: 'Тест Партнёр' });
    expect(result.rows[0].ordersCount).toBe(5);
    expect(result.rows[0].organizationUsersCount).toBe(2);
  });

  it('row mapping: null partnerCommissionRate preserved as null', async () => {
    const org = makeOrg({ partnerCommissionRate: null });
    const findMany = vi.fn().mockResolvedValue([org]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = makePrisma({ organization: { findMany, count } });

    const result = await listOrganizations(prisma, {});

    expect(result.rows[0].partnerCommissionRate).toBeNull();
  });

  it('q and partnerId can be combined', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ organization: { findMany, count } });

    await listOrganizations(prisma, { q: 'test', partnerId: 'p1' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.partnerId).toBe('p1');
    expect(whereArg.OR).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// AdminOrgError
// ---------------------------------------------------------------------------
describe('AdminOrgError', () => {
  it('has correct code and name', () => {
    const err = new AdminOrgError('not_found');
    expect(err.code).toBe('not_found');
    expect(err.name).toBe('AdminOrgError');
    expect(err).toBeInstanceOf(Error);
  });

  it('forbidden code is supported', () => {
    const err = new AdminOrgError('forbidden');
    expect(err.code).toBe('forbidden');
  });
});

// ---------------------------------------------------------------------------
// getOrganization()
// ---------------------------------------------------------------------------
describe('getOrganization()', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeFullOrg(overrides: Record<string, unknown> = {}) {
    return {
      id: 'org1',
      name: 'Тест Организация',
      inn: '7700000000',
      kpp: '770001001',
      externalId: '1C-001',
      partnerId: 'p1',
      partner: { id: 'p1', name: 'Тест Партнёр' },
      partnerCommissionRate: new Prisma.Decimal('0.08'),
      partnerCommissionRateNote: 'Спецусловие',
      ...overrides
    };
  }

  it('returns null when organization not found', async () => {
    const prisma = makePrisma();
    const result = await getOrganization(prisma, 'missing');
    expect(result).toBeNull();
  });

  it('maps Decimal partnerCommissionRate to number', async () => {
    const org = makeFullOrg({ partnerCommissionRate: new Prisma.Decimal('0.08') });
    const prisma = makePrisma({ organization: { findUnique: vi.fn().mockResolvedValue(org) } });

    const result = await getOrganization(prisma, 'org1');

    expect(result).not.toBeNull();
    expect(result!.partnerCommissionRate).toBeCloseTo(0.08);
  });

  it('null partnerCommissionRate preserved as null', async () => {
    const org = makeFullOrg({ partnerCommissionRate: null });
    const prisma = makePrisma({ organization: { findUnique: vi.fn().mockResolvedValue(org) } });

    const result = await getOrganization(prisma, 'org1');

    expect(result!.partnerCommissionRate).toBeNull();
  });

  it('includes partnerCommissionRateNote in result', async () => {
    const org = makeFullOrg({ partnerCommissionRateNote: 'VIP условия' });
    const prisma = makePrisma({ organization: { findUnique: vi.fn().mockResolvedValue(org) } });

    const result = await getOrganization(prisma, 'org1');

    expect(result!.partnerCommissionRateNote).toBe('VIP условия');
  });

  it('null partnerCommissionRateNote preserved as null', async () => {
    const org = makeFullOrg({ partnerCommissionRateNote: null });
    const prisma = makePrisma({ organization: { findUnique: vi.fn().mockResolvedValue(org) } });

    const result = await getOrganization(prisma, 'org1');

    expect(result!.partnerCommissionRateNote).toBeNull();
  });

  it('returns full detail shape with partner, inn, kpp, externalId', async () => {
    const org = makeFullOrg();
    const prisma = makePrisma({ organization: { findUnique: vi.fn().mockResolvedValue(org) } });

    const result = await getOrganization(prisma, 'org1');

    expect(result).toMatchObject({
      id: 'org1',
      name: 'Тест Организация',
      inn: '7700000000',
      kpp: '770001001',
      externalId: '1C-001',
      partnerId: 'p1',
      partner: { id: 'p1', name: 'Тест Партнёр' }
    });
  });
});

// ---------------------------------------------------------------------------
// updateOrganization()
// ---------------------------------------------------------------------------
describe('updateOrganization()', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeTx(orgData: unknown) {
    return {
      organization: {
        findUnique: vi.fn().mockResolvedValue(orgData),
        update: vi.fn().mockResolvedValue({})
      }
    };
  }

  function makePrismaWithTx(tx: ReturnType<typeof makeTx>) {
    return {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx))
    } as unknown as PrismaClient;
  }

  it('throws not_found when org does not exist', async () => {
    const tx = makeTx(null);
    const prisma = makePrismaWithTx(tx);

    await expect(updateOrganization(prisma, 'actor1', 'missing', { name: 'New' }))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('throws AdminOrgError (not just any Error) when not found', async () => {
    const tx = makeTx(null);
    const prisma = makePrismaWithTx(tx);

    await expect(updateOrganization(prisma, 'actor1', 'missing', {}))
      .rejects.toBeInstanceOf(AdminOrgError);
  });

  it('happy path: calls tx.organization.update with only provided fields', async () => {
    const before = { name: 'Old Name', inn: '7700000000', kpp: null };
    const tx = makeTx(before);
    const prisma = makePrismaWithTx(tx);

    await updateOrganization(prisma, 'actor1', 'org1', { name: 'New Name' });

    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: 'org1' },
      data: { name: 'New Name' }
    });
  });

  it('happy path: calls recordAudit with correct shape', async () => {
    const before = { name: 'Old Name', inn: '7700000000', kpp: null };
    const tx = makeTx(before);
    const prisma = makePrismaWithTx(tx);

    await updateOrganization(prisma, 'actor1', 'org1', { name: 'New Name' });

    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'actor1',
        action: 'organization_updated',
        entity: 'organization',
        entityId: 'org1'
      })
    );
  });

  it('audit before is pre-update snapshot', async () => {
    const before = { name: 'Old Name', inn: '7700000000', kpp: '770001001' };
    const tx = makeTx(before);
    const prisma = makePrismaWithTx(tx);

    await updateOrganization(prisma, 'actor1', 'org1', { name: 'New Name' });

    const auditCall = recordAuditMock.mock.calls[0][1];
    expect(auditCall.before).toEqual({ name: 'Old Name', inn: '7700000000', kpp: '770001001' });
  });

  it('audit after is the args passed to updateOrganization', async () => {
    const before = { name: 'Old Name', inn: '7700000000', kpp: null };
    const tx = makeTx(before);
    const prisma = makePrismaWithTx(tx);

    const args = { name: 'New Name', inn: null };
    await updateOrganization(prisma, 'actor1', 'org1', args);

    const auditCall = recordAuditMock.mock.calls[0][1];
    expect(auditCall.after).toEqual(args);
  });

  it('omitted fields are not included in update data', async () => {
    const before = { name: 'Name', inn: '7700000000', kpp: null };
    const tx = makeTx(before);
    const prisma = makePrismaWithTx(tx);

    await updateOrganization(prisma, 'actor1', 'org1', { kpp: '770001001' });

    const updateData = tx.organization.update.mock.calls[0][0].data;
    expect(updateData).toEqual({ kpp: '770001001' });
    expect(updateData.name).toBeUndefined();
    expect(updateData.inn).toBeUndefined();
  });

  it('null inn is passed as null (not stripped)', async () => {
    const before = { name: 'Name', inn: '7700000000', kpp: null };
    const tx = makeTx(before);
    const prisma = makePrismaWithTx(tx);

    await updateOrganization(prisma, 'actor1', 'org1', { inn: null });

    const updateData = tx.organization.update.mock.calls[0][0].data;
    expect(updateData.inn).toBeNull();
  });
});
