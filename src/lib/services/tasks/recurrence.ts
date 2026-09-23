import { Prisma, type PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
import { nextOccurrence, parseRecurrence } from '@/lib/tasks/recurrence';
import { pastDueWhere } from '@/lib/tasks/due';
import { createTaskCore } from './create';

/**
 * Повторяющиеся задачи (`У-221`) — рождение следующего экземпляра.
 *
 * **Экземпляр вперёд ровно один.** Не «все повторы на год вперёд»: доска задач
 * тогда превращается в календарь, а изменение правила задним числом требует
 * чистить хвост. Следующий появляется, когда текущий завершён или когда его срок
 * прошёл, — то есть ровно тогда, когда о нём пора думать.
 *
 * **Дубль невозможен по устройству базы.** Следующий экземпляр рождается двумя
 * путями — завершением задачи и ночным прогоном, — и они могут сойтись в одну
 * секунду. Уникальность `Task.recurrenceParentId` означает «у экземпляра ровно
 * один потомок»: второй вставки не будет, база ответит `P2002`, и повтор молча
 * пропускается. Тот же приём, что у журнала срабатываний правил.
 */

/** Почему следующий экземпляр не создан. Это не ошибки — это нормальные исходы. */
type RecurrenceSkip =
  | 'not_found'
  | 'no_rule'
  /** `until` в прошлом: серия закончилась, падать тут не на чем. */
  | 'series_finished'
  /** Потомок уже есть — второй путь успел раньше. */
  | 'already_materialized'
  /** У задачи нет срока: считать «следующий раз» не от чего. */
  | 'no_due_date';

export type MaterializeResult = { created: string } | { skipped: RecurrenceSkip };

const TASK_SELECT = {
  id: true,
  companyId: true,
  createdById: true,
  title: true,
  description: true,
  priority: true,
  dueDate: true,
  recurrence: true,
  linkedOrderId: true,
  linkedOrganizationId: true,
  linkedLeadId: true,
  linkedDealId: true,
  linkedContactId: true,
  linkedDialogId: true,
  linkedDocumentId: true,
  assignees: { select: { userId: true } },
  checklist: { select: { title: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
  recurrenceChild: { select: { id: true } },
} satisfies Prisma.TaskSelect;

/**
 * Создаёт следующий экземпляр серии для задачи `taskId`.
 *
 * Новый экземпляр всегда начинается с начала: статус `todo`, колонка —
 * начальная, чек-лист скопирован НЕотмеченным. Это новая работа, а не копия
 * состояния: переносить галочки прошлой недели в задачу следующей значит врать
 * о том, что она уже наполовину сделана.
 */
export async function materializeNextOccurrence(
  prisma: PrismaClient,
  taskId: string
): Promise<MaterializeResult> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: TASK_SELECT });
  if (!task) return { skipped: 'not_found' };
  if (task.recurrenceChild) return { skipped: 'already_materialized' };

  const rule = parseRecurrence(task.recurrence);
  if (!rule) return { skipped: 'no_rule' };
  if (!task.dueDate) return { skipped: 'no_due_date' };

  const due = nextOccurrence(rule, task.dueDate);
  if (!due) return { skipped: 'series_finished' };

  try {
    return await prisma.$transaction(async (tx) => {
      const next = await createTaskCore(tx, {
        companyId: task.companyId,
        // Автор серии, а не тот, кто закрыл прошлый экземпляр: задачу завёл он,
        // и отвечать на вопрос «откуда это взялось» тоже ему.
        createdById: task.createdById,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: due,
        status: 'todo',
        columnId: null,
        completedAt: null,
        linkedOrderId: task.linkedOrderId,
        linkedOrganizationId: task.linkedOrganizationId,
        linkedLeadId: task.linkedLeadId,
        linkedDealId: task.linkedDealId,
        linkedContactId: task.linkedContactId,
        linkedDialogId: task.linkedDialogId,
        linkedDocumentId: task.linkedDocumentId,
        assigneeIds: task.assignees.map((a) => a.userId),
      });

      await tx.task.update({
        where: { id: next.id },
        // Правило переезжает В НОВЫЙ экземпляр: серия живёт в последнем, и
        // «больше не повторять» — это снять правило именно с него.
        data: { recurrence: task.recurrence as Prisma.InputJsonValue, recurrenceParentId: task.id },
      });

      if (task.checklist.length > 0) {
        await tx.taskChecklistItem.createMany({
          data: task.checklist.map((item) => ({
            taskId: next.id,
            title: item.title,
            sortOrder: item.sortOrder,
            isDone: false,
          })),
        });
      }

      return { created: next.id };
    });
  } catch (e) {
    // Гонка двух путей: потомка уже создали, пока мы считали. Это штатный исход.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { skipped: 'already_materialized' };
    }
    throw e;
  }
}

/**
 * Тот же вызов, но без права упасть: используется там, где повтор — побочный
 * эффект основного действия (человек закрыл задачу). Сбой рождения следующего
 * экземпляра не должен отменять завершение текущей (§3, graceful degrade).
 */
export async function materializeNextOccurrenceSafely(
  prisma: PrismaClient,
  taskId: string
): Promise<void> {
  try {
    await materializeNextOccurrence(prisma, taskId);
  } catch (e) {
    log.error('[tasks] не удалось создать следующий экземпляр серии', {
      taskId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Сколько задач разбираем за один ночной прогон. */
const RECURRENCE_SWEEP_CAP = 500;

/**
 * Ночной обход: у кого правило есть, потомка ещё нет, а срок уже прошёл.
 *
 * Завершённые сюда тоже попадают: если человек закрыл задачу до срока, следующий
 * экземпляр родится сразу при завершении, а этот обход просто ничего не найдёт.
 * Обход — страховка на случай, когда экземпляр никто не закрыл.
 */
export async function sweepRecurringTasks(
  prisma: PrismaClient,
  now: Date
): Promise<{ scanned: number; created: number }> {
  const due = await prisma.task.findMany({
    where: {
      recurrence: { not: Prisma.DbNull },
      recurrenceChild: null,
      // «Срок прошёл» — закончился московский день срока (прогон №36,
      // `Р-М-3`), как обещает подсказка формы: «когда пройдёт срок». Прежнее
      // «срок < сейчас» в 06:00 МСК рождало следующий экземпляр в сам день
      // срока, пока текущий ещё честно в работе.
      dueDate: pastDueWhere(now),
    },
    select: { id: true },
    orderBy: { dueDate: 'asc' },
    take: RECURRENCE_SWEEP_CAP,
  });

  let created = 0;
  for (const task of due) {
    // Каждая задача сама по себе: одна сломанная серия не должна останавливать
    // остальные (тот же принцип, что у прогона правил автоматизации).
    try {
      const res = await materializeNextOccurrence(prisma, task.id);
      if ('created' in res) created += 1;
    } catch (e) {
      log.error('[worker] повтор задачи не создан', {
        taskId: task.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { scanned: due.length, created };
}
