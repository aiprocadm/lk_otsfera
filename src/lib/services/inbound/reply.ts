import type { InboundMessage } from '@prisma/client';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { sendMaxMessage } from '@/lib/max/client';
import { sendWhatsAppMessage } from '@/lib/whatsapp/aggregator';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { log } from '@/lib/logging';

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
  msg: Pick<InboundMessage, 'channel' | 'senderRef' | 'subject'> & { resolvedUserId?: string | null },
  text: string,
): Promise<{ ok: boolean }> {
  switch (msg.channel) {
    case 'cabinet':
      // Этап 9 (ФТ-11.1, решение §9-2): у вопроса из кабинета нет внешнего
      // транспорта — ответ доставляется уведомлением в личный кабинет автора
      // (и в подключённые им каналы через общий слой доставки).
      return replyToCabinetQuestion(msg, text);
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

/**
 * Ответ на вопрос из кабинета: уведомление автору (ЛК + его каналы).
 * Best-effort — ошибки доставки не бросаются наружу, как и у транспортов.
 */
async function replyToCabinetQuestion(
  msg: Pick<InboundMessage, 'subject'> & { resolvedUserId?: string | null },
  text: string
): Promise<{ ok: boolean }> {
  if (!msg.resolvedUserId) return { ok: false };
  const title = 'Ответ на ваше обращение';
  const body = msg.subject ? `«${msg.subject}»: ${text}` : text;
  try {
    const row = await createNotification({
      userId: msg.resolvedUserId,
      type: 'inbound_reply',
      title,
      body
    });
    await deliverNotificationToUser({ userId: msg.resolvedUserId, title, body, type: 'inbound_reply', dedupKey: row.id });
    return { ok: true };
  } catch (err) {
    log.warn('[inbound/reply] cabinet reply failed', { error: (err as Error).message });
    return { ok: false };
  }
}
