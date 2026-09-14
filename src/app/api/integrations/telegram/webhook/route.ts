import { prisma } from '@/lib/db/prisma';
import { linkByCode } from '@/lib/services/telegram/link';
import { getTelegramFileUrl, sendTelegramMessage } from '@/lib/telegram/client';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { fetchInboundAttachment } from '@/lib/services/messengers/attachment';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { secretEquals } from '@/lib/security/secretCompare';
import { recordWebhookEvent } from '@/lib/services/admin/webhookDiagnostics';
import { log } from '@/lib/logging';
import { getSettingValue } from '@/lib/config/integrationSettings';

/** Что клиент приложил к сообщению: id файла у провайдера, имя, тип, размер. */
type TelegramAttachmentRef = {
  fileId: string;
  name: string;
  mimeType: string;
  size: number | null;
};

/**
 * Разбор вложения из апдейта Telegram (`У-204`).
 *
 * `document` несёт имя и тип сам; `photo` — массив вариантов одного снимка от
 * мелкого к крупному, берём последний (самый качественный) и даём ему имя
 * сами: у фото в Telegram имени файла нет вовсе.
 *
 * Всё, что не документ и не фото (видео, голосовое, стикер, геометка),
 * осознанно пропускаем: их форматы вне списка разрешённых, и скачивать их
 * незачем — сообщение при этом всё равно запишется текстом.
 */
function telegramAttachmentRef(
  message: Record<string, unknown> | undefined
): TelegramAttachmentRef | null {
  const doc = message?.document as Record<string, unknown> | undefined;
  if (doc && typeof doc.file_id === 'string') {
    return {
      fileId: doc.file_id,
      name: typeof doc.file_name === 'string' ? doc.file_name : 'file',
      mimeType: typeof doc.mime_type === 'string' ? doc.mime_type : 'application/octet-stream',
      size: typeof doc.file_size === 'number' ? doc.file_size : null,
    };
  }
  const photos = message?.photo;
  if (Array.isArray(photos) && photos.length > 0) {
    const largest = photos[photos.length - 1] as Record<string, unknown> | undefined;
    if (largest && typeof largest.file_id === 'string') {
      return {
        fileId: largest.file_id,
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: typeof largest.file_size === 'number' ? largest.file_size : null,
      };
    }
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  // `У-123`: секрет вебхука берётся из настроек (база, затем переменная
  // сервера). Задать его теперь можно из интерфейса, не заходя на сервер.
  const secret = (await getSettingValue(prisma, 'telegram.webhookSecret'))?.trim();
  const provided = req.headers.get('x-telegram-bot-api-secret-token');

  // 401 when secret is not configured or header doesn't match
  if (!secret || !secretEquals(provided, secret)) {
    return new Response(null, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    // Malformed JSON — still return 200 so Telegram doesn't retry
    return new Response(null, { status: 200 });
  }

  // ФТ-14.4: отметка «последнее входящее» для диагностики в админке.
  // Never-throws; сбой записи не влияет на ответ вебхука.
  await recordWebhookEvent(prisma, 'telegram');

  // Extract message.text and message.chat.id safely
  const message = (update as Record<string, unknown>)?.message as
    Record<string, unknown> | undefined;
  const text = typeof message?.text === 'string' ? message.text : null;
  // У-204: клиент мог прислать фото или документ. До этапа 3 такой апдейт не
  // подходил ни под одну ветку и пропадал МОЛЧА — сообщение не появлялось
  // нигде. Подпись к файлу (`caption`) становится телом сообщения.
  const attachmentRef = telegramAttachmentRef(message);
  const caption = typeof message?.caption === 'string' ? message.caption : null;
  const chatId =
    message?.chat != null ? String((message.chat as Record<string, unknown>).id) : null;

  // /start <код> — привязка чата; всё остальное (текст, файл, файл с
  // подписью) — входящее сообщение.
  if (text && chatId) {
    const startMatch = /^\/start\s+(\S+)/.exec(text);
    if (startMatch) {
      const code = startMatch[1]!;
      // Never log the code (§12 security rule). Wrap the whole handling so an
      // unexpected DB error can't turn into a 500 → Telegram retry-storm.
      try {
        const result = await linkByCode(prisma, { code, chatId });
        // Спека 2026-09-12 (§5.4): при включённом приёме сообщений бот — ещё и
        // чат с менеджером; говорим об этом сразу, а не оставляем догадываться.
        const reply = result.ok
          ? isFeatureEnabled('inbound_messaging')
            ? '✅ Готово: уведомления привязаны к этому чату, а ваши сообщения здесь увидит ваш менеджер.'
            : '✅ Уведомления привязаны к этому чату.'
          : 'Код недействителен или истёк.';
        // Best-effort — don't await failure propagation
        await sendTelegramMessage(chatId, reply).catch((e: unknown) => {
          log.warn('[webhook/telegram] reply send failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        });
      } catch (e) {
        // Swallow — always 200 below so Telegram doesn't retry.
        // Код привязки НЕ логируем (§12).
        log.error('[webhook/telegram] link handling failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // Входящее сообщение: текст, файл или файл с подписью (`У-204`). До этапа 3
  // сюда попадал только текст, и апдейт с одним фото не подходил ни под одну
  // ветку — сообщение пропадало МОЛЧА. Данные клиента не интерпретируем,
  // только сохраняем. Сбои не блокируют вебхук (§3): всегда отвечаем 200,
  // иначе Telegram уйдёт в шторм повторов.
  const isStart = text !== null && /^\/start\b/.test(text);
  const body = text ?? caption ?? (attachmentRef ? `Файл: ${attachmentRef.name}` : null);
  if (
    chatId &&
    !isStart &&
    body !== null &&
    message?.message_id != null &&
    isFeatureEnabled('inbound_messaging')
  ) {
    const externalId = `tg:${chatId}:${message.message_id}`;
    const senderDisplay =
      typeof (message?.from as Record<string, unknown> | undefined)?.username === 'string'
        ? ((message.from as Record<string, unknown>).username as string)
        : undefined;

    // Файл скачиваем ДО записи сообщения: ссылка Telegram живёт около часа, а
    // содержит токен бота — наружу она не уходит никогда. Не скачалось —
    // сообщение всё равно записываем, текстом с именем файла: терять
    // обращение клиента из-за неудачной загрузки картинки нельзя.
    let stored: Awaited<ReturnType<typeof fetchInboundAttachment>> = null;
    if (attachmentRef) {
      const url = await getTelegramFileUrl(attachmentRef.fileId).catch(() => null);
      if (url) {
        stored = await fetchInboundAttachment('inbound', {
          url,
          name: attachmentRef.name,
          mimeType: attachmentRef.mimeType,
          size: attachmentRef.size,
        });
      }
    }

    await ingestInboundMessage(prisma, {
      channel: 'telegram',
      externalId,
      senderRef: chatId,
      // exactOptionalPropertyTypes: InboundDto различает «ключа нет» и «ключ = undefined».
      ...(senderDisplay !== undefined ? { senderDisplay } : {}),
      body,
      ...(stored
        ? {
            attachmentPath: stored.path,
            attachmentName: stored.name,
            attachmentMime: stored.mimeType,
            attachmentSize: stored.size,
          }
        : {}),
    }).catch((e: unknown) => {
      log.error('[webhook/telegram] ingest failed', {
        externalId,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  // Always return 200 for well-formed updates (prevents Telegram retries)
  return new Response(null, { status: 200 });
}
