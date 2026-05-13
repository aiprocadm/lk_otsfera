import { prisma } from '@/lib/db/prisma';

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
  return prisma.notification.create({ data: input });
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

export async function triggerNotificationEmail(payload: {
  userId: string;
  title: string;
  body: string;
  type: string;
}) {
  if (process.env.EMAIL_ENABLED !== 'true') return;
  console.info('EMAIL_QUEUE_NOTIFICATION', payload);
}
