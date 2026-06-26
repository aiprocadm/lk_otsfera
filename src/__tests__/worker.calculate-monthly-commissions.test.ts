import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { SyncJobPayload } from '@/lib/jobs/types';

// Mock calculateStatementForPartner before importing processor
vi.mock('@/lib/services/commission/statement', () => ({
  calculateStatementForPartner: vi.fn()
}));

// Mock default prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {}
}));

// Mock partner notifier (C-02 fan-out)
vi.mock('@/lib/notifications/partner', () => ({
  notifyPartnerUsers: vi.fn()
}));

import { calculateMonthlyCommissionsProcessor } from '@/worker/processors/calculate-monthly-commissions';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { notifyPartnerUsers } from '@/lib/notifications/partner';

const mockCalc = calculateStatementForPartner as ReturnType<typeof vi.fn>;
const mockNotify = notifyPartnerUsers as ReturnType<typeof vi.fn>;

function statementFixture(over: Record<string, unknown> = {}) {
  return { id: 's1', periodFrom: new Date(2026, 4, 1), totalCommissionAmount: { toString: () => '125000' }, ...over };
}

function makeJob(id = 'job-1'): Job<SyncJobPayload> {
  return { id, data: { triggeredAt: new Date().toISOString(), reason: 'cron' } } as Job<SyncJobPayload>;
}

function makePrisma(partnerIds: { id: string }[]) {
  return {
    payment: {
      findMany: vi.fn().mockResolvedValue(
        partnerIds.map((p) => ({ order: { partnerId: p.id }, organization: { partnerId: null } }))
      ),
    },
    syncLog: { create: vi.fn().mockResolvedValue({}) },
  } as any;
}

beforeEach(() => {
  mockCalc.mockReset();
  mockNotify.mockReset();
  mockNotify.mockResolvedValue({ recipientsNotified: 1, emailsSent: 1, emailsSkipped: 0 });
});

