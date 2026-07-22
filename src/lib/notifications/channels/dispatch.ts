/**
 * Диспетчер доставки (D5): очередь `notifications.dispatch` или inline.
 *
 * Очередь включается opt-in флагом `notif_queue` + `REDIS_URL` (staged
 * rollout: тесты и dev без Redis остаются на inline-пути = поведение D1).
 * По job-у на (получатель × включённый канал) с детерминированным
 * `jobId = notif_{dedupKey}_{userId}_{channel}` — BullMQ дедуплицирует по
 * jobId, что даёт идемпотентность: одно событие не задваивается в канале.
 * Двоеточие в custom jobId запрещено BullMQ — разделитель `_`.
 *
 * Ошибка enqueue деградирует в inline-доставку (уведомление важнее очереди,
 * §3 CLAUDE.md: сбой очереди не блокирует основной путь).
 */
import { isFeatureEnabled } from '@/lib/featureFlags';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { getQueue } from '@/lib/jobs/queues';
import type { NotificationDispatchPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';
import { deliverToRecipient, type DeliverOptions, type DeliveryResults } from './deliver';
import { getChannels } from './registry';
import type { ChannelKey, ChannelPayload, ChannelRecipient } from './types';

export type DispatchOptions = DeliverOptions & {
  /**
   * Ключ идемпотентности события×получателя — id созданной in-app
   * Notification-строки (создаётся ровно одна на событие×получателя).
   */
  dedupKey: string;
};

export type DispatchOutcome =
  | { mode: 'inline'; results: DeliveryResults }
  | { mode: 'queued'; channels: ChannelKey[] };

export function notificationJobId(dedupKey: string, userId: string, channel: ChannelKey): string {
  return `notif_${dedupKey}_${userId}_${channel}`;
}

export async function dispatchToRecipient(
  user: ChannelRecipient,
  payload: ChannelPayload,
  opts: DispatchOptions
): Promise<DispatchOutcome> {
  if (!isFeatureEnabled('notif_queue') || !process.env.REDIS_URL?.trim()) {
    return { mode: 'inline', results: await deliverToRecipient(user, payload, opts) };
  }

  // Queued-путь сам зовёт isEnabledFor (кэш настроек) — праймим до фильтра.
  const { prisma } = await import('@/lib/db/prisma');
  await primeIntegrationSettingsCache(prisma);

  const enabled = getChannels().filter(
    (ch) =>
      (!opts.channels || opts.channels.includes(ch.key)) &&
      ch.isEnabledFor(user) &&
      // Без email-контента канал вернул бы skipped — не ставим пустой job.
      !(ch.key === 'email' && !payload.email)
  );
  if (enabled.length === 0) {
    return { mode: 'queued', channels: [] };
  }

  try {
    const queue = getQueue('notifications.dispatch');
    await Promise.all(
      enabled.map((ch) => {
        const job: NotificationDispatchPayload = { userId: user.id, channel: ch.key, payload };
        return queue.add('deliver', job, {
          jobId: notificationJobId(opts.dedupKey, user.id, ch.key),
        });
      })
    );
    return { mode: 'queued', channels: enabled.map((ch) => ch.key) };
  } catch (err) {
    log.warn('[notifications] enqueue failed — falling back to inline delivery', {
      dedupKey: opts.dedupKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return { mode: 'inline', results: await deliverToRecipient(user, payload, opts) };
  }
}
