import type { InboundMessage } from '@prisma/client';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { sendMaxMessage } from '@/lib/max/client';
import { sendWhatsAppMessage } from '@/lib/whatsapp/aggregator';

/**
 * Reply to an inbound message through the SAME outbound transport the
 * notification channels already use (§25.3 единый слой интеграций). No new
 * transport code — this only routes `msg.channel` to the existing
 * `send*Message` adapters keyed by `senderRef` (chatId for telegram/max,
 * E.164 phone for whatsapp).
 *
 * Best-effort: transport-level failures are swallowed here (the transports
 * themselves already return `{ ok: false }` rather than throwing), so callers
 * get a stable `{ ok: boolean }` without try/catch of their own.
 *
 * Email has no low-level raw-send (subject/text → address) counterpart today
 * — `src/lib/email/send.tsx` only exposes template-bound senders (one per
 * notification type), and composing a one-off reply template is out of scope
 * here. Deferred to boarding; returns `{ ok: false }` rather than pretending
 * success.
 */
export async function replyToInbound(
  msg: Pick<InboundMessage, 'channel' | 'senderRef' | 'subject'>,
  text: string,
): Promise<{ ok: boolean }> {
  switch (msg.channel) {
    case 'telegram': {
      const r = await sendTelegramMessage(msg.senderRef, text).catch(() => ({ ok: false }));
      return { ok: !!(r as { ok?: boolean })?.ok };
    }
    case 'max': {
      const r = await sendMaxMessage(msg.senderRef, text).catch(() => ({ ok: false }));
      return { ok: !!(r as { ok?: boolean })?.ok };
    }
    case 'whatsapp': {
      const r = await sendWhatsAppMessage(msg.senderRef, text).catch(() => ({ ok: false }));
      return { ok: !!(r as { ok?: boolean })?.ok };
    }
    case 'email':
      // No raw-send available (see doc comment above) — email reply
      // composition is deferred.
      return { ok: false };
    default:
      return { ok: false };
  }
}
