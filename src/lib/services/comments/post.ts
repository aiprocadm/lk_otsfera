import type { Comment, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder } from '@/lib/auth/organizationPolicy';
import {
  canSeeOrder as canSeeOrderMgr,
  managedOrgIds,
  getCompanyTeamVisibility,
} from '@/lib/auth/managerPolicy';
import { canReadOrder } from '@/lib/auth/policy';
import {
  deliverNotificationToUser,
  notifyManagers,
  notifyMessageCreated,
  notifyOrgUsers,
} from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';

/**
 * Комментарий к заказу (разговор клиент↔менеджер, CLAUDE.md §5) — доменный слой
 * POST /api/comments. Роут остаётся тонким: разбор тела + маппинг кода в HTTP.
 *
 * Три ветки видимости — намеренно раздельные, у каждой свой скоуп (§4):
 *   organization — членства из сессии (multi-org, Phase 7);
 *   manager      — three-way managerPolicy, mode-aware (C8);
 *   partner      — пришпилен к своим заказам (order.partnerId === session.partnerId);
 *   остальные    — общий canReadOrder (company-level).
 *
 * `viewer` в успешном результате говорит роуту, какой статус отдать: ветки
 * counterparty отвечают 201, историческая (legacy) — 200. Это разошлось
 * исторически; выравнивать нельзя — контракт клиентов.
 *
 * Коды отказа различают ДВА разных 403-тела прежнего роута:
 *   'access_denied' → { error: 'Access denied' } (org/manager/partner-ветки);
 *   'forbidden'     → { error: 'Forbidden' }     (общий guard-отказ).
 * message-строки — контракт COMMENT_ERROR_LABEL композера ленты
 * (deal-activity-thread.tsx); при переименовании обновить обе стороны.
 */

export type PostOrderCommentArgs = { orderId: string; body: string };

export type PostOrderCommentResult =
  | { ok: true; comment: Comment; viewer: 'organization' | 'manager' | 'legacy' }
  | { ok: false; error: 'not_found' | 'access_denied' | 'forbidden' };

export async function postOrderComment(
  prisma: PrismaClient,
  session: SessionPayload,
  args: PostOrderCommentArgs
): Promise<PostOrderCommentResult> {
  const { orderId, body } = args;

  // Organization-cabinet users: scope check via organizationMemberships array.
  // Legacy canReadOrder still relies on session.organizationId (singular) and
  // does not understand multi-org Phase 7 sessions, so handle this role here.
  if (session.role === 'organization') {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
    });
    if (!order) return { ok: false, error: 'not_found' };
    if (!canSeeOrder(session, order)) return { ok: false, error: 'access_denied' };

    const comment = await prisma.comment.create({
      data: { orderId, body, authorId: session.sub },
    });

    await recordAudit(prisma, {
      action: 'comment_posted',
      entity: 'order',
      entityId: orderId,
      userId: session.sub,
      after: { commentId: comment.id, viewer: 'organization' },
    });

    // Best-effort fan-out to managers in scope of this order. Failure here must
    // NOT roll back the comment — the in-app row is the source of truth, the
    // email is a side channel. notifyManagers itself returns an empty summary
    // when the order has no manager assignment (per-order, per-org, or
    // historical), so a missing manager is not an error.
    try {
      await notifyManagers(prisma, {
        orderId: order.id,
        type: 'comment_from_org',
        payload: {
          orgName: order.organization?.name ?? '',
          commentExcerpt: body.slice(0, 200),
        },
      });
    } catch (err) {
      log.warn('[api/comments] notifyManagers (comment_from_org) failed', {
        commentId: comment.id,
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { ok: true, comment, viewer: 'organization' };
  }

  // Manager-cabinet users: three-way visibility via managerPolicy (per-order,
  // per-org, or historical comments). Mirrors the upload service hot-path:
  // count comments only when the cheaper per-order/per-org checks miss.
  if (session.role === 'manager') {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        managerId: true,
        organizationId: true,
        companyId: true,
        orderNumber: true,
        title: true,
      },
    });
    if (!order) return { ok: false, error: 'not_found' };

    let commentsCountByMe = 0;
    if (!teamMode && order.managerId !== session.sub) {
      const inOrgScope =
        order.organizationId !== null && managedOrgIds(session).includes(order.organizationId);
      if (!inOrgScope) {
        commentsCountByMe = await prisma.comment.count({
          where: { orderId: order.id, authorId: session.sub },
        });
      }
    }
    if (!canSeeOrderMgr(session, { ...order, commentsCountByMe }, teamMode)) {
      return { ok: false, error: 'access_denied' };
    }

    const comment = await prisma.comment.create({
      data: { orderId, body, authorId: session.sub },
    });

    await recordAudit(prisma, {
      action: 'comment_posted',
      entity: 'order',
      entityId: orderId,
      userId: session.sub,
      after: { commentId: comment.id, viewer: 'manager' },
    });

    if (order.organizationId) {
      try {
        await notifyOrgUsers(prisma, {
          organizationId: order.organizationId,
          type: 'manager_replied',
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            orderTitle: order.title,
            commentExcerpt: body.slice(0, 200),
          },
        });
      } catch (err) {
        log.warn('[api/comments] notifyOrgUsers (manager_replied) failed', {
          commentId: comment.id,
          organizationId: order.organizationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { ok: true, comment, viewer: 'manager' };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: 'not_found' };

  // Partner: pin to own orders. The generic canReadOrder grants company-level
  // access, which would let a partner comment on a sibling partner's order in
  // the same company — the partner cabinet itself only ever surfaces orders
  // with order.partnerId === session.partnerId.
  if (session.role === 'partner') {
    if (!session.partnerId || order.partnerId !== session.partnerId) {
      return { ok: false, error: 'access_denied' };
    }
  } else if (!(await canReadOrder(session, order))) {
    return { ok: false, error: 'forbidden' };
  }

  const comment = await prisma.comment.create({ data: { orderId, body, authorId: session.sub } });

  // Best-effort fan-out: the comment row is committed; notification/email
  // transport failures must not turn into a 500 for an already-posted comment.
  try {
    const organizationId = await getPrimaryOrganizationId(session);
    const row = await notifyMessageCreated({
      userId: session.sub,
      organizationId,
      // exactOptionalPropertyTypes: NotificationInput различает «ключа нет» и «ключ = undefined».
      ...(session.partnerId !== undefined ? { partnerId: session.partnerId } : {}),
      title: 'Новое сообщение',
      body,
      meta: { orderId, commentId: comment.id },
    });
    await deliverNotificationToUser({
      userId: session.sub,
      title: 'Новое сообщение',
      body,
      type: 'message_created',
      dedupKey: row.id,
    });
  } catch (err) {
    log.warn('[api/comments] notification fan-out failed', {
      commentId: comment.id,
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, comment, viewer: 'legacy' };
}
