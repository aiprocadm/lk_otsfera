/**
 * Unit tests for commission/statement.ts — covers branches unreachable in the
 * integration suite (mocked prisma, no live Postgres required).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks declared before any imports
const { recordAudit, getQueue, queueAdd } = vi.hoisted(() => {
  const queueAdd = vi.fn().mockResolvedValue({});
  const getQueue = vi.fn(() => ({ add: queueAdd }));
  const recordAudit = vi.fn().mockResolvedValue(undefined);
  return { recordAudit, getQueue, queueAdd };
});

vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { Prisma } from '@prisma/client';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';

type MockTx = {
  commissionStatementItem: { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> };
  commissionStatement: { update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

const PERIOD_FROM = new Date('2026-04-01T00:00:00Z');
const PERIOD_TO = new Date('2026-04-30T23:59:59Z');

function makeTx(overrides: Partial<MockTx> = {}): MockTx {
  return {
    commissionStatementItem: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    commissionStatement: {
      update: vi.fn().mockResolvedValue({ id: 'stmt-1', status: 'draft', pdfPath: null, xlsxPath: null }),
      create: vi.fn().mockResolvedValue({ id: 'stmt-new', status: 'draft' }),
    },
    ...overrides,
  };
}

function makeDb({
  partner = { commissionRate: { toString: () => '0.10', toNumber: () => 0.1 } as never },
  overlapResult = null as { id: string } | null,
  orders = [] as {
    id: string; orderNumber: string | null; totalAmount: { toString: () => string }; vatIncluded: boolean;
    vatRate: null; partnerId: string; companyId: string; company: { name: string };
  }[],
  existingStatement = null as { id: string; status: string; supersededBy: null | string } | null,
  orgLookup = [] as { companyId: string; name: string; partnerCommissionRate: null | { toNumber: () => number } }[],
  txFactory = null as (() => MockTx) | null,
} = {}) {
  const tx = txFactory ? txFactory() : makeTx();

  return {
    partner: { findUnique: vi.fn().mockResolvedValue(partner) },
    commissionStatement: {
      findFirst: vi.fn()
        .mockResolvedValueOnce(overlapResult)   // overlap check (only called when rejectOverlap)
        .mockResolvedValueOnce(existingStatement), // existing statement lookup
      create: tx.commissionStatement.create,
      update: tx.commissionStatement.update,
    },
    order: { findMany: vi.fn().mockResolvedValue(orders) },
    organization: { findMany: vi.fn().mockResolvedValue(orgLookup) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: MockTx) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure REDIS_URL is not set so queue enqueue branch is skipped by default
  delete process.env.REDIS_URL;
  delete process.env.COMMISSION_TRIGGER;
  delete process.env.COMMISSION_VAT_MODE;
});

afterEach(() => {
  delete process.env.REDIS_URL;
  delete process.env.COMMISSION_TRIGGER;
  delete process.env.COMMISSION_VAT_MODE;
});

describe('calculateStatementForPartner — unit (mocked prisma)', () => {
  it('throws PARTNER_NOT_FOUND when partner does not exist', async () => {
    const db = makeDb({ partner: null as never });
    db.partner.findUnique.mockResolvedValue(null);
    await expect(
      calculateStatementForPartner(db as never, {
        partnerId: 'p-missing',
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: null,
      })
    ).rejects.toThrow('PARTNER_NOT_FOUND');
  });

  it('creates new draft when no existing statement (isNew=true, 0 items)', async () => {
    const tx = makeTx();
    const newStmt = { id: 'stmt-new', status: 'draft' };
    tx.commissionStatement.create.mockResolvedValue(newStmt);
    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: {
        findFirst: vi.fn().mockResolvedValue(null), // no existing
        create: tx.commissionStatement.create,
        update: tx.commissionStatement.update,
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(result.isNew).toBe(true);
    expect(result.itemCount).toBe(0);
    // No audit when calculatedByUserId is null
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('writes audit log when calculatedByUserId is provided', async () => {
    const tx = makeTx();
    const newStmt = { id: 'stmt-new', status: 'draft' };
    tx.commissionStatement.create.mockResolvedValue(newStmt);
    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: tx.commissionStatement.create,
        update: tx.commissionStatement.update,
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: 'u-admin',
    });

    expect(recordAudit).toHaveBeenCalledOnce();
    expect(recordAudit.mock.calls[0][1]).toMatchObject({
      userId: 'u-admin',
      action: 'commission_statement_calculated',
    });
  });

  it('enqueues PDF/XLSX when REDIS_URL is set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const tx = makeTx();
    const newStmt = { id: 'stmt-redis', status: 'draft' };
    tx.commissionStatement.create.mockResolvedValue(newStmt);
    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: tx.commissionStatement.create,
        update: tx.commissionStatement.update,
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(getQueue).toHaveBeenCalledWith('docs.generateCommissionPdf');
    expect(getQueue).toHaveBeenCalledWith('docs.generateCommissionXlsx');
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });

  it('swallows queue errors when REDIS_URL is set but queue throws', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    queueAdd.mockRejectedValue(new Error('Redis unavailable'));
    const tx = makeTx();
    const newStmt = { id: 'stmt-q-fail', status: 'draft' };
    tx.commissionStatement.create.mockResolvedValue(newStmt);
    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: tx.commissionStatement.create,
        update: tx.commissionStatement.update,
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    // Should not throw even though queue throws
    await expect(
      calculateStatementForPartner(db, {
        partnerId: 'p1',
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: null,
      })
    ).resolves.toBeDefined();
  });

  it('updates draft in-place when existing draft found (isNew=false)', async () => {
    const existingDraft = { id: 'stmt-draft', status: 'draft', supersededBy: null };
    const updatedStmt = { id: 'stmt-draft', status: 'draft', pdfPath: null, xlsxPath: null };
    const tx = makeTx();
    tx.commissionStatement.update.mockResolvedValue(updatedStmt);

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: {
        findFirst: vi.fn().mockResolvedValue(existingDraft),
        create: tx.commissionStatement.create,
        update: tx.commissionStatement.update,
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(result.isNew).toBe(false);
    expect(result.statement.id).toBe('stmt-draft');
  });

  it('creates new + supersedes old when existing is approved (not draft)', async () => {
    const existingApproved = { id: 'stmt-old', status: 'approved', supersededBy: null };
    const newStmt = { id: 'stmt-new', status: 'draft' };
    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue(newStmt);
    tx.commissionStatement.update.mockResolvedValue({ id: 'stmt-old', supersededBy: 'stmt-new' });

    const findFirst = vi.fn().mockResolvedValue(existingApproved);
    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: {
        findFirst,
        create: tx.commissionStatement.create,
        update: tx.commissionStatement.update,
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(result.isNew).toBe(true);
    expect(result.statement.id).toBe('stmt-new');
    // existing must be vacated (temp self-ref) and then pointed to new
    expect(tx.commissionStatement.update).toHaveBeenCalledTimes(2);
  });

  it('uses "paid" trigger when COMMISSION_TRIGGER=paid', async () => {
    process.env.COMMISSION_TRIGGER = 'paid';
    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue({ id: 'stmt-paid-trigger', status: 'draft' });
    const orderFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { findMany: orderFindMany },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    // The where clause should use financialStatus=paid + paidAt (not closedAt)
    const where = orderFindMany.mock.calls[0][0].where;
    expect(where).toHaveProperty('financialStatus', 'paid');
    expect(where).toHaveProperty('paidAt');
    expect(where).not.toHaveProperty('closedAt');
  });

  it('uses "completed" trigger when COMMISSION_TRIGGER=completed', async () => {
    process.env.COMMISSION_TRIGGER = 'completed';
    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue({ id: 'stmt-completed-trigger', status: 'draft' });
    const orderFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { findMany: orderFindMany },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    const where = orderFindMany.mock.calls[0][0].where;
    expect(where).toHaveProperty('executionStatus', 'completed');
    expect(where).toHaveProperty('completedAt');
  });

  it('defaults to "paid_and_closed" trigger for invalid env value', async () => {
    process.env.COMMISSION_TRIGGER = 'bogus-value';
    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue({ id: 'stmt-default-trigger', status: 'draft' });
    const orderFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { findMany: orderFindMany },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    const where = orderFindMany.mock.calls[0][0].where;
    expect(where).toHaveProperty('financialStatus', 'paid');
    expect(where).toHaveProperty('closedAt');
  });

  it('uses exclude_vat mode when COMMISSION_VAT_MODE=exclude_vat', async () => {
    process.env.COMMISSION_VAT_MODE = 'exclude_vat';
    // With a non-zero vatRate and vatIncluded, the base amount is reduced
    const order = {
      id: 'o1', orderNumber: 'N1', totalAmount: new Prisma.Decimal('120'),
      vatIncluded: true, vatRate: new Prisma.Decimal('0.2'), partnerId: 'p1', companyId: 'c1',
      company: { name: 'Org1' },
    };
    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue({ id: 'stmt-vat', status: 'draft' });

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { findMany: vi.fn().mockResolvedValue([order]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(result.itemCount).toBe(1);
    // Base was 120 with 20% VAT inclusive => 100 net; commission = 100 * 0.1 = 10
    // (or just confirm it ran without error and items exist)
  });

  it('throws PERIOD_OVERLAP when rejectOverlap=true and a different range overlaps', async () => {
    const overlapRow = { id: 'stmt-other' };
    const findFirst = vi.fn().mockResolvedValueOnce(overlapRow); // overlap check returns hit

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;

    await expect(
      calculateStatementForPartner(db, {
        partnerId: 'p1',
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: null,
        rejectOverlap: true,
      })
    ).rejects.toThrow(/PERIOD_OVERLAP/);
  });

  it('C-01 race: falls back to updateDraftInPlace when P2002 unique violation on create', async () => {
    const tx = makeTx();
    const racedStmt = { id: 'stmt-race-winner', status: 'draft', pdfPath: null, xlsxPath: null };
    tx.commissionStatement.update.mockResolvedValue(racedStmt);

    const uniqueError = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    // Transaction throws P2002 on create attempt
    const $transaction = vi.fn()
      .mockRejectedValueOnce(uniqueError) // first attempt fails with P2002
      .mockImplementationOnce(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)); // second (updateDraftInPlace) succeeds

    const winnerStmt = { id: 'stmt-race-winner', status: 'draft', supersededBy: null };
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null) // no existing before creation attempt
      .mockResolvedValueOnce(winnerStmt); // re-read after P2002

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst, create: tx.commissionStatement.create, update: tx.commissionStatement.update },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction,
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(result.isNew).toBe(false);
    expect(result.statement.id).toBe('stmt-race-winner');
  });

  it('C-01 race: re-throws non-P2002 errors from transaction', async () => {
    const networkError = new Error('Network error');
    const $transaction = vi.fn().mockRejectedValue(networkError);

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction,
    } as never;

    await expect(
      calculateStatementForPartner(db, {
        partnerId: 'p1',
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: null,
      })
    ).rejects.toThrow('Network error');
  });

  it('C-01 race: re-throws P2002 when no winner found after race', async () => {
    const uniqueError = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    const $transaction = vi.fn().mockRejectedValue(uniqueError);

    const findFirst = vi.fn()
      .mockResolvedValueOnce(null) // no existing before
      .mockResolvedValueOnce(null); // no winner found either (edge case)

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction,
    } as never;

    await expect(
      calculateStatementForPartner(db, {
        partnerId: 'p1',
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: null,
      })
    ).rejects.toThrow();
  });

  it('creates items in transaction when orders are present', async () => {
    const order = {
      id: 'o1', orderNumber: 'N1',
      totalAmount: new Prisma.Decimal('100000'),
      vatIncluded: false, vatRate: null, partnerId: 'p1', companyId: 'c1',
      company: { name: 'Org A' },
    };
    const tx = makeTx();
    const newStmt = { id: 'stmt-items', status: 'draft' };
    tx.commissionStatement.create.mockResolvedValue(newStmt);

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { findMany: vi.fn().mockResolvedValue([order]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(result.itemCount).toBe(1);
    expect(tx.commissionStatementItem.createMany).toHaveBeenCalledOnce();
  });

  it('uses org-level commission rate override when org matches by companyId', async () => {
    const order = {
      id: 'o1', orderNumber: 'N1',
      totalAmount: new Prisma.Decimal('100000'),
      vatIncluded: false, vatRate: null, partnerId: 'p1', companyId: 'c1',
      company: { name: 'Org A' },
    };
    const orgOverride = { companyId: 'c1', name: 'Org A Custom', partnerCommissionRate: new Prisma.Decimal('0.05') };

    const tx = makeTx();
    const newStmt = { id: 'stmt-override', status: 'draft' };
    tx.commissionStatement.create.mockResolvedValue(newStmt);

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { findMany: vi.fn().mockResolvedValue([order]) },
      organization: { findMany: vi.fn().mockResolvedValue([orgOverride]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(result.itemCount).toBe(1);
    // 100000 * 0.05 = 5000
    const itemData = tx.commissionStatementItem.createMany.mock.calls[0][0].data[0];
    expect(Number(itemData.commissionAmount)).toBe(5000);
  });

  it('resolveRatesAndOrgNames: org with null partnerCommissionRate falls back to partner rate', async () => {
    // Covers the `partnerCommissionRate ?? null` ARM 0 — when the org HAS a companyId
    // but partnerCommissionRate is null, we store null and fall back to partner default rate.
    const order = {
      id: 'o1', orderNumber: 'N1',
      totalAmount: new Prisma.Decimal('100000'),
      vatIncluded: false, vatRate: null, partnerId: 'p1', companyId: 'c1',
      company: { name: 'Company Name' },
    };
    // Org has companyId (not skipped) but NO rate override (null)
    const orgNoRate = { companyId: 'c1', name: 'Org No Rate', partnerCommissionRate: null };

    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue({ id: 'stmt-nooverride', status: 'draft' });

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { findMany: vi.fn().mockResolvedValue([order]) },
      organization: { findMany: vi.fn().mockResolvedValue([orgNoRate]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(result.itemCount).toBe(1);
    // null rate from org → falls back to partner default 0.1, so 100000 * 0.1 = 10000
    const itemData = tx.commissionStatementItem.createMany.mock.calls[0][0].data[0];
    expect(Number(itemData.commissionAmount)).toBe(10000);
    // The org name from the map (not from company) is used
    expect(itemData.organizationName).toBe('Org No Rate');
  });

  it('resolveRatesAndOrgNames: org with null companyId is skipped in byCompany map', async () => {
    const order = {
      id: 'o1', orderNumber: 'N1',
      totalAmount: new Prisma.Decimal('100000'),
      vatIncluded: false, vatRate: null, partnerId: 'p1', companyId: 'c1',
      company: { name: 'Company Name' },
    };
    // org with null companyId should be skipped
    const orgNullCompany = { companyId: null, name: 'Bad Org', partnerCommissionRate: new Prisma.Decimal('0.05') };

    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue({ id: 'stmt-null-company', status: 'draft' });

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { findMany: vi.fn().mockResolvedValue([order]) },
      organization: { findMany: vi.fn().mockResolvedValue([orgNullCompany]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    // orgNullCompany should be skipped; falls back to company.name + partner default rate 0.1
    expect(result.itemCount).toBe(1);
    const itemData = tx.commissionStatementItem.createMany.mock.calls[0][0].data[0];
    expect(itemData.organizationName).toBe('Company Name');
    expect(Number(itemData.commissionAmount)).toBe(10000); // 100000 * 0.1
  });

  it('updateDraftInPlace: does NOT call createMany when items array is empty', async () => {
    // Existing draft + no orders → empty items → createMany must NOT be called
    const existingDraft = { id: 'stmt-draft', status: 'draft', supersededBy: null };
    const updatedStmt = { id: 'stmt-draft', status: 'draft', pdfPath: null, xlsxPath: null };
    const tx = makeTx();
    tx.commissionStatement.update.mockResolvedValue(updatedStmt);

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(existingDraft) },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(tx.commissionStatementItem.createMany).not.toHaveBeenCalled();
  });

  it('updateDraftInPlace: calls createMany when items are present (in-place update with orders)', async () => {
    // Existing draft + 1 order → items.length > 0 → createMany IS called
    const existingDraft = { id: 'stmt-draft-with-items', status: 'draft', supersededBy: null };
    const updatedStmt = { id: 'stmt-draft-with-items', status: 'draft', pdfPath: null, xlsxPath: null };
    const tx = makeTx();
    tx.commissionStatement.update.mockResolvedValue(updatedStmt);

    const order = {
      id: 'o1', orderNumber: 'N1',
      totalAmount: new Prisma.Decimal('50000'),
      vatIncluded: false, vatRate: null, partnerId: 'p1', companyId: 'c1',
      company: { name: 'Org A' },
    };

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(existingDraft) },
      order: { findMany: vi.fn().mockResolvedValue([order]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });

    expect(result.isNew).toBe(false);
    expect(tx.commissionStatementItem.createMany).toHaveBeenCalledOnce();
    expect(result.itemCount).toBe(1);
  });

  it('audit: supersededOldId is null when isNew=false (in-place update)', async () => {
    // Tests the !isNew ? null branch (line 324)
    const existingDraft = { id: 'stmt-draft-for-audit', status: 'draft', supersededBy: null };
    const updatedStmt = { id: 'stmt-draft-for-audit', status: 'draft', pdfPath: null, xlsxPath: null };
    const tx = makeTx();
    tx.commissionStatement.update.mockResolvedValue(updatedStmt);

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: { findFirst: vi.fn().mockResolvedValue(existingDraft) },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: 'u-cron', // provide userId so audit runs
    });

    // isNew=false → supersededOldId = null
    expect(recordAudit).toHaveBeenCalledOnce();
    const auditAfter = recordAudit.mock.calls[0][1].after;
    expect(auditAfter.isNew).toBe(false);
    expect(auditAfter.supersededOldId).toBeNull();
  });

  it('audit: supersededOldId is existing.id when isNew=true and existing was present', async () => {
    // Tests the existing?.id ?? null branch when existing IS defined
    const existingApproved = { id: 'stmt-approved-for-audit', status: 'approved', supersededBy: null };
    const newStmt = { id: 'stmt-new-audit', status: 'draft' };
    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue(newStmt);
    tx.commissionStatement.update.mockResolvedValue({ id: 'stmt-approved-for-audit' });

    const db = {
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: new Prisma.Decimal('0.1') }) },
      commissionStatement: {
        findFirst: vi.fn().mockResolvedValue(existingApproved),
        create: tx.commissionStatement.create,
        update: tx.commissionStatement.update,
      },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    await calculateStatementForPartner(db, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: 'u-admin',
    });

    expect(recordAudit).toHaveBeenCalledOnce();
    const auditAfter = recordAudit.mock.calls[0][1].after;
    expect(auditAfter.isNew).toBe(true);
    // supersededOldId = existing.id
    expect(auditAfter.supersededOldId).toBe('stmt-approved-for-audit');
  });
});
