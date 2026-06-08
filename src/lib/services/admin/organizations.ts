import type { PrismaClient, Prisma } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

export type AdminOrgErrorCode = 'forbidden' | 'not_found';

export class AdminOrgError extends Error {
  readonly code: AdminOrgErrorCode;
  constructor(code: AdminOrgErrorCode) {
    super(code);
    this.code = code;
    this.name = 'AdminOrgError';
  }
}

export type OrgFilters = {
  q?: string;
  partnerId?: string;
  withRateOverride?: boolean;
  take?: number;
  skip?: number;
};

export type OrgRow = {
  id: string;
  name: string;
  inn: string | null;
  externalId: string | null;
  partner: { id: string; name: string } | null;
  ordersCount: number;
  organizationUsersCount: number;
  partnerCommissionRate: number | null;
};

export async function listOrganizations(
  prisma: PrismaClient,
  filters: OrgFilters
): Promise<{ rows: OrgRow[]; total: number }> {
  const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
  const skip = Math.max(filters.skip ?? 0, 0);

  const where: Prisma.OrganizationWhereInput = {};
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: 'insensitive' } },
      { inn: { contains: filters.q, mode: 'insensitive' } },
      { externalId: { contains: filters.q, mode: 'insensitive' } }
    ];
  }
  if (filters.partnerId) where.partnerId = filters.partnerId;
  if (filters.withRateOverride === true) where.partnerCommissionRate = { not: null };
  if (filters.withRateOverride === false) where.partnerCommissionRate = null;

  const [orgs, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        partner: { select: { id: true, name: true } },
        _count: { select: { orders: true, organizationUsers: true } }
      },
      orderBy: { name: 'asc' },
      take,
      skip
    }),
    prisma.organization.count({ where })
  ]);

  const rows: OrgRow[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    inn: o.inn,
    externalId: o.externalId,
    partner: o.partner ? { id: o.partner.id, name: o.partner.name } : null,
    ordersCount: o._count.orders,
    organizationUsersCount: o._count.organizationUsers,
    partnerCommissionRate: o.partnerCommissionRate !== null ? Number(o.partnerCommissionRate) : null
  }));

  return { rows, total };
}

export type OrgDetail = {
  id: string;
  name: string;
  inn: string | null;
  kpp: string | null;
  externalId: string | null;
  partnerId: string | null;
  partner: { id: string; name: string } | null;
  partnerCommissionRate: number | null;
  partnerCommissionRateNote: string | null;
};

export async function getOrganization(prisma: PrismaClient, id: string): Promise<OrgDetail | null> {
  const o = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      inn: true,
      kpp: true,
      externalId: true,
      partnerId: true,
      partner: { select: { id: true, name: true } },
      partnerCommissionRate: true,
      partnerCommissionRateNote: true
    }
  });
  if (!o) return null;
  return {
    id: o.id,
    name: o.name,
    inn: o.inn,
    kpp: o.kpp,
    externalId: o.externalId,
    partnerId: o.partnerId,
    partner: o.partner ? { id: o.partner.id, name: o.partner.name } : null,
    partnerCommissionRate: o.partnerCommissionRate !== null ? Number(o.partnerCommissionRate) : null,
    partnerCommissionRateNote: o.partnerCommissionRateNote
  };
}

export type UpdateOrgArgs = {
  name?: string;
  inn?: string | null;
  kpp?: string | null;
};

export async function updateOrganization(
  prisma: PrismaClient,
  actorUserId: string,
  id: string,
  args: UpdateOrgArgs
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUnique({
      where: { id },
      select: { name: true, inn: true, kpp: true }
    });
    if (!before) throw new AdminOrgError('not_found');

    await tx.organization.update({
      where: { id },
      data: {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.inn !== undefined ? { inn: args.inn } : {}),
        ...(args.kpp !== undefined ? { kpp: args.kpp } : {})
      }
    });

    await recordAudit(tx, {
      userId: actorUserId,
      action: 'organization_updated',
      entity: 'organization',
      entityId: id,
      before,
      after: args
    });
  });
}
