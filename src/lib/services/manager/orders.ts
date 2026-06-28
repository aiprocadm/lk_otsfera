import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  managerOrderScope,
  canSeeOrder,
  getCompanyTeamVisibility,
  isLeaderSameCompany
} from '@/lib/auth/managerPolicy';

/**
 * Manager-facing orders service. All visibility is governed by the three-way
 * RBAC scope from `managerOrderScopeFilter`:
 *   1. Per-order: `Order.managerId == session.sub`
 *   2. Per-org:   `Order.organizationId` ∈ session.managedOrgIds
 *   3. Historical: this user ever commented on the order
 *
 * The `comments-history` branch lets a manager keep seeing orders they were
 * once attached to even after their `OrganizationManager` row is removed by an
 * admin (см. plan §3 + §5).
 */

const ListOrdersOptionsSchema = z.object({
  session: z.custom<SessionPayload>((v) => !!v && typeof v === 'object' && 'sub' in (v as object)),
  search: z.string().optional(),
  executionStatus: z.string().optional(),
  financialStatus: z.string().optional(),
  organizationId: z.string().optional(),
  take: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  // Кабинет руководителя форсит company-wide независимо от toggle ("играющий
  // тренер": личный /manager-кабинет лидера остаётся scoped, см. CLAUDE.md §4).
  teamModeOverride: z.boolean().optional()
});

export type ListOrdersOptions = z.input<typeof ListOrdersOptionsSchema>;

const LIST_INCLUDE = {
  organization: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true, email: true } }
} satisfies Prisma.OrderInclude;

export type ManagerOrderRow = Prisma.OrderGetPayload<{ include: typeof LIST_INCLUDE }>;

export type ListOrdersResult = {
  rows: ManagerOrderRow[];
  nextCursor: string | null;
};

export async function listOrders(
  prisma: PrismaClient,
  optsRaw: ListOrdersOptions
): Promise<ListOrdersResult> {
  const opts = ListOrdersOptionsSchema.parse(optsRaw);
  const teamMode =
    opts.teamModeOverride ?? (await getCompanyTeamVisibility(prisma, opts.session.companyId));
  const scope = managerOrderScope(opts.session, teamMode);
  const filters: Prisma.OrderWhereInput[] = [scope];
  if (opts.executionStatus) {
    filters.push({ executionStatus: opts.executionStatus as Prisma.OrderWhereInput['executionStatus'] });
  }
  if (opts.financialStatus) {
    filters.push({ financialStatus: opts.financialStatus as Prisma.OrderWhereInput['financialStatus'] });
  }
  if (opts.organizationId) {
    filters.push({ organizationId: opts.organizationId });
  }
  if (opts.search) {
    filters.push({
      OR: [
        { title: { contains: opts.search, mode: 'insensitive' } },
        { orderNumber: { contains: opts.search, mode: 'insensitive' } }
      ]
    });
  }

  const rows = await prisma.order.findMany({
    where: { AND: filters },
    include: LIST_INCLUDE,
    orderBy: { id: 'desc' },
    take: opts.take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {})
  });

  const hasMore = rows.length > opts.take;
  const sliced = hasMore ? rows.slice(0, opts.take) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]!.id : null;
  return { rows: sliced, nextCursor };
}

const DETAIL_INCLUDE = {
  documents: { where: { scanStatus: { not: 'infected' } } },
  payments: true,
  manager: { select: { id: true, name: true, email: true } },
  organization: { select: { id: true, name: true } },
  _count: { select: { comments: true } }
} satisfies Prisma.OrderInclude;

export type ManagerOrderDetail = Prisma.OrderGetPayload<{ include: typeof DETAIL_INCLUDE }> & {
  commentsCountByMe: number;
};

export async function getOrder(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<ManagerOrderDetail | null> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      ...DETAIL_INCLUDE,
      comments: {
        where: { authorId: session.sub },
        take: 1,
        select: { id: true }
      }
    }
  });
  if (!order) return null;
  const commentsCountByMe = order.comments.length;
  // `order` is a findUnique-with-include, so the scalar `companyId` is present.
  // Руководитель открывает любую деталь заказа своей компании (лидер-инвариант
  // C8: граница — компания). Cross-company держится `order.companyId === session.companyId`;
  // при companyId=null правило не срабатывает → нормальный canSeeOrder (deny).
  const leaderSameCompany = isLeaderSameCompany(session, order.companyId);
  if (!leaderSameCompany && !canSeeOrder(session, { ...order, commentsCountByMe }, teamMode)) {
    return null;
  }
  // Strip the helper comments[] used only for the RBAC probe — the caller
  // gets the _count.comments aggregate plus the explicit commentsCountByMe.
  const { comments: _probe, ...rest } = order;
  void _probe;
  return { ...rest, commentsCountByMe };
}
