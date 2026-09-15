import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { isMessengerAvailable } from './availability';
import type { DialogChannel } from './channels';
import { deliverDialogText } from './deliver';
import { isDialogInScope } from './scope';

/**
 * Повтор отправки сообщения, которое не дошло (`У-213`).
 *
 * Повторяет **человек**, а не воркер, и это осознанно: причина отказа почти
 * всегда требует решения. «Бот заблокирован клиентом» автоматическим повтором
 * не лечится — надо связаться иначе; «канал не настроен» лечится в настройках.
 * Молчаливые ретраи в такой ситуации только скрывают проблему.
 *
 * Повторяем ровно тот же текст, что лежит в истории: сотрудник видит на экране
 * то, что уйдёт. Новое сообщение не заводим — обновляем статус существующего,
 * иначе одна попытка отправить превращалась бы в две строки переписки.
 */
export type RetryMessageResult =
  | { ok: true }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'not_failed' | 'channel_unavailable' | 'reply_failed';
      /** Причина от провайдера — её показывают рядом с кнопкой. */
      reason?: string;
    };

export async function retryDialogMessage(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dialogId: string; messageId: string }
): Promise<RetryMessageResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const message = await prisma.messengerMessage.findUnique({
    where: { id: args.messageId },
    select: {
      id: true,
      dialogId: true,
      body: true,
      direction: true,
      deliveryStatus: true,
      attachmentPath: true,
      dialog: {
        select: {
          id: true,
          channel: true,
          peerRef: true,
          companyId: true,
          assigneeId: true,
          organizationId: true,
          userId: true,
          messages: {
            where: { direction: 'in', inboundMessageId: { not: null } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { inboundMessage: { select: { subject: true, externalMessageId: true } } },
          },
        },
      },
    },
  });

  // Чужой диалог и несуществующее сообщение отвечают одинаково: существование
  // чужой переписки не раскрываем (то же правило, что у карточки).
  if (!message || message.dialogId !== args.dialogId) return { ok: false, error: 'not_found' };
  if (!isDialogInScope(session, message.dialog)) return { ok: false, error: 'not_found' };

  // Повторять можно только то, что действительно не ушло. Заметка и входящее
  // сообщение транспорта не знают вовсе.
  if (message.direction !== 'out' || message.deliveryStatus !== 'failed') {
    return { ok: false, error: 'not_failed' };
  }
  // Файл повторяется своим путём (проверка антивирусом, захват отправки) —
  // сюда он не попадает, чтобы не отправить вложение дважды.
  if (message.attachmentPath) return { ok: false, error: 'not_failed' };

  const channel = message.dialog.channel as DialogChannel;
  if (!isMessengerAvailable(channel)) return { ok: false, error: 'channel_unavailable' };

  const sent = await deliverDialogText(message.dialog, channel, message.body);

  await prisma.messengerMessage.update({
    where: { id: message.id },
    data: {
      deliveryStatus: sent.ok ? 'sent' : 'failed',
      deliveryError: sent.ok ? null : (sent.error ?? null),
    },
  });

  await recordAudit(prisma, {
    action: 'messenger_message_retried',
    entity: 'messenger_dialog',
    entityId: message.dialogId,
    userId: session.sub,
    after: { messageId: message.id, channel, delivered: sent.ok },
  });

  if (!sent.ok) {
    return sent.error
      ? { ok: false, error: 'reply_failed', reason: sent.error }
      : { ok: false, error: 'reply_failed' };
  }
  return { ok: true };
}
