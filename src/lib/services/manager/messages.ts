import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { orderWhereForLevel } from '@/lib/auth/accessProfile';

/**
 * Manager-facing messages inbox service. Lists `Comment` rows whose `order`
 * the manager can see through the three-way RBAC scope filter (per-order,
 * per-org, comments-history). When `withOutgoing` is false (the default), only
 * comments authored by an `organization` user are returned (the inbox of
 * incoming questions). When true, the manager's own outgoing replies are
 * mixed in so the page can render an "all conversations" view.
 *
 * Pagination is cursor-based on `Comment.id` (descending) and mirrors the
 * pattern used in `services/manager/orders.ts`.
 */

const DEFAULT_TAKE = 30;
const MAX_TAKE = 100;
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const ListIncomingCommentsOptionsSchema = z.object({
  session: z.custom<SessionPayload>((v) => !!v && typeof v === 'object' && 'sub' in (v as object)),
  since: z.date().optional(),
  take: z.number().int().min(1).max(MAX_TAKE).default(DEFAULT_TAKE),
  cursor: z.string().optional(),
  withOutgoing: z.boolean().optional(),
  // `У-110`: кабинет руководителя форсит company-wide — как у `listOrders` и
  // `listDocuments`. Его личный /manager-кабинет остаётся scoped.
  teamModeOverride: z.boolean().optional(),
});

export type ListIncomingCommentsOptions = z.input<typeof ListIncomingCommentsOptionsSchema>;

const INBOX_INCLUDE = {
  order: { select: { id: true, orderNumber: true, title: true } },
  author: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.CommentInclude;

export type ManagerInboxItem = Prisma.CommentGetPayload<{ include: typeof INBOX_INCLUDE }>;

export type ListIncomingCommentsResult = {
  rows: ManagerInboxItem[];
  nextCursor: string | null;
};

export async function listIncomingComments(
  prisma: PrismaClient,
  optsRaw: ListIncomingCommentsOptions
): Promise<ListIncomingCommentsResult> {
  const opts = ListIncomingCommentsOptionsSchema.parse(optsRaw);
  const since = opts.since ?? new Date(Date.now() - DEFAULT_WINDOW_MS);
  const teamMode =
    opts.teamModeOverride ?? (await getCompanyTeamVisibility(prisma, opts.session.companyId));

  // G1: тред-охват берётся из профиля (threads-уровень), иначе legacy order-scope.
  const orderWhere = opts.session.accessProfile
    ? orderWhereForLevel(opts.session, opts.session.accessProfile.threads)
    : managerOrderScope(opts.session, teamMode);

  // withOutgoing = «показать и наши ответы»: автором ответа может быть любой
  // сотрудник менеджерского контура, включая руководителя (ТЗ 2026-08-17 — до
  // выделения роли он писал как manager и попадал в ленту сам собой).
  const authorWhere: Prisma.UserWhereInput = opts.withOutgoing
    ? { role: { in: ['organization', 'manager', 'leader'] } }
    : { role: 'organization' };

  const rows = await prisma.comment.findMany({
    where: {
      order: orderWhere,
      author: authorWhere,
      createdAt: { gte: since },
    },
    include: INBOX_INCLUDE,
    orderBy: { id: 'desc' },
    take: opts.take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > opts.take;
  const sliced = hasMore ? rows.slice(0, opts.take) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]!.id : null;
  return { rows: sliced, nextCursor };
}
