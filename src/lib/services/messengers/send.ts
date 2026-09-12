import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { isMessengerAvailable } from './availability';
import type { MessengerChannel } from './channels';
import { recordOutboundInDialog } from './recordOutbound';
import { isDialogInScope } from './scope';
import { sendToMessenger } from './transport';

/** Предел одного сообщения: у Telegram 4096, берём круглое общее для всех каналов. */
export const DIALOG_MESSAGE_MAX = 4000;

export type SendDialogMessageArgs = { dialogId: string; text: string };

export type SendDialogMessageResult =
  | { ok: true; messageId: string }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'not_found'
        | 'invalid'
        | 'text_too_long'
        | 'channel_unavailable'
        | 'reply_failed';
    };

/**
 * Ответ из диалога (спека 2026-09-12 §4 `send.ts`). Порядок: скоуп → форма
 * текста → канал подключён → транспорт → правило первого ответившего (ничей
 * диалог становится диалогом компании ответившего, Р-М-2) → история (в том
 * числе неудачная отправка — она видна в ленте как «не доставлено») → аудит.
 *
 * Чужой диалог отвечает `not_found`, как и карточка: существование переписки
 * другой компании не раскрываем.
 */
export async function sendDialogMessage(
  prisma: PrismaClient,
  session: SessionPayload,
  args: SendDialogMessageArgs
): Promise<SendDialogMessageResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const dialog = await prisma.messengerDialog.findUnique({
    where: { id: args.dialogId },
    select: { id: true, channel: true, peerRef: true, companyId: true },
  });
  if (!dialog || !isDialogInScope(session, dialog)) return { ok: false, error: 'not_found' };

  const text = args.text.trim();
  if (!text) return { ok: false, error: 'invalid' };
  if (text.length > DIALOG_MESSAGE_MAX) return { ok: false, error: 'text_too_long' };

  const channel = dialog.channel as MessengerChannel;
  if (!isMessengerAvailable(channel)) return { ok: false, error: 'channel_unavailable' };

  const sent = await sendToMessenger(channel, dialog.peerRef, text);

  // Правило первого ответившего: условие в `where` — если за это время диалог
  // привязал кто-то другой, чужое решение не перетираем.
  if (dialog.companyId === null) {
    const claimed = await prisma.messengerDialog.updateMany({
      where: { id: dialog.id, companyId: null },
      data: { companyId: session.companyId },
    });
    if (claimed.count > 0) {
      await recordAudit(prisma, {
        action: 'messenger_dialog_bound',
        entity: 'messenger_dialog',
        entityId: dialog.id,
        userId: session.sub,
        after: { companyId: session.companyId, reason: 'first_reply' },
      });
    }
  }

  const recorded = await recordOutboundInDialog(prisma, {
    channel,
    peerRef: dialog.peerRef,
    authorId: session.sub,
    text,
    delivered: sent.ok,
  });

  await recordAudit(prisma, {
    action: 'messenger_message_sent',
    entity: 'messenger_dialog',
    entityId: dialog.id,
    userId: session.sub,
    after: { channel, delivered: sent.ok },
  });

  if (!sent.ok) return { ok: false, error: 'reply_failed' };
  return { ok: true, messageId: recorded.messageId };
}
