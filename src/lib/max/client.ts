/**
 * Транспорт Max (D3) — нативная интеграция по образцу Telegram (§25.3 единый
 * слой интеграций). Все внешние вызовы за адаптером и мокабельны в тестах.
 * Под feature-флагом `max_channel` (opt-in staged rollout).
 *
 * Max Bot API близок к Telegram по форме (bot token + sendMessage + deep-link
 * `/start`). Базовый URL вынесен в env для гибкости и тестируемости.
 */
import { isFeatureEnabled } from '@/lib/featureFlags';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';

const MAX_TIMEOUT_MS = 5000;

export function maxApiBaseUrl(): string {
  // Настраивается в UI (кэш: БД после prime, env — fallback), дефолт — botapi.max.ru.
  return cachedIntegrationSetting('max.baseUrl') || 'https://botapi.max.ru';
}

/**
 * Канал включён, когда флаг поднят И заданы креды бота. Флаг — первая точка
 * гейтинга (§5): без него канал не активен даже при наличии кредов. Креды —
 * из настроек интеграций (кэш: БД после prime, env — fallback).
 */
export function isMaxEnabled(): boolean {
  return (
    isFeatureEnabled('max_channel') &&
    !!cachedIntegrationSetting('max.botToken') &&
    !!cachedIntegrationSetting('max.botUsername')
  );
}

export function maxDeepLink(code: string): string {
  const username = cachedIntegrationSetting('max.botUsername') ?? '';
  return `https://max.ru/${username}?start=${code}`;
}

/**
 * Отправка сообщения в привязанный Max-чат. Best-effort: транспорт-level сбой
 * не бросается наружу важный путь, возвращается `{ ok: false }` (диспетчер/
 * воркер решают, ретраить ли).
 */
export async function sendMaxMessage(chatId: string, text: string): Promise<{ ok: boolean }> {
  const token = cachedIntegrationSetting('max.botToken');
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
