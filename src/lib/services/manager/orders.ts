import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  managerOrderScope,
  canSeeOrder,
  getCompanyTeamVisibility,
  isLeaderSameCompany,
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
  /** §10: фильтр по рабочему статусу (id строки справочника). */
  statusId: z.string().optional(),
  financialStatus: z.string().optional(),
  organizationId: z.string().optional(),
  // «Без менеджера»: только заказы без персонального менеджера (Order.managerId IS NULL).
  unassigned: z.boolean().optional(),
  take: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  // Кабинет руководителя форсит company-wide независимо от toggle ("играющий
  // тренер": личный /manager-кабинет лидера остаётся scoped, см. CLAUDE.md §4).
  teamModeOverride: z.boolean().optional(),
});

export type ListOrdersOptions = z.input<typeof ListOrdersOptionsSchema>;

const LIST_INCLUDE = {
  organization: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true, email: true } },
  // §10 ТЗ v0.5: в списке показываем рабочий статус из справочника — тот же,
  // что на карточке. Операционный `executionStatus` из интерфейса убран
  // (решение Q3), поэтому бейджи по нему больше не строим.
  statusDefinition: { select: { id: true, label: true, isTerminal: true } },
} satisfies Prisma.OrderInclude;

export type ManagerOrderRow = Prisma.OrderGetPayload<{ include: typeof LIST_INCLUDE }>;

export type ListOrdersResult = {
  rows: ManagerOrderRow[];
  nextCursor: string | null;
};

/**
 * Фильтры списка заказов поверх RBAC-скоупа. Общие для экрана (`listOrders`) и
 * выгрузки (`listOrdersForExport`) — ФТ-12.1 требует, чтобы файл строился той же
 * выборкой, что и таблица, и уважал активные фильтры.
 */
function buildOrdersFilters(
  opts: z.output<typeof ListOrdersOptionsSchema>,
  scope: Prisma.OrderWhereInput
): Prisma.OrderWhereInput[] {
  const filters: Prisma.OrderWhereInput[] = [scope];
  if (opts.statusId) {
    filters.push({ statusId: opts.statusId });
  }
  if (opts.executionStatus) {
    filters.push({
      executionStatus: opts.executionStatus as NonNullable<
        Prisma.OrderWhereInput['executionStatus']
      >,
    });
  }
  if (opts.financialStatus) {
    filters.push({
      financialStatus: opts.financialStatus as NonNullable<
        Prisma.OrderWhereInput['financialStatus']
      >,
    });
  }
  if (opts.organizationId) {
    filters.push({ organizationId: opts.organizationId });
  }
  if (opts.unassigned) {
    filters.push({ managerId: null });
  }
  if (opts.search) {
    filters.push({
      OR: [
        { title: { contains: opts.search, mode: 'insensitive' } },
        { orderNumber: { contains: opts.search, mode: 'insensitive' } },
      ],
    });
  }
  return filters;
}

export async function listOrders(
  prisma: PrismaClient,
  optsRaw: ListOrdersOptions
): Promise<ListOrdersResult> {
  const opts = ListOrdersOptionsSchema.parse(optsRaw);
  const teamMode =
    opts.teamModeOverride ?? (await getCompanyTeamVisibility(prisma, opts.session.companyId));
  const scope = managerOrderScope(opts.session, teamMode);
  const filters = buildOrdersFilters(opts, scope);

  const rows = await prisma.order.findMany({
    where: { AND: filters },
    include: LIST_INCLUDE,
    orderBy: { id: 'desc' },
    take: opts.take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > opts.take;
  const sliced = hasMore ? rows.slice(0, opts.take) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]!.id : null;
  return { rows: sliced, nextCursor };
}

/** Лимит строк выгрузки заказов (ФТ-12.1, как у реестра удостоверений). */
export const ORDERS_EXPORT_LIMIT = 10_000;

export type ListOrdersForExportOptions = Omit<ListOrdersOptions, 'take' | 'cursor'>;

/**
 * Выгрузка заказов (этап 9, ФТ-12.2): та же выборка и те же фильтры, что у
 * экрана, но одной страницей до `ORDERS_EXPORT_LIMIT` строк. `total` нужен
 * рендереру для хвоста «показаны первые N из M».
 */
export async function listOrdersForExport(
  prisma: PrismaClient,
  optsRaw: ListOrdersForExportOptions
): Promise<{ rows: ManagerOrderRow[]; total: number }> {
  const opts = ListOrdersOptionsSchema.parse(optsRaw);
  const teamMode =
    opts.teamModeOverride ?? (await getCompanyTeamVisibility(prisma, opts.session.companyId));
  const scope = managerOrderScope(opts.session, teamMode);
  const where: Prisma.OrderWhereInput = { AND: buildOrdersFilters(opts, scope) };

  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { id: 'desc' },
      take: ORDERS_EXPORT_LIMIT,
    }),
  ]);
  return { rows, total };
}

const DETAIL_INCLUDE = {
  // `У-151`: в карточке заказа — действующие версии документов.
  documents: { where: { scanStatus: { not: 'infected' }, supersededAt: null } },
  payments: true,
  manager: { select: { id: true, name: true, email: true } },
  organization: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
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
        select: { id: true },
      },
    },
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
