import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { AdminUserErrorCode } from '@/lib/services/admin/users';
import { recordAudit } from '@/lib/auth/audit';
import { createInviteToken } from '@/lib/auth/passwordReset';

export type AdminPartnerErrorCode = 'forbidden' | 'not_found' | 'duplicate_slug' | AdminUserErrorCode;

export class AdminPartnerError extends Error {
  readonly code: AdminPartnerErrorCode;
  constructor(code: AdminPartnerErrorCode) {
    super(code);
    this.code = code;
    this.name = 'AdminPartnerError';
  }
}

export type PartnerFilters = {
  active?: boolean;
  filter?: 'norate';
  q?: string;
  take?: number;
  skip?: number;
};

export type PartnerRow = {
  id: string;
  name: string;
  slug: string;
  commissionRate: number | null;
  isActive: boolean;
  activeOrgCount: number;
  paidYTD: string; // serialised Decimal for client
};

export async function listPartners(
  prisma: PrismaClient,
  filters: PartnerFilters
): Promise<{ rows: PartnerRow[]; total: number }> {
  const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
  const skip = Math.max(filters.skip ?? 0, 0);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  const where: Prisma.PartnerWhereInput = {};
  if (filters.active !== undefined) where.isActive = filters.active;
  // commissionRate is non-nullable with default 0; 0 means "not set"
  if (filters.filter === 'norate') where.commissionRate = { equals: 0 };
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: 'insensitive' } },
      { slug: { contains: filters.q, mode: 'insensitive' } }
    ];
  }

  const [partners, total] = await Promise.all([
    prisma.partner.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      take,
      skip
    }),
    prisma.partner.count({ where })
  ]);

  const rows: PartnerRow[] = await Promise.all(
    partners.map(async (p) => {
      const [activeOrgCount, paidAgg] = await Promise.all([
        prisma.organization.count({
          where: { partnerId: p.id }
        }),
        prisma.commissionStatement.aggregate({
          where: { partnerId: p.id, status: 'paid', paidAt: { gte: yearStart } },
          _sum: { totalCommissionAmount: true }
        })
      ]);
      const rate = Number(p.commissionRate);
      return {
        id: p.id,
        name: p.name,
        slug: p.slug ?? '',
        commissionRate: rate === 0 ? null : rate,
        isActive: p.isActive,
        activeOrgCount,
        paidYTD: (paidAgg._sum.totalCommissionAmount ?? new Prisma.Decimal(0)).toString()
      };
    })
  );

  return { rows, total };
}

export type PartnerDetail = PartnerRow & {
  admins: Array<{
    partnerUserId: string;
    userId: string;
    email: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
  }>;
};

export async function getPartner(prisma: PrismaClient, id: string): Promise<PartnerDetail | null> {
  const p = await prisma.partner.findUnique({
    where: { id },
    include: {
      partnerUsers: {
        where: { roleInPartner: 'admin' },
        include: {
          user: { select: { id: true, email: true, name: true, isActive: true, createdAt: true } }
        }
      }
    }
  });
  if (!p) return null;

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const [activeOrgCount, paidAgg] = await Promise.all([
    prisma.organization.count({ where: { partnerId: p.id } }),
    prisma.commissionStatement.aggregate({
      where: { partnerId: p.id, status: 'paid', paidAt: { gte: yearStart } },
      _sum: { totalCommissionAmount: true }
    })
  ]);

  const rate = Number(p.commissionRate);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug ?? '',
    commissionRate: rate === 0 ? null : rate,
    isActive: p.isActive,
    activeOrgCount,
    paidYTD: (paidAgg._sum.totalCommissionAmount ?? new Prisma.Decimal(0)).toString(),
    admins: p.partnerUsers.map((pu) => ({
      partnerUserId: pu.id,
      userId: pu.userId,
      email: pu.user.email,
      name: pu.user.name,
      isActive: pu.user.isActive,
      createdAt: pu.user.createdAt
    }))
  };
}

export type UpdatePartnerArgs = {
  name?: string;
  commissionRate?: number | null;
  isActive?: boolean;
  effectiveFrom?: Date; // A5: дата вступления ставки; default now()
};

