import type { PrismaClient } from '@prisma/client';
import { recordNotification, deliverNotificationToUser } from '@/lib/notifications';
import { fmtDate } from '@/lib/format';
import { dueByWhere } from '@/lib/tasks/due';

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

export async function runTaskDueSoon(
  prisma: PrismaClient,
  now: Date
): Promise<{ notified: number }> {
  const tasks = await prisma.task.findMany({
    where: {
      // «До конца завтрашнего дня» — по МОСКОВСКОМУ календарю (прогон №36,
      // `Р-М-3`). Было `setDate`/`setHours` в поясе процесса, а процесс живёт
      // в UTC: конец «завтра» наступал в 02:59 МСК послезавтра, и срок из
      // Битрикс24 «послезавтра 01:30 МСК» получал «скоро срок» на день раньше.
      dueDate: { not: null, ...dueByWhere(now, 1) },
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
    // Дата — по Москве (`fmtDate`), как на экране задачи.
    /* v8 ignore next -- defensive: where-фильтр отбирает только dueDate != null */
    const dueLabel = task.dueDate ? fmtDate(task.dueDate) : '';
    const title = 'Скоро срок задачи';
    const body = `«${task.title}» — срок ${dueLabel}.`;
    // `У-232`: ссылку на карточку задачи строит таблица маршрутов по `taskId`
    // от роли получателя — адрес кабинета сюда не пишем.
    const meta = { taskId: task.id };

    for (const userId of [...new Set(recipients)]) {
      const { row, deduped } = await recordNotification(prisma, {
        userId,
        type: 'task_due_soon',
        title,
        body,
        meta,
        entityId: task.id,
      });
      if (deduped) continue;
      await deliverNotificationToUser({
        userId,
        title,
        body,
        type: 'task_due_soon',
        meta,
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
