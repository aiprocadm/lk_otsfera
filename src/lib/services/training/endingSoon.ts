import type { PrismaClient } from '@prisma/client';
import { recordNotification, deliverNotificationToUser } from '@/lib/notifications';
import { moscowDaysUntil } from '@/lib/tasks/due';
import { moscowCalendarDay } from '@/lib/dates/calendar';
import { pluralizeRu } from '@/lib/format';

/**
 * «Скоро заканчивается срок обучения» (этап 2 ТЗ 13.10.2026, `У-286`,
 * `Р-2-6`): слушателю — за {@link TRAINING_ENDING_DAYS} дня до окончания
 * обучения (`EnrollmentRequestItem.endsOn`), **один раз на обучение**.
 *
 * Повтор отсекается по уже записанному уведомлению этого типа для позиции —
 * без отдельного журнала: окно дедупа ленты (60 минут) не спасло бы от
 * второго письма на следующий день.
 *
 * Запускается ежедневным прогоном напоминаний об удостоверениях
 * (`certificateExpiryProcessor`): расписание то же, отдельная очередь не нужна.
 */
const TRAINING_ENDING_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Окно «от сегодня до сегодня + N» по московским дням — для колонки
 * `@db.Date`. Границы-моменты (`dueWithinDaysWhere`) тут не годятся: Prisma
 * обрезает их до даты, и «меньше 15.11 21:00 UTC» превращается в «меньше
 * 15.11» — последний день окна выпадал (поймано тестом на живой базе).
 */
function dateOnlyWindow(today: Date, days: number): { gte: Date; lte: Date } {
  const from = moscowCalendarDay(today);
  const to = moscowCalendarDay(new Date(today.getTime() + days * DAY_MS));
  return { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) };
}

/** Позиции, которые ещё идут: подтверждены, зачислены или учатся. */
const ACTIVE = ['approved', 'provisioned', 'in_training'] as const;

export async function runTrainingEndingSoon(
  prisma: PrismaClient,
  today: Date
): Promise<{ remindersSent: number }> {
  const items = await prisma.enrollmentRequestItem.findMany({
    where: {
      status: { in: [...ACTIVE] },
      endsOn: dateOnlyWindow(today, TRAINING_ENDING_DAYS),
      student: { userId: { not: null } },
    },
    select: {
      id: true,
      endsOn: true,
      direction: { select: { name: true } },
      student: { select: { userId: true } },
    },
  });
  if (items.length === 0) return { remindersSent: 0 };

  const already = await prisma.notification.findMany({
    where: { type: 'training_ending_soon', entityId: { in: items.map((i) => i.id) } },
    select: { entityId: true },
  });
  const sent = new Set(already.map((n) => n.entityId));

  let remindersSent = 0;
  for (const item of items) {
    if (sent.has(item.id)) continue;
    // Выборка взяла только позиции со сроком и связанной учёткой.
    const userId = (item.student as { userId: string }).userId;
    const daysLeft = moscowDaysUntil(item.endsOn as Date, today);
    const when =
      daysLeft === 0
        ? 'сегодня'
        : `через ${daysLeft} ${pluralizeRu(daysLeft, 'день', 'дня', 'дней')}`;
    const title = 'Скоро заканчивается срок обучения';
    const body = `Обучение «${item.direction.name}» заканчивается ${when}. Успейте пройти курс на учебной площадке.`;
    const meta = { enrollmentItemId: item.id };
    const { row } = await recordNotification(prisma, {
      userId,
      type: 'training_ending_soon',
      title,
      body,
      meta,
      entityId: item.id,
    });
    await deliverNotificationToUser({
      userId,
      title,
      body,
      type: 'training_ending_soon',
      meta,
      dedupKey: row.id,
    });
    remindersSent += 1;
  }
  return { remindersSent };
}
