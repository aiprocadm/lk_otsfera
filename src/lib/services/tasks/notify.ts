import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { log } from '@/lib/logging';

/**
 * Этап 7 (ФТ-7.2) — уведомления по задачам. Fan-out деградирует gracefully (§3
 * CLAUDE.md): ошибка доставки логируется и проглатывается, основную мутацию не
 * блокирует. Самоназначение не уведомляется (диф считает вызывающий).
 * Deep-link — meta.url на доску задач (href.ts отдаёт meta.url приоритетом).
 */

export const TASKS_BOARD_URL = '/manager/tasks';

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
  const due = args.dueDate ? `, срок до ${new Date(args.dueDate).toLocaleDateString('ru-RU')}` : '';
  const body = `«${args.taskTitle}»${due}.`;

  for (const userId of recipients) {
    try {
      const row = await createNotification({
        userId,
        type: 'task_assigned',
        title,
        body,
        meta: { taskId: args.taskId, url: TASKS_BOARD_URL },
      });
      await deliverNotificationToUser({
        userId,
        title,
        body,
        type: 'task_assigned',
        url: TASKS_BOARD_URL,
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
