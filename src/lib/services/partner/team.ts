import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient, PartnerUser, User } from '@prisma/client';

export type TeamRow = {
  userId: string;
  partnerUserId: string;
  email: string;
  name: string;
  roleInPartner: 'admin' | 'manager';
  assignedOrgIds: string[];
  isActive: boolean;
  createdAt: Date;
};

export async function listTeam(
  prisma: PrismaClient,
  partnerId: string
): Promise<TeamRow[]> {
  const rows = await prisma.partnerUser.findMany({
    where: { partnerId },
    include: { user: { select: { email: true, name: true } } },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }]
  });

  return rows.map((r) => ({
    userId: r.userId,
    partnerUserId: r.id,
    email: r.user.email,
    name: r.user.name,
    roleInPartner: r.roleInPartner === 'admin' ? 'admin' : 'manager',
    assignedOrgIds: r.assignedOrgIds,
    isActive: r.isActive,
    createdAt: r.createdAt
  }));
}

export type InviteInput = {
  partnerId: string;
  email: string;
  name: string;
  roleInPartner: 'admin' | 'manager';
  assignedOrgIds: string[];
};

export async function inviteMember(
  prisma: PrismaClient,
  input: InviteInput
): Promise<{ user: User; partnerUser: PartnerUser }> {
  if (input.assignedOrgIds.length > 0) {
    const inScope = await prisma.organization.count({
      where: { partnerId: input.partnerId, id: { in: input.assignedOrgIds } }
    });
    if (inScope !== input.assignedOrgIds.length) {
      throw new Error('ORG_OUT_OF_SCOPE');
    }
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new Error('EMAIL_TAKEN: user with this email already exists');

  const tempPasswordPlain = randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPasswordPlain, 10);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: 'partner',
        partnerId: input.partnerId,
        passwordHash
      }
    });

    const partnerUser = await tx.partnerUser.create({
      data: {
        partnerId: input.partnerId,
        userId: user.id,
        roleInPartner: input.roleInPartner,
        assignedOrgIds: input.assignedOrgIds,
        isActive: true
      }
    });

    return { user, partnerUser };
  });
}

export async function assignOrgs(
  prisma: PrismaClient,
  args: { partnerId: string; userId: string; assignedOrgIds: string[] }
): Promise<PartnerUser> {
  if (args.assignedOrgIds.length > 0) {
    const inScope = await prisma.organization.count({
      where: { partnerId: args.partnerId, id: { in: args.assignedOrgIds } }
    });
    if (inScope !== args.assignedOrgIds.length) {
      throw new Error('ORG_OUT_OF_SCOPE');
    }
  }

  return prisma.partnerUser.update({
    where: { partnerId_userId: { partnerId: args.partnerId, userId: args.userId } },
    data: { assignedOrgIds: args.assignedOrgIds }
  });
}

export async function deactivateMember(
  prisma: PrismaClient,
  args: { partnerId: string; userId: string }
): Promise<PartnerUser> {
  const target = await prisma.partnerUser.findUnique({
    where: { partnerId_userId: { partnerId: args.partnerId, userId: args.userId } }
  });
  if (!target) throw new Error('NOT_FOUND');

  if (target.roleInPartner === 'admin' && target.isActive) {
    const activeAdmins = await prisma.partnerUser.count({
      where: { partnerId: args.partnerId, roleInPartner: 'admin', isActive: true }
    });
    if (activeAdmins <= 1) throw new Error('LAST_ADMIN: cannot deactivate the last active admin');
  }

  return prisma.partnerUser.update({
    where: { id: target.id },
    data: { isActive: false }
  });
}
