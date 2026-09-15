import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import { safeDeliveryError } from '@/lib/messengers/deliveryError';
import { isMessengerAvailable } from './availability';
import type { MessengerChannel } from './channels';
import { sendToMessenger } from './transport';

/**
 * Две проверки канала «своими руками» (`У-213`).
 *
 * Обе отвечают на вопрос «работает ли канал прямо сейчас», но с разных сторон:
 * тестовое сообщение проверяет путь НАРУЖУ, проверка вебхука — путь ВНУТРЬ.
 * Настроенный бот, который не получает входящих, выглядит совершенно исправным
 * до первого потерянного обращения клиента.
 */

export type SelfCheckResult =
  | { ok: true; detail: string }
  | {
      ok: false;
      error: 'forbidden' | 'not_linked' | 'channel_unavailable' | 'failed';
      reason?: string;
    };

/**
 * «Отправить тестовое сообщение себе» — в мессенджер, привязанный к учётной
 * записи самого администратора. Адрес берётся С СЕРВЕРА из его профиля: ввод
 * произвольного адреса означал бы отправку кому угодно от имени компании.
 */
export async function sendSelfTestMessage(
  prisma: PrismaClient,
  session: SessionPayload,
  channel: MessengerChannel
): Promise<SelfCheckResult> {
  if (!isMessengerAvailable(channel)) return { ok: false, error: 'channel_unavailable' };

  const me = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { telegramChatId: true, maxChatId: true, whatsappPhone: true },
  });
  const peerRef =
    channel === 'telegram'
      ? me?.telegramChatId
      : channel === 'max'
        ? me?.maxChatId
        : me?.whatsappPhone;
  // Не привязан — это не ошибка канала, а отсутствие адресата: так и говорим.
  if (!peerRef) return { ok: false, error: 'not_linked' };

  const sent = await sendToMessenger(
    channel,
    peerRef,
    'Проверка связи из личного кабинета. Если вы видите это сообщение — канал работает.'
  );
  if (sent.ok) return { ok: true, detail: 'Сообщение отправлено — проверьте мессенджер.' };
  return sent.error
    ? { ok: false, error: 'failed', reason: sent.error }
    : { ok: false, error: 'failed' };
}

/** Ответ Telegram на `getWebhookInfo` — берём только то, что показываем. */
type WebhookInfo = {
  url?: unknown;
  pending_update_count?: unknown;
  last_error_message?: unknown;
};

const CHECK_TIMEOUT_MS = 5000;

/**
 * «Проверить вебхук» — спрашиваем у самого Telegram, куда он шлёт обновления и
 * не копятся ли у него неотданные. Это единственный способ узнать про обрыв,
 * который с нашей стороны выглядит как тишина.
 *
 * У MAX аналогичной ручки в контракте не подтверждено, поэтому честно
 * отказываем вместо выдумывания чужого API (то же решение, что с отправкой
 * файлов, `В-3-10`).
 */
export async function checkWebhook(channel: MessengerChannel): Promise<SelfCheckResult> {
  if (channel !== 'telegram') {
    return {
      ok: false,
      error: 'channel_unavailable',
      reason: 'Проверка вебхука есть только у Telegram',
    };
  }
  const token = cachedIntegrationSetting('telegram.botToken');
  if (!token) return { ok: false, error: 'channel_unavailable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
      signal: controller.signal,
    });
    if (!res.ok)
      return { ok: false, error: 'failed', reason: `Telegram ответил ошибкой ${res.status}` };
    const data = (await res.json()) as { result?: WebhookInfo };
    const info = data.result ?? {};
    const url = typeof info.url === 'string' && info.url ? info.url : '';
    if (!url) {
      return {
        ok: false,
        error: 'failed',
        reason: 'Вебхук не зарегистрирован — Telegram нам ничего не шлёт',
      };
    }
    const pending = typeof info.pending_update_count === 'number' ? info.pending_update_count : 0;
    const lastError =
      typeof info.last_error_message === 'string' && info.last_error_message
        ? ` Последняя ошибка у Telegram: ${safeDeliveryError(info.last_error_message)}`
        : '';
    return {
      ok: true,
      // Сам адрес наружу не показываем: в нём наш секретный путь приёма.
      detail: `Вебхук зарегистрирован. Необработанных обновлений: ${pending}.${lastError}`,
    };
  } catch {
    return { ok: false, error: 'failed', reason: 'Telegram недоступен: сеть не ответила' };
    /* v8 ignore next 2 -- V8 marks the finally as a branch; the exceptional-completion edge is unreachable (bare catch catches all, clearTimeout cannot throw) */
  } finally {
    clearTimeout(timer);
  }
}
