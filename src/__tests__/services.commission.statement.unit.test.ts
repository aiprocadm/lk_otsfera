/**
 * Unit tests for commission/statement.ts (mocked prisma, no live Postgres).
 * Платёжная модель: db.payment.findMany + db.commissionRateChange.findMany.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const PERIOD_FROM = new Date('2026-04-01T00:00:00Z');
const PERIOD_TO = new Date('2026-04-30T23:59:59Z');

function makeTx() {
  return {
    commissionStatementItem: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    commissionStatement: {
      update: vi
        .fn()
        .mockResolvedValue({ id: 'stmt-draft', status: 'draft', pdfPath: null, xlsxPath: null }),
      create: vi.fn().mockResolvedValue({ id: 'stmt-new', status: 'draft' }),
    },
  };
}

type DbOpts = {
  partner?: unknown;
  payments?: unknown[];
  rateChanges?: unknown[];
  corrections?: unknown[];
  existing?: unknown;
  findFirstQueue?: unknown[];
  tx?: ReturnType<typeof makeTx>;
  $transaction?: ReturnType<typeof vi.fn>;
};

function makeDb(o: DbOpts = {}) {
  const tx = o.tx ?? makeTx();
  const findFirst = vi.fn();
  if (o.findFirstQueue) {
    for (const v of o.findFirstQueue) findFirst.mockResolvedValueOnce(v);
  } else {
    findFirst.mockResolvedValue(o.existing ?? null);
  }
  return {
    partner: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          'partner' in o ? o.partner : { commissionRate: new Prisma.Decimal('0.1') }
        ),
    },
    commissionRateChange: { findMany: vi.fn().mockResolvedValue(o.rateChanges ?? []) },
    // F4: история org-override; пустая по умолчанию (fallback на текущее значение).
    organizationCommissionRateChange: {
      findMany: vi.fn().mockResolvedValue((o as any).orgRateChanges ?? []),
    },
    payment: { findMany: vi.fn().mockResolvedValue(o.payments ?? []) },
    commissionCorrection: { findMany: vi.fn().mockResolvedValue((o as any).corrections ?? []) },
    commissionStatement: {
      findFirst,
      create: tx.commissionStatement.create,
      update: tx.commissionStatement.update,
    },
    $transaction:
      o.$transaction ??
      vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

function paymentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pay1',
    amount: new Prisma.Decimal('100000'),
    paidAt: new Date('2026-04-10T00:00:00Z'),
    isRefund: false,
    orderId: 'o1',
    order: { orderNumber: 'N1', partnerId: 'p1' },
    organization: { name: 'Org A', partnerId: 'p1' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.REDIS_URL;
});
afterEach(() => {
  delete process.env.REDIS_URL;
});

describe('calculateStatementForPartner — unit (payment model)', () => {
  it('returns partner_not_found when partner missing', async () => {
    const db = makeDb({ partner: null });
    expect(
      await calculateStatementForPartner(db as never, {
        partnerId: 'x',
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: null,
      })
    ).toEqual({ ok: false, error: 'partner_not_found' });
  });

  it('creates new draft with 0 items when no payments', async () => {
    const db = makeDb();
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.isNew).toBe(true);
    expect(r.itemCount).toBe(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('maps a payment into an item with paymentId and resolved rate', async () => {
    const db = makeDb({ payments: [paymentRow()] });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.itemCount).toBe(1);
    const data = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data[0];
    expect(data.paymentId).toBe('pay1');
    expect(data.orderId).toBe('o1');
    expect(Number(data.commissionAmount)).toBe(10000); // 100000 * 0.1
    expect(data.organizationName).toBe('Org A');
  });

  it('order-less payment maps orderId=null and uses organization name', async () => {
    const db = makeDb({ payments: [paymentRow({ orderId: null, order: null })] });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    if (!r.ok) throw new Error('expected ok');
    const data = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data[0];
    expect(data.orderId).toBeNull();
    expect(data.orderNumber).toBeNull();
    expect(data.organizationName).toBe('Org A');
    expect(r.itemCount).toBe(1);
  });

  it('A5: applies historical rate by paidAt', async () => {
    const db = makeDb({
      payments: [
        paymentRow({
          id: 'pBefore',
          paidAt: new Date('2026-04-10'),
          amount: new Prisma.Decimal('100000'),
        }),
        paymentRow({
          id: 'pAfter',
          paidAt: new Date('2026-04-20'),
          amount: new Prisma.Decimal('100000'),
        }),
      ],
      rateChanges: [
        {
          effectiveFrom: new Date('2026-01-01'),
          oldRate: null,
          newRate: new Prisma.Decimal('0.05'),
        },
        {
          effectiveFrom: new Date('2026-04-15'),
          oldRate: new Prisma.Decimal('0.05'),
          newRate: new Prisma.Decimal('0.2'),
        },
      ],
    });
    await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    const rows = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data;
    const before = rows.find((x: { paymentId: string }) => x.paymentId === 'pBefore');
    const after = rows.find((x: { paymentId: string }) => x.paymentId === 'pAfter');
    expect(Number(before.commissionAmount)).toBe(5000); // 0.05
    expect(Number(after.commissionAmount)).toBe(20000); // 0.2
  });

  it('A2: org override applied when the org belongs to the statement partner', async () => {
    const db = makeDb({
      payments: [
        paymentRow({
          organization: {
            name: 'Org A',
            partnerId: 'p1',
            partnerCommissionRate: new Prisma.Decimal('0.3'),
          },
        }),
      ],
    });
    await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    const data = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data[0];
    expect(Number(data.commissionAmount)).toBe(30000); // 100000 × 0.3
  });

  it('A2: org override IGNORED when the org belongs to a different partner than the statement', async () => {
    // Payment attributed to p1 via order.partnerId, but its organization belongs to
    // pOther (whose negotiated discount must not bleed onto p1).
    const db = makeDb({
      payments: [
        paymentRow({
          organization: {
            name: 'Org A',
            partnerId: 'pOther',
            partnerCommissionRate: new Prisma.Decimal('0.3'),
          },
        }),
      ],
    });
    await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    const data = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data[0];
    expect(Number(data.commissionAmount)).toBe(10000); // falls back to partner default 0.1
  });

  it('writes audit when calculatedByUserId provided', async () => {
    const db = makeDb({ payments: [paymentRow()] });
    await calculateStatementForPartner(db as never, {
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

  it('enqueues PDF/XLSX when REDIS_URL set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const db = makeDb({ payments: [paymentRow()] });
    await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(getQueue).toHaveBeenCalledWith('docs.generateCommissionPdf');
    expect(getQueue).toHaveBeenCalledWith('docs.generateCommissionXlsx');
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });

  it('swallows queue errors', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    queueAdd.mockRejectedValue(new Error('Redis down'));
    const db = makeDb({ payments: [paymentRow()] });
    await expect(
      calculateStatementForPartner(db as never, {
        partnerId: 'p1',
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: null,
      })
    ).resolves.toBeDefined();
  });

  it('updates draft in place when existing draft found (isNew=false)', async () => {
    const db = makeDb({ existing: { id: 'stmt-draft', status: 'draft', supersededBy: null } });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.isNew).toBe(false);
    expect(r.statement.id).toBe('stmt-draft');
  });

  it('creates new + supersedes when existing is approved', async () => {
    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue({ id: 'stmt-new', status: 'draft' });
    tx.commissionStatement.update.mockResolvedValue({ id: 'stmt-old', supersededBy: 'stmt-new' });
    const db = makeDb({ existing: { id: 'stmt-old', status: 'approved', supersededBy: null }, tx });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.isNew).toBe(true);
    expect(r.statement.id).toBe('stmt-new');
    expect(tx.commissionStatement.update).toHaveBeenCalledTimes(2);
  });

  it('returns period_overlap when rejectOverlap and a different range overlaps', async () => {
    const db = makeDb({ findFirstQueue: [{ id: 'stmt-other' }] });
    expect(
      await calculateStatementForPartner(db as never, {
        partnerId: 'p1',
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: null,
        rejectOverlap: true,
      })
    ).toEqual({ ok: false, error: 'period_overlap' });
  });

  it('C-01 race: falls back to updateDraftInPlace on P2002', async () => {
    const tx = makeTx();
    tx.commissionStatement.update.mockResolvedValue({
      id: 'stmt-winner',
      status: 'draft',
      pdfPath: null,
      xlsxPath: null,
    });
    const uniqueError = Object.assign(new Error('Unique'), { code: 'P2002' });
    const $transaction = vi
      .fn()
      .mockRejectedValueOnce(uniqueError)
      .mockImplementationOnce(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    const db = makeDb({
      tx,
      $transaction,
      findFirstQueue: [
        null /*existing lookup*/,
        { id: 'stmt-winner', status: 'draft', supersededBy: null } /*winner*/,
      ],
    });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.isNew).toBe(false);
    expect(r.statement.id).toBe('stmt-winner');
  });

  it('C-01 race: re-throws non-P2002', async () => {
    const $transaction = vi.fn().mockRejectedValue(new Error('Network'));
    const db = makeDb({ $transaction });
    await expect(
      calculateStatementForPartner(db as never, {
        partnerId: 'p1',
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: null,
      })
    ).rejects.toThrow('Network');
  });

  it('A6: applied correction not yet carried becomes a negative line', async () => {
    const db = makeDb({
      payments: [paymentRow({ amount: new Prisma.Decimal('100000') })],
      corrections: [
        {
          id: 'corr-1',
          amount: new Prisma.Decimal('30000'),
          rate: new Prisma.Decimal('0.2'),
          commissionAmount: new Prisma.Decimal('6000'),
        },
      ],
    } as any);
    await calculateStatementForPartner(db as never, {
      partnerId: 'p1',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    const rows = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data;
    const corrLine = rows.find((x: { correctionId?: string }) => x.correctionId === 'corr-1');
    expect(corrLine).toBeTruthy();
    expect(Number(corrLine.commissionAmount)).toBe(-6000);
    expect(corrLine.paymentId).toBeNull();
  });
});
