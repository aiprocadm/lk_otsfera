import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { taskWhereForLevel } from '@/lib/auth/accessProfile';

/**
 * Просроченные задачи для дашборда руководителя (`У-225`).
 *
 * До этого просрочка жила одной цифрой в «Моём дне» менеджера — то есть у
 * руководителя её не было вовсе, и узнать, что у команды третий день висит
 * незакрытая задача, он мог только зайдя на общую доску и отфильтровав её
 * руками.
 *
 * Выборка идёт поверх охвата профиля: руководитель со суженным охватом не
 * должен видеть здесь то, чего не видит на доске.
 */

export type OverdueTaskRow = {
  id: string;
  title: string;
  dueDate: Date;
  /** На сколько дней просрочена — по этому числу сортируется список. */
  overdueDays: number;
  assigneeNames: string[];
};

/** Сколько строк показывает блок; полный список — на доске с фильтром. */
export const OVERDUE_BLOCK_CAP = 10;

export async function listOverdueTasks(
  prisma: PrismaClient,
  session: SessionPayload,
  now: Date = new Date()
): Promise<{ rows: OverdueTaskRow[]; total: number }> {
  if (!session.companyId) return { rows: [], total: 0 };

  const where = {
    AND: [
      taskWhereForLevel(session, session.accessProfile?.tasks ?? 'all'),
      { status: { not: 'done' as const }, dueDate: { lt: now } },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      // Сначала самые старые: они и есть проблема, а не свежая вчерашняя.
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: OVERDUE_BLOCK_CAP,
      select: {
        id: true,
        title: true,
        dueDate: true,
        assignees: { select: { user: { select: { name: true } } } },
      },
    }),
    prisma.task.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((t) => ({
      id: t.id,
      title: t.title,
      // `dueDate` не может быть пустым: условие выборки требует `< now`.
      dueDate: t.dueDate as Date,
      overdueDays: Math.max(
        1,
        Math.floor((now.getTime() - (t.dueDate as Date).getTime()) / 86_400_000)
      ),
      assigneeNames: t.assignees.map((a) => a.user.name),
    })),
  };
}
