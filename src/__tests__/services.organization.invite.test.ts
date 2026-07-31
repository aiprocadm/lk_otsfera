import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createOrgAdminInvite, OrgInviteError } from '@/lib/services/organization/invite';

let prisma: PrismaClient;
let partnerAId: string;
let partnerBId: string;
let companyId: string;
let orgAId: string; // belongs to partnerA
let orgBId: string; // belongs to partnerB
let actorPartnerAdminAId: string;
let actorPlatformAdminId: string;
const STAMP = Date.now();

beforeAll(async () => {
  prisma = new PrismaClient();
  const a = await prisma.partner.create({
    data: { name: `InviteSvcPA-${STAMP}`, commissionRate: 0.1 },
  });
  partnerAId = a.id;
  const b = await prisma.partner.create({
    data: { name: `InviteSvcPB-${STAMP}`, commissionRate: 0.1 },
  });
  partnerBId = b.id;
  const company = await prisma.company.create({ data: { name: `InviteSvcC-${STAMP}` } });
  companyId = company.id;
  const oa = await prisma.organization.create({
    data: { name: `InviteSvcOrgA-${STAMP}`, partnerId: partnerAId, companyId },
  });
  orgAId = oa.id;
  const ob = await prisma.organization.create({
    data: { name: `InviteSvcOrgB-${STAMP}`, partnerId: partnerBId, companyId },
  });
  orgBId = ob.id;

  const pa = await prisma.user.create({
    data: {
      email: `invite-partnerA-${STAMP}@t.local`,
      name: 'Partner A admin',
      role: 'partner',
      partnerId: partnerAId,
      passwordHash: 'x',
    },
  });
  actorPartnerAdminAId = pa.id;
  const adm = await prisma.user.create({
    data: {
      email: `invite-admin-${STAMP}@t.local`,
      name: 'Platform admin',
      role: 'admin',
      passwordHash: 'x',
    },
  });
  actorPlatformAdminId = adm.id;
});

afterAll(async () => {
  const testUsers = await prisma.user.findMany({
    where: { email: { contains: 'invite-' } },
    select: { id: true },
  });
  const ids = testUsers.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { entity: 'organization_user' } });
  if (ids.length) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerAId, partnerBId] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.organizationUser.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
});

describe('createOrgAdminInvite', () => {
  it('throws not_found when organization does not exist', async () => {
    await expect(
      createOrgAdminInvite(
        prisma,
        { organizationId: 'org-does-not-exist', email: 'x@x.x', name: 'X' },
        { actorUserId: actorPlatformAdminId, source: 'platform_admin' }
      )
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('partner-admin can invite into their own portfolio org', async () => {
    const email = `invite-target-pa-${Date.now()}@t.local`;
    const result = await createOrgAdminInvite(
      prisma,
      { organizationId: orgAId, email, name: 'Customer A' },
      {
        actorUserId: actorPartnerAdminAId,
        source: 'partner',
        actorPartnerId: partnerAId,
      }
    );
    expect(result.user.email).toBe(email);
    expect(result.inviteUrl).toMatch(/\/reset-password\?token=/);

    const orgUser = await prisma.organizationUser.findFirst({
      where: { organizationId: orgAId, userId: result.user.id },
    });
    expect(orgUser?.roleInOrg).toBe('admin');
    expect(orgUser?.isActive).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {
        entity: 'organization_user',
        entityId: orgUser!.id,
        action: 'org_member_invited',
      },
    });
    expect(audit).not.toBeNull();
    expect((audit!.meta as Record<string, unknown>).after).toMatchObject({
      source: 'partner',
      roleInOrg: 'admin',
    });
  });

  it('partner-admin CANNOT invite into another partner organisation (forbidden)', async () => {
    await expect(
      createOrgAdminInvite(
        prisma,
        { organizationId: orgBId, email: `forbidden-${Date.now()}@t.local`, name: 'X' },
        {
          actorUserId: actorPartnerAdminAId,
          source: 'partner',
          actorPartnerId: partnerAId,
        }
      )
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('partner-admin without actorPartnerId is forbidden even from own-looking org', async () => {
    await expect(
      createOrgAdminInvite(
        prisma,
        { organizationId: orgAId, email: `forbidden-2-${Date.now()}@t.local`, name: 'X' },
        { actorUserId: actorPartnerAdminAId, source: 'partner' }
      )
    ).rejects.toThrow(OrgInviteError);
  });

  it('platform-admin can invite into any organisation', async () => {
    const email = `invite-target-admin-${Date.now()}@t.local`;
    const result = await createOrgAdminInvite(
      prisma,
      { organizationId: orgBId, email, name: 'Customer B' },
      { actorUserId: actorPlatformAdminId, source: 'platform_admin' }
    );
    expect(result.user.email).toBe(email);

    const orgUser = await prisma.organizationUser.findFirst({
      where: { organizationId: orgBId, userId: result.user.id },
    });
    expect(orgUser?.roleInOrg).toBe('admin');

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'organization_user', entityId: orgUser!.id },
    });
    expect((audit!.meta as Record<string, unknown>).after).toMatchObject({
      source: 'platform_admin',
    });
  });
});