export async function updatePartner(
  prisma: PrismaClient,
  actorUserId: string,
  id: string,
  args: UpdatePartnerArgs
): Promise<{ ok: true } | { ok: false; error: AdminPartnerErrorCode }> {
  try {
    await prisma.$transaction(async (tx) => {
    const before = await tx.partner.findUnique({
      where: { id },
      select: { name: true, commissionRate: true, isActive: true }
    });
    if (!before) throw new AdminPartnerError('not_found');

    const rateUpdate =
      args.commissionRate !== undefined
        ? { commissionRate: args.commissionRate === null ? new Prisma.Decimal(0) : new Prisma.Decimal(args.commissionRate) }
        : {};

    const updated = await tx.partner.update({
      where: { id },
      data: {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...rateUpdate,
        ...(args.isActive !== undefined ? { isActive: args.isActive } : {})
      }
    });

    if (args.commissionRate !== undefined) {
      const newDec = args.commissionRate === null ? new Prisma.Decimal(0) : new Prisma.Decimal(args.commissionRate);
      if (!newDec.equals(before.commissionRate ?? new Prisma.Decimal(0))) {
        await tx.commissionRateChange.create({
          data: {
            partnerId: id,
            oldRate: before.commissionRate ?? null,
            newRate: newDec,
            effectiveFrom: args.effectiveFrom ?? new Date(),
            changedById: actorUserId
          }
        });
      }
    }

    await recordAudit(tx, {
      userId: actorUserId,
      action: 'partner_updated',
      entity: 'partner',
      entityId: id,
      before: {
        name: before.name,
        commissionRate: before.commissionRate?.toString() ?? null,
        isActive: before.isActive
      },
      after: {
        name: updated.name,
        commissionRate: updated.commissionRate?.toString() ?? null,
        isActive: updated.isActive
      }
    });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AdminPartnerError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function deactivatePartner(
  prisma: PrismaClient,
  actorUserId: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: AdminPartnerErrorCode }> {
  try {
    await prisma.$transaction(async (tx) => {
    const before = await tx.partner.findUnique({ where: { id }, select: { isActive: true } });
    if (!before) throw new AdminPartnerError('not_found');
    if (!before.isActive) return;

    await tx.partner.update({ where: { id }, data: { isActive: false } });
    await recordAudit(tx, {
      userId: actorUserId,
      action: 'partner_deactivated',
      entity: 'partner',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false }
    });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AdminPartnerError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function reactivatePartner(
  prisma: PrismaClient,
  actorUserId: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: AdminPartnerErrorCode }> {
  try {
    await prisma.$transaction(async (tx) => {
    const before = await tx.partner.findUnique({ where: { id }, select: { isActive: true } });
    if (!before) throw new AdminPartnerError('not_found');
    if (before.isActive) return;

    await tx.partner.update({ where: { id }, data: { isActive: true } });
    await recordAudit(tx, {
      userId: actorUserId,
      action: 'partner_reactivated',
      entity: 'partner',
      entityId: id,
      before: { isActive: false },
      after: { isActive: true }
    });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AdminPartnerError) return { ok: false, error: e.code };
    throw e;
  }
}

export type CreatePartnerWithAdminArgs = {
  name: string;
  slug: string;
  commissionRate?: number | null;
  adminEmail: string;
  adminName: string;
};

export type CreatePartnerWithAdminResult = {
  partner: { id: string; name: string; slug: string };
  user: { id: string; email: string };
  inviteToken: string;
};

export async function createPartnerWithAdmin(
  prisma: PrismaClient,
  actorUserId: string,
  args: CreatePartnerWithAdminArgs
): Promise<
  | ({ ok: true } & CreatePartnerWithAdminResult)
  | { ok: false; error: AdminPartnerErrorCode }
> {
  try {
    const result = await prisma.$transaction(async (tx) => {
    const slugExists = await tx.partner.findUnique({ where: { slug: args.slug } });
    if (slugExists) throw new AdminPartnerError('duplicate_slug');

    const emailExists = await tx.user.findUnique({ where: { email: args.adminEmail } });
    if (emailExists) throw new AdminPartnerError('duplicate_email');

    // commissionRate is Decimal NOT NULL with default 0; null/undefined means "no rate" → Decimal(0)
    const partner = await tx.partner.create({
      data: {
        name: args.name,
        slug: args.slug,
        commissionRate: args.commissionRate != null ? new Prisma.Decimal(args.commissionRate) : new Prisma.Decimal(0),
        isActive: true
      }
    });

    const user = await tx.user.create({
      data: {
        email: args.adminEmail,
        name: args.adminName,
        role: 'partner',
        partnerId: partner.id,
        passwordHash: null,
        isActive: true
      }
    });

    await tx.partnerUser.create({
      data: {
        userId: user.id,
        partnerId: partner.id,
        roleInPartner: 'admin',
        assignedOrgIds: []
      }
    });

    const { token } = await createInviteToken(tx, user.id);

    if (args.commissionRate != null && args.commissionRate !== 0) {
      await tx.commissionRateChange.create({
        data: {
          partnerId: partner.id,
          oldRate: null,
          newRate: new Prisma.Decimal(args.commissionRate),
          changedById: actorUserId
        }
      });
    }

    await recordAudit(tx, {
      userId: actorUserId,
      action: 'partner_created',
      entity: 'partner',
      entityId: partner.id,
      after: {
        name: args.name,
        slug: args.slug,
        commissionRate: args.commissionRate != null ? String(args.commissionRate) : null,
        adminUserId: user.id,
        adminEmail: args.adminEmail
      }
    });

    return {
      partner: { id: partner.id, name: partner.name, slug: partner.slug ?? '' },
      user: { id: user.id, email: user.email },
      inviteToken: token
    };
    });
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof AdminPartnerError) return { ok: false, error: e.code };
    throw e;
  }
}
