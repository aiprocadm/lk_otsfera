import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { AdminUserErrorCode } from '@/lib/services/admin/users';

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
