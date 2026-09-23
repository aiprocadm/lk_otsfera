import { prisma } from '@/lib/db/prisma';
import { recordNotification, deliverNotificationToUser } from '@/lib/notifications';
import { log } from '@/lib/logging';
import { fmtDate } from '@/lib/format';

/**
 * Этап 7 (ФТ-7.2) — уведомления по задачам. Fan-out деградирует gracefully (§3
 * CLAUDE.md): ошибка доставки логируется и проглатывается, основную мутацию не
 * блокирует. Самоназначение не уведомляется (диф считает вызывающий).
 * Ссылка на карточку задачи (`У-232`) строится таблицей маршрутов по
 * `meta.taskId` от роли получателя — адрес кабинета в строку не пишем.
 */

export async function notifyTaskAssigned(args: {
  taskId: string;
  taskTitle: string;
  dueDate: Date | null;
  actorUserId: string;
  assigneeUserIds: string[];
}): Promise<void> {
  const recipients = [...new Set(args.assigneeUserIds)].filter((id) => id !== args.actorUserId);
  if (recipients.length === 0) return;

  const title = 'Вам назначена задача';
  // Дата — по Москве (`fmtDate`, прогон №36): срок из Битрикс24 «25.09 01:30
  // МСК» хранится как 24.09 22:30 UTC, и без пояса сервер (UTC) написал бы
  // «до 24.09» — на день раньше, чем на экране задачи.
  const due = args.dueDate ? `, срок до ${fmtDate(args.dueDate)}` : '';
  const body = `«${args.taskTitle}»${due}.`;
  const meta = { taskId: args.taskId };

  for (const userId of recipients) {
    try {
      // Ключ дедупа — задача: переназначение туда-обратно за час — одна строка.
      const { row, deduped } = await recordNotification(prisma, {
        userId,
        type: 'task_assigned',
        title,
        body,
        meta,
        entityId: args.taskId,
      });
      if (deduped) continue;
      await deliverNotificationToUser({
        userId,
        title,
        body,
        type: 'task_assigned',
        meta,
        dedupKey: row.id,
      });
    } catch (e) {
      log.error('[tasks/notify] task_assigned fan-out failed', {
        taskId: args.taskId,
        userId,
        error: (e as Error).message,
      });
    }
  }
}
