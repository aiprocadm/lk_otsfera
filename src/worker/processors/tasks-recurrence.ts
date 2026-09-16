import type { PrismaClient } from '@prisma/client';
import { sweepRecurringTasks } from '@/lib/services/tasks/recurrence';

/**
 * Этап 4 (`У-221`) — ночной обход повторяющихся задач, 06:00 МСК.
 *
 * Обычно следующий экземпляр рождается сразу, как человек закрыл текущий. Этот
 * прогон — про второй случай: задачу НЕ закрыли, а срок прошёл. Без него
 * «еженедельная проверка оплат» исчезла бы из работы ровно тогда, когда о ней
 * забыли, — то есть когда она нужнее всего.
 *
 * Вся логика — в сервисе `services/tasks/recurrence.ts`: процессор остаётся
 * тонкой обёрткой, как `task-due-soon` и `expire-proposals`.
 */
export async function runTasksRecurrence(
  prisma: PrismaClient,
  now: Date
): Promise<{ scanned: number; created: number }> {
  return sweepRecurringTasks(prisma, now);
}

/** BullMQ wrapper, вызывается воркером по расписанию. */
export async function tasksRecurrenceProcessor(): Promise<{ scanned: number; created: number }> {
  const { prisma } = await import('@/lib/db/prisma');
  return runTasksRecurrence(prisma, new Date());
}
