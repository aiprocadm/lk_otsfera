/**
 * WhatsApp через агрегатор (D4) — по принципу Wazzup (§25.3 единый слой
 * интеграций). НЕ прямая интеграция с Meta: номер подключается через сервис-
 * агрегатор, отправка идёт по его API-ключу. Реальные вызовы за адаптером и
 * замоканы в тестах; боевые креды подключаются позже.
 *
 * Интеграционный шов: базовый URL + API-ключ + id канала (подключённого через
 * сервис номера-отправителя) — ТОЛЬКО из окружения, не в коде. Под feature-
 * флагом `whatsapp_channel` (opt-in).
 */
import { isFeatureEnabled } from '@/lib/featureFlags';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';

const WHATSAPP_TIMEOUT_MS = 5000;

export function whatsappAggregatorBaseUrl(): string {
  // Настраивается в UI (кэш: БД после prime, env — fallback), дефолт — Wazzup.
  return cachedIntegrationSetting('whatsapp.baseUrl') || 'https://api.wazzup24.com';
}

/**
 * Канал включён при флаге + всех трёх параметрах агрегатора (URL берётся из
 * env или дефолта, но ключ и channelId обязательны — из настроек интеграций:
 * кэш БД после prime, env — fallback). Флаг — первая точка гейтинга.
 */
export function isWhatsAppEnabled(): boolean {
  return (
    isFeatureEnabled('whatsapp_channel') &&
    !!cachedIntegrationSetting('whatsapp.apiKey') &&
    !!cachedIntegrationSetting('whatsapp.channelId')
  );
}

/**
 * Отправка текста на номер через агрегатор. Wazzup-подобный контракт:
 * POST {base}/v3/message, Bearer-ключ, тело { channelId, chatType, chatId, text }.
 * Best-effort `{ ok }`; транспорт-level сбой не бросается наружу.
 */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<{ ok: boolean }> {
  const apiKey = cachedIntegrationSetting('whatsapp.apiKey');
  const channelId = cachedIntegrationSetting('whatsapp.channelId');
  if (!apiKey || !channelId) return { ok: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WHATSAPP_TIMEOUT_MS);
  try {
    const res = await fetch(`${whatsappAggregatorBaseUrl()}/v3/message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        channelId,
        chatType: 'whatsapp',
        chatId: phone,
        text,
      }),
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

/** Одно входящее сообщение Wazzup после парсинга — уже готово к `ingestInboundMessage`. */
export type WazzupInbound = {
  externalId: string;
  phone: string;
  text: string;
  name?: string | undefined;
  /**
   * Файл, присланный клиентом (`У-204`): агрегатор отдаёт его прямой ссылкой
   * (`contentUri`), скачиванием занимается вызывающий. Ссылки нет — поля нет.
   */
  attachment?: { url: string; name: string; mimeType: string } | undefined;
};

type WazzupRawMessage = {
  messageId?: unknown;
  chatId?: unknown;
  text?: unknown;
  isEcho?: unknown;
  contact?: unknown;
  /** Прямая ссылка на присланный файл (`У-204`). */
  contentUri?: unknown;
  mimeType?: unknown;
};

/** Type guard: сырой элемент `messages[]` содержит достаточно полей, чтобы стать входящим сообщением. */
function isIngestibleWazzupMessage(
  m: unknown
): m is WazzupRawMessage & { messageId: string; chatId: string | number } {
  if (!m || typeof m !== 'object') return false;
  const rec = m as WazzupRawMessage;
  return (
    typeof rec.messageId === 'string' &&
    (typeof rec.chatId === 'string' || typeof rec.chatId === 'number') &&
    // У-204: текст ИЛИ ссылка на файл. Раньше требовался только текст, и
    // сообщение с одним вложением отбрасывалось молча — клиент отправлял
    // документ, а в кабинете не появлялось ничего.
    (typeof rec.text === 'string' ||
      typeof (rec as { contentUri?: unknown }).contentUri === 'string') &&
    !rec.isEcho
  );
}

/** Имя файла из ссылки агрегатора: последний сегмент пути без параметров. */
function fileNameFromUri(uri: string): string {
  const withoutQuery = uri.split('?')[0] ?? uri;
  const last = withoutQuery.split('/').filter(Boolean).pop();
  return last && last.includes('.') ? decodeURIComponent(last) : 'file';
}

/**
 * Чистый парсер входящего вебхука Wazzup (D-inbound): достаёт из `body.messages[]`
 * только реальные входящие сообщения (фильтрует наши же исходящие эхо-события
 * `isEcho`, и элементы без строкового `messageId`/`text`). `phone` собирается
 * в ТОМ ЖЕ E.164-виде, что и `normalizePhone` в `resolve.ts` (только цифры +
 * ведущий `+`), иначе резолвинг отправителя по `User.whatsappPhone` не совпадёт.
 * Не бросает исключений на произвольном untrusted JSON — на любую непонятную
 * форму возвращает `[]`.
 */
export function parseWazzupInbound(body: unknown): WazzupInbound[] {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return [];

  return messages.filter(isIngestibleWazzupMessage).map((m) => {
    const contact = m.contact as { name?: unknown } | null | undefined;
    const name = typeof contact?.name === 'string' ? contact.name : undefined;
    const digits = String(m.chatId).replace(/\D/g, '');
    const raw = m as WazzupRawMessage & { contentUri?: unknown; mimeType?: unknown };
    const uri = typeof raw.contentUri === 'string' ? raw.contentUri : null;
    const text = typeof m.text === 'string' ? m.text : '';
    return {
      externalId: `wa:${m.messageId}`,
      phone: digits ? `+${digits}` : '',
      // Файл без подписи: телом становится имя файла, иначе сообщение было бы
      // пустой строкой и в списке выглядело бы как пропажа.
      text: text || (uri ? `Файл: ${fileNameFromUri(uri)}` : ''),
      name,
      ...(uri
        ? {
            attachment: {
              url: uri,
              name: fileNameFromUri(uri),
              mimeType:
                typeof raw.mimeType === 'string' ? raw.mimeType : 'application/octet-stream',
            },
          }
        : {}),
    };
  });
}
