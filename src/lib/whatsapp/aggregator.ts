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
export async function sendWhatsAppMessage(
  phone: string,
  text: string
): Promise<{ ok: boolean }> {
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
export type WazzupInbound = { externalId: string; phone: string; text: string; name?: string };

type WazzupRawMessage = {
  messageId?: unknown;
  chatId?: unknown;
  text?: unknown;
  isEcho?: unknown;
  contact?: unknown;
};

/** Type guard: сырой элемент `messages[]` содержит достаточно полей, чтобы стать входящим сообщением. */
function isIngestibleWazzupMessage(
  m: unknown
): m is WazzupRawMessage & { messageId: string; chatId: string | number; text: string } {
  if (!m || typeof m !== 'object') return false;
  const rec = m as WazzupRawMessage;
  return (
    typeof rec.messageId === 'string' &&
    (typeof rec.chatId === 'string' || typeof rec.chatId === 'number') &&
    typeof rec.text === 'string' &&
    !rec.isEcho
  );
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
    return {
      externalId: `wa:${m.messageId}`,
      phone: digits ? `+${digits}` : '',
      text: m.text,
      name,
    };
  });
}
