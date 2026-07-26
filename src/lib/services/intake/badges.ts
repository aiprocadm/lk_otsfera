import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { countIntake } from './list';
import { taskFiltersWhere } from '@/lib/services/tasks/board';

/**
 * Этап 7 (ФТ-8.4) — счётчики бейджей меню сотрудника: непустой Intake и
 * просроченные задачи (ФТ-7.3). Один вызов на поллинг (роут /api/staff/badges);
 * каркас расширяем для ФТ-15.2 (этап 11) — новые ключи добавляются сюда.
 */

export type StaffBadges = { intake: number; tasksOverdue: number };

export async function getStaffBadges(prisma: PrismaClient, session: SessionPayload): Promise<StaffBadges> {
  const [intake, tasksOverdue] = await Promise.all([
    countIntake(prisma, session),
    prisma.task.count({ where: taskFiltersWhere(session, { overdue: true }, new Date()) })
  ]);
  return { intake, tasksOverdue };
}
