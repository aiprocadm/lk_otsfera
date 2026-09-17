import { Prisma, type Notification, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { deliverToRecipient, type DeliveryResults } from './channels/deliver';
import { dispatchToRecipient } from './channels/dispatch';
import { CHANNEL_RECIPIENT_SELECT, type ChannelKey, type ChannelPayload } from './channels/types';
import {
  NOTIFICATION_TYPES,
  type NotificationTypeKey,
  type NotificationTypeSpec,
} from './registry';
import { notificationRoute } from './routes';
import { getAppBaseUrl } from './shared';

/**
 * Единая точка создания уведомления (этап 5 PR-3, `У-231`, решение `Р-Э5-5`).
 *
 * До этапа записи `Notification` рождались в 27 местах напрямую через
 * `prisma.notification.create` — и ни одно из них не знало о повторах. Теперь
 * запись создаёт только `recordNotification`, а страж
 * `notifications.single-create-point` не даёт прямым вызовам вернуться.
 *
 * Дедупликация: если у получателя уже есть строка того же типа о том же
 * объекте (`entityId`), последний повтор которой не старше окна, — строка
 * обновляется («×N», снова непрочитана, тексты свежие), возвращается
 * `deduped: true`, и продьюсер НЕ дёргает каналы: письмо и мессенджер не
 * дублируются. Без `entityId` дедупа нет — честнее, чем угадывать по `meta`.
 * Типы с `noDedup` в реестре (сообщения) — всегда новая строка.
 *
 * Известный предел (спека §3.5): два события в одну миллисекунду проходят
 * проверку одновременно и дают две строки. Окно — защита от шума, а не
 * транзакционная гарантия; уникальный индекс невозможен — третье событие
 * через час обязано создать новую строку.
 */

export const NOTIFICATION_DEDUP_WINDOW_MS = 60 * 60 * 1000;

/** Клиент базы: обычный или транзакционный — продьюсеры пишут и так, и так. */
export type NotificationDb = PrismaClient | Prisma.TransactionClient;

type RecordNotificationInput = {
  userId: string;
  organizationId?: string | null | undefined;
  partnerId?: string | null | undefined;
  type: string;
  title: string;
  body: string;
  meta?: Record<string, unknown> | null | undefined;
  /** Ключ дедупликации: id объекта события (заказ, задача, диалог, …). */
  entityId?: string | null | undefined;
};

type RecordNotificationResult = { row: Notification; deduped: boolean };

export async function recordNotification(
  db: NotificationDb,
  input: RecordNotificationInput
): Promise<RecordNotificationResult> {
  const now = new Date();
  const meta = input.meta != null ? (input.meta as Prisma.InputJsonValue) : Prisma.JsonNull;
  const entityId = input.entityId ?? null;
  // Реестр знает не все исторические типы — незнакомый тип дедупится как обычный.
  const spec = (NOTIFICATION_TYPES as Record<string, NotificationTypeSpec | undefined>)[
    input.type as NotificationTypeKey
  ];

  if (entityId && !spec?.noDedup) {
    const since = new Date(now.getTime() - NOTIFICATION_DEDUP_WINDOW_MS);
    const candidate = await db.notification.findFirst({
      where: {
        userId: input.userId,
        type: input.type,
        entityId,
        // «Последний повтор» — lastOccurredAt, у строк до миграции — createdAt.
        OR: [
          { lastOccurredAt: { gte: since } },
          { lastOccurredAt: null, createdAt: { gte: since } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (candidate) {
      const row = await db.notification.update({
        where: { id: candidate.id },
        data: {
          dedupCount: { increment: 1 },
          lastOccurredAt: now,
          isRead: false,
          title: input.title,
          body: input.body,
          meta,
        },
      });
      return { row, deduped: true };
    }
  }

  const row = await db.notification.create({
    data: {
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      partnerId: input.partnerId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      meta,
      entityId,
      lastOccurredAt: now,
    },
  });
  return { row, deduped: false };
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
  /**
   * `Р-Э5-7`: ссылка считается от роли получателя по идентификаторам `meta`
   * (таблица `routes.ts`). Явный `url` — только для адресов вне таблицы.
   */
  meta?: Record<string, unknown> | null | undefined;
  url?: string | undefined;
  channels?: ChannelKey[] | undefined;
  dedupKey?: string | undefined;
}): Promise<DeliveryResults> {
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: CHANNEL_RECIPIENT_SELECT,
  });
  if (!user) return {};

  const route = payload.url
    ? null
    : notificationRoute(payload.type, payload.meta ?? null, user.role);
  const url = payload.url ?? (route ? `${getAppBaseUrl()}${route}` : undefined);

  const channelPayload: ChannelPayload = {
    type: payload.type,
    title: payload.title,
    body: payload.body,
    url,
    email: {
      template: 'notification',
      props: {
        recipientName: user.name || 'партнёр',
        title: payload.title,
        body: payload.body,
        url,
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
