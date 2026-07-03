import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { SyncJobPayload } from '@/lib/jobs/types';

// ─────────────────────────────────────────────────────────────────────────────
// Track E / E1 — coverage restoration for the worker sync + cert-expiry processors.
//
// Targets the exact residual gaps (nothing else is missing):
//   certificate-expiry.ts  lines 80-82,112-115  branches @ 19,23,73,79
//   sync-documents.ts      lines 52-53          branch  @ 51
//   sync-orders.ts         lines 48-49          branch  @ 47
//   sync-organizations.ts  lines 52-53          branch  @ 51
//   sync-payments.ts       lines 52-53          branch  @ 51
//
// Style mirrors worker.sync-*.shadow.test.ts (mock PrismaClient, mocked pending
// module, ONE_C_ADAPTER=fake) and worker.certificate-expiry.test.ts (notifications
// mock). Pure mock-DB → unit tier (no `new PrismaClient()`).
// ─────────────────────────────────────────────────────────────────────────────

// pending capture/replay is mocked so we can make it REJECT and drive the
// best-effort try/catch tail (the residual uncovered branch in every sync-*).
const { capturePendingSkips, replayPendingRecords } = vi.hoisted(() => ({
  capturePendingSkips: vi.fn().mockResolvedValue(undefined),
  replayPendingRecords: vi.fn().mockResolvedValue({ resolved: 0, deadLettered: 0, stillPending: 0 }),
}));
vi.mock('@/lib/services/oneCSync/pending', () => ({
  capturePendingSkips,
  replayPendingRecords,
  isTransientSkip: () => true,
}));

// notifications fan-out mocked (no email/push side-effects), as in the cert test.
// notifyOrgUsers/notifyManagers are also stubbed: the sync-* live-mode writer paths
// (order/payment CREATE + status-change UPDATE) call them via the barrel, and running
// live mode here would otherwise hit the real fan-out. Best-effort try/catch in the
// writers means even a stub is safe, but neutralising them keeps the tests hermetic.
const { createNotification, deliverNotificationToUser, notifyOrgUsers, notifyManagers } = vi.hoisted(() => ({
  createNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
  deliverNotificationToUser: vi.fn().mockResolvedValue({}),
  notifyOrgUsers: vi.fn().mockResolvedValue(undefined),
  notifyManagers: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser, notifyOrgUsers, notifyManagers }));

// resolveAutoManager runs in the order CREATE path (best-effort). Stub it so no
// real manager-distribution query executes against the mock db.
const { resolveAutoManager } = vi.hoisted(() => ({ resolveAutoManager: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/services/manager/distribution', () => ({ resolveAutoManager }));

// db barrel used by the BullMQ wrapper certificateExpiryProcessor(); a mock prisma
// whose certificate.findMany returns [] short-circuits with zero reminders sent.
const { mockDbPrisma } = vi.hoisted(() => ({
  mockDbPrisma: { certificate: { findMany: vi.fn().mockResolvedValue([]) } },
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: mockDbPrisma }));

import { syncDocumentsProcessor } from '@/worker/processors/sync-documents';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { syncOrganizationsProcessor } from '@/worker/processors/sync-organizations';
import { syncPaymentsProcessor } from '@/worker/processors/sync-payments';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import { runCertificateExpiry, certificateExpiryProcessor } from '@/worker/processors/certificate-expiry';

const job = { id: 'cov-1', data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const } } as Job<SyncJobPayload>;

// Mock fetchAndStore1CDocument + scan queue so the sync-documents live CREATE path
// (writers.ts) never touches S3 or Redis. Mirrors worker.sync-documents.shadow.test.ts.
vi.mock('@/lib/services/oneCSync/document-fetch', () => ({
  fetchAndStore1CDocument: vi.fn().mockResolvedValue('fake/storage/path.pdf'),
}));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: vi.fn().mockReturnValue({ add: vi.fn().mockResolvedValue({}) }),
}));

// ─── sync-* live-mode pending capture/replay failure (the residual catch tail) ──
// In live mode the processors run capturePendingSkips + replayPendingRecords inside
// a best-effort try/catch. The existing shadow tests only assert the resolve path;
// making capturePendingSkips REJECT drives the `catch (e) { console.warn(...) }`
// arm — sync-documents/organizations/payments lines 52-53 (branch @ 51),
// sync-orders lines 48-49 (branch @ 47). The pull must still succeed (never fail
// on this) so the processor returns a normal summary.

