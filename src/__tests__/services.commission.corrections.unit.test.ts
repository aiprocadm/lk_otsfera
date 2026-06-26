import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { detectLateRefundCorrections } from '@/lib/services/commission/corrections';

const dec = (n: number) => new Prisma.Decimal(n);

function makeDb(opts: { refunds: any[]; liveStatement?: any; rateChanges?: any[]; created?: any[] }) {
  const created = opts.created ?? [];
  return {
    payment: { findMany: vi.fn().mockResolvedValue(opts.refunds) },
    commissionStatement: { findFirst: vi.fn().mockResolvedValue(opts.liveStatement ?? null) },
    commissionRateChange: { findMany: vi.fn().mockResolvedValue(opts.rateChanges ?? []) },
    commissionCorrection: {
      create: vi.fn().mockImplementation(({ data }) => { created.push(data); return { id: 'new', ...data }; }),
    },
    partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: dec(0.2) }) },
    _created: created,
  } as any;
}

function refundRow(over: any = {}) {
  return {
    id: 'pay-r1', amount: dec(30000), paidAt: new Date('2026-04-20'), isRefund: true, orderId: 'o1',
    order: { partnerId: 'p1' }, organization: { partnerId: 'p1' },
    ...over,
  };
}

describe('detectLateRefundCorrections', () => {
  it('creates needs_review for a refund landing in a paid period', async () => {
    const db = makeDb({
      refunds: [refundRow()],
      liveStatement: { id: 'stmt-apr', status: 'paid', periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30T23:59:59Z') },
    });
    const n = await detectLateRefundCorrections(db);
    expect(n).toBe(1);
    expect(db._created[0]).toMatchObject({ partnerId: 'p1', paymentId: 'pay-r1', status: 'needs_review', originalStatementId: 'stmt-apr' });
    expect(Number(db._created[0].commissionAmount)).toBe(6000);
  });

  it('creates for an approved period too (owner: approved∨paid closed)', async () => {
    const db = makeDb({
      refunds: [refundRow()],
      liveStatement: { id: 'stmt-apr', status: 'approved', periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30T23:59:59Z') },
    });
    expect(await detectLateRefundCorrections(db)).toBe(1);
  });

  it('skips a refund whose period is only draft (normal SP-1 negative line)', async () => {
    const db = makeDb({ refunds: [refundRow()], liveStatement: null });
    expect(await detectLateRefundCorrections(db)).toBe(0);
    expect(db.commissionCorrection.create).not.toHaveBeenCalled();
  });

  it('is idempotent: refunds already having a correction are excluded by the query', async () => {
    const db = makeDb({ refunds: [] });
    expect(await detectLateRefundCorrections(db)).toBe(0);
    const where = db.payment.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isRefund: true, commissionCorrection: { is: null } });
  });

  it('skips a refund with no resolvable partner', async () => {
    const db = makeDb({ refunds: [refundRow({ order: null, organization: { partnerId: null } })] });
    expect(await detectLateRefundCorrections(db)).toBe(0);
  });
});
