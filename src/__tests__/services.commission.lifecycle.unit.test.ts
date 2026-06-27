/**
 * Unit tests for commission/lifecycle.ts — covers branches not reached in the
 * integration suite (mocked prisma, no live Postgres required).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { approveStatement, markStatementPaid } from '@/lib/services/commission/lifecycle';

beforeEach(() => { recordAudit.mockClear(); });

function makePrismaForApprove({
  statement = null as { id: string; status: string; supersededBy: string | null; partnerId?: string; periodFrom?: Date; periodTo?: Date } | null,
} = {}) {
  const updated = { id: statement?.id ?? 's1', status: 'approved' };
  const tx = {
    commissionStatement: { update: vi.fn().mockResolvedValue(updated) },
    commissionStatementItem: { findMany: vi.fn().mockResolvedValue([]) },
    commissionCorrection: { create: vi.fn() },
  };
  return {
    commissionStatement: {
      findFirst: vi.fn().mockResolvedValue(statement),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

function makePrismaForPaid({
  payer = null as { role: string } | null,
  statement = null as { id: string; status: string; supersededBy: string | null; partnerId: string } | null,
} = {}) {
  const updated = { id: statement?.id ?? 's1', status: 'paid', paidAt: new Date() };
  const tx = {
    commissionStatement: { update: vi.fn().mockResolvedValue(updated) },
  };
  return {
    user: { findUnique: vi.fn().mockResolvedValue(payer) },
    commissionStatement: { findUnique: vi.fn().mockResolvedValue(statement) },
    $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

describe('approveStatement — unit', () => {
  it('throws NOT_FOUND when statement not found (wrong partnerId)', async () => {
    const db = makePrismaForApprove({ statement: null });
    await expect(
      approveStatement(db as never, { statementId: 's-missing', partnerId: 'p1', approvedByUserId: 'u1' })
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('throws LIFECYCLE_VIOLATION when statement is superseded', async () => {
    const db = makePrismaForApprove({
      statement: { id: 's1', status: 'draft', supersededBy: 's2', partnerId: 'p1', periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31') },
    });
    await expect(
      approveStatement(db as never, { statementId: 's1', partnerId: 'p1', approvedByUserId: 'u1' })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION.*superseded/);
  });

  it('throws LIFECYCLE_VIOLATION when status is not draft (e.g. approved)', async () => {
    const db = makePrismaForApprove({
      statement: { id: 's1', status: 'approved', supersededBy: null, partnerId: 'p1', periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31') },
    });
    await expect(
      approveStatement(db as never, { statementId: 's1', partnerId: 'p1', approvedByUserId: 'u1' })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION.*status=approved/);
  });

  it('throws LIFECYCLE_VIOLATION when status is paid', async () => {
    const db = makePrismaForApprove({
      statement: { id: 's1', status: 'paid', supersededBy: null, partnerId: 'p1', periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31') },
    });
    await expect(
      approveStatement(db as never, { statementId: 's1', partnerId: 'p1', approvedByUserId: 'u1' })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });

  it('transitions draft → approved and records audit', async () => {
    const db = makePrismaForApprove({
      statement: { id: 's1', status: 'draft', supersededBy: null, partnerId: 'p1', periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31') },
    });
    const result = await approveStatement(db as never, {
      statementId: 's1',
      partnerId: 'p1',
      approvedByUserId: 'u-partner',
    });
    expect(result.status).toBe('approved');
    expect(recordAudit).toHaveBeenCalledOnce();
    expect(recordAudit.mock.calls[0][1]).toMatchObject({
      action: 'commission_statement_approved',
      userId: 'u-partner',
    });
  });

  it('A6: approve materialises a chained remainder correction when clamped', async () => {
    const items = [
      { commissionAmount: new Prisma.Decimal('1000'), correctionId: null },
      { commissionAmount: new Prisma.Decimal('-5000'), correctionId: 'corr-1' },
    ];
    const created: any[] = [];
    const tx = {
      commissionStatement: { update: vi.fn().mockResolvedValue({ id: 's1', status: 'approved' }) },
      commissionStatementItem: { findMany: vi.fn().mockResolvedValue(items) },
      commissionCorrection: { create: vi.fn().mockImplementation(({ data }: any) => { created.push(data); return {}; }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      commissionStatement: { findFirst: vi.fn().mockResolvedValue({ id: 's1', status: 'draft', supersededBy: null, partnerId: 'p1', periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31') }) },
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
    } as any;

    await approveStatement(db, { statementId: 's1', partnerId: 'p1', approvedByUserId: 'u1' });

    expect(created).toHaveLength(1);
    expect(Number(created[0].commissionAmount)).toBe(4000);
    expect(created[0].status).toBe('applied');
    expect(created[0].paymentId).toBeNull();
    expect(created[0].parentCorrectionId).toBe('corr-1');
  });

  it('A6: approve with no clamp creates no chain correction', async () => {
    const items = [
      { commissionAmount: new Prisma.Decimal('50000'), correctionId: null },
      { commissionAmount: new Prisma.Decimal('-6000'), correctionId: 'corr-1' },
    ];
    const tx = {
      commissionStatement: { update: vi.fn().mockResolvedValue({ id: 's1', status: 'approved' }) },
      commissionStatementItem: { findMany: vi.fn().mockResolvedValue(items) },
      commissionCorrection: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      commissionStatement: { findFirst: vi.fn().mockResolvedValue({ id: 's1', status: 'draft', supersededBy: null, partnerId: 'p1', periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31') }) },
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
    } as any;
    await approveStatement(db, { statementId: 's1', partnerId: 'p1', approvedByUserId: 'u1' });
    expect(tx.commissionCorrection.create).not.toHaveBeenCalled();
  });

  it('A6: approve with no correction lines creates no chain correction', async () => {
    const items = [{ commissionAmount: new Prisma.Decimal('-100'), correctionId: null }];
    const tx = {
      commissionStatement: { update: vi.fn().mockResolvedValue({ id: 's1', status: 'approved' }) },
      commissionStatementItem: { findMany: vi.fn().mockResolvedValue(items) },
      commissionCorrection: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      commissionStatement: { findFirst: vi.fn().mockResolvedValue({ id: 's1', status: 'draft', supersededBy: null, partnerId: 'p1', periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31') }) },
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
    } as any;
    await approveStatement(db, { statementId: 's1', partnerId: 'p1', approvedByUserId: 'u1' });
    expect(tx.commissionCorrection.create).not.toHaveBeenCalled();
  });
});

describe('markStatementPaid — unit', () => {
  it('throws FORBIDDEN when payer user not found', async () => {
    const db = makePrismaForPaid({ payer: null, statement: null });
    await expect(
      markStatementPaid(db as never, { statementId: 's1', paidByUserId: 'u-missing' })
    ).rejects.toThrow(/FORBIDDEN.*not found/);
  });

  it('throws FORBIDDEN when payer is not an admin (e.g. partner)', async () => {
    const db = makePrismaForPaid({ payer: { role: 'partner' }, statement: null });
    await expect(
      markStatementPaid(db as never, { statementId: 's1', paidByUserId: 'u-partner' })
    ).rejects.toThrow(/FORBIDDEN.*admin/);
  });

  it('throws NOT_FOUND when statement not found', async () => {
    const db = makePrismaForPaid({ payer: { role: 'admin' }, statement: null });
    await expect(
      markStatementPaid(db as never, { statementId: 's-missing', paidByUserId: 'u-admin' })
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('throws LIFECYCLE_VIOLATION when statement is superseded', async () => {
    const db = makePrismaForPaid({
      payer: { role: 'admin' },
      statement: { id: 's1', status: 'approved', supersededBy: 's2', partnerId: 'p1' },
    });
    await expect(
      markStatementPaid(db as never, { statementId: 's1', paidByUserId: 'u-admin' })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION.*superseded/);
  });

  it('throws LIFECYCLE_VIOLATION when status is not approved (e.g. draft)', async () => {
    const db = makePrismaForPaid({
      payer: { role: 'admin' },
      statement: { id: 's1', status: 'draft', supersededBy: null, partnerId: 'p1' },
    });
    await expect(
      markStatementPaid(db as never, { statementId: 's1', paidByUserId: 'u-admin' })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION.*draft/);
  });

  it('transitions approved → paid and records audit', async () => {
    const db = makePrismaForPaid({
      payer: { role: 'admin' },
      statement: { id: 's1', status: 'approved', supersededBy: null, partnerId: 'p1' },
    });
    const result = await markStatementPaid(db as never, {
      statementId: 's1',
      paidByUserId: 'u-admin',
    });
    expect(result.status).toBe('paid');
    expect(recordAudit).toHaveBeenCalledOnce();
    expect(recordAudit.mock.calls[0][1]).toMatchObject({
      action: 'commission_statement_paid',
      userId: 'u-admin',
    });
  });

  it('uses provided paidAt date', async () => {
    const customDate = new Date('2026-05-15T10:00:00Z');
    const db = makePrismaForPaid({
      payer: { role: 'admin' },
      statement: { id: 's1', status: 'approved', supersededBy: null, partnerId: 'p1' },
    });
    await markStatementPaid(db as never, {
      statementId: 's1',
      paidByUserId: 'u-admin',
      paidAt: customDate,
    });
    const updateCall = db._tx.commissionStatement.update.mock.calls[0][0];
    expect(updateCall.data.paidAt).toEqual(customDate);
  });
});
