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
): Promise<
  | { ok: true; user: User; partnerUser: PartnerUser }
  | { ok: false; error: 'org_out_of_scope' | 'email_taken' }
> {
  if (input.assignedOrgIds.length > 0) {
    const inScope = await prisma.organization.count({
      where: { partnerId: input.partnerId, id: { in: input.assignedOrgIds } }
    });
    if (inScope !== input.assignedOrgIds.length) {
      return { ok: false, error: 'org_out_of_scope' };
    }
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return { ok: false, error: 'email_taken' };

  const tempPasswordPlain = randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPasswordPlain, 10);

  const { user, partnerUser } = await prisma.$transaction(async (tx) => {
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

  return { ok: true, user, partnerUser };
}

export async function assignOrgs(
  prisma: PrismaClient,
  args: { partnerId: string; userId: string; assignedOrgIds: string[] }
): Promise<{ ok: true; partnerUser: PartnerUser } | { ok: false; error: 'org_out_of_scope' }> {
  if (args.assignedOrgIds.length > 0) {
    const inScope = await prisma.organization.count({
      where: { partnerId: args.partnerId, id: { in: args.assignedOrgIds } }
    });
    if (inScope !== args.assignedOrgIds.length) {
      return { ok: false, error: 'org_out_of_scope' };
    }
  }

  const partnerUser = await prisma.partnerUser.update({
    where: { partnerId_userId: { partnerId: args.partnerId, userId: args.userId } },
    data: { assignedOrgIds: args.assignedOrgIds }
  });
  return { ok: true, partnerUser };
}

export async function deactivateMember(
  prisma: PrismaClient,
  args: { partnerId: string; userId: string }
): Promise<
  | { ok: true; partnerUser: PartnerUser }
  | { ok: false; error: 'not_found' | 'last_admin_protected' }
> {
  const target = await prisma.partnerUser.findUnique({
    where: { partnerId_userId: { partnerId: args.partnerId, userId: args.userId } }
  });
  if (!target) return { ok: false, error: 'not_found' };

  if (target.roleInPartner === 'admin' && target.isActive) {
    const activeAdmins = await prisma.partnerUser.count({
      where: { partnerId: args.partnerId, roleInPartner: 'admin', isActive: true }
    });
    if (activeAdmins <= 1) return { ok: false, error: 'last_admin_protected' };
  }

  const partnerUser = await prisma.partnerUser.update({
    where: { id: target.id },
    data: { isActive: false }
  });
  return { ok: true, partnerUser };
}