function withLiveMode(runId: string, run: () => Promise<void>) {
  describe(runId, () => {
    beforeEach(() => {
      process.env.ONE_C_ADAPTER = 'fake';
      process.env.ONE_C_MODE = 'live';
      resetOneCAdapter();
      vi.clearAllMocks();
    });
    afterEach(() => {
      delete process.env.ONE_C_MODE;
      resetOneCAdapter();
    });
    it('swallows pending capture failure, still returns summary + writes log', run);
  });
}

// sync-documents: existing docs → UPDATE path, no S3/queue needed.
withLiveMode('syncDocumentsProcessor pending capture failure (live mode)', async () => {
  capturePendingSkips.mockRejectedValueOnce(new Error('pending_doc_down'));
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const syncLogCreate = vi.fn().mockResolvedValue({});
  const db = {
    syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: null, orderNumber: 'N', title: 'T' }) },
    document: { findUnique: vi.fn().mockResolvedValue({ id: 'doc-existing' }), create: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    syncLog: { create: syncLogCreate },
  } as unknown as PrismaClient;

  const result = await syncDocumentsProcessor(job, db);

  // capture threw → catch ran → warn fired with the module-specific prefix.
  expect(capturePendingSkips).toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sync-document]'), expect.anything());
  // best-effort: pull did NOT fail — summary returned + success log written.
  expect(result.updated).toBeGreaterThan(0);
  expect(syncLogCreate).toHaveBeenCalled();
  warnSpy.mockRestore();
});

// sync-orders: no existing orders → CREATE path resolves via mocked org lookup.
withLiveMode('syncOrdersProcessor pending capture failure (live mode)', async () => {
  capturePendingSkips.mockRejectedValueOnce(new Error('pending_order_down'));
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const syncLogCreate = vi.fn().mockResolvedValue({});
  const db = {
    syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    organization: { findFirst: vi.fn().mockResolvedValue({ id: 'org1', partnerId: 'p1', companyId: 'c1', externalId: '1c-org-001' }) },
    order: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn() },
    syncLog: { create: syncLogCreate },
  } as unknown as PrismaClient;

  const result = await syncOrdersProcessor(job, db);

  expect(capturePendingSkips).toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sync-order]'), expect.anything());
  expect(result.created).toBeGreaterThan(0);
  expect(syncLogCreate).toHaveBeenCalled();
  warnSpy.mockRestore();
});

// sync-organizations: existing orgs → UPDATE path (no $transaction needed).
withLiveMode('syncOrganizationsProcessor pending capture failure (live mode)', async () => {
  capturePendingSkips.mockRejectedValueOnce(new Error('pending_org_down'));
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const syncLogCreate = vi.fn().mockResolvedValue({});
  const db = {
    syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    partner: { findUnique: vi.fn().mockResolvedValue({ id: 'p1' }) },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-existing', companyId: 'co1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    syncLog: { create: syncLogCreate },
  } as unknown as PrismaClient;

  const result = await syncOrganizationsProcessor(job, db);

  expect(capturePendingSkips).toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sync-organization]'), expect.anything());
  expect(result.updated).toBeGreaterThan(0);
  expect(syncLogCreate).toHaveBeenCalled();
  warnSpy.mockRestore();
});

// sync-payments: order resolves → CREATE path; capture rejects → catch tail.
withLiveMode('syncPaymentsProcessor pending capture failure (live mode)', async () => {
  capturePendingSkips.mockRejectedValueOnce(new Error('pending_pay_down'));
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const syncLogCreate = vi.fn().mockResolvedValue({});
  const db = {
    syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: 'org1', orderNumber: 'N', title: 'T' }) },
    payment: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    syncLog: { create: syncLogCreate },
  } as unknown as PrismaClient;

  const result = await syncPaymentsProcessor(job, db);

  expect(capturePendingSkips).toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sync-payment]'), expect.anything());
  expect(result.created).toBeGreaterThan(0);
  expect(syncLogCreate).toHaveBeenCalled();
  warnSpy.mockRestore();
});

// ─── certificate-expiry: branch/line gaps via a mock PrismaClient ──────────────
// validUntil = today + 7d → selectDueReminders emits the 7-day threshold (smallest
// t with daysLeft<=t, not yet sent) → the reminder loop body runs.

