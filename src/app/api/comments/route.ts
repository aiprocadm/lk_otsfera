import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrderAccess, requireSession, forbiddenResponse } from '@/lib/auth/guard';
import { canSeeOrder } from '@/lib/auth/organizationPolicy';
import {
  canSeeOrder as canSeeOrderMgr,
  managedOrgIds,
  getCompanyTeamVisibility,
} from '@/lib/auth/managerPolicy';
import {
  deliverNotificationToUser,
  notifyManagers,
  notifyMessageCreated,
  notifyOrgUsers,
} from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';

const commentSchema = z.object({
  orderId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(5000),
});

export async function POST(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = commentSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { orderId, body } = parsed.data;

  // Organization-cabinet users: scope check via organizationMemberships array.
  // Legacy canReadOrder still relies on session.organizationId (singular) and
  // does not understand multi-org Phase 7 sessions, so handle this role here.
  if (s.role === 'organization') {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
    });
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canSeeOrder(s, order)) return forbiddenResponse('Access denied');

    const comment = await prisma.comment.create({
      data: { orderId, body, authorId: s.sub },
    });

    await recordAudit(prisma, {
      action: 'comment_posted',
      entity: 'order',
      entityId: orderId,
      userId: s.sub,
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

    return NextResponse.json(comment, { status: 201 });
  }

  // Manager-cabinet users: three-way visibility via managerPolicy (per-order,
  // per-org, or historical comments). Mirrors the upload service hot-path:
  // count comments only when the cheaper per-order/per-org checks miss.
  // NB: message-строки ошибок этой ветки ('Invalid request'/'Not found'/
  // 'Access denied') — контракт COMMENT_ERROR_LABEL композера ленты
  // (deal-activity-thread.tsx); при переименовании обновить обе стороны.
  if (s.role === 'manager') {
    const teamMode = await getCompanyTeamVisibility(prisma, s.companyId);
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
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let commentsCountByMe = 0;
    if (!teamMode && order.managerId !== s.sub) {
      const inOrgScope =
        order.organizationId !== null && managedOrgIds(s).includes(order.organizationId);
      if (!inOrgScope) {
        commentsCountByMe = await prisma.comment.count({
          where: { orderId: order.id, authorId: s.sub },
        });
      }
    }
    if (!canSeeOrderMgr(s, { ...order, commentsCountByMe }, teamMode)) {
      return forbiddenResponse('Access denied');
    }

    const comment = await prisma.comment.create({
      data: { orderId, body, authorId: s.sub },
    });

    await recordAudit(prisma, {
      action: 'comment_posted',
      entity: 'order',
      entityId: orderId,
      userId: s.sub,
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

    return NextResponse.json(comment, { status: 201 });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Partner: pin to own orders. The generic canReadOrder grants company-level
  // access, which would let a partner comment on a sibling partner's order in
  // the same company — the partner cabinet itself only ever surfaces orders
  // with order.partnerId === session.partnerId.
  if (s.role === 'partner') {
    if (!s.partnerId || order.partnerId !== s.partnerId) {
      return forbiddenResponse('Access denied');
    }
  } else {
    const orderAccess = await requireOrderAccess(s, order);
    if (!orderAccess.ok) return orderAccess.response;
  }

  const comment = await prisma.comment.create({ data: { orderId, body, authorId: s.sub } });

  // Best-effort fan-out: the comment row is committed; notification/email
  // transport failures must not turn into a 500 for an already-posted comment.
  try {
    const organizationId = await getPrimaryOrganizationId(s);
    const row = await notifyMessageCreated({
      userId: s.sub,
      organizationId,
      // exactOptionalPropertyTypes: NotificationInput различает «ключа нет» и «ключ = undefined».
      ...(s.partnerId !== undefined ? { partnerId: s.partnerId } : {}),
      title: 'Новое сообщение',
      body,
      meta: { orderId, commentId: comment.id },
    });
    await deliverNotificationToUser({
      userId: s.sub,
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

  return NextResponse.json(comment);
}
