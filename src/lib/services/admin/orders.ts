import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Карточка заказа для админского зеркала (Model A): без скоупа по компании —
 * гард `requireAdmin` остаётся на странице, сервис только читает.
 *
 * Возвращает заказ вместе с организацией, партнёром и назначенным менеджером;
 * `null` — заказа нет (страница отвечает `notFound()`).
 */
export async function getOrderForAdmin(prisma: PrismaClient, id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true } },
      partner: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true, email: true } },
    },
  });
}

/**
 * Список заказов администратора (`У-112`).
 *
 * Раздела не было: `/admin/orders` молча уводил на дашборд, и посмотреть заказы
 * **всех компаний** в одном месте было негде — админ шёл в чужой кабинет или в
 * базу. Скоупа по компании здесь нет намеренно (Model A, §4 CLAUDE.md): гард
 * `requireAdmin` стоит на странице, сервис только читает.
 *
 * Фильтры повторяют менеджерские — плюс фильтр по компании, которого у
 * менеджера быть не может: он всегда внутри одной.
 */
const ListAdminOrdersSchema = z.object({
  search: z.string().optional(),
  statusId: z.string().optional(),
  financialStatus: z.string().optional(),
  organizationId: z.string().optional(),
  companyId: z.string().optional(),
  /** Только заказы без персонального менеджера. */
  unassigned: z.boolean().optional(),
  take: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ListAdminOrdersOptions = z.input<typeof ListAdminOrdersSchema>;

const ADMIN_LIST_INCLUDE = {
  organization: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true, email: true } },
  company: { select: { id: true, name: true } },
  statusDefinition: { select: { id: true, label: true, isTerminal: true } },
} satisfies Prisma.OrderInclude;

export type AdminOrderRow = Prisma.OrderGetPayload<{ include: typeof ADMIN_LIST_INCLUDE }>;

export async function listOrdersForAdmin(
  prisma: PrismaClient,
  optsRaw: ListAdminOrdersOptions = {}
): Promise<{ rows: AdminOrderRow[]; nextCursor: string | null }> {
  const opts = ListAdminOrdersSchema.parse(optsRaw);

  const filters: Prisma.OrderWhereInput[] = [];
  if (opts.statusId) filters.push({ statusId: opts.statusId });
  if (opts.financialStatus) {
    filters.push({
      financialStatus: opts.financialStatus as NonNullable<
        Prisma.OrderWhereInput['financialStatus']
      >,
    });
  }
  if (opts.organizationId) filters.push({ organizationId: opts.organizationId });
  if (opts.companyId) filters.push({ companyId: opts.companyId });
  if (opts.unassigned) filters.push({ managerId: null });
  if (opts.search) {
    filters.push({
      OR: [
        { title: { contains: opts.search, mode: 'insensitive' } },
        { orderNumber: { contains: opts.search, mode: 'insensitive' } },
      ],
    });
  }

  const rows = await prisma.order.findMany({
    ...(filters.length ? { where: { AND: filters } } : {}),
    include: ADMIN_LIST_INCLUDE,
    orderBy: { id: 'desc' },
    take: opts.take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > opts.take;
  const sliced = hasMore ? rows.slice(0, opts.take) : rows;
  return { rows: sliced, nextCursor: hasMore ? (sliced[sliced.length - 1]?.id ?? null) : null };
}

/** Компании для фильтра списка заказов — по названию, как в справочниках. */
export async function listCompanyOptions(
  prisma: PrismaClient
): Promise<Array<{ id: string; name: string }>> {
  return prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
}