function due7Certs() {
  return [
    {
      id: 'cert-A',
      organizationId: 'org-A',
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      number: 'EXP-A',
      student: { name: 'Иван' },
      reminders: [] as { thresholdDays: number }[],
    },
  ];
}

describe('runCertificateExpiry — recipient fan-out with partner + managers + leaders (branch @ 23)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('collects org users, partner users, order managers and company leaders (org.partner? truthy)', async () => {
    const reminderCreate = vi.fn().mockResolvedValue({});
    const db = {
      certificate: { findMany: vi.fn().mockResolvedValue(due7Certs()) },
      certificateReminder: { create: reminderCreate },
      // recipientsForOrg: org present WITH partner.users (drives `org.partner?.users`
      // truthy arm of branch @ 23) + companyId present (drives the leaders block).
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          partnerId: 'p1',
          companyId: 'co1',
          users: [{ id: 'u-org-1' }, { id: 'u-org-2' }],
          partner: { users: [{ id: 'u-partner-1' }] },
        }),
      },
      order: { findMany: vi.fn().mockResolvedValue([{ managerId: 'u-mgr-1' }, { managerId: null }]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u-leader-1' }]) },
    } as unknown as PrismaClient;

    const result = await runCertificateExpiry(db, new Date());

    expect(result.remindersSent).toBe(1);
    expect(reminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { certificateId: 'cert-A', thresholdDays: 7 } })
    );
    // Unique recipient set: 2 org users + 1 partner user + 1 order manager + 1 leader = 5.
    // (managerId:null is skipped by the `&& ids.add` guard.)
    expect(createNotification).toHaveBeenCalledTimes(5);
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(5);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'certificate_expiring', meta: { certificateId: 'cert-A', thresholdDays: 7 } })
    );
  });
});

describe('runCertificateExpiry — organization not found (branch @ 19)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns [] recipients (no fan-out) but still counts the reminder', async () => {
    const db = {
      certificate: { findMany: vi.fn().mockResolvedValue(due7Certs()) },
      certificateReminder: { create: vi.fn().mockResolvedValue({}) },
      // organization.findUnique → null drives `if (!org) return []` (branch @ 19).
      organization: { findUnique: vi.fn().mockResolvedValue(null) },
      order: { findMany: vi.fn() },
      user: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const result = await runCertificateExpiry(db, new Date());

    // Reminder row created & counted, but zero recipients → no notifications.
    expect(result.remindersSent).toBe(1);
    expect(createNotification).not.toHaveBeenCalled();
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
    // order/user lookups short-circuited by the early `return []`.
    expect((db.order.findMany as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('runCertificateExpiry — reminder create race (branch @ 79, lines 80-82)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips silently on P2002 unique-collision (continue arm — no fan-out)', async () => {
    const db = {
      certificate: { findMany: vi.fn().mockResolvedValue(due7Certs()) },
      // A concurrent run already inserted the row → unique violation P2002 → `continue`.
      certificateReminder: { create: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' })) },
      organization: { findUnique: vi.fn() },
      order: { findMany: vi.fn() },
      user: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const result = await runCertificateExpiry(db, new Date());

    // P2002 → continue → not counted, recipientsForOrg never reached.
    expect(result.remindersSent).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect((db.organization.findUnique as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('re-throws non-P2002 create failures (throw arm)', async () => {
    const db = {
      certificate: { findMany: vi.fn().mockResolvedValue(due7Certs()) },
      certificateReminder: { create: vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: 'P2003' })) },
      organization: { findUnique: vi.fn() },
      order: { findMany: vi.fn() },
      user: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    await expect(runCertificateExpiry(db, new Date())).rejects.toThrow('boom');
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('certificateExpiryProcessor — BullMQ wrapper (lines 112-115)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('imports the shared prisma and runs runCertificateExpiry for today', async () => {
    // mockDbPrisma.certificate.findMany → [] → zero due reminders, no fan-out.
    const result = await certificateExpiryProcessor();
    expect(result).toEqual({ remindersSent: 0 });
    expect(mockDbPrisma.certificate.findMany).toHaveBeenCalledTimes(1);
    // the `gte: today` filter carries a Date — confirms `new Date()` was passed through.
    const arg = mockDbPrisma.certificate.findMany.mock.calls[0][0];
    expect(arg.where.validUntil.gte).toBeInstanceOf(Date);
  });
});
