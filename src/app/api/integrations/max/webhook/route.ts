import { prisma } from '@/lib/db/prisma';
import { linkMaxByCode } from '@/lib/services/max/link';
import { sendMaxMessage } from '@/lib/max/client';
import { notFoundIfDisabled } from '@/lib/featureFlags';

/**
 * Webhook привязки Max (D3) — зеркало telegram-webhook. Гейтится флагом
 * `max_channel` (404 до раскрытия существования эндпоинта — третья точка §5).
 * Секрет-заголовок `x-max-webhook-secret`. Ловит `/start <code>` из апдейта;
 * формат апдейта Max за защитным парсингом (боевые креды/уточнение позже).
 */
export async function POST(req: Request): Promise<Response> {
  const disabled = notFoundIfDisabled('max_channel');
  if (disabled) return disabled;

  const secret = process.env.MAX_WEBHOOK_SECRET?.trim();
  const provided = req.headers.get('x-max-webhook-secret');
  if (!secret || provided !== secret) {
    return new Response(null, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    // Malformed JSON — 200, чтобы Max не ретраил.
    return new Response(null, { status: 200 });
  }

  const { text, chatId } = extractStart(update);
  if (text && chatId) {
    const startMatch = /^\/start\s+(\S+)/.exec(text);
    if (startMatch) {
      const code = startMatch[1]!;
      // Никогда не логируем код (§12). Оборачиваем целиком, чтобы неожиданная
      // ошибка БД не превратилась в 500 → retry-storm.
      try {
        const result = await linkMaxByCode(prisma, { code, chatId });
        const reply = result.ok
          ? '✅ Уведомления привязаны к этому чату.'
          : 'Код недействителен или истёк.';
        await sendMaxMessage(chatId, reply).catch(() => {});
      } catch {
        // Swallow — 200 ниже.
      }
    }
  }

  return new Response(null, { status: 200 });
}

/**
 * Защитно достаёт текст сообщения и id чата из апдейта Max. Форма апдейта
 * может отличаться от Telegram — принимаем `message` (как TG) и `bot_started`.
 */
function extractStart(update: unknown): { text: string | null; chatId: string | null } {
  const root = update as Record<string, unknown> | null;
  const message = root?.message as Record<string, unknown> | undefined;
  const botStarted = root?.bot_started as Record<string, unknown> | undefined;

  const text =
    typeof message?.text === 'string'
      ? message.text
      : typeof botStarted?.payload === 'string'
        ? `/start ${botStarted.payload}`
        : null;

  const chatRaw =
    (message?.chat as Record<string, unknown> | undefined)?.id ??
    (message?.recipient as Record<string, unknown> | undefined)?.chat_id ??
    botStarted?.chat_id ??
    botStarted?.user_id;
  const chatId = chatRaw != null ? String(chatRaw) : null;

  return { text, chatId };
}
