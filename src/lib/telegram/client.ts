import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';
import {
  httpDeliveryError,
  networkDeliveryError,
  notConfiguredDeliveryError,
} from '@/lib/messengers/deliveryError';

const TELEGRAM_TIMEOUT_MS = 5000;
/** Файл грузится дольше текста — отдельный предел, чтобы не рвать загрузку. */
const TELEGRAM_UPLOAD_TIMEOUT_MS = 30_000;

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

/** Текстовое пояснение из тела ответа провайдера, если оно там есть. */
async function describe(res: Response): Promise<string | undefined> {
  try {
    const data: unknown = await res.json();
    const d = (data as { description?: unknown } | null)?.description;
    return typeof d === 'string' && d.trim() ? d.trim() : undefined;
  } catch {
    // Тело не JSON или уже прочитано — причина останется без подробностей.
    return undefined;
  }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const token = cachedIntegrationSetting('telegram.botToken');
  if (!token) return { ok: false, error: notConfiguredDeliveryError('Telegram') };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    // `У-213`: причину отказа Telegram пишет словами («бот заблокирован
    // пользователем», «чат не найден») — ровно то, что нужно сотруднику. Тело
    // ответа токена не содержит, но всё равно проходит через чистку.
    return { ok: false, error: httpDeliveryError('Telegram', res.status, await describe(res)) };
  } catch {
    return { ok: false, error: networkDeliveryError('Telegram') };
    /* v8 ignore next 2 -- V8 marks the finally as a branch; the exceptional-completion edge is unreachable (bare catch catches all, clearTimeout cannot throw) */
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Отправка файла в чат Telegram (`У-204`). Фото уходит как `sendPhoto` —
 * тогда клиент видит картинку прямо в переписке, а не «документ»; остальное —
 * `sendDocument`. Тело — multipart, его собирает `FormData` рантайма.
 *
 * Как и у текста, контракт best-effort `{ ok }`: сетевой сбой не бросается
 * наружу, а превращается в «не доставлено» в истории диалога.
 */
export async function sendTelegramDocument(
  chatId: string,
  file: { name: string; mimeType: string; buffer: Buffer },
  caption?: string
): Promise<{ ok: boolean }> {
  const token = cachedIntegrationSetting('telegram.botToken');
  if (!token) return { ok: false };

  const isImage = file.mimeType.startsWith('image/');
  const method = isImage ? 'sendPhoto' : 'sendDocument';
  const field = isImage ? 'photo' : 'document';

  const form = new FormData();
  form.set('chat_id', chatId);
  if (caption) form.set('caption', caption);
  form.set(
    field,
    new Blob([new Uint8Array(file.buffer)], { type: file.mimeType || 'application/octet-stream' }),
    file.name
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
    /* v8 ignore next 2 -- V8 считает finally ветвью; исключительный путь недостижим (пустой catch ловит всё, clearTimeout не бросает) */
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Прямая ссылка на файл, присланный клиентом (`У-204`). Telegram отдаёт в
 * апдейте только `file_id`; чтобы скачать, нужен `getFile` → `file_path`.
 * Ссылка содержит токен бота, поэтому наружу она не отдаётся никогда — только
 * в серверное скачивание.
 */
export async function getTelegramFileUrl(fileId: string): Promise<string | null> {
  const token = cachedIntegrationSetting('telegram.botToken');
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
      {
        signal: controller.signal,
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; result?: { file_path?: string } };
    const path = data?.result?.file_path;
    if (!data?.ok || !path) return null;
    return `https://api.telegram.org/file/bot${token}/${path}`;
  } catch {
    return null;
    /* v8 ignore next 2 -- см. выше: finally считается ветвью, исключительный путь недостижим */
  } finally {
    clearTimeout(timer);
  }
}
