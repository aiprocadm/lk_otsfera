import type { PrismaClient } from '@prisma/client';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { TASKS_BOARD_URL } from '@/lib/services/tasks/notify';

/**
 * Этап 7 (ФТ-7.2) — дневной джоб «скоро срок задачи»: dueDate ≤ конца завтрашнего
 * дня (включая уже просроченные, не уведомлённые ранее), статус ≠ done. Дедуп —
 * атомарный claim `dueSoonNotifiedAt` (образец calendar-reminder: updateMany по
 * null-полю; повторный прогон и конкурирующий воркер строку не перехватят).
 * Перенос срока сбрасывает поле (updateTask) → уведомление уйдёт заново.
 * Получатели — исполнители; без исполнителей — создатель (иначе о сроке не
 * узнает никто).
 */

const BATCH_LIMIT = 500;

function endOfTomorrow(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function runTaskDueSoon(
  prisma: PrismaClient,
  now: Date
): Promise<{ notified: number }> {
  const horizon = endOfTomorrow(now);

  const tasks = await prisma.task.findMany({
    where: {
      dueDate: { not: null, lte: horizon },
      status: { not: 'done' },
      dueSoonNotifiedAt: null,
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      createdById: true,
      assignees: { select: { userId: true } },
    },
    orderBy: { dueDate: 'asc' },
    take: BATCH_LIMIT,
  });

  let notified = 0;
  for (const task of tasks) {
    const claimed = await prisma.task.updateMany({
      where: { id: task.id, dueSoonNotifiedAt: null },
      data: { dueSoonNotifiedAt: now },
    });
    if (claimed.count === 0) continue; // перехвачено конкурирующим прогоном

    const recipients =
      task.assignees.length > 0 ? task.assignees.map((a) => a.userId) : [task.createdById];
    /* v8 ignore next -- defensive: where-фильтр отбирает только dueDate != null */
    const dueLabel = task.dueDate ? new Date(task.dueDate).toLocaleDateString('ru-RU') : '';
    const title = 'Скоро срок задачи';
    const body = `«${task.title}» — срок ${dueLabel}.`;

    for (const userId of [...new Set(recipients)]) {
      const row = await createNotification({
        userId,
        type: 'task_due_soon',
        title,
        body,
        meta: { taskId: task.id, url: TASKS_BOARD_URL },
      });
      await deliverNotificationToUser({
        userId,
        title,
        body,
        type: 'task_due_soon',
        url: TASKS_BOARD_URL,
        dedupKey: row.id,
      });
    }

    notified += 1;
  }

  return { notified };
}

/** BullMQ wrapper, вызывается воркером по расписанию. */
export async function taskDueSoonProcessor(): Promise<{ notified: number }> {
  const { prisma } = await import('@/lib/db/prisma');
  return runTaskDueSoon(prisma, new Date());
}
