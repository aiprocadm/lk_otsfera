import { type Prisma, type PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { getChannels } from '@/lib/notifications/channels/registry';
import {
  CHANNEL_RECIPIENT_SELECT,
  type ChannelPayload,
  type ChannelSendResult,
  type EmailContentRef,
} from '@/lib/notifications/channels/types';
import type { NotificationDispatchPayload } from '@/lib/jobs/types';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { log } from '@/lib/logging';

/**
 * Email-props с типом Date, которые JSON round-trip через Redis превратил в
 * ISO-строки. Оживляем по whitelist ключей (props контролируются нашими
 * EmailContentRef-конструкторами — generic-ревайвер по regex был бы риском
 * ложных срабатываний на пользовательском тексте).
 */
const DATE_EMAIL_PROPS = ['paidAt'] as const;

export function reviveChannelPayload(payload: ChannelPayload): ChannelPayload {
  if (!payload.email) return payload;
  const props = { ...(payload.email.props as Record<string, unknown>) };
  for (const key of DATE_EMAIL_PROPS) {
    const value = props[key];
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) props[key] = parsed;
    }
  }
  return { ...payload, email: { ...payload.email, props } as EmailContentRef };
}

export type DispatchNotificationResult = {
  status: 'sent' | 'skipped' | 'user_not_found' | 'unknown_channel';
  reason?: string;
};

/**
 * Доставка одного job-а `notifications.dispatch` (D5).
 *
 * - Настройки/привязки перечитываются на момент обработки (могли измениться
 *   между enqueue и выполнением) — канал, ставший выключенным, даёт `skipped`.
 * - `failed` → SyncLog(entity='notification', direction='out') + throw:
 *   BullMQ ретраит по дефолтной политике очереди (attempts: 5, exponential
 *   backoff), упавшие навсегда job-ы остаются в failed (removeOnFail: false).
 * - Ошибка одного канала не влияет на остальные по построению: каждый канал —
 *   отдельный job.
 */
export async function runDispatchNotification(
  db: PrismaClient,
  data: NotificationDispatchPayload,
  jobId?: string
): Promise<DispatchNotificationResult> {
  // Токены/ключи каналов — из кэша настроек интеграций; праймим на воркере,
  // чтобы изменения из /admin/integrations доезжали без рестарта процесса.
  await primeIntegrationSettingsCache(db);

  const user = await db.user.findUnique({
    where: { id: data.userId },
    select: CHANNEL_RECIPIENT_SELECT,
  });
  if (!user) return { status: 'user_not_found' };

  const channel = getChannels().find((ch) => ch.key === data.channel);
  if (!channel) return { status: 'unknown_channel' };

  if (!channel.isEnabledFor(user)) {
    return { status: 'skipped', reason: 'channel_disabled' };
  }

  const payload = reviveChannelPayload(data.payload);

  let result: ChannelSendResult;
  try {
    result = await channel.send(user, payload);
  } catch (err) {
    result = {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (result.status === 'failed') {
    // SyncLog — единый канал расследования (§12). Пишем напрямую в модель:
    // writeSyncLog типизирован под 1С-домен (entity/operation/direction), а
    // доставка уведомления — другой домен со свободными строковыми колонками.
    // Лог best-effort: сбой записи не должен маскировать исходную ошибку канала
    // (throw ниже — сигнал ретрая BullMQ).
    await db.syncLog
      .create({
        data: {
          entity: 'notification',
          externalId: jobId ?? null,
          direction: 'out',
          operation: `channel_${data.channel}`,
          status: 'error',
          errorMessage: result.reason ?? 'unknown',
          payload: { userId: data.userId, type: data.payload.type } as Prisma.InputJsonValue,
        },
      })
      .catch((logErr) =>
        log.error('[dispatch-notification] SyncLog write failed', { error: logErr })
      );
    throw new Error(
      `notification channel ${data.channel} failed: ${result.reason ?? 'unknown'}`
    );
  }

  return { status: result.status, ...(result.reason ? { reason: result.reason } : {}) };
}

/** BullMQ-обёртка; `db` — инжектируемый шов (toBullProcessor передаёт только job). */
export async function dispatchNotificationProcessor(
  job: Job<NotificationDispatchPayload>,
  db?: PrismaClient
): Promise<DispatchNotificationResult> {
  const { prisma } = await import('@/lib/db/prisma');
  return runDispatchNotification(db ?? prisma, job.data, job.id);
}
