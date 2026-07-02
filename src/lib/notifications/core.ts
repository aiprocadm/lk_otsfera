import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { deliverToRecipient, type DeliveryResults } from './channels/deliver';
import { dispatchToRecipient } from './channels/dispatch';
import { CHANNEL_RECIPIENT_SELECT, type ChannelKey, type ChannelPayload } from './channels/types';

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
 * Доставка одиночного уведомления по каналам пользователя (трек D).
 * Заменяет пару triggerNotificationEmail/triggerNotificationTelegram: один
 * вызов = все включённые каналы получателя, email — с generic-шаблоном
 * `notification`. Гейты каналов (EMAIL_ENABLED, привязки, настройки) живут
 * в самих каналах — вызывающим не нужно ничего проверять.
 *
 * `channels` сужает веер (например, monitoring/deliver.ts шлёт ops-алерты
 * только email — персональный Telegram дублировал бы общий алерт-чат).
 *
 * `dedupKey` (id соответствующей Notification-строки) включает D5-очередь
 * при флаге notif_queue; без него доставка всегда inline.
 */
export async function deliverNotificationToUser(payload: {
  userId: string;
  title: string;
  body: string;
  type: string;
  url?: string;
  channels?: ChannelKey[];
  dedupKey?: string;
}): Promise<DeliveryResults> {
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: CHANNEL_RECIPIENT_SELECT,
  });
  if (!user) return {};

  const channelPayload: ChannelPayload = {
    type: payload.type,
    title: payload.title,
    body: payload.body,
    url: payload.url,
    email: {
      template: 'notification',
      props: {
        recipientName: user.name || 'партнёр',
        title: payload.title,
        body: payload.body,
        url: payload.url,
      },
    },
  };
  const opts = payload.channels ? { channels: payload.channels } : {};

  if (payload.dedupKey) {
    const outcome = await dispatchToRecipient(user, channelPayload, {
      ...opts,
      dedupKey: payload.dedupKey,
    });
    return outcome.mode === 'inline' ? outcome.results : {};
  }

  return deliverToRecipient(user, channelPayload, payload.channels ? opts : undefined);
}
