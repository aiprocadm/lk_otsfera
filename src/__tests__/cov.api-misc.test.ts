import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Track E / E1 — coverage top-up for thin API routes + a couple of small
// service branches. Structure:
//   §A  admin/training-directions routes (mapErr default + guard-fail branches)
//   §B  manager/certificates route (validUntil truthy branches on both paths)
//   §C  manager/leads/[id] route (assign/reject !ok branches)
//   §D  manager/order-items/[id] route (duplicate_position 409 + default 400)
//   §E  enrollments/[id] route (reject !ok branch)
//   §F  documents/upload route (deliverNotificationToUser throws — line 160-166 edge)
//   §G  oneCSync/pending replay (500-cap warn, invalid-DTO dead-letter,
//        dto-not-in-batch continue, non-Error throw → 'replay_threw')
//   §H  organization/finance (enteredBy present → left side of ?? — INTEGRATION)
//   §I  organization/team (APP_URL env branch in getAppBaseUrl — INTEGRATION)
//
// The route/pending sections mirror the mock style of the existing exemplars
// (api.admin.trainingDirections / api.manager.orderItems / api.manager.leads /
// api.enrollments / documents.route / oneCSync.pending.unit). §H/§I use a real
// PrismaClient (the injected `prisma` arg — module singleton stays mocked, which
// is harmless since those services never touch it).
// ─────────────────────────────────────────────────────────────────────────────

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { requireSession, requireAdmin, requireRole } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireAdmin: vi.fn(),
  requireRole: vi.fn(),
}));
const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));

const { createDirection, listDirections, updateDirection, deactivateDirection } = vi.hoisted(
  () => ({
    createDirection: vi.fn(),
    listDirections: vi.fn(),
    updateDirection: vi.fn(),
    deactivateDirection: vi.fn(),
  })
);
const { createCertificate, issueFromOrderItem } = vi.hoisted(() => ({
  createCertificate: vi.fn(),
  issueFromOrderItem: vi.fn(),
}));
const { updateItemStatus, removeOrderItem } = vi.hoisted(() => ({
  updateItemStatus: vi.fn(),
  removeOrderItem: vi.fn(),
}));
const { getManagerLead, assignLead, setLeadStatus, promoteLead, rejectLead } = vi.hoisted(() => ({
  getManagerLead: vi.fn(),
  assignLead: vi.fn(),
  setLeadStatus: vi.fn(),
  promoteLead: vi.fn(),
  rejectLead: vi.fn(),
}));
const { canReviewEnrollments, approveEnrollment, rejectEnrollment, markProvisioned } = vi.hoisted(
  () => ({
    canReviewEnrollments: vi.fn(),
    approveEnrollment: vi.fn(),
    rejectEnrollment: vi.fn(),
    markProvisioned: vi.fn(),
  })
);
const {
  orderFindUnique,
  orgFindFirst,
  docCreate,
  auditCreate,
  canReadOrder,
  upload,
  enqueueAdd,
  notifyDocumentCreated,
  deliverNotificationToUser,
  getPrimaryOrganizationId,
} = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  orgFindFirst: vi.fn(),
  docCreate: vi.fn(),
  auditCreate: vi.fn(),
  canReadOrder: vi.fn(),
  upload: vi.fn(),
  enqueueAdd: vi.fn(),
  notifyDocumentCreated: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  getPrimaryOrganizationId: vi.fn(),
}));
const { upsertPaymentRecord } = vi.hoisted(() => ({ upsertPaymentRecord: vi.fn() }));

// Guards / auth
vi.mock('@/lib/auth/guard', () => ({
  requireSession,
  requireAdmin,
  requireRole,
  forbiddenResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/auth/policy', () => ({ canReadOrder }));
vi.mock('@/lib/auth/organization', () => ({ getPrimaryOrganizationId }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

// Unified prisma module singleton: the service-mocked routes ignore its
// internals; only documents/upload reaches into it directly.
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique },
    organization: { findFirst: orgFindFirst },
    document: { create: docCreate },
    auditLog: { create: auditCreate },
  },
}));

