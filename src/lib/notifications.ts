import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  sendManagerCommentFromOrgEmail,
  sendManagerDocumentUploadedByOrgEmail,
  sendManagerOrderMarkedPaidBy1CEmail,
  sendManagerOrderStatusChangedEmail,
  sendNotificationEmail,
  sendOrgDocumentPublishedEmail,
  sendOrgManagerRepliedEmail,
  sendOrgOrderStatusChangedEmail,
  sendOrgPaymentReceivedEmail,
  type SendResult,
} from '@/lib/email/send';
import { isEmailEnabled } from '@/lib/email/transport';
import {
  managerCommentFromOrgSubject,
  managerCommentFromOrgText,
  managerDocumentUploadedByOrgSubject,
  managerDocumentUploadedByOrgText,
  managerOrderMarkedPaidBy1CSubject,
  managerOrderMarkedPaidBy1CText,
  managerOrderStatusChangedSubject,
  managerOrderStatusChangedText
} from '@/lib/email/templates';

type NotificationInput = {
  userId: string;
  organizationId?: string | null;
  partnerId?: string | null;
  type: string;
  title: string;
  body: string;
  meta?: Record<string, unknown> | null;
};

export async function createNotification(input: NotificationInput) {
  return prisma.notification.create({
    data: {
      ...input,
      meta: input.meta != null ? (input.meta as Prisma.InputJsonValue) : Prisma.JsonNull
    }
  });
}

export async function notifyDocumentCreated(params: Omit<NotificationInput, "type">) {
  return createNotification({ ...params, type: 'document_created' });
}

export async function notifyStatusChanged(params: Omit<NotificationInput, "type">) {
  return createNotification({ ...params, type: 'status_changed' });
}

export async function notifyMessageCreated(params: Omit<NotificationInput, "type">) {
  return createNotification({ ...params, type: 'message_created' });
}

/**
 * Fan-out hook called after in-app notifications. Looks up the recipient's
 * email and dispatches a generic notification email via Resend (when
 * configured). Silent no-op when EMAIL_ENABLED!=true or the API key is
 * missing — callers never need to gate this themselves.
 */
export async function triggerNotificationEmail(payload: {
  userId: string;
  title: string;
  body: string;
  type: string;
  url?: string;
}) {
  if (!isEmailEnabled()) return;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return;

  await sendNotificationEmail({
    to: user.email,
    recipientName: user.name || 'партнёр',
    title: payload.title,
    body: payload.body,
    url: payload.url,
  });
}

// ----- Organization-side fan-out --------------------------------------------

type OrgNotifyInput =
  | {
      organizationId: string;
      type: 'document_published';
      payload: {
        orderId: string;
        orderNumber: string | null;
        orderTitle: string;
        documentName: string;
        documentType: string;
      };
    }
  | {
      organizationId: string;
      type: 'payment_received';
      payload: {
        orderId: string;
        orderNumber: string | null;
        orderTitle: string;
        amount: string;
        paidAt: Date;
      };
    }
  | {
      organizationId: string;
      type: 'order_status_changed';
      payload: {
        orderId: string;
        orderNumber: string | null;
        orderTitle: string;
        dimension: 'execution' | 'financial';
        oldStatus: string;
        newStatus: string;
      };
    }
  | {
      organizationId: string;
      type: 'manager_replied';
      payload: {
        orderId: string;
        orderNumber: string | null;
        orderTitle: string;
        commentExcerpt: string;
      };
    };

export type NotifyOrgUsersSummary = {
  recipientsNotified: number;
  emailsSent: number;
  emailsSkipped: number;
};

function getAppBaseUrl(): string {
  return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
}

function orderLabel(orderNumber: string | null, orderTitle: string): string {
  return orderNumber ? `№ ${orderNumber}` : `«${orderTitle}»`;
}

