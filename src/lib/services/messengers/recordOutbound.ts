import type { PrismaClient } from '@prisma/client';
import type { MessengerChannel } from './channels';
import { previewOf, upsertDialog } from './dialog';

export type RecordOutboundArgs = {
  channel: MessengerChannel;
  peerRef: string;
  /** Сотрудник, который написал. */
  authorId: string;
  text: string;
  /** Дошло ли до транспорта: неудачная отправка тоже остаётся в истории. */
  delivered: boolean;
  /**
   * Привязка на случай, если диалога ещё нет (ответ из «Входящих писем» на
   * письмо старше бэкфилла). Существующий диалог этим не перепривязывается.
   */
  binding?:
    | {
        companyId: string | null;
        organizationId: string | null;
        contactId: string | null;
        userId: string | null;
      }
    | undefined;
};

/**
 * Исходящее сообщение → история диалога. До программы ответ менеджера уходил
 * в канал и нигде не сохранялся (§1 спеки): через час было не узнать, что и
 * кому ответили. Теперь любой ответ — из диалога или из «Входящих писем» —
 * попадает сюда. Ответ сотрудника означает, что диалог он видел: счётчик
 * непрочитанных обнуляется.
 */
export async function recordOutboundInDialog(
  prisma: PrismaClient,
  args: RecordOutboundArgs
): Promise<{ dialogId: string; messageId: string }> {
  const at = new Date();
  const preview = previewOf(args.text);
  const dialog = await upsertDialog(
    prisma,
    { channel: args.channel, peerRef: args.peerRef },
    {
      create: {
        companyId: args.binding?.companyId ?? null,
        organizationId: args.binding?.organizationId ?? null,
        contactId: args.binding?.contactId ?? null,
        userId: args.binding?.userId ?? null,
        status: 'open',
        lastMessageAt: at,
        lastMessagePreview: preview,
        lastMessageDirection: 'out',
        unreadCount: 0,
      },
      update: {
        status: 'open',
        lastMessageAt: at,
        lastMessagePreview: preview,
        lastMessageDirection: 'out',
        unreadCount: 0,
      },
    }
  );

  const message = await prisma.messengerMessage.create({
    data: {
      dialogId: dialog.id,
      direction: 'out',
      body: args.text,
      authorId: args.authorId,
      deliveryStatus: args.delivered ? 'sent' : 'failed',
      createdAt: at,
    },
    select: { id: true },
  });

  return { dialogId: dialog.id, messageId: message.id };
}