// Services (mocked so routes only map result → HTTP)
vi.mock('@/lib/services/training', () => ({
  createDirection,
  listDirections,
  updateDirection,
  deactivateDirection,
}));
vi.mock('@/lib/services/training/certificates', () => ({ createCertificate, issueFromOrderItem }));
vi.mock('@/lib/services/training/orderItems', () => ({ updateItemStatus, removeOrderItem }));
vi.mock('@/lib/services/manager/leads', () => ({ getManagerLead }));
vi.mock('@/lib/services/manager/leadLifecycle', () => ({
  assignLead,
  setLeadStatus,
  promoteLead,
  rejectLead,
}));
vi.mock('@/lib/services/enrollments/policy', () => ({ canReviewEnrollments }));
vi.mock('@/lib/services/enrollments/lifecycle', () => ({
  approveEnrollment,
  rejectEnrollment,
  markProvisioned,
}));

// documents/upload infra
vi.mock('@/lib/notifications', () => ({ notifyDocumentCreated, deliverNotificationToUser }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload,
    createSignedUrl: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }),
}));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: enqueueAdd }),
  QUEUE_NAMES: ['docs.scanDocument'],
}));

// oneCSync writers (replay dispatches to these)
vi.mock('@/lib/services/oneCSync/writers', () => ({
  upsertOrgRecord: vi.fn(),
  upsertOrderRecord: vi.fn(),
  upsertPaymentRecord,
  upsertDocumentRecord: vi.fn(),
}));

// ── imports under test (after mocks) ─────────────────────────────────────────
import { GET as dirGet, POST as dirPost } from '@/app/api/admin/training-directions/route';
import {
  PATCH as dirPatch,
  DELETE as dirDelete,
} from '@/app/api/admin/training-directions/[id]/route';
import { POST as certPost } from '@/app/api/manager/certificates/route';
import { PATCH as itemPatch, DELETE as itemDelete } from '@/app/api/manager/order-items/[id]/route';
import { PATCH as leadPatch } from '@/app/api/manager/leads/[id]/route';
import { PATCH as enrollPatch } from '@/app/api/enrollments/[id]/route';
import { POST as uploadPost } from '@/app/api/documents/upload/route';
import { replayPendingRecords } from '@/lib/services/oneCSync/pending';
import { getOrgFinanceKpis, listOrgPayments } from '@/lib/services/organization/finance';
import { inviteMember } from '@/lib/services/organization/team';

