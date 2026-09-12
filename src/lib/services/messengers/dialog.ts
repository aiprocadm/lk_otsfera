import { Prisma, type PrismaClient } from '@prisma/client';
import type { MessengerChannel } from './channels';

/** Длина превью последнего сообщения в списке диалогов. */
const PREVIEW_MAX = 200;

/** Превью для списка: одна строка, без лишних пробелов, не длиннее `PREVIEW_MAX`. */
export function previewOf(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_MAX ? `${oneLine.slice(0, PREVIEW_MAX).trimEnd()}…` : oneLine;
}

export type DialogKey = { channel: MessengerChannel; peerRef: string };

type DialogUpsertArgs = {
  create: Omit<Prisma.MessengerDialogUncheckedCreateInput, 'channel' | 'peerRef'>;
  update: Prisma.MessengerDialogUncheckedUpdateInput;
};

/**
 * Upsert диалога по ключу «канал + адрес» (Р-М-2) с одной повторной попыткой
 * при гонке. Два вебхука одного собеседника могут прийти одновременно: оба не
 * находят диалог, оба создают, второй ловит нарушение уникальности (P2002).
 * Повтор находит уже созданный и обновляет его — сообщение не теряется.
 * Любая другая ошибка и вторая P2002 подряд пробрасываются: это не гонка.
 *
 * Возвращает и привязку к организации, и известное имя собеседника:
 * уведомлению менеджерам (Р-М-9) нужно, чей это диалог и как его назвать,
 * без второго запроса.
 */
export async function upsertDialog(
  prisma: PrismaClient,
  key: DialogKey,
  args: DialogUpsertArgs
): Promise<{
  id: string;
  companyId: string | null;
  organizationId: string | null;
  peerDisplay: string | null;
}> {
  const run = () =>
    prisma.messengerDialog.upsert({
      where: { channel_peerRef: { channel: key.channel, peerRef: key.peerRef } },
      create: { channel: key.channel, peerRef: key.peerRef, ...args.create },
      update: args.update,
      select: { id: true, companyId: true, organizationId: true, peerDisplay: true },
    });
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return run();
    }
    throw err;
  }
}
