import type { Prisma, PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
import { createNotification, deliverNotificationToUser } from './core';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/** Где написана заметка: по сделке (заказу) или по организации. */
type NoteMentionEntity = 'deal' | 'organization';

export type NoteMentionInput = {
  /** Кого упомянули — id пользователей; автора вызывающий уже исключил. */
  mentionedUserIds: string[];
  entity: NoteMentionEntity;
  /** id заказа (заметка по сделке) или организации. */
  entityId: string;
  noteId: string;
  body: string;
  /** Путь в кабинете менеджера. Администратору ссылку не даём — у него нет `/manager`. */
  managerPath: string;
};

const TITLE_RU: Record<NoteMentionEntity, string> = {
  deal: 'Вас упомянули в заметке по заказу',
  organization: 'Вас упомянули в заметке по организации',
};

const EXCERPT_MAX = 200;

/**
 * Единственный продьюсер типа `note_mention` (`У-183`, спека этапа 1 §3.6):
 * заметка по сделке и заметка по организации шлют одно и то же уведомление,
 * различая объект полем `meta.entity`. Извлечение упоминаний — забота
 * вызывающего сервиса (`extractMentions`), здесь только доставка.
 *
 * Никогда не бросает (fail-open, §3 CLAUDE.md): сбой уведомления не должен
 * отменить уже сохранённую заметку. Возвращает число оповещённых.
 */
export async function notifyNoteMention(
  prisma: PrismaLike,
  input: NoteMentionInput
): Promise<number> {
  if (input.mentionedUserIds.length === 0) return 0;
  const title = TITLE_RU[input.entity];
  const excerpt = input.body.slice(0, EXCERPT_MAX);
  // Прежняя форма `meta` заметок по сделке (`orderId`) сохраняется — по ней
  // строятся ссылки в ленте уведомлений.
  const meta =
    input.entity === 'deal'
      ? { entity: input.entity, orderId: input.entityId, noteId: input.noteId }
      : { entity: input.entity, organizationId: input.entityId, noteId: input.noteId };
  let notified = 0;
  try {
    const recipients = await prisma.user.findMany({
      where: { id: { in: input.mentionedUserIds } },
      select: { id: true, role: true },
    });
    for (const r of recipients) {
      const row = await createNotification({
        userId: r.id,
        type: 'note_mention',
        title,
        body: excerpt,
        meta,
      });
      await deliverNotificationToUser({
        userId: r.id,
        title,
        body: excerpt,
        type: 'note_mention',
        ...(r.role === 'admin' ? {} : { url: input.managerPath }),
        dedupKey: row.id,
      });
      notified += 1;
    }
  } catch (err) {
    log.warn('[notifications/noteMention] mention notify failed', {
      noteId: input.noteId,
      entity: input.entity,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return notified;
}
