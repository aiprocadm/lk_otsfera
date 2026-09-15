import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';
import type { SessionPayload } from '@/lib/auth/jwt';
import { log } from '@/lib/logging';
import { notifyNoteMention } from '@/lib/notifications/noteMention';
import { extractMentions, listColleagues } from '@/lib/services/staffChat/mentions';
import { isDialogInScope } from './scope';

/**
 * Внутренняя заметка в диалоге (`У-209`, спека этапа 3 §3.5).
 *
 * Зачем: обсудить клиента, не открывая соседнюю вкладку и не рискуя отправить
 * обсуждение ему же. Заметка живёт в той же ленте, что и переписка, но
 * помечена и **никуда не уходит**.
 *
 * ДВА независимых запрета, а не один (это принципиально):
 *
 * 1. **Транспорт.** Здесь нет и не может быть вызова отправки: заметка
 *    пишется прямо в базу, минуя `send.ts`.
 * 2. **Клиентские выборки.** Сообщения, которые видит клиент (`У-212`,
 *    `У-234`), фильтруются по направлению — заметка в них не попадает.
 *
 * Один запрет без другого бесполезен: закрой транспорт, но отдай заметку в
 * кабинет — и клиент прочитает её там. Каждый закреплён своим стражем.
 *
 * Заметка **не двигает статус диалога** (`У-207`): обсуждение между коллегами
 * не является ответом клиенту, и снимать диалог с контроля SLA ему нельзя.
 */

export const DIALOG_NOTE_MAX = 4000;

/**
 * Что видно в списке диалогов вместо текста заметки. Именно константа, а не
 * обрезанный текст: превью диалога клиенту видно (см. ниже), и содержимое
 * внутреннего обсуждения туда попадать не должно.
 */
const NOTE_PREVIEW = 'Внутренняя заметка';

export type AddDialogNoteResult =
  | { ok: true; messageId: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'invalid' | 'text_too_long' };

export async function addDialogNote(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dialogId: string; text: string }
): Promise<AddDialogNoteResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const dialog = await prisma.messengerDialog.findUnique({
    where: { id: args.dialogId },
    select: { id: true, companyId: true, organizationId: true },
  });
  if (!dialog || !isDialogInScope(session, dialog)) return { ok: false, error: 'not_found' };

  const text = args.text.trim();
  if (!text) return { ok: false, error: 'invalid' };
  if (text.length > DIALOG_NOTE_MAX) return { ok: false, error: 'text_too_long' };

  const message = await prisma.messengerMessage.create({
    data: {
      dialogId: dialog.id,
      direction: 'note',
      body: text,
      authorId: session.sub,
      // Заметка никуда не отправляется — «доставлено» к ней неприменимо, но
      // поле обязательное: ставим `sent`, чтобы лента не сочла её неудачной.
      deliveryStatus: 'sent',
    },
    select: { id: true },
  });

  // Превью списка получает ПОМЕТКУ БЕЗ ТЕКСТА заметки.
  //
  // Это третья дверь наружу, которую легко не заметить: поле
  // `lastMessagePreview` лежит на самом диалоге и не фильтруется по
  // направлению нигде. Экран «Переписка с менеджером» в кабинете клиента
  // (`У-212`, `У-234`) покажет список диалогов с превью — и первые двести
  // символов внутреннего обсуждения уехали бы клиенту, хотя сама заметка в
  // ленту ему не попадает.
  await prisma.messengerDialog.update({
    where: { id: dialog.id },
    data: {
      lastMessageAt: new Date(),
      lastMessagePreview: NOTE_PREVIEW,
      lastMessageDirection: 'note',
    },
  });

  await recordAudit(prisma, {
    action: 'dialog_note_added',
    entity: 'messenger_dialog',
    entityId: dialog.id,
    userId: session.sub,
    after: { messageId: message.id },
  });

  // `@упоминание` → уведомление коллеге. Общий продьюсер `note_mention` (один
  // на тип, требование стража реестра); best-effort — сбой не отменяет
  // сохранённую заметку.
  try {
    if (text.includes('@')) {
      const colleagues = await listColleagues(prisma, session);
      const mentioned = extractMentions(text, colleagues.rows).filter((id) => id !== session.sub);
      await notifyNoteMention(prisma, {
        mentionedUserIds: mentioned,
        entity: 'dialog',
        entityId: dialog.id,
        noteId: message.id,
        body: text,
        managerPath: `/manager/messengers/${dialog.id}`,
      });
    }
  } catch (error) {
    log.warn('[messengers/note] mention notify failed', {
      messageId: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { ok: true, messageId: message.id };
}
