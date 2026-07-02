import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { detectLateRefundCorrections, listCorrectionQueue, resolveCorrection } from '@/lib/services/commission/corrections';

const dec = (n: number) => new Prisma.Decimal(n);

function makeDb(opts: { refunds: any[]; liveStatement?: any; rateChanges?: any[]; created?: any[] }) {
  const created = opts.created ?? [];
  return {
    payment: { findMany: vi.fn().mockResolvedValue(opts.refunds) },
    commissionStatement: { findFirst: vi.fn().mockResolvedValue(opts.liveStatement ?? null) },
    commissionRateChange: { findMany: vi.fn().mockResolvedValue(opts.rateChanges ?? []) },
    // F4: история org-override; пустая по умолчанию (fallback на текущее значение).
    organizationCommissionRateChange: { findMany: vi.fn().mockResolvedValue([]) },
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

// ── Task 4: listCorrectionQueue + resolveCorrection ──────────────────────────

const adminSession = { role: 'admin', sub: 'u-admin', companyId: null } as any;
const leaderSession = { role: 'manager', managerRole: 'leader', sub: 'u-leader', companyId: 'co-1' } as any;
const partnerSession = { role: 'partner', sub: 'u-p', companyId: null } as any;

describe('listCorrectionQueue', () => {
  it('partner is forbidden (returns empty)', async () => {
    const db = { commissionCorrection: { findMany: vi.fn() } } as any;
    expect(await listCorrectionQueue(db, partnerSession)).toEqual([]);
    expect(db.commissionCorrection.findMany).not.toHaveBeenCalled();
  });
  it('admin sees all needs_review (no company filter)', async () => {
    const db = { commissionCorrection: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    await listCorrectionQueue(db, adminSession);
    const where = db.commissionCorrection.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'needs_review' });
    expect(where.partner).toBeUndefined();
  });
  it('leader is scoped to own company partners', async () => {
    const db = { commissionCorrection: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    await listCorrectionQueue(db, leaderSession);
    const where = db.commissionCorrection.findMany.mock.calls[0][0].where;
    expect(where.partner).toMatchObject({ organizations: { some: { companyId: 'co-1' } } });
  });
});

describe('resolveCorrection', () => {
  function makeDb(existing: any) {
    return {
      commissionCorrection: {
        findUnique: vi.fn().mockResolvedValue(existing),
        findFirst: vi.fn().mockResolvedValue(existing),
      },
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn({
        commissionCorrection: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })),
    } as any;
  }
  it('apply: needs_review → applied', async () => {
    const r = await resolveCorrection(makeDb({ id: 'c1', status: 'needs_review', partnerId: 'p1' }), adminSession, { correctionId: 'c1', action: 'apply' });
    expect(r).toEqual({ ok: true });
  });
  it('waive requires a reason', async () => {
    const r = await resolveCorrection(makeDb({ id: 'c1', status: 'needs_review', partnerId: 'p1' }), adminSession, { correctionId: 'c1', action: 'waive', reason: '' });
    expect(r).toEqual({ ok: false, error: 'reason_required' });
  });
  it('partner forbidden', async () => {
    const r = await resolveCorrection(makeDb({ id: 'c1', status: 'needs_review', partnerId: 'p1' }), partnerSession, { correctionId: 'c1', action: 'apply' });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
  it('not needs_review → invalid_state', async () => {
    const r = await resolveCorrection(makeDb({ id: 'c1', status: 'applied', partnerId: 'p1' }), adminSession, { correctionId: 'c1', action: 'apply' });
    expect(r).toEqual({ ok: false, error: 'invalid_state' });
  });
  it('not found → not_found', async () => {
    const d = { commissionCorrection: { findUnique: vi.fn().mockResolvedValue(null) } } as any;
    const r = await resolveCorrection(d, adminSession, { correctionId: 'missing', action: 'apply' });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

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
