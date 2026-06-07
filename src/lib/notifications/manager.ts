import { Prisma, type PrismaClient } from '@prisma/client';
import {
  sendManagerCommentFromOrgEmail,
  sendManagerDocumentUploadedByOrgEmail,
  sendManagerDocumentUploadedByPartnerEmail,
  sendManagerOrderMarkedPaidBy1CEmail,
  sendManagerOrderStatusChangedEmail,
  sendNotificationEmail,
  type SendResult,
} from '@/lib/email/send';
import {
  managerCommentFromOrgSubject,
  managerCommentFromOrgText,
  managerDocumentUploadedByOrgSubject,
  managerDocumentUploadedByOrgText,
  managerDocumentUploadedByPartnerSubject,
  managerDocumentUploadedByPartnerText,
  managerOrderMarkedPaidBy1CSubject,
  managerOrderMarkedPaidBy1CText,
  managerOrderStatusChangedSubject,
  managerOrderStatusChangedText
} from '@/lib/email/templates';
import { getAppBaseUrl, orderLabel } from './shared';

export type NotifyManagersType =
  | 'comment_from_org'
  | 'document_uploaded_by_org'
  | 'document_uploaded_by_partner'
  | 'order_marked_paid_by_1c'
  | 'order_status_changed_by_manager'
  | 'chat_message';

export type NotifyManagersInput =
  | {
      orderId: string;
      type: 'comment_from_org';
      payload: {
        orgName: string;
        commentExcerpt: string;
      };
    }
  | {
      orderId: string;
      type: 'document_uploaded_by_org';
      payload: {
        orgName: string;
        documentName: string;
        documentType: string;
      };
    }
  | {
      orderId: string;
      type: 'document_uploaded_by_partner';
      payload: {
        partnerName: string;
        documentName: string;
        documentType: string;
      };
    }
  | {
      orderId: string;
      type: 'order_marked_paid_by_1c';
      payload: {
        amount: number;
        paidAt: Date;
      };
    }
  | {
      orderId: string;
      type: 'order_status_changed_by_manager';
      payload: {
        actorName: string;
        oldStatus: string;
        newStatus: string;
      };
    }
  | {
      orderId: string;
      type: 'chat_message';
      payload: {
        excerpt: string;
        side: string;
      };
    };

export type NotifyManagersOptions = { excludeUserId?: string };

export type NotifyManagersSummary = {
  recipientsNotified: number;
  emailsSent: number;
  emailsSkipped: number;
};

export type ManagerRecipient = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * Resolve the set of manager users who should be notified about activity on
 * an order. Mirrors `managerOrderScopeFilter` — three OR paths, dedup'd,
 * filtered by `User.isActive`, with optional `excludeUserId` for actor.
 *
 *   a) per-order: `Order.managerId`
 *   b) per-org:   active `OrganizationManager` rows for `Order.organizationId`
 *   c) historical: distinct users with `role='manager'` who have ever
 *      commented on this order
 *
 * Returning empty array is a valid result (e.g. unassigned order with no
 * comments yet — nobody to notify).
 */
export async function resolveManagerRecipients(
  db: PrismaClient,
  orderId: string,
  opts?: NotifyManagersOptions
): Promise<ManagerRecipient[]> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { managerId: true, organizationId: true }
  });
  if (!order) return [];

  const ids = new Set<string>();

  // a) per-order direct assignment
  if (order.managerId) ids.add(order.managerId);

  // b) per-org via active OrganizationManager rows
  if (order.organizationId) {
    const orgAssigned = await db.organizationManager.findMany({
      where: { organizationId: order.organizationId, isActive: true },
      select: { userId: true }
    });
    for (const a of orgAssigned) ids.add(a.userId);
  }

  // c) historical: any manager who commented on this order
  const historical = await db.comment.findMany({
    where: { orderId, author: { role: 'manager' } },
    select: { authorId: true },
    distinct: ['authorId']
  });
  for (const c of historical) ids.add(c.authorId);

  if (opts?.excludeUserId) ids.delete(opts.excludeUserId);
  if (ids.size === 0) return [];

  // Filter by User.isActive — deactivated managers stay out of recipient list
  // even if they were left on OrganizationManager.
  return db.user.findMany({
    where: { id: { in: Array.from(ids) }, isActive: true },
    select: { id: true, email: true, name: true }
  });
}

type OrderContext = {
  orderId: string;
  orderNumber: string | null;
  orderTitle: string;
  orderUrl: string;
};

type ManagerNotificationOutput = {
  subject: string;
  shortBody: string;
  dispatch: (to: string) => Promise<SendResult>;
};

/**
 * MANAGER_TEMPLATES — keyed by notification type. Each builder receives
 * the structured input and the resolved order context and returns the
 * `{ subject, shortBody, dispatch }` triple used to (a) fill in the
 * in-app Notification row and (b) dispatch the matching Resend email.
 */
const MANAGER_TEMPLATES: Record<
  NotifyManagersType,
  (input: NotifyManagersInput, ctx: OrderContext) => ManagerNotificationOutput
