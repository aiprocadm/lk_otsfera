import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';

const TELEGRAM_TIMEOUT_MS = 5000;

// Креды бота — из настроек интеграций (БД через праймленный кэш, env — fallback);
// вызывающие контексты синхронные, поэтому чтение через integrationSettingsCache.

export function isTelegramEnabled(): boolean {
  return (
    !!cachedIntegrationSetting('telegram.botToken') &&
    !!cachedIntegrationSetting('telegram.botUsername')
  );
}

export function botDeepLink(code: string): string {
  const username = cachedIntegrationSetting('telegram.botUsername') ?? '';
  return `https://t.me/${username}?start=${code}`;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<{ ok: boolean }> {
  const token = cachedIntegrationSetting('telegram.botToken');
  if (!token) return { ok: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: controller.signal,
      }
    );
    return { ok: res.ok };
  } catch {
    return { ok: false };
  /* v8 ignore next 2 -- V8 marks the finally as a branch; the exceptional-completion edge is unreachable (bare catch catches all, clearTimeout cannot throw) */
  } finally {
    clearTimeout(timer);
  }
}