describe('calculateMonthlyCommissionsProcessor', () => {
  it('processes each partner that has payments in the period', async () => {
    const db = makePrisma([{ id: 'p1' }, { id: 'p2' }]);
    mockCalc.mockResolvedValue({ statement: {}, itemCount: 5, isNew: true });
    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);
    expect(mockCalc).toHaveBeenCalledTimes(2);
    expect(result.partnersProcessed).toBe(2);
  });

  it('skips partner when itemCount=0 (no qualifying orders)', async () => {
    const db = makePrisma([{ id: 'p1' }, { id: 'p2' }]);
    mockCalc
      .mockResolvedValueOnce({ statement: {}, itemCount: 3, isNew: true })
      .mockResolvedValueOnce({ statement: {}, itemCount: 0, isNew: true });

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(result.partnersProcessed).toBe(1);
    expect(result.partnersSkipped).toBe(1);
  });

  it('captures errors per partner and continues with the rest', async () => {
    const db = makePrisma([{ id: 'p1' }, { id: 'p2' }]);
    mockCalc
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce({ statement: {}, itemCount: 2, isNew: true });

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(result.partnersProcessed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].partnerId).toBe('p1');
    expect(result.errors[0].error).toBe('DB timeout');
    // Partial failure surfaces durably as a syncLog 'warn' row.
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: 'commission',
        status: 'warn',
        errorMessage: expect.stringContaining('p1: DB timeout')
      })
    });
  });

  it('writes a syncLog error row when ALL partners fail', async () => {
    const db = makePrisma([{ id: 'p1' }, { id: 'p2' }]);
    mockCalc.mockRejectedValue(new Error('schema drift'));

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(result.errors).toHaveLength(2);
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: 'commission',
        status: 'error',
        errorMessage: expect.stringContaining('ALL failed')
      })
    });
  });

  it('returns periodFrom / periodTo as ISO strings', async () => {
    const db = makePrisma([]);
    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(typeof result.periodFrom).toBe('string');
    expect(typeof result.periodTo).toBe('string');
    // prev month: from should be the 1st of prev month
    const from = new Date(result.periodFrom);
    expect(from.getDate()).toBe(1);
  });

  it('passes calculatedByUserId=null to calculateStatementForPartner', async () => {
    const db = makePrisma([{ id: 'p1' }]);
    mockCalc.mockResolvedValue({ statement: statementFixture(), itemCount: 1, isNew: true });

    await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(mockCalc).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ partnerId: 'p1', calculatedByUserId: null })
    );
  });

  // C-02: cron is the system actor → it is the right place to tell the partner
  // a fresh statement is ready to review.
  it('notifies the partner when a NEW statement with items is created', async () => {
    const db = makePrisma([{ id: 'p1' }]);
    mockCalc.mockResolvedValue({ statement: statementFixture({ id: 's7' }), itemCount: 3, isNew: true });

    await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(mockNotify).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        partnerId: 'p1',
        type: 'commission_statement_ready',
        payload: expect.objectContaining({
          statementId: 's7',
          period: 'май 2026',
          // ru-RU groups thousands with a non-breaking space → match loosely.
          amount: expect.stringContaining('125')
        })
      })
    );
  });

  it('does NOT notify when the statement was an in-place update (isNew=false)', async () => {
    const db = makePrisma([{ id: 'p1' }]);
    mockCalc.mockResolvedValue({ statement: statementFixture(), itemCount: 3, isNew: false });

    await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('does NOT notify when there are no qualifying orders (itemCount=0)', async () => {
    const db = makePrisma([{ id: 'p1' }]);
    mockCalc.mockResolvedValue({ statement: statementFixture(), itemCount: 0, isNew: true });

    await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('a notify failure does not break the batch (best-effort fan-out)', async () => {
    const db = makePrisma([{ id: 'p1' }]);
    mockCalc.mockResolvedValue({ statement: statementFixture(), itemCount: 2, isNew: true });
    mockNotify.mockRejectedValue(new Error('redis down'));

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(result.partnersProcessed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  // Branch: allFailed = (partnersProcessed === 0 && partnersSkipped === 0) where
  // partnersSkipped !== 0. The `&&` short-circuits when partnersProcessed !== 0, but
  // when partnersProcessed === 0 we need partnersSkipped !== 0 for allFailed=false.
  it('writes syncLog warn (not error) when some partners fail and others are skipped (allFailed=false via skipped)', async () => {
    const db = makePrisma([{ id: 'p1' }, { id: 'p2' }]);
    mockCalc
      .mockRejectedValueOnce(new Error('timeout'))      // p1 fails
      .mockResolvedValueOnce({ statement: {}, itemCount: 0, isNew: true }); // p2 skipped

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    // partnersProcessed=0, partnersSkipped=1, errors=[p1]
    expect(result.partnersProcessed).toBe(0);
    expect(result.partnersSkipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    // status is 'warn', not 'error', because allFailed is false (skipped > 0)
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: 'commission', status: 'warn' })
    });
  });

  // Branch: the .catch(e => console.warn) callback on writeSyncLog — fires when
  // syncLog.create rejects after a per-partner failure (durable-log is best-effort).
  it('swallows syncLog write failure gracefully (writeSyncLog.catch branch)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = makePrisma([{ id: 'p1' }]);
    (db.syncLog.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('pg_down'));
    mockCalc.mockRejectedValue(new Error('partner_err'));

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    // The processor must NOT throw even when both the partner calc AND the syncLog write fail.
    expect(result.errors).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('calculate-monthly-commissions writeSyncLog'),
      expect.anything()
    );
    warnSpy.mockRestore();
  });

  // Branch: `err instanceof Error ? err.message : String(err)` FALSE path —
  // partner calc rejects with a non-Error value (plain string).
  it('stringifies non-Error partner calc rejection (String(err) branch in catch)', async () => {
    const db = makePrisma([{ id: 'p1' }]);
    // Reject with a string literal (not an Error) → instanceof Error = false → String(err)
    mockCalc.mockRejectedValue('plain-string-rejection');

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('plain-string-rejection');
  });

  // Branch: `e instanceof Error ? e.message : String(e)` FALSE path —
  // notify fan-out rejects with a non-Error value (plain string).
  it('stringifies non-Error notify rejection (String(e) branch in notify catch)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = makePrisma([{ id: 'p1' }]);
    mockCalc.mockResolvedValue({ statement: statementFixture(), itemCount: 2, isNew: true });
    // Reject with a string literal → instanceof Error = false → String(e)
    mockNotify.mockRejectedValue('notify-plain-string');

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    // The batch must still complete successfully despite the notify failure.
    expect(result.partnersProcessed).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('commission-ready notify failed'),
      expect.objectContaining({ error: 'notify-plain-string' })
    );
    warnSpy.mockRestore();
  });
});
