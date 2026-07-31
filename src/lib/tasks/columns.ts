import type { PrismaClient, TaskStatus } from '@prisma/client';

/**
 * Трек G3 — колонки канбана задач. Словарь `TaskColumn` (company-scoped) поверх
 * enum-якорей `TaskStatus`; если у компании нет кастомных колонок — используются
 * дефолтные (эта константа). `id` дефолта — `default:<anchor>` (синтетический,
 * стабильный); кастомной — реальный cuid. Зеркало `src/lib/funnel/stages.ts`.
 */

export type TaskColumnView = {
  id: string;
  name: string;
  position: number;
  statusAnchor: TaskStatus;
  isDoneColumn: boolean;
  color: string | null;
};

/** Дефолтный канбан (§21 ТЗ): 3 рабочих + 1 done-колонка над якорями TaskStatus. */
export const DEFAULT_TASK_COLUMNS: readonly TaskColumnView[] = [
  {
    id: 'default:todo',
    name: 'К выполнению',
    position: 0,
    statusAnchor: 'todo',
    isDoneColumn: false,
    color: null,
  },
  {
    id: 'default:in_progress',
    name: 'В работе',
    position: 1,
    statusAnchor: 'in_progress',
    isDoneColumn: false,
    color: null,
  },
  {
    id: 'default:review',
    name: 'На проверке',
    position: 2,
    statusAnchor: 'review',
    isDoneColumn: false,
    color: null,
  },
  {
    id: 'default:done',
    name: 'Готово',
    position: 3,
    statusAnchor: 'done',
    isDoneColumn: true,
    color: null,
  },
];

/** Колонки компании: кастомные (если заданы) или дефолтные. */
export async function resolveTaskColumns(
  prisma: PrismaClient,
  companyId: string
): Promise<TaskColumnView[]> {
  const custom = await prisma.taskColumn.findMany({
    where: { companyId },
    orderBy: { position: 'asc' },
  });
  if (custom.length === 0) return DEFAULT_TASK_COLUMNS.map((c) => ({ ...c }));
  return custom.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    statusAnchor: c.statusAnchor,
    isDoneColumn: c.isDoneColumn,
    color: c.color,
  }));
}

/**
 * Колонка, в которую попадает задача: явный `columnId` (если существует среди
 * columns), иначе первая колонка с якорем = status задачи (дефолтная для якоря).
 */
export function columnForTask(
  columns: TaskColumnView[],
  task: { status: TaskStatus; columnId: string | null }
): TaskColumnView | undefined {
  if (task.columnId) {
    const explicit = columns.find((c) => c.id === task.columnId);
    if (explicit) return explicit;
  }
  return columns.find((c) => c.statusAnchor === task.status);
}
