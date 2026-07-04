/**
 * Транспорт Max (D3) — нативная интеграция по образцу Telegram (§25.3 единый
 * слой интеграций). Все внешние вызовы за адаптером и мокабельны в тестах.
 * Под feature-флагом `max_channel` (opt-in staged rollout).
 *
 * Max Bot API близок к Telegram по форме (bot token + sendMessage + deep-link
 * `/start`). Базовый URL вынесен в env для гибкости и тестируемости.
 */
import { isFeatureEnabled } from '@/lib/featureFlags';

const MAX_TIMEOUT_MS = 5000;

export function maxApiBaseUrl(): string {
  return process.env.MAX_API_BASE_URL?.trim() || 'https://botapi.max.ru';
}

/**
 * Канал включён, когда флаг поднят И заданы креды бота. Флаг — первая точка
 * гейтинга (§5): без него канал не активен даже при наличии кредов.
 */
export function isMaxEnabled(): boolean {
  return (
    isFeatureEnabled('max_channel') &&
    !!process.env.MAX_BOT_TOKEN?.trim() &&
    !!process.env.MAX_BOT_USERNAME?.trim()
  );
}

export function maxDeepLink(code: string): string {
  const username = process.env.MAX_BOT_USERNAME?.trim() ?? '';
  return `https://max.ru/${username}?start=${code}`;
}

/**
 * Отправка сообщения в привязанный Max-чат. Best-effort: транспорт-level сбой
 * не бросается наружу важный путь, возвращается `{ ok: false }` (диспетчер/
 * воркер решают, ретраить ли).
 */
export async function sendMaxMessage(
  chatId: string,
  text: string
): Promise<{ ok: boolean }> {
  const token = process.env.MAX_BOT_TOKEN?.trim();
  if (!token) return { ok: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);
  try {
    const res = await fetch(`${maxApiBaseUrl()}/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  /* v8 ignore next 2 -- V8 marks the finally as a branch; the exceptional-completion edge is unreachable (bare catch catches all, clearTimeout cannot throw) */
  } finally {
    clearTimeout(timer);
  }
}
