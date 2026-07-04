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

const WHATSAPP_TIMEOUT_MS = 5000;

export function whatsappAggregatorBaseUrl(): string {
  return process.env.WHATSAPP_AGGREGATOR_BASE_URL?.trim() || 'https://api.wazzup24.com';
}

/**
 * Канал включён при флаге + всех трёх параметрах агрегатора (URL берётся из
 * env или дефолта, но ключ и channelId обязательны). Флаг — первая точка
 * гейтинга.
 */
export function isWhatsAppEnabled(): boolean {
  return (
    isFeatureEnabled('whatsapp_channel') &&
    !!process.env.WHATSAPP_AGGREGATOR_API_KEY?.trim() &&
    !!process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID?.trim()
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
  const apiKey = process.env.WHATSAPP_AGGREGATOR_API_KEY?.trim();
  const channelId = process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID?.trim();
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
