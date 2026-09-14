import type { InboundMessage } from '@prisma/client';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { sendToMessenger } from '@/lib/services/messengers/transport';
import { log } from '@/lib/logging';
import { sendEmailReply } from './emailReply';

/**
 * Reply to an inbound message through the SAME outbound transport the
 * notification channels already use (§25.3 единый слой интеграций). No new
 * transport code — messenger channels go through `sendToMessenger`
 * (спека 2026-09-12, Р-М-7 — один транспорт на диалоги и инбокс), keyed by
 * `senderRef` (chatId for telegram/max, E.164 phone for whatsapp).
 *
 * Best-effort: transport-level failures are swallowed there (the transports
 * themselves already return `{ ok: false }` rather than throwing), so callers
 * get a stable `{ ok: boolean }` without try/catch of their own.
 *
 * Почта (`У-205`, этап 3): ответ уходит через `sendEmailReply` — с `Reply-To`
 * на входящий ящик и `In-Reply-To` на письмо клиента, иначе ответ клиента не
 * вернулся бы в ту же переписку. До этапа 3 эта ветка отвечала отказом, и
 * менеджеру приходилось писать из своей почты мимо кабинета.
 */
export async function replyToInbound(
  msg: Pick<InboundMessage, 'channel' | 'senderRef' | 'subject'> & {
    resolvedUserId?: string | null;
    /** `Message-ID` письма клиента — сшивка ветки ответа (`У-205`). */
    externalMessageId?: string | null;
  },
  text: string
): Promise<{ ok: boolean }> {
  switch (msg.channel) {
    case 'cabinet':
      // Этап 9 (ФТ-11.1, решение §9-2): у вопроса из кабинета нет внешнего
      // транспорта — ответ доставляется уведомлением в личный кабинет автора
      // (и в подключённые им каналы через общий слой доставки).
      return replyToCabinetQuestion(msg, text);
    case 'telegram':
    case 'max':
    case 'whatsapp':
      return sendToMessenger(msg.channel, msg.senderRef, text);
    case 'email':
      return sendEmailReply({
        to: msg.senderRef,
        subject: msg.subject,
        text,
        inReplyTo: msg.externalMessageId ?? null,
      });
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
      body,
    });
    await deliverNotificationToUser({
      userId: msg.resolvedUserId,
      title,
      body,
      type: 'inbound_reply',
      dedupKey: row.id,
    });
    return { ok: true };
  } catch (err) {
    log.warn('[inbound/reply] cabinet reply failed', { error: (err as Error).message });
    return { ok: false };
  }
}