const adminSession = { sub: 'admin-1', role: 'admin', partnerId: null } as never;
const managerSession = { sub: 'm1', role: 'manager', companyId: 'c1' } as never;
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const routeCtx = { params: Promise.resolve({}) };
const patchReq = (body: unknown) =>
  new Request('http://x/', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

// ── §A admin/training-directions ─────────────────────────────────────────────

describe('§A admin/training-directions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireAdmin.mockReturnValue({ ok: true, value: adminSession });
  });

  it('GET → 400 when service returns an unmapped error (mapErr default branch)', async () => {
    listDirections.mockResolvedValue({ ok: false, error: 'boom' });
    const res = await dirGet(new Request('http://x'), routeCtx);
    expect(res.status).toBe(400); // covers route.ts:19 !ok + mapErr default
  });

  it('GET → 404 when service returns not_found (mapErr not_found branch)', async () => {
    listDirections.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await dirGet(new Request('http://x'), routeCtx);
    expect(res.status).toBe(404); // covers route.ts:8 not_found true-branch
  });

  it('POST → 403 when requireAdmin fails (guard branch @27)', async () => {
    requireAdmin.mockReturnValue({
      ok: false,
      response: new Response('Forbidden', { status: 403 }),
    });
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'X' }) });
    const res = await dirPost(req as Request, routeCtx);
    expect(res.status).toBe(403);
    expect(createDirection).not.toHaveBeenCalled();
  });

  it('PATCH → 401 when session missing (guard branch @16)', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: new Response('Unauthorized', { status: 401 }),
    });
    const res = await dirPatch(patchReq({ name: 'X' }) as Request, idCtx('d1'));
    expect(res.status).toBe(401);
    expect(updateDirection).not.toHaveBeenCalled();
  });

  it('PATCH → 403 when requireAdmin fails (guard branch @18)', async () => {
    requireAdmin.mockReturnValue({
      ok: false,
      response: new Response('Forbidden', { status: 403 }),
    });
    const res = await dirPatch(patchReq({ name: 'X' }) as Request, idCtx('d1'));
    expect(res.status).toBe(403);
    expect(updateDirection).not.toHaveBeenCalled();
  });

  it('PATCH → 400 when service returns an unmapped error ([id] mapErr default lines 9-10)', async () => {
    updateDirection.mockResolvedValue({ ok: false, error: 'validation' });
    const res = await dirPatch(patchReq({ name: '' }) as Request, idCtx('d1'));
    expect(res.status).toBe(400);
  });

  it('DELETE → 403 when requireAdmin fails (guard branch @35)', async () => {
    requireAdmin.mockReturnValue({
      ok: false,
      response: new Response('Forbidden', { status: 403 }),
    });
    const res = await dirDelete(
      new Request('http://x', { method: 'DELETE' }) as Request,
      idCtx('d1')
    );
    expect(res.status).toBe(403);
    expect(deactivateDirection).not.toHaveBeenCalled();
  });
});

// ── §B manager/certificates — validUntil truthy branches ─────────────────────

describe('§B manager/certificates validUntil truthy branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue(managerSession);
    notFoundIfDisabled.mockReturnValue(undefined as never);
  });

  it('issueFromOrderItem receives a parsed Date when validUntil is present (line 36 truthy)', async () => {
    issueFromOrderItem.mockResolvedValue({ ok: true, certificate: { id: 'c1' } });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        orderItemId: 'oi1',
        number: 'N',
        issuedAt: '2026-01-01',
        validUntil: '2027-01-01',
      }),
    });
    const res = await certPost(req as never);
    expect(res.status).toBe(201);
    const arg = issueFromOrderItem.mock.calls[0][2] as { validUntil: Date | null };
    expect(arg.validUntil).toBeInstanceOf(Date);
    expect(arg.validUntil?.toISOString()).toBe(new Date('2027-01-01').toISOString());
  });

  it('createCertificate receives a parsed Date when validUntil is present (line 52 truthy)', async () => {
    createCertificate.mockResolvedValue({ ok: true, certificate: { id: 'c2' } });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        studentId: 's1',
        directionId: 'd1',
        number: 'N',
        issuedAt: '2026-01-01',
        validUntil: '2027-06-01',
      }),
    });
    const res = await certPost(req as never);
    expect(res.status).toBe(201);
    const arg = createCertificate.mock.calls[0][2] as { validUntil: Date | null };
    expect(arg.validUntil).toBeInstanceOf(Date);
  });
});

// ── §C manager/leads/[id] — assign/reject !ok branches ───────────────────────

describe('§C manager/leads/[id] failing lifecycle results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue(managerSession);
    notFoundIfDisabled.mockReturnValue(undefined as never);
  });

  it('assign → 404 when service returns not_found (branch @35)', async () => {
    assignLead.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await leadPatch(patchReq({ action: 'assign' }), idCtx('L1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('reject → 409 when service returns lifecycle_violation (branch @50)', async () => {
    rejectLead.mockResolvedValue({ ok: false, error: 'lifecycle_violation' });
    const res = await leadPatch(patchReq({ action: 'reject', reason: 'x' }), idCtx('L1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lifecycle_violation' });
  });
});

