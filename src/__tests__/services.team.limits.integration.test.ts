/**
 * B5 (§14 ТЗ) — user limits enforced server-side: organization ≤ 10 active
 * contacts, partner ≤ 5 active users. Deactivated members do NOT occupy a slot.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inviteMember as inviteOrgMember } from '@/lib/services/organization/team';
import { inviteMember as invitePartnerMember } from '@/lib/services/partner/team';
import { MAX_ORGANIZATION_USERS, MAX_PARTNER_USERS } from '@/lib/config/teamLimits';

const prisma = new PrismaClient();
const TAG = `teamlimit-it-${Date.now()}`;

let companyId = '';
let orgFull = ''; // 10 active members
let orgWithInactive = ''; // 9 active + 1 inactive
let partnerFull = ''; // 5 active users
let actorId = '';

async function makeUser(suffix: string) {
  return prisma.user.create({
    data: { email: `${TAG}-${suffix}@x`, name: suffix, role: 'organization', passwordHash: 'x' }
  });
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `${TAG}-co` } });
  companyId = company.id;
  const actor = await makeUser('actor');
  actorId = actor.id;

  const oFull = await prisma.organization.create({ data: { name: `${TAG}-orgFull`, companyId } });
  orgFull = oFull.id;
  for (let i = 0; i < MAX_ORGANIZATION_USERS; i++) {
    const u = await makeUser(`of-${i}`);
    await prisma.organizationUser.create({
      data: { organizationId: orgFull, userId: u.id, roleInOrg: 'member', isActive: true }
    });
  }

  const oInactive = await prisma.organization.create({ data: { name: `${TAG}-orgInactive`, companyId } });
  orgWithInactive = oInactive.id;
  for (let i = 0; i < MAX_ORGANIZATION_USERS; i++) {
    const u = await makeUser(`oi-${i}`);
    await prisma.organizationUser.create({
      // last one deactivated → 9 active + 1 inactive
      data: { organizationId: orgWithInactive, userId: u.id, roleInOrg: 'member', isActive: i < MAX_ORGANIZATION_USERS - 1 }
    });
  }

  const partner = await prisma.partner.create({ data: { name: `${TAG}-partner` } });
  partnerFull = partner.id;
  for (let i = 0; i < MAX_PARTNER_USERS; i++) {
    const u = await makeUser(`pf-${i}`);
    await prisma.partnerUser.create({
      data: { partnerId: partnerFull, userId: u.id, roleInPartner: 'manager', assignedOrgIds: [], isActive: true }
    });
  }
});

afterAll(async () => {
  await prisma.passwordResetToken.deleteMany({ where: { user: { email: { startsWith: TAG } } } });
  await prisma.auditLog.deleteMany({ where: { user: { email: { startsWith: TAG } } } });
  await prisma.organizationUser.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.partnerUser.deleteMany({ where: { partner: { name: { startsWith: TAG } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe('organization user limit', () => {
  it('rejects the 11th active contact', async () => {
    const res = await inviteOrgMember(
      prisma,
      { organizationId: orgFull, email: `${TAG}-org11@x`, name: 'Eleventh', roleInOrg: 'member' },
      actorId,
      { source: 'organization' },
      'admin'
    );
    expect(res).toEqual({ ok: false, error: 'member_limit_reached' });
    // Rolled back — no orphan user created.
    const created = await prisma.user.findUnique({ where: { email: `${TAG}-org11@x` } });
    expect(created).toBeNull();
  });

  it('allows an invite when a slot is free because a member is deactivated', async () => {
    const res = await inviteOrgMember(
      prisma,
      { organizationId: orgWithInactive, email: `${TAG}-org10@x`, name: 'Tenth', roleInOrg: 'member' },
      actorId,
      { source: 'organization' },
      'admin'
    );
    expect(res.ok).toBe(true);
    const activeNow = await prisma.organizationUser.count({
      where: { organizationId: orgWithInactive, isActive: true }
    });
    expect(activeNow).toBe(MAX_ORGANIZATION_USERS);
  });
});

describe('partner user limit', () => {
  it('rejects the 6th user', async () => {
    const res = await invitePartnerMember(prisma, {
      partnerId: partnerFull,
      email: `${TAG}-p6@x`,
      name: 'Sixth',
      roleInPartner: 'manager',
      assignedOrgIds: []
    });
    expect(res).toEqual({ ok: false, error: 'member_limit_reached' });
    const created = await prisma.user.findUnique({ where: { email: `${TAG}-p6@x` } });
    expect(created).toBeNull();
  });
});
