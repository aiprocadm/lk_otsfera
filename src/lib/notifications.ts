import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { sendNotificationEmail } from '@/lib/email/send';
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