// ── §D manager/order-items/[id] — 409 + default 400 ──────────────────────────

describe('§D manager/order-items/[id] mapError branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManager.mockResolvedValue(managerSession);
    notFoundIfDisabled.mockReturnValue(undefined as never);
  });

  it('PATCH → 409 on duplicate_position (case @12)', async () => {
    updateItemStatus.mockResolvedValue({ ok: false, error: 'duplicate_position' });
    const res = await itemPatch(patchReq({ trainingStatus: 'completed' }), idCtx('it1'));
    expect(res.status).toBe(409);
  });

  it('PATCH → 400 on student_mismatch (default @13)', async () => {
    updateItemStatus.mockResolvedValue({ ok: false, error: 'student_mismatch' });
    const res = await itemPatch(patchReq({ trainingStatus: 'completed' }), idCtx('it1'));
    expect(res.status).toBe(400);
  });

  it('DELETE → 400 on direction_inactive (default @13, DELETE path)', async () => {
    removeOrderItem.mockResolvedValue({ ok: false, error: 'direction_inactive' });
    const res = await itemDelete(
      new Request('http://x', { method: 'DELETE' }) as never,
      idCtx('it1')
    );
    expect(res.status).toBe(400);
  });
});

// ── §E enrollments/[id] — reject !ok branch ──────────────────────────────────

describe('§E enrollments/[id] reject failing result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notFoundIfDisabled.mockReturnValue(null as never);
    getSession.mockResolvedValue({ sub: 'm', role: 'manager' } as never);
    canReviewEnrollments.mockReturnValue(true);
  });

  it('reject → 404 when lifecycle returns not_found (branch @32)', async () => {
    rejectEnrollment.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await enrollPatch(patchReq({ action: 'reject', reason: 'no' }), idCtx('E1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

// ── §F documents/upload — deliverNotificationToUser throws (line 160-166 edge) ─

describe('§F documents/upload fan-out: deliver throws after notify succeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    orderFindUnique.mockResolvedValue({ id: 'ord1', companyId: 'c1', organizationId: 'o1' });
    orgFindFirst.mockResolvedValue({ id: 'o1', partnerId: 'p1' });
    canReadOrder.mockResolvedValue(true);
    upload.mockResolvedValue(undefined);
    enqueueAdd.mockResolvedValue(undefined);
    docCreate.mockResolvedValue({
      id: 'd1',
      name: 'good.pdf',
      mimeType: 'application/pdf',
      createdAt: new Date(),
    });
    auditCreate.mockResolvedValue({});
    getPrimaryOrganizationId.mockResolvedValue('o1');
    // notify SUCCEEDS (so the try-block reaches deliverNotificationToUser at line 160)
    notifyDocumentCreated.mockResolvedValue({ id: 'notif-row-1' });
  });

  it('still returns 200 when deliverNotificationToUser rejects (throw edge from line 160-166)', async () => {
    deliverNotificationToUser.mockRejectedValueOnce(new Error('delivery channel down'));
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(
      new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd })
    );
    expect(res.status).toBe(200);
    // notify DID run (row.id consumed as dedupKey at line 165 before the throw)
    expect(notifyDocumentCreated).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'notif-row-1', type: 'document_created' })
    );
  });
});

// ── §G oneCSync/pending replay — remaining branches ──────────────────────────

function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pr1',
    entity: 'payment',
    externalId: 'P1',
    dto: {
      externalId: 'P1',
      amount: 1,
      paidAt: '2026-06-01T00:00:00Z',
      isRefund: false,
      organizationInn: '77',
      updatedAt: '2026-06-01T00:00:00Z',
    },
    reason: 'organization_not_found',
    attempts: 0,
    status: 'pending',
    firstSeenAt: new Date('2026-06-20T00:00:00Z'),
    lastTriedAt: new Date('2026-06-20T00:00:00Z'),
    ...over,
  };
}

