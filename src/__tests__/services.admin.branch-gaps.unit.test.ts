/**
 * Unit tests covering missed branches in admin service files.
 * Each test targets a specific uncovered arm identified from coverage-final.json.
 *
 * NOTE: admin/dashboard.ts "user null → actor '—'" is tested in
 * services.admin.dashboard.test.ts (which already has the correct queueStats mock).
 *
 * Files covered:
 *  - src/lib/services/admin/organizations.ts    (2 branches: partner null in list/get)
 *  - src/lib/services/admin/partners.ts         (3 branches: createPartnerWithAdmin nulls)
 *  - src/lib/services/admin/queueStats.ts       (7 branches + defaultProvider fn smoke)
 *  - src/lib/services/admin/syncControl.ts      (2 branches + defaultSyncProvider fn)
 *  - src/lib/services/admin/users/mutations.ts  (9+ branches)
 *  - src/lib/services/admin/users/queries.ts    (5 branches)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Module mocks — partners.ts, mutations.ts need audit + passwordReset
// ---------------------------------------------------------------------------
const { recordAuditMock, createInviteTokenMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  createInviteTokenMock: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/auth/passwordReset', () => ({ createInviteToken: createInviteTokenMock }));

// ---------------------------------------------------------------------------
// admin/organizations.ts — partner null branches
// ---------------------------------------------------------------------------
import { listOrganizations, getOrganization } from '@/lib/services/admin/organizations';

describe('admin/organizations — partner null arms', () => {
  it('listOrganizations: org without partner → partner field is null', async () => {
    const org = {
      id: 'org1',
      name: 'ОргБезПартнёра',
      inn: null,
      externalId: null,
      partner: null,
      _count: { orders: 0, organizationUsers: 1 },
      partnerCommissionRate: null,
    };
    const prisma = {
      organization: {
        findMany: vi.fn().mockResolvedValue([org]),
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaClient;

    const { rows } = await listOrganizations(prisma, {});
    expect(rows[0].partner).toBeNull();
  });

  it('getOrganization: org without partner → partner field is null', async () => {
    const org = {
      id: 'org1',
      name: 'ОргБезПартнёра',
      inn: null,
      kpp: null,
      externalId: null,
      partnerId: null,
      partner: null,
      partnerCommissionRate: null,
      partnerCommissionRateNote: null,
    };
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue(org),
      },
    } as unknown as PrismaClient;

    const result = await getOrganization(prisma, 'org1');
    expect(result).not.toBeNull();
    expect(result!.partner).toBeNull();
    expect(result!.partnerId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// admin/partners.ts — createPartnerWithAdmin null/undefined commissionRate
// ---------------------------------------------------------------------------
import { createPartnerWithAdmin } from '@/lib/services/admin/partners';

describe('admin/partners — createPartnerWithAdmin null/undefined commissionRate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createInviteTokenMock.mockResolvedValue({ token: 'tok-abc' });
    recordAuditMock.mockResolvedValue(undefined);
  });

  function makeTx() {
    const partner = {
      id: 'p1',
      name: 'НовыйПартнёр',
      slug: null as string | null,
      commissionRate: new Prisma.Decimal('0'),
      isActive: true,
    };
    const user = { id: 'u1', email: 'admin@new.com' };
    return {
      partner: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(partner),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(user),
      },
      partnerUser: { create: vi.fn().mockResolvedValue({}) },
      commissionRateChange: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  it('commissionRate: null → Decimal(0) in partner.create, null in audit', async () => {
    const tx = makeTx();
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    const result = await createPartnerWithAdmin(prisma, 'actor1', {
      name: 'НовыйПартнёр',
      slug: 'noviy-partner',
      commissionRate: null,
      adminEmail: 'admin@new.com',
      adminName: 'Иван Иванов',
    });

    expect(tx.partner.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ commissionRate: new Prisma.Decimal(0) }),
      }),
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.objectContaining({ commissionRate: null }),
      }),
    );
    // partner.slug is null → `partner.slug ?? ''` → ''
    if (!result.ok) throw new Error('expected ok');
    expect(result.partner.slug).toBe('');
  });

  it('commissionRate: undefined → Decimal(0) in partner.create, null in audit', async () => {
    const tx = makeTx();
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    await createPartnerWithAdmin(prisma, 'actor1', {
      name: 'НовыйПартнёр',
      slug: 'noviy-partner',
      // commissionRate omitted → undefined
      adminEmail: 'admin@new.com',
      adminName: 'Иван Иванов',
    });

    expect(tx.partner.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ commissionRate: new Prisma.Decimal(0) }),
      }),
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.objectContaining({ commissionRate: null }),
      }),
    );
  });

  it('commissionRate: non-null → audit commissionRate is stringified, slug passed through', async () => {
    const tx = makeTx();
    tx.partner.create = vi.fn().mockResolvedValue({
      id: 'p1',
      name: 'НовыйПартнёр',
      slug: 'noviy-partner',
      commissionRate: new Prisma.Decimal('0.07'),
      isActive: true,
    });
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaClient;

    const result = await createPartnerWithAdmin(prisma, 'actor1', {
      name: 'НовыйПартнёр',
      slug: 'noviy-partner',
      commissionRate: 0.07,
      adminEmail: 'admin@new.com',
      adminName: 'Иван Иванов',
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.partner.slug).toBe('noviy-partner');
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.objectContaining({ commissionRate: '0.07' }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// admin/queueStats.ts — getDlq null/undefined job fields + sort comparator
//                       + non-Error in retryDlqJob + defaultProvider fn smoke
// NOTE: This section imports queueStats directly (no vi.mock of queueStats in
//       this file) so the real implementation is tested.
// ---------------------------------------------------------------------------
import {
  getDlq,
  retryDlqJob,
  getQueueStats,
  type QueueProvider,
} from '@/lib/services/admin/queueStats';
import { QUEUE_NAMES } from '@/lib/jobs/queues';

describe('admin/queueStats — getDlq: null/undefined job fields', () => {
  it('job.id undefined → jobId is empty string', async () => {
    const provider: QueueProvider = (name) => ({
      getJobCounts: vi.fn().mockResolvedValue({}),
      getFailed: vi.fn().mockResolvedValue(
        name === 'docs.scanDocument'
          ? [{ id: undefined, name: 'scan', failedReason: 'err', finishedOn: 1000, attemptsMade: 1 }]
          : [],
      ),
      getJob: vi.fn(),
    } as any);

    const rows = await getDlq(provider);
    const row = rows.find((r) => r.queue === 'docs.scanDocument');
    expect(row?.jobId).toBe('');
  });

  it('job.failedReason undefined → failedReason is null', async () => {
    const provider: QueueProvider = (name) => ({
      getJobCounts: vi.fn().mockResolvedValue({}),
      getFailed: vi.fn().mockResolvedValue(
        name === 'docs.scanDocument'
          ? [{ id: 'j1', name: 'scan', failedReason: undefined, finishedOn: 1000, attemptsMade: 1 }]
          : [],
      ),
      getJob: vi.fn(),
    } as any);

    const rows = await getDlq(provider);
    const row = rows.find((r) => r.queue === 'docs.scanDocument');
    expect(row?.failedReason).toBeNull();
  });

  it('job.finishedOn undefined → failedAt is null', async () => {
    const provider: QueueProvider = (name) => ({
      getJobCounts: vi.fn().mockResolvedValue({}),
      getFailed: vi.fn().mockResolvedValue(
        name === 'docs.scanDocument'
          ? [{ id: 'j1', name: 'scan', failedReason: 'err', finishedOn: undefined, attemptsMade: 1 }]
          : [],
      ),
      getJob: vi.fn(),
    } as any);

    const rows = await getDlq(provider);
    const row = rows.find((r) => r.queue === 'docs.scanDocument');
    expect(row?.failedAt).toBeNull();
  });

  it('job.attemptsMade undefined → attemptsMade is 0', async () => {
    const provider: QueueProvider = (name) => ({
      getJobCounts: vi.fn().mockResolvedValue({}),
      getFailed: vi.fn().mockResolvedValue(
        name === 'docs.scanDocument'
          ? [{ id: 'j1', name: 'scan', failedReason: 'err', finishedOn: 1000, attemptsMade: undefined }]
          : [],
      ),
      getJob: vi.fn(),
    } as any);

    const rows = await getDlq(provider);
    const row = rows.find((r) => r.queue === 'docs.scanDocument');
    expect(row?.attemptsMade).toBe(0);
  });

  it('sort: job with failedAt sorts before job with null failedAt', async () => {
    const now = Date.now();
    const provider: QueueProvider = (name) => ({
      getJobCounts: vi.fn().mockResolvedValue({}),
      getFailed: vi.fn().mockResolvedValue(
        name === 'docs.scanDocument'
          ? [
              { id: 'nodate', name: 'scan', failedReason: 'e', finishedOn: undefined, attemptsMade: 1 },
              { id: 'withdate', name: 'scan', failedReason: 'e', finishedOn: now, attemptsMade: 1 },
            ]
          : [],
      ),
      getJob: vi.fn(),
    } as any);

    const rows = await getDlq(provider);
    expect(rows[0].jobId).toBe('withdate');
    expect(rows[1].jobId).toBe('nodate');
  });

  it('sort comparator: both rows with null failedAt → stable (covers b.failedAt?.getTime() ?? 0)', async () => {
    // Two jobs both with finishedOn=undefined → both failedAt=null → sort uses 0-0=0
    const provider: QueueProvider = (name) => ({
      getJobCounts: vi.fn().mockResolvedValue({}),
      getFailed: vi.fn().mockResolvedValue(
        name === 'docs.scanDocument'
          ? [
              { id: 'null-1', name: 'scan', failedReason: 'e', finishedOn: undefined, attemptsMade: 1 },
              { id: 'null-2', name: 'scan', failedReason: 'e', finishedOn: undefined, attemptsMade: 2 },
            ]
          : [],
      ),
      getJob: vi.fn(),
    } as any);

    const rows = await getDlq(provider);
    // Both have null failedAt; just verify they both appear
    expect(rows.filter((r) => r.queue === 'docs.scanDocument')).toHaveLength(2);
    expect(rows.every((r) => r.failedAt === null || r.failedAt instanceof Date)).toBe(true);
  });
});

describe('admin/queueStats — retryDlqJob: non-Error thrown → RETRY_FAILED', () => {
  it('captures non-Error throws and returns RETRY_FAILED', async () => {
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn(),
      getJob: vi.fn().mockResolvedValue({
        retry: vi.fn().mockRejectedValue('string error'),
      }),
    } as any);

    const result = await retryDlqJob('docs.scanDocument', 'j1', provider);
    expect(result).toEqual({ ok: false, reason: 'RETRY_FAILED' });
  });
});

describe('admin/queueStats — defaultProvider smoke (via getQueueStats)', () => {
  it('getQueueStats with explicit stub provider returns row per queue', async () => {
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 1, active: 0, completed: 5, failed: 0, delayed: 0 }),
      getFailed: vi.fn().mockResolvedValue([]),
      getJob: vi.fn(),
    } as any);

    const rows = await getQueueStats(provider);
    expect(rows.length).toBe(QUEUE_NAMES.length);
    expect(rows[0].counts.waiting).toBe(1);
    expect(rows[0].counts.completed).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// admin/syncControl.ts — rewindCursor null existing + triggerSync active undefined
// ---------------------------------------------------------------------------
import { rewindCursor, triggerSync, type SyncControlQueueProvider } from '@/lib/services/admin/syncControl';

describe('admin/syncControl — rewindCursor: existing cursor null', () => {
  it('when syncState.findUnique returns null, before.cursor is null', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      syncState: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx)),
    } as never;

    const res = await rewindCursor(prisma, 'actor', 'order', '2026-01-01T00:00:00.000Z');
    expect(res).toEqual({ ok: true, entity: 'order', cursor: '2026-01-01T00:00:00.000Z' });
    // recordAudit is mocked via @/lib/auth/audit; check before.cursor is null (existing was null)
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(), // tx
      expect.objectContaining({ before: { cursor: null } }),
    );
  });
});

describe('admin/syncControl — triggerSync: counts.active undefined', () => {
  it('missing active key treated as 0 → job enqueued', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = { auditLog: { create: auditCreate } } as never;
    const add = vi.fn().mockResolvedValue({ id: 'j1' });
    const provider: SyncControlQueueProvider = () => ({
      getJobCounts: vi.fn().mockResolvedValue({}), // active key absent → `counts.active ?? 0` = 0
      add,
      upsertJobScheduler: vi.fn(),
      removeJobScheduler: vi.fn(),
    } as any);

    const res = await triggerSync(prisma, 'actor', 'order', provider);
    expect(res.ok).toBe(true);
    expect(add).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// admin/users/mutations.ts — missed branches
// ---------------------------------------------------------------------------
import {
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
} from '@/lib/services/admin/users/mutations';

describe('admin/users/mutations — missed branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createInviteTokenMock.mockResolvedValue({ token: 'tok-xyz' });
    recordAuditMock.mockResolvedValue(undefined);
  });

  it('createUser: duplicate_email (findUnique returns existing user) → ok:false', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    const result = await createUser(prisma, 'actor', { email: 'e@x', name: 'N', role: 'organization' });
    expect(result).toEqual({ ok: false, error: 'duplicate_email' });
  });

  it('updateUser: before is null → not_found', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    const result = await updateUser(prisma, 'actor', 'u99', { name: 'New' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('updateUser: student → partner transition is allowed', async () => {
    const before = { id: 'u1', role: 'student' as const, isActive: true, partnerId: null, name: 'X' };
    const updated = { role: 'partner' as const, isActive: true, partnerId: 'p1', name: 'X' };
    const userDetail = {
      id: 'u1', email: 'x@x', name: 'X', role: 'partner' as const, isActive: true, createdAt: new Date(),
      partnerId: 'p1', partner: null, organizationUsers: [], managedOrganizations: [],
    };
    const txMock = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(before)
          .mockResolvedValueOnce(userDetail),
        update: vi.fn().mockResolvedValue(updated),
        count: vi.fn(),
      },
      partnerUser: { create: vi.fn(), deleteMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    const result = await updateUser(prisma, 'actor', 'u1', { role: 'partner', partnerId: 'p1' });
    expect(result.ok).toBe(true);
    expect(txMock.partnerUser.create).toHaveBeenCalled();
  });

  it('updateUser: admin protection → deactivate last admin fails', async () => {
    const before = { id: 'u1', role: 'admin' as const, isActive: true, partnerId: null, name: 'X' };
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue(before),
        count: vi.fn().mockResolvedValue(0), // last admin
      },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    const result = await updateUser(prisma, 'actor', 'u1', { isActive: false });
    expect(result).toEqual({ ok: false, error: 'last_admin_protected' });
  });

  it('updateUser: only name changes → update data contains only name', async () => {
    const before = { id: 'u1', role: 'organization' as const, isActive: true, partnerId: null, name: 'Old' };
    const updated = { role: 'organization' as const, isActive: true, partnerId: null, name: 'New' };
    const userDetail = {
      id: 'u1', email: 'x@x', name: 'New', role: 'organization' as const, isActive: true, createdAt: new Date(),
      partnerId: null, partner: null, organizationUsers: [], managedOrganizations: [],
    };
    const txMock = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(before)
          .mockResolvedValueOnce(userDetail),
        update: vi.fn().mockResolvedValue(updated),
        count: vi.fn(),
      },
      partnerUser: { create: vi.fn(), deleteMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    const result = await updateUser(prisma, 'actor', 'u1', { name: 'New' });
    expect(result.ok).toBe(true);
    const updateCall = txMock.user.update.mock.calls[0][0];
    expect(updateCall.data).toEqual({ name: 'New' });
    // recordAudit mocked → check it was called with action user_updated
    expect(recordAuditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ action: 'user_updated' }),
    );
  });

  it('updateUser: same-role (partner→partner) → audit action is user_updated', async () => {
    const before = { id: 'u1', role: 'partner' as const, isActive: true, partnerId: 'p1', name: 'X' };
    const updated = { role: 'partner' as const, isActive: true, partnerId: 'p1', name: 'New' };
    const userDetail = {
      id: 'u1', email: 'x@x', name: 'New', role: 'partner' as const, isActive: true, createdAt: new Date(),
      partnerId: 'p1', partner: null, organizationUsers: [], managedOrganizations: [],
    };
    const txMock = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(before)
          .mockResolvedValueOnce(userDetail),
        update: vi.fn().mockResolvedValue(updated),
        count: vi.fn(),
      },
      partnerUser: { create: vi.fn(), deleteMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    const result = await updateUser(prisma, 'actor', 'u1', { role: 'partner', name: 'New' });
    expect(result.ok).toBe(true);
    expect(recordAuditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ action: 'user_updated' }),
    );
  });

  it('updateUser: non-AdminUserError thrown inside tx re-throws', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockRejectedValue(new Error('DB crashed')) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    await expect(updateUser(prisma, 'actor', 'u1', { name: 'X' })).rejects.toThrow('DB crashed');
  });

  it('deactivateUser: active admin with remaining admins → deactivates OK', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'admin', isActive: true }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(1), // remaining > 0 → not last admin
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    const result = await deactivateUser(prisma, 'actor', 'u1');
    expect(result).toEqual({ ok: true });
    expect(txMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
  });

  it('deactivateUser: non-AdminUserError thrown inside tx re-throws', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockRejectedValue(new TypeError('type crash')) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    await expect(deactivateUser(prisma, 'actor', 'u1')).rejects.toThrow('type crash');
  });

  it('reactivateUser: non-AdminUserError thrown inside tx re-throws', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockRejectedValue(new RangeError('range err')) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    await expect(reactivateUser(prisma, 'actor', 'u1')).rejects.toThrow('range err');
  });

  it('createUser: non-AdminUserError thrown inside tx re-throws', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null), // no duplicate
        create: vi.fn().mockRejectedValue(new TypeError('DB write failure')),
      },
      partnerUser: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    await expect(createUser(prisma, 'actor', { email: 'n@x', name: 'N', role: 'organization' })).rejects.toThrow('DB write failure');
  });

  it('updateUser: forbidden role transition → ok:false error:role_transition_forbidden', async () => {
    // manager → partner is not in ALLOWED_TRANSITIONS → throws role_transition_forbidden
    const before = { id: 'u2', role: 'manager' as const, isActive: true, partnerId: null, name: 'Y' };
    const txMock = { user: { findUnique: vi.fn().mockResolvedValue(before) } };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    const result = await updateUser(prisma, 'actor', 'u2', { role: 'partner' as any });
    expect(result).toEqual({ ok: false, error: 'role_transition_forbidden' });
  });

  it('updateUser: isActive:true update included in data', async () => {
    const before = { id: 'u1', role: 'organization' as const, isActive: false, partnerId: null, name: 'X' };
    const updated = { role: 'organization' as const, isActive: true, partnerId: null, name: 'X' };
    const userDetail = {
      id: 'u1', email: 'x@x', name: 'X', role: 'organization' as const, isActive: true, createdAt: new Date(),
      partnerId: null, partner: null, organizationUsers: [], managedOrganizations: [],
    };
    const txMock = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(before)
          .mockResolvedValueOnce(userDetail),
        update: vi.fn().mockResolvedValue(updated),
        count: vi.fn(),
      },
      partnerUser: { create: vi.fn(), deleteMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (t: typeof txMock) => unknown) => cb(txMock)),
    } as unknown as PrismaClient;

    const result = await updateUser(prisma, 'actor', 'u1', { isActive: true });
    expect(result.ok).toBe(true);
    const updateCall = txMock.user.update.mock.calls[0][0];
    expect(updateCall.data.isActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// admin/users/queries.ts — missed branches in computeAttachmentLabel + listUsers
// ---------------------------------------------------------------------------
import { getUser, listUsers } from '@/lib/services/admin/users/queries';

const ADMIN_SESSION = { sub: 'adm', role: 'admin' as const };

describe('admin/users/queries — computeAttachmentLabel missed arms', () => {
  it('getUser: partner role but partner is null → attachmentLabel "—"', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1', email: 'p@x', name: 'P', role: 'partner', isActive: true, createdAt: new Date(),
          partnerId: 'p1',
          partner: null,
          organizationUsers: [],
          managedOrganizations: [],
          managerRole: null,
        }),
      },
    } as unknown as PrismaClient;

    const result = await getUser(prisma, ADMIN_SESSION, 'u1');
    expect(result!.attachmentLabel).toBe('—');
  });

  it('getUser: organization role with empty organizationUsers → attachmentLabel "—"', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u2', email: 'o@x', name: 'O', role: 'organization', isActive: true, createdAt: new Date(),
          partnerId: null, partner: null,
          organizationUsers: [],
          managedOrganizations: [],
          managerRole: null,
        }),
      },
    } as unknown as PrismaClient;

    const result = await getUser(prisma, ADMIN_SESSION, 'u2');
    expect(result!.attachmentLabel).toBe('—');
  });

  it('listUsers: manager with multiple managedOrganizations → attachmentLabel with (+N)', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'u3', email: 'm@x', name: 'M', role: 'manager', isActive: true, createdAt: new Date(),
            partner: null,
            organizationUsers: [],
            managedOrganizations: [
              { organization: { name: 'Org A' } },
              { organization: { name: 'Org B' } },
            ],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaClient;

    const { rows } = await listUsers(prisma, ADMIN_SESSION, {});
    expect(rows[0].attachmentLabel).toBe('Org A (+1)');
  });

  it('listUsers: manager with no managedOrganizations → attachmentLabel "—"', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'u4', email: 'm2@x', name: 'M2', role: 'manager', isActive: true, createdAt: new Date(),
            partner: null,
            organizationUsers: [],
            managedOrganizations: [],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaClient;

    const { rows } = await listUsers(prisma, ADMIN_SESSION, {});
    expect(rows[0].attachmentLabel).toBe('—');
  });

  it('listUsers: partnerId filter sets where.partnerId', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = { user: { findMany, count } } as unknown as PrismaClient;

    await listUsers(prisma, ADMIN_SESSION, { partnerId: 'partner-42' });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.partnerId).toBe('partner-42');
  });
});
