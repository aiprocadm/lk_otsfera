import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listMembers,
  inviteMember,
  updateMemberRole,
  deactivateMember,
  reactivateMember,
} from '@/lib/services/organization/team';

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgId: string;
let actorAdminUserId: string;
let actorAdminOrgUserId: string;
let secondAdminUserId: string;
let secondAdminOrgUserId: string;
let memberUserId: string;
let memberOrgUserId: string;
const STAMP = Date.now();

async function ensureMemberships() {
  // wipe between tests, then restore baseline:
  // - actorAdmin: admin, active (the actor performing operations)
  // - secondAdmin: admin, active (provides 2nd admin so demotions/deactivations of actor can be tested elsewhere)
  // - member: member, active
  await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });

  const a = await prisma.organizationUser.create({
    data: {
      organizationId: orgId,
      userId: actorAdminUserId,
      roleInOrg: 'admin',
      isActive: true,
    },
  });
  actorAdminOrgUserId = a.id;
  const s = await prisma.organizationUser.create({
    data: {
      organizationId: orgId,
      userId: secondAdminUserId,
      roleInOrg: 'admin',
      isActive: true,
    },
  });
  secondAdminOrgUserId = s.id;
  const m = await prisma.organizationUser.create({
    data: {
      organizationId: orgId,
      userId: memberUserId,
      roleInOrg: 'member',
      isActive: true,
    },
  });
  memberOrgUserId = m.id;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({
    data: { name: `OrgTeamP-${STAMP}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `OrgTeamC-${STAMP}` } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: { name: `OrgTeam-${STAMP}`, partnerId, companyId },
  });
  orgId = org.id;

  const a = await prisma.user.create({
    data: {
      email: `team-actor-${STAMP}@t.local`,
      name: 'Actor Admin',
      role: 'organization',
      passwordHash: 'x',
    },
  });
  actorAdminUserId = a.id;
  const s = await prisma.user.create({
    data: {
      email: `team-second-${STAMP}@t.local`,
      name: 'Second Admin',
      role: 'organization',
      passwordHash: 'x',
    },
  });
  secondAdminUserId = s.id;
  const m = await prisma.user.create({
    data: {
      email: `team-member-${STAMP}@t.local`,
      name: 'Plain Member',
      role: 'organization',
      passwordHash: 'x',
    },
  });
  memberUserId = m.id;
});

afterAll(async () => {
  // Identify all users created by this test (seeded + invited)
  const testUsers = await prisma.user.findMany({
    where: {
      OR: [{ email: { contains: 'team-' } }, { email: { contains: 'invitee-' } }],
    },
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

beforeEach(async () => {
  await ensureMemberships();
});

describe('listMembers', () => {
  it('returns all members (active and inactive) ordered by isActive desc, createdAt asc', async () => {
    await prisma.organizationUser.update({
      where: { id: memberOrgUserId },
      data: { isActive: false },
    });
    const rows = await listMembers(prisma, orgId);
    expect(rows).toHaveLength(3);
    // active members first
    expect(rows[0].isActive).toBe(true);
    expect(rows[1].isActive).toBe(true);
    expect(rows[2].isActive).toBe(false);
    expect(rows.find((r) => r.userId === memberUserId)?.roleInOrg).toBe('member');
    expect(rows.find((r) => r.userId === actorAdminUserId)?.roleInOrg).toBe('admin');
    // Все посеянные пользователи имеют passwordHash → приглашение принято.
    expect(rows.every((r) => r.invitePending === false)).toBe(true);
  });

  it('marks invitePending=true for members without a password (ФТ-10.2)', async () => {
    await prisma.user.update({ where: { id: memberUserId }, data: { passwordHash: null } });
    try {
      const rows = await listMembers(prisma, orgId);
      expect(rows.find((r) => r.userId === memberUserId)?.invitePending).toBe(true);
      expect(rows.find((r) => r.userId === actorAdminUserId)?.invitePending).toBe(false);
    } finally {
      await prisma.user.update({ where: { id: memberUserId }, data: { passwordHash: 'x' } });
    }
  });
});

describe('inviteMember', () => {
  it('creates new User + OrganizationUser, returns inviteUrl when no passwordHash', async () => {
    const email = `invitee-new-${Date.now()}@t.local`;
    const result = await inviteMember(
      prisma,
      { organizationId: orgId, email, name: 'New One', roleInOrg: 'member' },
      actorAdminUserId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.user.email).toBe(email);
    expect(result.inviteUrl).toMatch(/\/reset-password\?token=/);
    expect(result.alreadyHasPassword).toBe(false);

    const created = await prisma.user.findUnique({ where: { email } });
    expect(created?.role).toBe('organization');
    expect(created?.passwordHash).toBeNull();

    const orgUser = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: created!.id } },
    });
    expect(orgUser?.isActive).toBe(true);
    expect(orgUser?.roleInOrg).toBe('member');

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'organization_user', entityId: orgUser!.id, action: 'org_member_invited' },
    });
    expect(audit).not.toBeNull();

    // ФТ-10.2: свежеприглашённый (без пароля) виден в списке как invitePending.
    const rows = await listMembers(prisma, orgId);
    expect(rows.find((r) => r.userId === created!.id)?.invitePending).toBe(true);
  });

  it('reuses existing User with password, returns alreadyHasPassword=true', async () => {
    const email = `invitee-existing-${Date.now()}@t.local`;
    await prisma.user.create({
      data: { email, name: 'Existing', role: 'organization', passwordHash: 'x' },
    });
    const result = await inviteMember(
      prisma,
      { organizationId: orgId, email, name: 'Existing', roleInOrg: 'member' },
      actorAdminUserId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.inviteUrl).toBeNull();
    expect(result.alreadyHasPassword).toBe(true);

    const orgUser = await prisma.organizationUser.findFirst({
      where: { organizationId: orgId, userId: result.user.id },
    });
    expect(orgUser?.isActive).toBe(true);
  });

  it('returns already_member when user is already an active member', async () => {
    const email = `invitee-dup-${Date.now()}@t.local`;
    await inviteMember(
      prisma,
      { organizationId: orgId, email, name: 'Dup', roleInOrg: 'member' },
      actorAdminUserId
    );
    const res = await inviteMember(
      prisma,
      { organizationId: orgId, email, name: 'Dup', roleInOrg: 'member' },
      actorAdminUserId
    );
    expect(res).toEqual({ ok: false, error: 'already_member' });
  });

  it('reactivates inactive membership with new role', async () => {
    const email = `invitee-deact-${Date.now()}@t.local`;
    const first = await inviteMember(
      prisma,
      { organizationId: orgId, email, name: 'Reactivate', roleInOrg: 'member' },
      actorAdminUserId
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected ok');
    // deactivate the membership directly
    await prisma.organizationUser.updateMany({
      where: { organizationId: orgId, userId: first.user.id },
      data: { isActive: false },
    });
    const second = await inviteMember(
      prisma,
      { organizationId: orgId, email, name: 'Reactivate', roleInOrg: 'admin' },
      actorAdminUserId
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('expected ok');
    expect(second.user.id).toBe(first.user.id);

    const orgUser = await prisma.organizationUser.findFirst({
      where: { organizationId: orgId, userId: first.user.id },
    });
    expect(orgUser?.isActive).toBe(true);
    expect(orgUser?.roleInOrg).toBe('admin');
  });
});

describe('updateMemberRole', () => {
  it('promotes a member to admin', async () => {
    const res = await updateMemberRole(prisma, orgId, memberOrgUserId, 'admin', actorAdminUserId);
    expect(res).toEqual({ ok: true });
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.roleInOrg).toBe('admin');
  });

  it('returns self_action_forbidden when actor targets themselves', async () => {
    const res = await updateMemberRole(
      prisma,
      orgId,
      actorAdminOrgUserId,
      'member',
      actorAdminUserId
    );
    expect(res).toEqual({ ok: false, error: 'self_action_forbidden' });
  });

  it('throws last_admin_protected when demoting the last active admin', async () => {
    // deactivate second admin → actor is sole admin
    await prisma.organizationUser.update({
      where: { id: secondAdminOrgUserId },
      data: { isActive: false },
    });
    // memberUser tries to demote actorAdmin (different actor — a hypothetical 2nd admin)
    // Need an actor that is NOT the target. We'll demote secondAdminOrgUserId — but it's already inactive.
    // Instead: try to demote actorAdmin from another active admin's perspective.
    // Build setup: promote member → admin; then demote member back; should fail when member is *only* active admin.
    // Actually simpler: demote secondAdmin (reactivate first), and check that we still have actor → 2 admins → OK.
    // To trigger last_admin_protected we need 1 admin left + try to demote that 1 from someone else's session.
    await prisma.organizationUser.update({
      where: { id: secondAdminOrgUserId },
      data: { isActive: true },
    });
    // Deactivate actor → secondAdmin is sole active admin
    await prisma.organizationUser.update({
      where: { id: actorAdminOrgUserId },
      data: { isActive: false },
    });
    // member (acting as some other user — use memberUserId) tries to demote secondAdmin
    const res = await updateMemberRole(prisma, orgId, secondAdminOrgUserId, 'member', memberUserId);
    expect(res).toEqual({ ok: false, error: 'last_admin_protected' });
  });

  it('returns not_found for unknown orgUserId', async () => {
    const res = await updateMemberRole(prisma, orgId, 'nonexistent', 'admin', actorAdminUserId);
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('is a no-op when newRole === currentRole', async () => {
    const res = await updateMemberRole(
      prisma,
      orgId,
      secondAdminOrgUserId,
      'admin',
      actorAdminUserId
    );
    expect(res).toEqual({ ok: true });
    const row = await prisma.organizationUser.findUnique({ where: { id: secondAdminOrgUserId } });
    expect(row?.roleInOrg).toBe('admin');
  });
});

describe('deactivateMember', () => {
  it('deactivates an active member', async () => {
    const res = await deactivateMember(prisma, orgId, memberOrgUserId, actorAdminUserId);
    expect(res).toEqual({ ok: true });
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.isActive).toBe(false);
  });

  it('returns self_action_forbidden when actor targets themselves', async () => {
    const res = await deactivateMember(prisma, orgId, actorAdminOrgUserId, actorAdminUserId);
    expect(res).toEqual({ ok: false, error: 'self_action_forbidden' });
  });

  it('returns last_admin_protected when deactivating the last active admin', async () => {
    await prisma.organizationUser.update({
      where: { id: secondAdminOrgUserId },
      data: { isActive: false },
    });
    // actorAdmin is now sole active admin; member (acting as someone else) tries to deactivate them
    const res = await deactivateMember(prisma, orgId, actorAdminOrgUserId, memberUserId);
    expect(res).toEqual({ ok: false, error: 'last_admin_protected' });
  });
});

describe('reactivateMember', () => {
  it('reactivates an inactive member', async () => {
    await prisma.organizationUser.update({
      where: { id: memberOrgUserId },
      data: { isActive: false },
    });
    const res = await reactivateMember(prisma, orgId, memberOrgUserId, actorAdminUserId);
    expect(res).toEqual({ ok: true });
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.isActive).toBe(true);
  });

  it('returns self_action_forbidden when actor targets themselves', async () => {
    const res = await reactivateMember(prisma, orgId, actorAdminOrgUserId, actorAdminUserId);
    expect(res).toEqual({ ok: false, error: 'self_action_forbidden' });
  });

  it('is a no-op when already active', async () => {
    const res = await reactivateMember(prisma, orgId, memberOrgUserId, actorAdminUserId);
    expect(res).toEqual({ ok: true });
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.isActive).toBe(true);
  });
});

// actorAdminUserId is reused as the actor's userId; actorRole='leader' is what
// controls privilege here — userId only drives the self-action guard and audit log.
describe('leader privilege-escalation guards', () => {
  it('leader cannot promote a member to admin', async () => {
    const res = await updateMemberRole(
      prisma,
      orgId,
      memberOrgUserId,
      'admin',
      actorAdminUserId,
      'leader'
    );
    expect(res).toEqual({ ok: false, error: 'requires_admin' });
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.roleInOrg).toBe('member'); // untouched
  });

  it('leader cannot change the role of an existing admin', async () => {
    const res = await updateMemberRole(
      prisma,
      orgId,
      secondAdminOrgUserId,
      'member',
      actorAdminUserId,
      'leader'
    );
    expect(res).toEqual({ ok: false, error: 'requires_admin' });
  });

  it('leader cannot deactivate an admin', async () => {
    const res = await deactivateMember(
      prisma,
      orgId,
      secondAdminOrgUserId,
      actorAdminUserId,
      'leader'
    );
    expect(res).toEqual({ ok: false, error: 'requires_admin' });
  });

  it('leader CAN promote a member to leader', async () => {
    const res = await updateMemberRole(
      prisma,
      orgId,
      memberOrgUserId,
      'leader',
      actorAdminUserId,
      'leader'
    );
    expect(res).toEqual({ ok: true });
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.roleInOrg).toBe('leader');
  });

  it('leader cannot invite a new admin', async () => {
    const res = await inviteMember(
      prisma,
      {
        organizationId: orgId,
        email: `team-leadinvite-${Date.now()}@t.local`,
        name: 'X',
        roleInOrg: 'admin',
      },
      actorAdminUserId,
      {},
      'leader'
    );
    expect(res).toEqual({ ok: false, error: 'requires_admin' });
  });

  it('admin (default actorRole) is unrestricted — promotes member to admin', async () => {
    const res = await updateMemberRole(prisma, orgId, memberOrgUserId, 'admin', actorAdminUserId);
    expect(res).toEqual({ ok: true });
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.roleInOrg).toBe('admin');
  });

  it('leader cannot reactivate an inactive admin via inviteMember', async () => {
    // Deactivate the second admin, then a leader re-invites them as 'member'.
    // Without the in-transaction guard this would reactivate + demote an admin.
    await prisma.organizationUser.update({
      where: { id: secondAdminOrgUserId },
      data: { isActive: false },
    });
    const adminUser = await prisma.user.findUnique({ where: { id: secondAdminUserId } });
    const res = await inviteMember(
      prisma,
      { organizationId: orgId, email: adminUser!.email, name: 'Re', roleInOrg: 'member' },
      actorAdminUserId,
      {},
      'leader'
    );
    expect(res).toEqual({ ok: false, error: 'requires_admin' });
    const row = await prisma.organizationUser.findUnique({ where: { id: secondAdminOrgUserId } });
    expect(row?.roleInOrg).toBe('admin'); // untouched
    expect(row?.isActive).toBe(false);
  });
});

describe('cross-organization isolation (IDOR guard)', () => {
  it('refuses to mutate a member belonging to a different organization', async () => {
    // Second org with its own member. actorAdmin only administers `orgId`, so
    // every mutation that targets this foreign membership while claiming `orgId`
    // must be rejected as not_found — see loadOrgUserOrThrow containment check.
    const foreignCompany = await prisma.company.create({
      data: { name: `OrgTeamForeignC-${STAMP}` },
    });
    const foreignOrg = await prisma.organization.create({
      data: { name: `OrgTeamForeign-${STAMP}`, partnerId, companyId: foreignCompany.id },
    });
    const foreignUser = await prisma.user.create({
      data: {
        email: `team-foreign-${Date.now()}@t.local`,
        name: 'Foreign Member',
        role: 'organization',
        passwordHash: 'x',
      },
    });
    const foreignOrgUser = await prisma.organizationUser.create({
      data: {
        organizationId: foreignOrg.id,
        userId: foreignUser.id,
        roleInOrg: 'member',
        isActive: true,
      },
    });

    try {
      expect(
        await updateMemberRole(prisma, orgId, foreignOrgUser.id, 'admin', actorAdminUserId)
      ).toEqual({ ok: false, error: 'not_found' });
      expect(await deactivateMember(prisma, orgId, foreignOrgUser.id, actorAdminUserId)).toEqual({
        ok: false,
        error: 'not_found',
      });
      expect(await reactivateMember(prisma, orgId, foreignOrgUser.id, actorAdminUserId)).toEqual({
        ok: false,
        error: 'not_found',
      });

      // The foreign membership must be completely untouched.
      const untouched = await prisma.organizationUser.findUnique({
        where: { id: foreignOrgUser.id },
      });
      expect(untouched?.roleInOrg).toBe('member');
      expect(untouched?.isActive).toBe(true);
    } finally {
      await prisma.organizationUser.deleteMany({ where: { id: foreignOrgUser.id } });
      await prisma.organization.deleteMany({ where: { id: foreignOrg.id } });
      await prisma.company.deleteMany({ where: { id: foreignCompany.id } });
      await prisma.user.deleteMany({ where: { id: foreignUser.id } });
    }
  });
});