describe('§G oneCSync replayPendingRecords remaining branches', () => {
  beforeEach(() => {
    upsertPaymentRecord.mockReset();
  });

  it('warns and processes when findMany returns exactly the 500-row cap (lines 79-80, branch @78)', async () => {
    // 500 identical-shape rows with unique ids so update targets are distinct.
    const rows = Array.from({ length: 500 }, (_, i) => pendingRow({ id: `pr-${i}`, attempts: 0 }));
    // Writer keeps skipping (transient) → each row stays pending; exercises the cap warn once.
    upsertPaymentRecord.mockImplementation(
      async (
        _db: unknown,
        _dto: unknown,
        sum: { skipped: number; skips: Array<{ externalId: string; reason: string }> }
      ) => {
        sum.skipped += 1;
        sum.skips.push({ externalId: 'P1', reason: 'organization_not_found' });
      }
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const findMany = vi.fn().mockResolvedValue(rows);
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: vi.fn(), update } } as never;
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-21T00:00:00Z'),
      maxAttempts: 50,
      maxAgeDays: 7,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('500-row cap'), 'payment');
    expect(res.stillPending).toBe(500);
    warnSpy.mockRestore();
  });

  it('dead-letters a row whose stored DTO fails schema validation (lines 90-92, branch @89)', async () => {
    // dto is structurally invalid for OneCPaymentSchema → safeParse fails.
    const findMany = vi.fn().mockResolvedValue([pendingRow({ dto: { garbage: true } })]);
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: vi.fn(), update } } as never;
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-21T00:00:00Z'),
      maxAttempts: 50,
      maxAgeDays: 7,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: { attempts: 1, status: 'dead', reason: 'invalid_stored_dto' },
    });
    expect(upsertPaymentRecord).not.toHaveBeenCalled(); // parse failed before write
    expect(res).toMatchObject({ resolved: 0, deadLettered: 1, stillPending: 0 });
  });

  it('uses reason "replay_threw" when the writer throws a non-Error (branch @101)', async () => {
    // Throwing a plain string exercises the `: 'replay_threw'` side of the ternary.
    upsertPaymentRecord.mockImplementation(async () => {
      throw 'not-an-error-object';
    });
    const findMany = vi.fn().mockResolvedValue([pendingRow({ attempts: 2 })]);
    const update = vi.fn().mockResolvedValue({});
    const del = vi.fn();
    const db = { oneCPendingRecord: { findMany, delete: del, update } } as never;
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-21T00:00:00Z'),
      maxAttempts: 50,
      maxAgeDays: 7,
    });
    // thrown, below cap, transient-treated (no skip) → stays pending, reason = replay_threw
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: { attempts: 3, reason: 'replay_threw' },
    });
    expect(del).not.toHaveBeenCalled();
    expect(res).toMatchObject({ resolved: 0, deadLettered: 0, stillPending: 1 });
  });
});

// ── §H organization/finance — enteredBy present (INTEGRATION) ─────────────────

