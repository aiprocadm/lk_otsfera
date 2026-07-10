import { prisma } from '@/lib/db/prisma';
import { linkByCode } from '@/lib/services/telegram/link';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { secretEquals } from '@/lib/security/secretCompare';
import { log } from '@/lib/logging';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
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

  // Extract message.text and message.chat.id safely
  const message = (update as Record<string, unknown>)?.message as
    | Record<string, unknown>
    | undefined;
  const text = typeof message?.text === 'string' ? message.text : null;
  const chatId =
    message?.chat != null
      ? String((message.chat as Record<string, unknown>).id)
      : null;

  // Only handle /start <code>
  if (text && chatId) {
    const startMatch = /^\/start\s+(\S+)/.exec(text);
    if (startMatch) {
      const code = startMatch[1]!;
      // Never log the code (§12 security rule). Wrap the whole handling so an
      // unexpected DB error can't turn into a 500 → Telegram retry-storm.
      try {
        const result = await linkByCode(prisma, { code, chatId });
        const reply = result.ok
          ? '✅ Уведомления привязаны к этому чату.'
          : 'Код недействителен или истёк.';
        // Best-effort — don't await failure propagation
        await sendTelegramMessage(chatId, reply).catch((e: unknown) => {
          log.warn('[webhook/telegram] reply send failed', {
            error: e instanceof Error ? e.message : String(e)
          });
        });
      } catch (e) {
        // Swallow — always 200 below so Telegram doesn't retry.
        // Код привязки НЕ логируем (§12).
        log.error('[webhook/telegram] link handling failed', {
          error: e instanceof Error ? e.message : String(e)
        });
      }
    } else if (
      !/^\/start\b/.test(text) &&
      message?.message_id != null &&
      isFeatureEnabled('inbound_messaging')
    ) {
      // Non-/start inbound text — best-effort ingest into the omnichannel
      // inbox (PR-A). `text` is untrusted user data: never interpret or
      // execute it, only store as the message body. Failures never block
      // the webhook (§3 — degrade gracefully). A bare `/start` (Start button)
      // matches neither branch and stays a no-op (pre-Task-6 behavior). Without
      // a message_id the externalId can't guarantee idempotency, so drop it.
      await ingestInboundMessage(prisma, {
        channel: 'telegram',
        externalId: `tg:${chatId}:${message.message_id}`,
        senderRef: chatId,
        senderDisplay:
          typeof (message?.from as Record<string, unknown> | undefined)?.username === 'string'
            ? ((message!.from as Record<string, unknown>).username as string)
            : undefined,
        body: text,
      }).catch((e: unknown) => {
        log.error('[webhook/telegram] ingest failed', {
          externalId: `tg:${chatId}:${message.message_id}`,
          error: e instanceof Error ? e.message : String(e)
        });
      });
    }
  }

  // Always return 200 for well-formed updates (prevents Telegram retries)
  return new Response(null, { status: 200 });
}