> = {
  comment_from_org: (input, ctx) => {
    if (input.type !== 'comment_from_org') throw new Error('type mismatch');
    const props = {
      orgName: input.payload.orgName,
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      commentExcerpt: input.payload.commentExcerpt,
      orderUrl: ctx.orderUrl
    };
    return {
      subject: managerCommentFromOrgSubject(props),
      shortBody: managerCommentFromOrgText(props),
      dispatch: (to) => sendManagerCommentFromOrgEmail({ to, ...props })
    };
  },
  document_uploaded_by_org: (input, ctx) => {
    if (input.type !== 'document_uploaded_by_org') throw new Error('type mismatch');
    const props = {
      orgName: input.payload.orgName,
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      documentName: input.payload.documentName,
      documentType: input.payload.documentType,
      orderUrl: ctx.orderUrl
    };
    return {
      subject: managerDocumentUploadedByOrgSubject(props),
      shortBody: managerDocumentUploadedByOrgText(props),
      dispatch: (to) => sendManagerDocumentUploadedByOrgEmail({ to, ...props })
    };
  },
  document_uploaded_by_partner: (input, ctx) => {
    if (input.type !== 'document_uploaded_by_partner') throw new Error('type mismatch');
    const props = {
      partnerName: input.payload.partnerName,
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      documentName: input.payload.documentName,
      documentType: input.payload.documentType,
      orderUrl: ctx.orderUrl
    };
    return {
      subject: managerDocumentUploadedByPartnerSubject(props),
      shortBody: managerDocumentUploadedByPartnerText(props),
      dispatch: (to) => sendManagerDocumentUploadedByPartnerEmail({ to, ...props })
    };
  },
  order_marked_paid_by_1c: (input, ctx) => {
    if (input.type !== 'order_marked_paid_by_1c') throw new Error('type mismatch');
    const props = {
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      amount: input.payload.amount,
      paidAt: input.payload.paidAt,
      orderUrl: ctx.orderUrl
    };
    return {
      subject: managerOrderMarkedPaidBy1CSubject(props),
      shortBody: managerOrderMarkedPaidBy1CText(props),
      dispatch: (to) => sendManagerOrderMarkedPaidBy1CEmail({ to, ...props })
    };
  },
  order_status_changed_by_manager: (input, ctx) => {
    if (input.type !== 'order_status_changed_by_manager') throw new Error('type mismatch');
    const props = {
      orderNumber: ctx.orderNumber ?? ctx.orderTitle,
      actorName: input.payload.actorName,
      oldStatus: input.payload.oldStatus,
      newStatus: input.payload.newStatus,
      orderUrl: ctx.orderUrl
    };
    return {
      subject: managerOrderStatusChangedSubject(props),
      shortBody: managerOrderStatusChangedText(props),
      dispatch: (to) => sendManagerOrderStatusChangedEmail({ to, ...props })
    };
  },
  chat_message: (input, ctx) => {
    if (input.type !== 'chat_message') throw new Error('type mismatch');
    const orderRef = orderLabel(ctx.orderNumber, ctx.orderTitle);
    const subject = `Новое сообщение по заказу ${orderRef}`;
    const shortBody = input.payload.excerpt;
    return {
      subject,
      shortBody,
      dispatch: (to) => sendNotificationEmail({
        to,
        title: subject,
        body: shortBody,
        recipientName: 'менеджер',
        url: ctx.orderUrl
      })
    };
  }
};

function getManagerOrderUrl(orderId: string): string {
  return `${getAppBaseUrl()}/manager/orders/${orderId}`;
}

function metaFromInput(input: NotifyManagersInput): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...input.payload, orderId: input.orderId };
  // Dates aren't JSON-serializable in a stable way for the Prisma JSON column —
  // store as ISO string when present.
  if ('paidAt' in input.payload && input.payload.paidAt instanceof Date) {
    meta.paidAt = input.payload.paidAt.toISOString();
  }
  return meta;
}

/**
 * Fan-out notification to all managers in scope of an order.
 *
 * Resolves recipients via `resolveManagerRecipients` (three-way OR matching
 * `managerOrderScopeFilter`), then creates an in-app Notification row per
 * recipient and best-effort dispatches an email via Resend. When the email
 * pipeline is disabled, `send()` returns `{status:'skipped'}` and the
 * Notification rows are still created — the bell counter is the source of
 * truth, not the inbox (matching `notifyOrgUsers` semantics).
 *
 * Invariant: the set of users notified for an order equals
 * `{ m : managerOrderScopeFilter(session(m)) sees order }`. Covered by
 * `notifications.invariant.test.ts`.
 */
export async function notifyManagers(
  db: PrismaClient,
  input: NotifyManagersInput,
  opts?: NotifyManagersOptions
): Promise<NotifyManagersSummary> {
  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, orderNumber: true, title: true }
  });
  if (!order) {
    return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };
  }

  const recipients = await resolveManagerRecipients(db, input.orderId, opts);
  if (recipients.length === 0) {
    return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };
  }

  const ctx: OrderContext = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderTitle: order.title,
    orderUrl: getManagerOrderUrl(order.id)
  };

  const build = MANAGER_TEMPLATES[input.type];
  const { subject, shortBody, dispatch } = build(input, ctx);
  const meta = metaFromInput(input);

  let emailsSent = 0;
  let emailsSkipped = 0;
  let recipientsNotified = 0;

  for (const r of recipients) {
    await db.notification.create({
      data: {
        userId: r.id,
        type: input.type,
        title: subject,
        body: shortBody,
        meta: meta as Prisma.InputJsonValue
      }
    });
    recipientsNotified += 1;

    if (r.email) {
      // Best-effort: a transport-level throw for one recipient must not abort
      // the fan-out nor propagate to callers that treat email as a side effect.
      try {
        const result = await dispatch(r.email);
        if (result.status === 'sent') emailsSent += 1;
        else emailsSkipped += 1;
      } catch (err) {
        emailsSkipped += 1;
        console.warn('[notifyManagers] email dispatch failed', {
          orderId: input.orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      emailsSkipped += 1;
    }
  }

  return { recipientsNotified, emailsSent, emailsSkipped };
}
