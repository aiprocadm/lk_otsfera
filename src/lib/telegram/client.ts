const TELEGRAM_TIMEOUT_MS = 5000;

export function isTelegramEnabled(): boolean {
  return (
    !!process.env.TELEGRAM_BOT_TOKEN?.trim() &&
    !!process.env.TELEGRAM_BOT_USERNAME?.trim()
  );
}

export function botDeepLink(code: string): string {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim() ?? '';
  return `https://t.me/${username}?start=${code}`;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<{ ok: boolean }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
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
  } finally {
    clearTimeout(timer);
  }
}
