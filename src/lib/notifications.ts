import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  sendNotificationEmail,
  sendOrgDocumentPublishedEmail,
  sendOrgOrderStatusChangedEmail,
  sendOrgPaymentReceivedEmail,
  type SendResult,
} from '@/lib/email/send';
import { isEmailEnabled } from '@/lib/email/transport';

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
