import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

import type { PrismaClient } from '@prisma/client';
import {
  listOrganizations,
  getOrganization,
  updateOrganization,
  createOrganization,
  AdminOrgError,
} from '@/lib/services/admin/organizations';

const { recordAuditMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
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
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    organization: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
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
      { externalId: { contains: 'foo', mode: 'insensitive' } },
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

  it('row mapping: Decimal(0) explicit override is 0, not null', async () => {
    const org = makeOrg({ partnerCommissionRate: new Prisma.Decimal('0') });
    const findMany = vi.fn().mockResolvedValue([org]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = makePrisma({ organization: { findMany, count } });

    const result = await listOrganizations(prisma, {});

    expect(result.rows[0].partnerCommissionRate).toBe(0);
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
      ...overrides,
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

  it('Decimal(0) explicit override is 0, not null', async () => {
    const org = makeFullOrg({ partnerCommissionRate: new Prisma.Decimal('0') });
    const prisma = makePrisma({ organization: { findUnique: vi.fn().mockResolvedValue(org) } });

    const result = await getOrganization(prisma, 'org1');

    expect(result!.partnerCommissionRate).toBe(0);
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
      partner: { id: 'p1', name: 'Тест Партнёр' },
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
        update: vi.fn().mockResolvedValue({}),
      },
    };
  }

  function makePrismaWithTx(tx: ReturnType<typeof makeTx>) {
    return {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaClient;
  }

  it('returns not_found when org does not exist', async () => {
    const tx = makeTx(null);
    const prisma = makePrismaWithTx(tx);

    expect(await updateOrganization(prisma, 'actor1', 'missing', { name: 'New' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('returns a §3 Result (not a throw) when not found', async () => {
    const tx = makeTx(null);
    const prisma = makePrismaWithTx(tx);

    expect(await updateOrganization(prisma, 'actor1', 'missing', {})).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('happy path: calls tx.organization.update with only provided fields', async () => {
    const before = { name: 'Old Name', inn: '7700000000', kpp: null };
    const tx = makeTx(before);
    const prisma = makePrismaWithTx(tx);

    await updateOrganization(prisma, 'actor1', 'org1', { name: 'New Name' });

    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: 'org1' },
      data: { name: 'New Name' },
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
        entityId: 'org1',
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

// ---------------------------------------------------------------------------
// createOrganization()
// ---------------------------------------------------------------------------
describe('createOrganization()', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeCreatePrisma(
    opts: {
      innLookup?: unknown;
      txThrows?: unknown;
      companyId?: string;
      orgId?: string;
    } = {}
  ) {
    const companyCreate = vi.fn().mockResolvedValue({ id: opts.companyId ?? 'company1' });
    const orgCreate = vi.fn().mockResolvedValue({ id: opts.orgId ?? 'neworg1' });
    const tx = {
      company: { create: companyCreate },
      organization: { create: orgCreate },
    };
    const findUnique = vi.fn().mockResolvedValue(opts.innLookup ?? null);
    const $transaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      if (opts.txThrows) throw opts.txThrows;
      return fn(tx);
    });
    const prisma = {
      organization: { findUnique },
      $transaction,
    } as unknown as PrismaClient;
    return { prisma, findUnique, companyCreate, orgCreate, $transaction };
  }

  it('validation: empty name → error validation, no DB writes', async () => {
    const { prisma, $transaction } = makeCreatePrisma();
    expect(await createOrganization(prisma, 'actor1', { name: '   ' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('validation: имя вообще не передано → тот же отказ, без падения', async () => {
    // Форма может прислать объект без поля name (старый клиент, ручной вызов
    // API). Отсутствие поля должно вести к вежливому отказу, а не к TypeError.
    const { prisma, $transaction } = makeCreatePrisma();
    expect(await createOrganization(prisma, 'actor1', {} as never)).toEqual({
      ok: false,
      error: 'validation',
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('inn_exists: existing inn short-circuits before any write', async () => {
    const { prisma, $transaction } = makeCreatePrisma({ innLookup: { id: 'existing' } });
    expect(
      await createOrganization(prisma, 'actor1', { name: 'Новая', inn: '7700000000' })
    ).toEqual({ ok: false, error: 'inn_exists' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('happy path: mints a Company, creates org with externalId=null, returns id', async () => {
    const { prisma, companyCreate, orgCreate } = makeCreatePrisma({ orgId: 'org-new' });
    const res = await createOrganization(prisma, 'actor1', {
      name: 'ООО Ромашка',
      inn: '7712345678',
      kpp: '771201001',
    });

    expect(res).toEqual({ ok: true, id: 'org-new' });
    expect(companyCreate).toHaveBeenCalledWith({ data: { name: 'ООО Ромашка' } });
    const orgData = orgCreate.mock.calls[0][0].data;
    expect(orgData).toMatchObject({
      name: 'ООО Ромашка',
      inn: '7712345678',
      kpp: '771201001',
      externalId: null,
      companyId: 'company1',
    });
  });

  it('trims inputs and stores blank inn/kpp as null; skips inn lookup when absent', async () => {
    const { prisma, findUnique, orgCreate } = makeCreatePrisma();
    await createOrganization(prisma, 'actor1', { name: '  Без ИНН  ', inn: '  ', kpp: '' });

    expect(findUnique).not.toHaveBeenCalled(); // ИНН пустой → проверки нет
    const orgData = orgCreate.mock.calls[0][0].data;
    expect(orgData.name).toBe('Без ИНН');
    expect(orgData.inn).toBeNull();
    expect(orgData.kpp).toBeNull();
  });

  it('writes a manual-source audit record', async () => {
    const { prisma } = makeCreatePrisma();
    await createOrganization(prisma, 'actor1', { name: 'Аудит Тест' });

    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'actor1',
        action: 'organization_created_manual',
        entity: 'organization',
        after: expect.objectContaining({ source: 'manual', name: 'Аудит Тест' }),
      })
    );
  });

  it('P2002 race (concurrent inn insert) maps to inn_exists', async () => {
    const { prisma } = makeCreatePrisma({ txThrows: { code: 'P2002' } });
    expect(
      await createOrganization(prisma, 'actor1', { name: 'Гонка', inn: '7700000000' })
    ).toEqual({ ok: false, error: 'inn_exists' });
  });

  it('non-P2002 errors propagate', async () => {
    const { prisma } = makeCreatePrisma({ txThrows: new Error('db down') });
    await expect(createOrganization(prisma, 'actor1', { name: 'Ошибка' })).rejects.toThrow(
      'db down'
    );
  });
});