describe('§H organization/finance enteredByName present', () => {
  let prisma: PrismaClient;
  let partnerId: string;
  let companyId: string;
  let orgId: string;
  let enteredByUserId: string;
  const STAMP = Date.now();

  beforeAll(async () => {
    prisma = new PrismaClient();
    const partner = await prisma.partner.create({
      data: { name: `CovFinP-${STAMP}`, commissionRate: new Prisma.Decimal('0.1') },
    });
    partnerId = partner.id;
    const company = await prisma.company.create({ data: { name: `CovFinC-${STAMP}` } });
    companyId = company.id;
    const org = await prisma.organization.create({
      data: { name: `CovFinOrg-${STAMP}`, partnerId, companyId },
    });
    orgId = org.id;
    const u = await prisma.user.create({
      data: {
        email: `cov-fin-actor-${STAMP}@t.local`,
        name: 'Payment Clerk',
        role: 'admin',
        passwordHash: 'x',
      },
    });
    enteredByUserId = u.id;
    await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: null,
        amount: new Prisma.Decimal('7777'),
        paidAt: new Date('2026-05-30'),
        method: 'bank',
        enteredById: enteredByUserId,
      },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.partner.deleteMany({ where: { id: partnerId } });
    await prisma.user.deleteMany({ where: { id: enteredByUserId } });
    await prisma.$disconnect();
  });

  it('surfaces enteredBy.name (left side of ?? — finance.ts:79)', async () => {
    const rows = await listOrgPayments(prisma, { organizationId: orgId });
    const row = rows.find((r) => r.amount === '7777.00');
    expect(row).toBeDefined();
    expect(row?.enteredByName).toBe('Payment Clerk'); // NOT null → ?? right side untaken
  });

  it('getOrgFinanceKpis returns zeroed KPIs when no billed orders exist (sanity)', async () => {
    const k = await getOrgFinanceKpis(prisma, orgId);
    expect(k.billed).toBe('0.00');
    expect(k.paid).toBe('0.00');
  });
});

// ── §I organization/team — getAppBaseUrl env branch (INTEGRATION) ─────────────

describe('§I organization/team getAppBaseUrl APP_URL branch', () => {
  let prisma: PrismaClient;
  let partnerId: string;
  let companyId: string;
  let orgId: string;
  let actorUserId: string;
  const STAMP = Date.now();
  let savedAppUrl: string | undefined;

  beforeAll(async () => {
    prisma = new PrismaClient();
    savedAppUrl = process.env.APP_URL;
    const partner = await prisma.partner.create({
      data: { name: `CovTeamP-${STAMP}`, commissionRate: new Prisma.Decimal('0.1') },
    });
    partnerId = partner.id;
    const company = await prisma.company.create({ data: { name: `CovTeamC-${STAMP}` } });
    companyId = company.id;
    const org = await prisma.organization.create({
      data: { name: `CovTeamOrg-${STAMP}`, partnerId, companyId },
    });
    orgId = org.id;
    const actor = await prisma.user.create({
      data: {
        email: `cov-team-actor-${STAMP}@t.local`,
        name: 'Actor',
        role: 'organization',
        passwordHash: 'x',
      },
    });
    actorUserId = actor.id;
    await prisma.organizationUser.create({
      data: { organizationId: orgId, userId: actorUserId, roleInOrg: 'admin', isActive: true },
    });
  });

  afterAll(async () => {
    if (savedAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = savedAppUrl;
    const testUsers = await prisma.user.findMany({
      where: { email: { contains: 'cov-team-' } },
      select: { id: true },
    });
    const userIds = testUsers.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { entity: 'organization_user' } });
    if (userIds.length) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.partner.deleteMany({ where: { id: partnerId } });
    await prisma.$disconnect();
  });

  it('uses APP_URL when set (left side of || — team.ts:55)', async () => {
    process.env.APP_URL = 'https://custom.example.test';
    const res = await inviteMember(
      prisma,
      {
        organizationId: orgId,
        email: `cov-team-inv1-${Date.now()}@t.local`,
        name: 'Inv One',
        roleInOrg: 'member',
      },
      actorUserId
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.inviteUrl).toMatch(/^https:\/\/custom\.example\.test\/reset-password\?token=/);
  });

  it('falls back to the default host when APP_URL is empty (right side of || — team.ts:55)', async () => {
    process.env.APP_URL = '   '; // whitespace → trim() is falsy → fallback
    const res = await inviteMember(
      prisma,
      {
        organizationId: orgId,
        email: `cov-team-inv2-${Date.now()}@t.local`,
        name: 'Inv Two',
        roleInOrg: 'member',
      },
      actorUserId
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.inviteUrl).toMatch(/^https:\/\/lk\.otsfera\.ru\/reset-password\?token=/);
  });
});