function buildOrgNotification(
  input: OrgNotifyInput,
  organizationName: string,
  orderUrl: string
): { title: string; body: string; meta: Record<string, unknown> } {
  if (input.type === 'document_published') {
    const { orderNumber, orderTitle, documentName, documentType } = input.payload;
    return {
      title: `Новый документ по заказу ${orderLabel(orderNumber, orderTitle)}`,
      body: `Загружен документ «${documentName}» (${documentType}).`,
      meta: {
        orderId: input.payload.orderId,
        orderNumber,
        documentName,
        documentType,
        organizationName,
        url: orderUrl
      }
    };
  }
  if (input.type === 'payment_received') {
    const { orderNumber, orderTitle, amount, paidAt } = input.payload;
    return {
      title: `Оплата по заказу ${orderLabel(orderNumber, orderTitle)}`,
      body: `Получена оплата ${amount} ₽.`,
      meta: {
        orderId: input.payload.orderId,
        orderNumber,
        amount,
        paidAt: paidAt.toISOString(),
        organizationName,
        url: orderUrl
      }
    };
  }
  if (input.type === 'manager_replied') {
    const { orderNumber, orderTitle, commentExcerpt } = input.payload;
    return {
      title: `Менеджер ответил по заказу ${orderLabel(orderNumber, orderTitle)}`,
      body: commentExcerpt,
      meta: {
        orderId: input.payload.orderId,
        orderNumber,
        commentExcerpt,
        organizationName,
        url: orderUrl
      }
    };
  }
  // order_status_changed
  const { orderNumber, orderTitle, dimension, oldStatus, newStatus } = input.payload;
  const dimLabel = dimension === 'execution' ? 'Статус' : 'Финансы';
  return {
    title: `${dimLabel} заказа ${orderLabel(orderNumber, orderTitle)} изменён`,
    body: `${oldStatus} → ${newStatus}.`,
    meta: {
      orderId: input.payload.orderId,
      orderNumber,
      dimension,
      oldStatus,
      newStatus,
      organizationName,
      url: orderUrl
    }
  };
}

async function dispatchOrgEmail(
  to: string,
  input: OrgNotifyInput,
  organizationName: string,
  orderUrl: string
): Promise<SendResult> {
  if (input.type === 'document_published') {
    return sendOrgDocumentPublishedEmail({
      to,
      organizationName,
      orderNumber: input.payload.orderNumber,
      orderTitle: input.payload.orderTitle,
      documentName: input.payload.documentName,
      documentType: input.payload.documentType,
      orderUrl
    });
  }
  if (input.type === 'payment_received') {
    return sendOrgPaymentReceivedEmail({
      to,
      organizationName,
      orderNumber: input.payload.orderNumber,
      orderTitle: input.payload.orderTitle,
      amount: input.payload.amount,
      paidAt: input.payload.paidAt,
      orderUrl
    });
  }
  if (input.type === 'manager_replied') {
    return sendOrgManagerRepliedEmail({
      to,
      organizationName,
      orderNumber: input.payload.orderNumber,
      orderTitle: input.payload.orderTitle,
      commentExcerpt: input.payload.commentExcerpt,
      orderUrl
    });
  }
  return sendOrgOrderStatusChangedEmail({
    to,
    organizationName,
    orderNumber: input.payload.orderNumber,
    orderTitle: input.payload.orderTitle,
    dimension: input.payload.dimension,
    oldStatus: input.payload.oldStatus,
    newStatus: input.payload.newStatus,
    orderUrl
  });
}

/**
 * Fan-out notification to all active members of an organization.
 *
 * Always creates in-app Notification rows. Email is best-effort — when the
 * Resend pipeline is disabled (no EMAIL_ENABLED=true or no RESEND_API_KEY),
 * `send()` returns `{status:'skipped'}` and the function still reports
 * recipients as notified (the bell counter is the source of truth, not the
 * inbox).
 */
export async function notifyOrgUsers(
  db: PrismaClient,
  input: OrgNotifyInput
): Promise<NotifyOrgUsersSummary> {
  const org = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: {
      id: true,
      name: true,
      organizationUsers: {
        where: { isActive: true, user: { isActive: true } },
        select: {
          user: { select: { id: true, email: true } }
        }
      }
    }
  });

  if (!org) {
    return { recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 };
  }

  const orderUrl = `${getAppBaseUrl()}/organization/orders/${input.payload.orderId}`;
  const { title, body, meta } = buildOrgNotification(input, org.name, orderUrl);

  let emailsSent = 0;
  let emailsSkipped = 0;
  let recipientsNotified = 0;

  for (const member of org.organizationUsers) {
    await db.notification.create({
      data: {
        userId: member.user.id,
        organizationId: org.id,
        type: input.type,
        title,
        body,
        meta: meta as Prisma.InputJsonValue
      }
    });
    recipientsNotified += 1;

    if (member.user.email) {
      const result = await dispatchOrgEmail(member.user.email, input, org.name, orderUrl);
      if (result.status === 'sent') emailsSent += 1;
      else emailsSkipped += 1;
    } else {
      emailsSkipped += 1;
    }
  }

  return { recipientsNotified, emailsSent, emailsSkipped };
}

// ----- Manager-side fan-out -------------------------------------------------

export type NotifyManagersType =
  | 'comment_from_org'
  | 'document_uploaded_by_org'
  | 'order_marked_paid_by_1c'
  | 'order_status_changed_by_manager';

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
      const result = await dispatch(r.email);
      if (result.status === 'sent') emailsSent += 1;
      else emailsSkipped += 1;
    } else {
      emailsSkipped += 1;
    }
  }

  return { recipientsNotified, emailsSent, emailsSkipped };
}
