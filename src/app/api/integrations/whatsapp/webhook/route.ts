import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { parseWazzupInbound } from '@/lib/whatsapp/aggregator';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { fetchInboundAttachment } from '@/lib/services/messengers/attachment';
import { secretEquals } from '@/lib/security/secretCompare';
import { recordWebhookEvent } from '@/lib/services/admin/webhookDiagnostics';
import { log } from '@/lib/logging';
import { getSettingValue } from '@/lib/config/integrationSettings';

/**
 * Webhook входящих сообщений WhatsApp через агрегатор Wazzup (D-inbound) —
 * зеркало telegram/max webhook по структуре (§Task 7). В отличие от
 * telegram/max тут нет `/start <code>`-привязки: WhatsApp-номер уже известен
 * из `User.whatsappPhone` (см. resolve.ts), поэтому маршрут — чистый ingest.
 *
 * Гейтится флагом `inbound_messaging` (404 до раскрытия существования
 * эндпоинта — третья точка §5). Секрет-заголовок `x-wazzup-secret`.
 * `text`/`body` — недоверенные пользовательские данные: никогда не
 * интерпретируем/не исполняем, только сохраняем как тело сообщения.
 */
export async function POST(req: Request): Promise<Response> {
  const disabled = notFoundIfDisabled('inbound_messaging');
  if (disabled) return disabled;

  // `У-123`: секрет вебхука берётся из настроек (база, затем переменная
  // сервера). Задать его теперь можно из интерфейса, не заходя на сервер.
  const secret = (await getSettingValue(prisma, 'whatsapp.webhookSecret'))?.trim();
  const provided = req.headers.get('x-wazzup-secret');
  if (!secret || !secretEquals(provided, secret)) {
    return new Response(null, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Malformed JSON — 200, чтобы агрегатор не ретраил.
    return new Response(null, { status: 200 });
  }

  // ФТ-14.4: отметка «последнее входящее» для диагностики в админке.
  // Never-throws; сбой записи не влияет на ответ вебхука.
  await recordWebhookEvent(prisma, 'whatsapp');

  // Best-effort ingest per message (§3 — degrade gracefully; ошибка одного
  // сообщения не должна блокировать остальные и не должна превращаться в 500).
  for (const m of parseWazzupInbound(body)) {
    // У-204: файл агрегатор отдаёт ссылкой — скачиваем его сами. Не вышло —
    // сообщение всё равно записываем (телом станет имя файла): терять
    // обращение клиента из-за неудачной загрузки нельзя.
    const stored = m.attachment
      ? await fetchInboundAttachment('inbound', {
          url: m.attachment.url,
          name: m.attachment.name,
          mimeType: m.attachment.mimeType,
        })
      : null;

    await ingestInboundMessage(prisma, {
      channel: 'whatsapp',
      externalId: m.externalId,
      senderRef: m.phone,
      // exactOptionalPropertyTypes: InboundDto различает «ключа нет» и «ключ = undefined».
      ...(m.name !== undefined ? { senderDisplay: m.name } : {}),
      body: m.text,
      ...(stored
        ? {
            attachmentPath: stored.path,
            attachmentName: stored.name,
            attachmentMime: stored.mimeType,
            attachmentSize: stored.size,
          }
        : {}),
    }).catch((e: unknown) => {
      log.error('[webhook/whatsapp] ingest failed', {
        externalId: m.externalId,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  return new Response(null, { status: 200 });
}
