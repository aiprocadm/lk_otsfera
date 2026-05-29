import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { AdminUserErrorCode } from '@/lib/services/admin/users';
import { recordAudit } from '@/lib/auth/audit';

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
          where: { orders: { some: { partnerId: p.id } } }
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
    prisma.organization.count({ where: { orders: { some: { partnerId: p.id } } } }),
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
};

export async function updatePartner(
  prisma: PrismaClient,
  actorUserId: string,
  id: string,
  args: UpdatePartnerArgs
): Promise<void> {
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
}

export async function deactivatePartner(
  prisma: PrismaClient,
  actorUserId: string,
  id: string
): Promise<void> {
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
}

export async function reactivatePartner(
  prisma: PrismaClient,
  actorUserId: string,
  id: string
): Promise<void> {
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
}
