import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { parseWazzupInbound } from '@/lib/whatsapp/aggregator';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { secretEquals } from '@/lib/security/secretCompare';
import { recordWebhookEvent } from '@/lib/services/admin/webhookDiagnostics';
import { log } from '@/lib/logging';

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

  const secret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();
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
    await ingestInboundMessage(prisma, {
      channel: 'whatsapp',
      externalId: m.externalId,
      senderRef: m.phone,
      senderDisplay: m.name,
      body: m.text,
    }).catch((e: unknown) => {
      log.error('[webhook/whatsapp] ingest failed', {
        externalId: m.externalId,
        error: e instanceof Error ? e.message : String(e)
      });
    });
  }

  return new Response(null, { status: 200 });
}
