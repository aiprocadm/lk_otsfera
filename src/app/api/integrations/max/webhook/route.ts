import { prisma } from '@/lib/db/prisma';
import { linkMaxByCode } from '@/lib/services/max/link';
import { sendMaxMessage } from '@/lib/max/client';
import { notFoundIfDisabled, isFeatureEnabled } from '@/lib/featureFlags';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { secretEquals } from '@/lib/security/secretCompare';
import { recordWebhookEvent } from '@/lib/services/admin/webhookDiagnostics';
import { log } from '@/lib/logging';
import { getSettingValue } from '@/lib/config/integrationSettings';

/**
 * Webhook привязки Max (D3) — зеркало telegram-webhook. Гейтится флагом
 * `max_channel` (404 до раскрытия существования эндпоинта — третья точка §5).
 * Секрет-заголовок `x-max-webhook-secret`. Ловит `/start <code>` из апдейта;
 * формат апдейта Max за защитным парсингом (боевые креды/уточнение позже).
 */
export async function POST(req: Request): Promise<Response> {
  const disabled = notFoundIfDisabled('max_channel');
  if (disabled) return disabled;

  // `У-123`: секрет вебхука берётся из настроек (база, затем переменная
  // сервера). Задать его теперь можно из интерфейса, не заходя на сервер.
  const secret = (await getSettingValue(prisma, 'max.webhookSecret'))?.trim();
  const provided = req.headers.get('x-max-webhook-secret');
  if (!secret || !secretEquals(provided, secret)) {
    return new Response(null, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    // Malformed JSON — 200, чтобы Max не ретраил.
    return new Response(null, { status: 200 });
  }

  // ФТ-14.4: отметка «последнее входящее» для диагностики в админке.
  // Never-throws; сбой записи не влияет на ответ вебхука.
  await recordWebhookEvent(prisma, 'max');

  const { text, chatId, messageId, isStart } = extractStart(update);
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
        await sendMaxMessage(chatId, reply).catch((e: unknown) => {
          log.warn('[webhook/max] reply send failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        });
      } catch (e) {
        // Swallow — 200 ниже. Код привязки НЕ логируем (§12).
        log.error('[webhook/max] link handling failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } else if (
      !isStart &&
      !/^\/start\b/.test(text) &&
      messageId != null &&
      isFeatureEnabled('inbound_messaging')
    ) {
      // Не-/start входящее текстовое сообщение — best-effort ingest в
      // омниканальный инбокс (PR-A). `text` — недоверенные пользовательские
      // данные: никогда не интерпретируем/не исполняем, только сохраняем как
      // body. Ошибки никогда не блокируют вебхук (§3 — degrade gracefully).
      // Голый `/start` (кнопка Start) не матчит ни ветку — no-op (до-Task-6).
      // Без message_id externalId не гарантирует идемпотентность → дропаем.
      await ingestInboundMessage(prisma, {
        channel: 'max',
        externalId: `max:${chatId}:${messageId}`,
        senderRef: chatId,
        body: text,
      }).catch((e: unknown) => {
        log.error('[webhook/max] ingest failed', {
          externalId: `max:${chatId}:${messageId}`,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }
  }

  return new Response(null, { status: 200 });
}

/**
 * Защитно достаёт текст сообщения и id чата из апдейта Max. Форма апдейта
 * может отличаться от Telegram — принимаем `message` (как TG) и `bot_started`.
 * `isStart` отличает synthetic `/start`-текст, сконструированный из
 * `bot_started.payload` (у него нет реального message_id, инжестить нечего)
 * от обычных текстовых сообщений в `message`.
 */
function extractStart(update: unknown): {
  text: string | null;
  chatId: string | null;
  messageId: string | null;
  isStart: boolean;
} {
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

  const messageIdRaw = message?.message_id;
  const messageId = messageIdRaw != null ? String(messageIdRaw) : null;

  return { text, chatId, messageId, isStart: botStarted != null };
}
