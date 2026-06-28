import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  createAndAssignManager,
  deactivateAssignment,
  reactivateAssignment
} from '@/lib/services/manager/invite';

let prisma: PrismaClient;
let companyId: string;
let partnerId: string;
let orgId: string;
let adminActorUserId: string;
let existingManagerUserId: string;
let existingManagerEmail: string;
let existingNonManagerEmail: string;
let existingNonManagerUserId: string;

const STAMP = Date.now();

beforeAll(async () => {
  prisma = new PrismaClient();
  const company = await prisma.company.create({ data: { name: `MgrInvC-${STAMP}` } });
  companyId = company.id;
  const partner = await prisma.partner.create({
    data: { name: `MgrInvP-${STAMP}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;

  const org = await prisma.organization.create({
    data: { name: `MgrInv-Org-${STAMP}`, partnerId, companyId }
  });
  orgId = org.id;

  const actor = await prisma.user.create({
    data: {
      email: `mgr-inv-actor-${STAMP}@t.local`,
      passwordHash: 'x',
      name: 'Actor',
      role: 'admin'
    }
  });
  adminActorUserId = actor.id;

  existingManagerEmail = `mgr-inv-existing-${STAMP}@t.local`;
  const existing = await prisma.user.create({
    data: {
      email: existingManagerEmail,
      passwordHash: 'has-pw',
      name: 'Existing Mgr',
      role: 'manager'
    }
  });
  existingManagerUserId = existing.id;

  existingNonManagerEmail = `mgr-inv-nonmgr-${STAMP}@t.local`;
  const nonMgr = await prisma.user.create({
    data: {
      email: existingNonManagerEmail,
      passwordHash: 'x',
      name: 'Org User',
      role: 'organization'
    }
  });
  existingNonManagerUserId = nonMgr.id;
});

afterAll(async () => {
  // Wipe everything we may have created across tests by org-scope; users we
  // created directly are removed by id.
  await prisma.passwordResetToken.deleteMany({
    where: { user: { email: { contains: `mgr-inv-` } } }
  });
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [adminActorUserId] } }
  });
  await prisma.organizationManager.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { id: { in: [adminActorUserId, existingManagerUserId, existingNonManagerUserId] } },
        { email: { contains: `mgr-inv-new-${STAMP}` } }
      ]
    }
  });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Reset assignment state for the shared org between tests so each case
  // starts clean. We only delete assignments for users this suite knows
  // about, to avoid touching cross-suite state.
  await prisma.organizationManager.deleteMany({
    where: { organizationId: orgId }
  });
  // mode='new' creates a fresh user and (when there's no passwordHash)
  // a PasswordResetToken via createInviteToken. Drop the tokens first to
  // avoid the FK constraint, then drop the users.
  await prisma.passwordResetToken.deleteMany({
    where: { user: { email: { contains: `mgr-inv-new-${STAMP}` } } }
  });
  await prisma.user.deleteMany({
    where: { email: { contains: `mgr-inv-new-${STAMP}` } }
  });
});

describe('createAndAssignManager — mode=existing', () => {
  it('user_not_found when the email is unknown', async () => {
    expect(
      await createAndAssignManager(
        prisma,
        { mode: 'existing', organizationId: orgId, email: `does-not-exist-${STAMP}@t.local` },
        adminActorUserId
      )
    ).toEqual({ ok: false, error: 'user_not_found' });
  });

  it('role_conflict when the user exists but is not a manager', async () => {
    expect(
      await createAndAssignManager(
        prisma,
        { mode: 'existing', organizationId: orgId, email: existingNonManagerEmail },
        adminActorUserId
      )
    ).toEqual({ ok: false, error: 'role_conflict' });
  });

  it('org_not_found when organizationId does not exist', async () => {
    expect(
      await createAndAssignManager(
        prisma,
        { mode: 'existing', organizationId: 'nope', email: existingManagerEmail },
        adminActorUserId
      )
    ).toEqual({ ok: false, error: 'org_not_found' });
  });

  it('assigns when the manager has no prior assignment', async () => {
    const result = await createAndAssignManager(
      prisma,
      { mode: 'existing', organizationId: orgId, email: existingManagerEmail },
      adminActorUserId
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.user.id).toBe(existingManagerUserId);
    expect(result.inviteUrl).toBeNull(); // existing user has a passwordHash
    expect(result.alreadyHasPassword).toBe(true);
    expect(result.reactivated).toBe(false);

    const row = await prisma.organizationManager.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: existingManagerUserId }
      }
    });
    expect(row?.isActive).toBe(true);
    expect(row?.assignedBy).toBe(adminActorUserId);
  });

  it('already_assigned when an active assignment exists', async () => {
    // pre-create active assignment
    await prisma.organizationManager.create({
      data: { organizationId: orgId, userId: existingManagerUserId, isActive: true }
    });
    expect(
      await createAndAssignManager(
        prisma,
        { mode: 'existing', organizationId: orgId, email: existingManagerEmail },
        adminActorUserId
      )
    ).toEqual({ ok: false, error: 'already_assigned' });
  });

  it('reactivates an inactive assignment instead of throwing', async () => {
    await prisma.organizationManager.create({
      data: {
        organizationId: orgId,
        userId: existingManagerUserId,
        isActive: false,
        deactivatedAt: new Date()
      }
    });

    const result = await createAndAssignManager(
      prisma,
      { mode: 'existing', organizationId: orgId, email: existingManagerEmail },
      adminActorUserId
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.reactivated).toBe(true);

    const row = await prisma.organizationManager.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: existingManagerUserId }
      }
    });
    expect(row?.isActive).toBe(true);
    expect(row?.deactivatedAt).toBeNull();
    expect(row?.assignedBy).toBe(adminActorUserId);
  });
});

describe('createAndAssignManager — mode=new', () => {
  it('creates a fresh user with role=manager and returns inviteUrl', async () => {
    const newEmail = `mgr-inv-new-${STAMP}-a@t.local`;
    const result = await createAndAssignManager(
      prisma,
      { mode: 'new', organizationId: orgId, email: newEmail, name: 'Fresh Mgr' },
      adminActorUserId
    );
    if (!result.ok) throw new Error('expected ok');

    expect(result.alreadyHasPassword).toBe(false);
    expect(result.inviteUrl).toMatch(/^https?:\/\/.+\/reset-password\?token=/);

    const u = await prisma.user.findUnique({ where: { email: newEmail } });
    expect(u?.role).toBe('manager');
    expect(u?.passwordHash).toBeNull();
    expect(u?.name).toBe('Fresh Mgr');
  });

  it('reuses an existing manager account (no new user created)', async () => {
    const result = await createAndAssignManager(
      prisma,
      { mode: 'new', organizationId: orgId, email: existingManagerEmail },
      adminActorUserId
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.user.id).toBe(existingManagerUserId);
    expect(result.alreadyHasPassword).toBe(true);
    expect(result.inviteUrl).toBeNull();
  });

  it('role_conflict when the email belongs to a non-manager', async () => {
    expect(
      await createAndAssignManager(
        prisma,
        { mode: 'new', organizationId: orgId, email: existingNonManagerEmail },
        adminActorUserId
      )
    ).toEqual({ ok: false, error: 'role_conflict' });
  });
});

describe('deactivateAssignment / reactivateAssignment', () => {
  it('deactivate flips isActive=false, sets deactivatedAt, and records audit', async () => {
    const created = await prisma.organizationManager.create({
      data: { organizationId: orgId, userId: existingManagerUserId, isActive: true }
    });

    const result = await deactivateAssignment(prisma, created.id, adminActorUserId);
    expect(result).toEqual({ ok: true, organizationId: orgId });

    const updated = await prisma.organizationManager.findUnique({ where: { id: created.id } });
    expect(updated?.isActive).toBe(false);
    expect(updated?.deactivatedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'organization_manager', entityId: created.id, action: 'manager_deactivated' },
      orderBy: { createdAt: 'desc' }
    });
    expect(audit).not.toBeNull();
  });

  it('deactivate returns not_found for missing assignmentId', async () => {
    const result = await deactivateAssignment(prisma, 'no-such-id', adminActorUserId);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('deactivate is idempotent on already-inactive rows', async () => {
    const created = await prisma.organizationManager.create({
      data: {
        organizationId: orgId,
        userId: existingManagerUserId,
        isActive: false,
        deactivatedAt: new Date()
      }
    });
    const result = await deactivateAssignment(prisma, created.id, adminActorUserId);
    expect(result).toEqual({ ok: true, organizationId: orgId });
  });

  it('reactivate restores isActive, clears deactivatedAt, and updates assignedBy', async () => {
    const created = await prisma.organizationManager.create({
      data: {
        organizationId: orgId,
        userId: existingManagerUserId,
        isActive: false,
        deactivatedAt: new Date()
      }
    });
    const result = await reactivateAssignment(prisma, created.id, adminActorUserId);
    expect(result).toEqual({ ok: true, organizationId: orgId });

    const updated = await prisma.organizationManager.findUnique({ where: { id: created.id } });
    expect(updated?.isActive).toBe(true);
    expect(updated?.deactivatedAt).toBeNull();
    expect(updated?.assignedBy).toBe(adminActorUserId);
  });

  it('reactivate returns not_found for missing assignmentId', async () => {
    const result = await reactivateAssignment(prisma, 'no-such-id', adminActorUserId);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('boundary-catch contract', () => {
  it('returns a §3 Result (not a throw) for a domain error', async () => {
    const result = await createAndAssignManager(
      prisma,
      { mode: 'existing', organizationId: 'nope', email: existingManagerEmail },
      adminActorUserId
    );
    expect(result).toEqual({ ok: false, error: 'org_not_found' });
  });
});
