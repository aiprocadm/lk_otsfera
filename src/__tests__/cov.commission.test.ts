/**
 * Track E / E1 — coverage restoration for the commission domain.
 *
 * Targets the exact branches/lines that drifted below 100% after later tracks
 * merged. Style mirrors the module's existing tests:
 *   - services.commission.corrections.unit.test.ts  (mocked-prisma unit)
 *   - services.commission.lifecycle.unit.test.ts     (mocked-prisma unit)
 *   - services.commission.statement.unit.test.ts     (mocked-prisma unit)
 *   - worker.calculate-monthly-commissions.test.ts   (vi.mock deps)
 *   - services.commission.rateHistory.test.ts        (live Postgres)
 *
 * The rateHistory branch (dangling changedById → nameById.get() undefined) needs
 * a real row, so this file constructs `new PrismaClient()` and is integration-tier.
 * The remaining tests use plain mocked prisma objects and never touch the client.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import type { SyncJobPayload } from '@/lib/jobs/types';

const dec = (n: number | string) => new Prisma.Decimal(n);

// ─────────────────────────────────────────────────────────────────────────────
// Worker: mock the exact same deps the existing worker test mocks. Hoisted so the
// vi.mock factories can reference them, and imported below.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/services/commission/statement', () => ({
  calculateStatementForPartner: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/notifications/partner', () => ({ notifyPartnerUsers: vi.fn() }));
vi.mock('@/lib/services/commission/corrections', async (importOriginal) => {
  // Keep the REAL corrections module (this file also unit-tests it directly), but
  // override detectLateRefundCorrections with a spy so the worker can drive its
  // early best-effort branch without a DB.
  const actual = await importOriginal<typeof import('@/lib/services/commission/corrections')>();
  return { ...actual, detectLateRefundCorrections: vi.fn().mockResolvedValue(0) };
});

import { calculateMonthlyCommissionsProcessor } from '@/worker/processors/calculate-monthly-commissions';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { notifyPartnerUsers } from '@/lib/notifications/partner';
import {
  detectLateRefundCorrections,
  resolveCorrection,
  listCorrectionQueue,
} from '@/lib/services/commission/corrections';
import { approveStatement } from '@/lib/services/commission/lifecycle';
import { listRateHistory } from '@/lib/services/commission/rateHistory';

const mockCalc = calculateStatementForPartner as ReturnType<typeof vi.fn>;
const mockNotify = notifyPartnerUsers as ReturnType<typeof vi.fn>;
const mockDetect = detectLateRefundCorrections as ReturnType<typeof vi.fn>;

// The REAL detectLateRefundCorrections implementation (unmocked) for the direct
// corrections unit tests below. importActual bypasses the vi.mock override above.
let realDetect: typeof import('@/lib/services/commission/corrections').detectLateRefundCorrections;

beforeAll(async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/commission/corrections')>(
    '@/lib/services/commission/corrections'
  );
  realDetect = actual.detectLateRefundCorrections;
});

// ═════════════════════════════════════════════════════════════════════════════
// corrections.ts — detectLateRefundCorrections branches 64/65/68/81 + lines 82-83
// ═════════════════════════════════════════════════════════════════════════════

function makeDetectDb(opts: {
  refunds: any[];
  liveStatement?: any;
  rateChanges?: any[];
  orgChanges?: any[];
  partner?: any;
  createImpl?: (arg: any) => any;
}) {
  return {
    payment: { findMany: vi.fn().mockResolvedValue(opts.refunds) },
    commissionStatement: { findFirst: vi.fn().mockResolvedValue(opts.liveStatement ?? null) },
    commissionRateChange: { findMany: vi.fn().mockResolvedValue(opts.rateChanges ?? []) },
    organizationCommissionRateChange: {
      findMany: vi.fn().mockResolvedValue(opts.orgChanges ?? []),
    },
    commissionCorrection: {
      create: vi
        .fn()
        .mockImplementation(opts.createImpl ?? (({ data }: any) => ({ id: 'new', ...data }))),
    },
    partner: {
      findUnique: vi
        .fn()
        .mockResolvedValue('partner' in opts ? opts.partner : { commissionRate: dec(0.2) }),
    },
  } as any;
}

function liveStmt() {
  return {
    id: 'stmt-apr',
    status: 'paid' as const,
    periodFrom: new Date('2026-04-01'),
    periodTo: new Date('2026-04-30T23:59:59Z'),
  };
}

function refundRow(over: any = {}) {
  return {
    id: 'pay-r1',
    amount: dec(30000),
    paidAt: new Date('2026-04-20'),
    isRefund: true,
    orderId: 'o1',
    organizationId: 'org1',
    order: { partnerId: 'p1' },
    organization: { partnerId: 'p1', partnerCommissionRate: null },
    ...over,
  };
}

describe('detectLateRefundCorrections — stray branches', () => {
  it('branch@64/65 false side: org belongs to a DIFFERENT partner → override=null, orgChanges=[]', async () => {
    // partnerId resolves from order.partnerId='p1', but organization.partnerId='pOther'.
    // → line 64 ternary false (orgOverride=null), line 65 ternary false (orgChanges=[]).
    // Rate falls through to partner history / default (0.2). 30000 × 0.2 = 6000.
    const captured: any[] = [];
    const db = makeDetectDb({
      refunds: [
        refundRow({
          order: { partnerId: 'p1' },
          organization: { partnerId: 'pOther', partnerCommissionRate: dec(0.9) },
        }),
      ],
      liveStatement: liveStmt(),
      // A live orgChange that MUST be ignored (foreign org → empty list passed to resolver).
      orgChanges: [{ effectiveFrom: new Date('2026-01-01'), oldRate: null, newRate: dec(0.9) }],
      createImpl: ({ data }: any) => {
        captured.push(data);
        return { id: 'new', ...data };
      },
    });
    const n = await realDetect(db);
    expect(n).toBe(1);
    // Not 0.9 (foreign override ignored) → partner default 0.2 → 6000.
    expect(Number(captured[0].rate)).toBe(0.2);
    expect(Number(captured[0].commissionAmount)).toBe(6000);
  });

  it('branch@64 nullish (?? null): own org but partnerCommissionRate undefined → override null', async () => {
    // organization.partnerId === partnerId, but partnerCommissionRate is undefined →
    // the `?? null` arm of `r.organization?.partnerCommissionRate ?? null` fires.
    const captured: any[] = [];
    const db = makeDetectDb({
      refunds: [
        refundRow({
          order: { partnerId: 'p1' },
          organization: { partnerId: 'p1' }, // partnerCommissionRate omitted → undefined
        }),
      ],
      liveStatement: liveStmt(),
      createImpl: ({ data }: any) => {
        captured.push(data);
        return { id: 'new', ...data };
      },
    });
    const n = await realDetect(db);
    expect(n).toBe(1);
    // No override → partner default 0.2 → 6000.
    expect(Number(captured[0].rate)).toBe(0.2);
  });

  it('branch@68 (?? Decimal(0)): partner row missing → partnerDefault falls back to 0', async () => {
    // partner.findUnique → null (partner?.commissionRate is undefined), and no history,
    // no override → resolved rate is Decimal(0). commissionAmount = 30000 × 0 = 0.
    const captured: any[] = [];
    const db = makeDetectDb({
      refunds: [refundRow({ organization: { partnerId: 'p1', partnerCommissionRate: null } })],
      liveStatement: liveStmt(),
      partner: null,
      createImpl: ({ data }: any) => {
        captured.push(data);
        return { id: 'new', ...data };
      },
    });
    const n = await realDetect(db);
    expect(n).toBe(1);
    expect(Number(captured[0].rate)).toBe(0);
    expect(Number(captured[0].commissionAmount)).toBe(0);
  });

  it('lines 82-83 / branch@81 catch: P2002 on create is swallowed (idempotent, not counted)', async () => {
    // create throws a Prisma P2002 unique violation → caught, NOT rethrown, created not incremented.
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const db = makeDetectDb({
      refunds: [refundRow()],
      liveStatement: liveStmt(),
      createImpl: () => {
        throw p2002;
      },
    });
    const n = await realDetect(db);
    expect(n).toBe(0); // swallowed → nothing counted
  });

  it('lines 82 / branch@81 catch: a NON-P2002 error propagates unchanged', async () => {
    const other = Object.assign(new Error('connection reset'), { code: 'P1001' });
    const db = makeDetectDb({
      refunds: [refundRow()],
      liveStatement: liveStmt(),
      createImpl: () => {
        throw other;
      },
    });
    await expect(realDetect(db)).rejects.toThrow('connection reset');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// corrections.ts — listCorrectionQueue branch@107 + resolveCorrection 140/141-146/148
// ═════════════════════════════════════════════════════════════════════════════

const leaderNoCompany = {
  role: 'leader',
  sub: 'u-leader',
  companyId: undefined,
} as any;
const leaderSession = {
  role: 'leader',
  sub: 'u-leader',
  companyId: 'co-1',
} as any;
const adminSession = { role: 'admin', sub: 'u-admin', companyId: null } as any;

describe('listCorrectionQueue — branch@107 nullish', () => {
  it("leader with no companyId → scope falls back to '__none__' sentinel", async () => {
    const db = { commissionCorrection: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    await listCorrectionQueue(db, leaderNoCompany);
    const where = db.commissionCorrection.findMany.mock.calls[0][0].where;
    expect(where.partner).toMatchObject({ organizations: { some: { companyId: '__none__' } } });
  });
});

describe('resolveCorrection — leader-scope branch@140 + lines 141-146 + waive branch@148', () => {
  function makeResolveDb(existing: any, inScope: any) {
    return {
      commissionCorrection: {
        findUnique: vi.fn().mockResolvedValue(existing),
        findFirst: vi.fn().mockResolvedValue(inScope),
      },
      $transaction: vi.fn().mockImplementation(async (fn: any) =>
        fn({
          commissionCorrection: { update: vi.fn().mockResolvedValue({}) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        })
      ),
    } as any;
  }

  it('branch@140 true + lines 141-145: leader IN scope → applies (findFirst returns row)', async () => {
    const db = makeResolveDb({ id: 'c1', status: 'needs_review', partnerId: 'p1' }, { id: 'c1' });
    const r = await resolveCorrection(db, leaderSession, { correctionId: 'c1', action: 'apply' });
    expect(r).toEqual({ ok: true });
    // The leader-scope findFirst guard was consulted.
    expect(db.commissionCorrection.findFirst).toHaveBeenCalledOnce();
    const scopeWhere = db.commissionCorrection.findFirst.mock.calls[0][0].where;
    expect(scopeWhere.partner).toMatchObject({ organizations: { some: { companyId: 'co-1' } } });
  });

  it('line 146: leader OUT of scope → forbidden (findFirst returns null)', async () => {
    const db = makeResolveDb({ id: 'c1', status: 'needs_review', partnerId: 'p1' }, null);
    const r = await resolveCorrection(db, leaderSession, { correctionId: 'c1', action: 'apply' });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });

  it('branch@142 nullish: leader without companyId uses the __none__ sentinel in scope query', async () => {
    const db = makeResolveDb({ id: 'c1', status: 'needs_review', partnerId: 'p1' }, null);
    await resolveCorrection(db, leaderNoCompany, { correctionId: 'c1', action: 'apply' });
    const scopeWhere = db.commissionCorrection.findFirst.mock.calls[0][0].where;
    expect(scopeWhere.partner).toMatchObject({
      organizations: { some: { companyId: '__none__' } },
    });
  });

  it('branch@148 waive side: admin waive with reason → status waived', async () => {
    let updateArg: any;
    const db = {
      commissionCorrection: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'c1', status: 'needs_review', partnerId: 'p1' }),
        findFirst: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (fn: any) =>
        fn({
          commissionCorrection: {
            update: vi.fn().mockImplementation((a: any) => {
              updateArg = a;
              return {};
            }),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        })
      ),
    } as any;
    const r = await resolveCorrection(db, adminSession, {
      correctionId: 'c1',
      action: 'waive',
      reason: 'duplicate refund',
    });
    expect(r).toEqual({ ok: true });
    // action==='waive' → next = 'waived' (the ternary's false arm).
    expect(updateArg.data.status).toBe('waived');
    expect(updateArg.data.reason).toBe('duplicate refund');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// lifecycle.ts — approveStatement branch@67 (parentId ?? null when no truthy correctionId)
// ═════════════════════════════════════════════════════════════════════════════

describe('approveStatement — branch@67 parentId ?? null', () => {
  it('clamp remainder with only an empty-string correctionId → find() falsy → parentCorrectionId null', async () => {
    // hasCorrections is true because '' !== null, but lines.find((l)=>l.correctionId)
    // is falsy for '' → the `?? null` arm of parentId fires. Total is negative → clamp.
    const items = [
      { commissionAmount: dec('1000'), correctionId: null },
      { commissionAmount: dec('-5000'), correctionId: '' }, // '' !== null but falsy
    ];
    const created: any[] = [];
    const tx = {
      commissionStatement: { update: vi.fn().mockResolvedValue({ id: 's1', status: 'approved' }) },
      commissionStatementItem: { findMany: vi.fn().mockResolvedValue(items) },
      commissionCorrection: {
        create: vi.fn().mockImplementation(({ data }: any) => {
          created.push(data);
          return {};
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      commissionStatement: {
        findFirst: vi.fn().mockResolvedValue({
          id: 's1',
          status: 'draft',
          supersededBy: null,
          partnerId: 'p1',
          periodFrom: new Date('2026-05-01'),
          periodTo: new Date('2026-05-31'),
        }),
      },
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
    } as any;

    await approveStatement(db, { statementId: 's1', partnerId: 'p1', approvedByUserId: 'u1' });

    expect(created).toHaveLength(1);
    // raw = 1000 + (-5000) = -4000 → remainder 4000.
    expect(Number(created[0].commissionAmount)).toBe(4000);
    // parentId: find() over [null, ''] both falsy → undefined → ?? null.
    expect(created[0].parentCorrectionId).toBeNull();
  });
});

// statement.ts branch@302 (`if (!winner) throw err`) is an unreachable defensive
// guard after a P2002 (a concurrent writer always leaves a winner) → v8-ignored in
// source rather than faked here. This file also vi.mock's the statement module for
// the worker tests below, so the real function isn't callable here anyway.

// ═════════════════════════════════════════════════════════════════════════════
// worker calculate-monthly-commissions — lines 46-47, 86-88 + branches 44/45/67/84
// ═════════════════════════════════════════════════════════════════════════════

function makeJob(id = 'cov-job'): any {
  return { id, data: { triggeredAt: new Date().toISOString(), reason: 'cron' } as SyncJobPayload };
}

function makeWorkerPrisma(paymentRows: any[]) {
  return {
    payment: { findMany: vi.fn().mockResolvedValue(paymentRows) },
    syncLog: { create: vi.fn().mockResolvedValue({}) },
  } as any;
}

describe('calculateMonthlyCommissionsProcessor — cron + resolve branches', () => {
  beforeEach(() => {
    mockCalc.mockReset();
    mockNotify.mockReset();
    mockNotify.mockResolvedValue({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
    mockDetect.mockReset();
    mockDetect.mockResolvedValue(0);
  });

  it('branch@44 true: logs when detected > 0 (late-refund corrections found)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockDetect.mockResolvedValue(3); // detected > 0
    const db = makeWorkerPrisma([]);
    await calculateMonthlyCommissionsProcessor(makeJob(), db);
    expect(logSpy).toHaveBeenCalledWith(
      '[worker] late-refund corrections detected',
      expect.objectContaining({ detected: 3 })
    );
    logSpy.mockRestore();
  });

  it('lines 46-47 + branch@45 Error side: detect failure is swallowed (best-effort)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDetect.mockRejectedValue(new Error('detect boom'));
    const db = makeWorkerPrisma([]);
    // Batch still completes despite detect throwing.
    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);
    expect(result.partnersProcessed).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      '[worker] correction detection failed',
      expect.objectContaining({ error: 'detect boom' })
    );
    warnSpy.mockRestore();
  });

  it('branch@45 String(e) side: non-Error detect rejection is stringified', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDetect.mockRejectedValue('detect-plain-string'); // not an Error
    const db = makeWorkerPrisma([]);
    await calculateMonthlyCommissionsProcessor(makeJob(), db);
    expect(warnSpy).toHaveBeenCalledWith(
      '[worker] correction detection failed',
      expect.objectContaining({ error: 'detect-plain-string' })
    );
    warnSpy.mockRestore();
  });

  it('branch@67: partner resolved via organization fallback when order.partnerId is null', async () => {
    // Row A: order.partnerId null → falls back to organization.partnerId ('pOrg').
    // Row B: order null → organization.partnerId ('pNoOrder').
    const db = makeWorkerPrisma([
      { order: { partnerId: null }, organization: { partnerId: 'pOrg' } },
      { order: null, organization: { partnerId: 'pNoOrder' } },
    ]);
    mockCalc.mockResolvedValue({ ok: true, statement: {}, itemCount: 2, isNew: false });
    await calculateMonthlyCommissionsProcessor(makeJob(), db);
    const called = mockCalc.mock.calls.map((c) => c[1].partnerId).sort();
    expect(called).toEqual(['pNoOrder', 'pOrg']);
    expect(mockCalc).toHaveBeenCalledTimes(2);
  });

  it('branch@67 (?? null): a payment with no resolvable partner is dropped (not processed)', async () => {
    // order null AND organization null → pid null → not added to the set.
    const db = makeWorkerPrisma([
      { order: null, organization: null },
      { order: { partnerId: 'pOK' }, organization: { partnerId: null } },
    ]);
    mockCalc.mockResolvedValue({ ok: true, statement: {}, itemCount: 1, isNew: false });
    await calculateMonthlyCommissionsProcessor(makeJob(), db);
    // Only the resolvable partner is processed.
    expect(mockCalc).toHaveBeenCalledTimes(1);
    expect(mockCalc.mock.calls[0][1].partnerId).toBe('pOK');
  });

  it('lines 86-88 + branch@84 false: calc returns {ok:false} → error recorded, loop continues', async () => {
    const db = makeWorkerPrisma([
      { order: { partnerId: 'pGone' }, organization: { partnerId: null } },
      { order: { partnerId: 'pOK' }, organization: { partnerId: null } },
    ]);
    mockCalc
      .mockResolvedValueOnce({ ok: false, error: 'partner_not_found' }) // pGone (or pOK — order-dependent)
      .mockResolvedValueOnce({ ok: true, statement: {}, itemCount: 1, isNew: false });
    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);
    // One !ok error recorded, the other partner processed → batch continued.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('partner_not_found');
    expect(result.partnersProcessed).toBe(1);
    // Durable warn row written (partial failure).
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: 'commission', status: 'warn' }),
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// rateHistory.ts — branch@38 (nameById.get() undefined → ?? null) — LIVE Postgres
// A change row whose changedById points to a user that does not exist: the id is a
// plain nullable String (no FK), so the user-name map misses it → the `?? null` arm.
// ═════════════════════════════════════════════════════════════════════════════

describe('listRateHistory — branch@38 dangling changedById (integration)', () => {
  let prisma: PrismaClient;
  let partnerId: string;
  const STAMP = Date.now();

  beforeAll(async () => {
    prisma = new PrismaClient();
    const partner = await prisma.partner.create({
      data: { name: 'CovRateHistPartner-' + STAMP, commissionRate: 0.1 },
    });
    partnerId = partner.id;
    // changedById references a user id that is NOT in the users table → nameById miss.
    await prisma.commissionRateChange.create({
      data: {
        partnerId,
        oldRate: new Prisma.Decimal('0.10'),
        newRate: new Prisma.Decimal('0.20'),
        effectiveFrom: new Date('2026-02-01T00:00:00Z'),
        changedById: 'ghost-user-' + STAMP, // truthy, but no matching User row
      },
    });
  });

  afterAll(async () => {
    await prisma.commissionRateChange.deleteMany({ where: { partnerId } });
    await prisma.partner.deleteMany({ where: { id: partnerId } });
    await prisma.$disconnect();
  });

  it('resolves changedByName=null when changedById has no matching user (map miss)', async () => {
    const result = await listRateHistory(
      prisma,
      { sub: 'session-sub', role: 'admin' } as any,
      partnerId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    // changedById is truthy (so the `c.changedById ? ...` guard is TRUE) but the map
    // has no entry → `nameById.get(...) ?? null` yields null.
    expect(result.rows[0].changedByName).toBeNull();
  });
});
