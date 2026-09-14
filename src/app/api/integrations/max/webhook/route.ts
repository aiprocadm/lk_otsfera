import { prisma } from '@/lib/db/prisma';
import { linkMaxByCode } from '@/lib/services/max/link';
import { sendMaxMessage } from '@/lib/max/client';
import { notFoundIfDisabled, isFeatureEnabled } from '@/lib/featureFlags';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { fetchInboundAttachment } from '@/lib/services/messengers/attachment';
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

  const { text, chatId, messageId, isStart, attachment } = extractStart(update);
  if (text && chatId) {
    const startMatch = /^\/start\s+(\S+)/.exec(text);
    if (startMatch) {
      const code = startMatch[1]!;
      // Никогда не логируем код (§12). Оборачиваем целиком, чтобы неожиданная
      // ошибка БД не превратилась в 500 → retry-storm.
      try {
        const result = await linkMaxByCode(prisma, { code, chatId });
        // Спека 2026-09-12 (§5.4): при включённом приёме сообщений бот — ещё и
        // чат с менеджером; говорим об этом сразу, а не оставляем догадываться.
        const reply = result.ok
          ? isFeatureEnabled('inbound_messaging')
            ? '✅ Готово: уведомления привязаны к этому чату, а ваши сообщения здесь увидит ваш менеджер.'
            : '✅ Уведомления привязаны к этому чату.'
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
    }
  }

  // Входящее сообщение: текст, файл или файл с подписью (`У-204`). Блок стоит
  // ОТДЕЛЬНО от разбора `/start`, а не внутри `if (text && chatId)`: апдейт с
  // одним вложением текста не содержит, и раньше такое сообщение не попадало
  // НИКУДА — тот же дефект, что закрыт для Telegram и WhatsApp. Данные клиента
  // не интерпретируем, только сохраняем; сбои не блокируют вебхук (§3) —
  // всегда отвечаем 200. Без `message_id` идемпотентность не гарантируется,
  // поэтому такие апдейты пропускаем.
  const inboundBody = text ?? (attachment ? `Файл: ${attachment.name}` : null);
  if (
    chatId &&
    !isStart &&
    inboundBody !== null &&
    !/^\/start\b/.test(inboundBody) &&
    messageId != null &&
    isFeatureEnabled('inbound_messaging')
  ) {
    // Файл MAX отдаёт ссылкой — скачиваем сами. Не вышло: сообщение всё равно
    // записываем, телом станет имя файла. Терять обращение клиента нельзя.
    const stored = attachment
      ? await fetchInboundAttachment('inbound', {
          url: attachment.url,
          name: attachment.name,
          mimeType: attachment.mimeType,
        })
      : null;

    await ingestInboundMessage(prisma, {
      channel: 'max',
      externalId: `max:${chatId}:${messageId}`,
      senderRef: chatId,
      body: inboundBody,
      ...(stored
        ? {
            attachmentPath: stored.path,
            attachmentName: stored.name,
            attachmentMime: stored.mimeType,
            attachmentSize: stored.size,
          }
        : {}),
    }).catch((e: unknown) => {
      log.error('[webhook/max] ingest failed', {
        externalId: `max:${chatId}:${messageId}`,
        error: e instanceof Error ? e.message : String(e),
      });
    });
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
  /** Файл, присланный клиентом (`У-204`): MAX отдаёт его ссылкой на медиа. */
  attachment: { url: string; name: string; mimeType: string } | null;
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

  // Вложение: MAX кладёт медиа в `body.attachments[]` с полезной нагрузкой,
  // содержащей прямую ссылку. Берём первое — одно сообщение, один файл.
  let attachment: { url: string; name: string; mimeType: string } | null = null;
  const attachments = (message?.body as Record<string, unknown> | undefined)?.attachments;
  if (Array.isArray(attachments) && attachments.length > 0) {
    const first = attachments[0] as Record<string, unknown> | undefined;
    const payload = first?.payload as Record<string, unknown> | undefined;
    const url = typeof payload?.url === 'string' ? payload.url : null;
    if (url) {
      attachment = {
        url,
        name: typeof payload?.filename === 'string' ? payload.filename : 'file',
        mimeType:
          typeof payload?.mime_type === 'string' ? payload.mime_type : 'application/octet-stream',
      };
    }
  }

  return { text, chatId, messageId, isStart: botStarted != null, attachment };
}
