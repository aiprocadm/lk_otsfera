import type { PrismaClient, TaskPriority } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { taskWhereForLevel, canSeeTask, NO_COMPANY_SENTINEL } from '@/lib/auth/accessProfile';
import { resolveTaskColumns, columnForTask, type TaskColumnView } from '@/lib/tasks/columns';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Трек G3 — доска задач (канбан). Задачи сгруппированы по колонкам (словарь
 * `TaskColumn` или дефолты), в рамках tasks-охвата профиля (G1) с company-floor.
 * `moveTask` — перемещение карточки: в отличие от воронки, у задач НЕТ lifecycle
 * (любая колонка → любая), единственный сайд-эффект — done-колонка ставит
 * `completedAt`. Клиентские роли доски не видят (canSeeTask, §4).
 */

export type TaskCard = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority | null;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  createdByName: string;
  columnId: string;
  assigneeIds: string[];
  assigneeNames: string[];
  linkedOrderId: string | null;
  linkedOrderTitle: string | null;
  linkedOrganizationId: string | null;
  linkedOrganizationName: string | null;
};

export type TaskBoardColumn = { column: TaskColumnView; cards: TaskCard[] };
export type TaskBoard = { columns: TaskColumnView[]; board: TaskBoardColumn[] };

const CARD_INCLUDE = {
  createdBy: { select: { name: true } },
  assignees: { select: { userId: true, user: { select: { name: true } } } },
  linkedOrder: { select: { title: true } },
  linkedOrganization: { select: { name: true } }
} as const;

export async function listTaskBoard(prisma: PrismaClient, session: SessionPayload): Promise<TaskBoard> {
  const columns = await resolveTaskColumns(prisma, session.companyId ?? '');
  const where = taskWhereForLevel(session, session.accessProfile?.tasks ?? 'all');

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true, title: true, description: true, priority: true, dueDate: true, completedAt: true,
      status: true, columnId: true, createdAt: true,
      linkedOrderId: true, linkedOrganizationId: true, ...CARD_INCLUDE
    }
  });

  const board: TaskBoardColumn[] = columns.map((column) => ({ column, cards: [] }));
  const byColumnId = new Map(board.map((c) => [c.column.id, c]));

  for (const t of tasks) {
    const column = columnForTask(columns, t);
    if (!column) continue; // статус без колонки (кастомный набор не покрывает якорь) — пропускаем
    byColumnId.get(column.id)?.cards.push({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
      createdByName: t.createdBy.name,
      columnId: column.id,
      assigneeIds: t.assignees.map((a) => a.userId),
      assigneeNames: t.assignees.map((a) => a.user.name),
      linkedOrderId: t.linkedOrderId,
      linkedOrderTitle: t.linkedOrder?.title ?? null,
      linkedOrganizationId: t.linkedOrganizationId,
      linkedOrganizationName: t.linkedOrganization?.name ?? null
    });
  }

  return { columns, board };
}

/** Данные для селектов диалога задачи (исполнители/организации/заявки), company-scoped. */
export type TaskFormOptions = {
  users: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  orders: { id: string; title: string }[];
};

export async function getTaskFormOptions(prisma: PrismaClient, session: SessionPayload): Promise<TaskFormOptions> {
  const companyId = session.companyId ?? NO_COMPANY_SENTINEL; // нет компании → пустые списки (fail-safe)
  const [users, organizations, orders] = await Promise.all([
    prisma.user.findMany({ where: { companyId, role: 'manager', isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }),
    prisma.organization.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }),
    prisma.order.findMany({ where: { companyId }, select: { id: true, title: true }, orderBy: { createdAt: 'desc' }, take: 100 })
  ]);
  return { users, organizations, orders };
}

export type MoveTaskError = 'not_found' | 'forbidden' | 'invalid_column';

export async function moveTask(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { taskId: string; toColumnId: string }
): Promise<{ ok: true } | { ok: false; error: MoveTaskError }> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const columns = await resolveTaskColumns(prisma, session.companyId);
  const target = columns.find((c) => c.id === args.toColumnId);
  if (!target) return { ok: false, error: 'invalid_column' };

  const task = await prisma.task.findUnique({
    where: { id: args.taskId },
    select: {
      id: true, companyId: true, status: true, columnId: true, completedAt: true,
      createdById: true, linkedOrganizationId: true, assignees: { select: { userId: true } }
    }
  });
  if (!task) return { ok: false, error: 'not_found' };
  const scopeTask = {
    companyId: task.companyId,
    createdById: task.createdById,
    assigneeUserIds: task.assignees.map((a) => a.userId),
    linkedOrganizationId: task.linkedOrganizationId
  };
  if (!canSeeTask(session, scopeTask)) return { ok: false, error: 'not_found' }; // scope: не leak-аем

  // Синтетический дефолт-id (`default:*`) не FK — columnId остаётся null (колонка
  // выводится из status-якоря); кастомная колонка → реальный cuid.
  const persistColumnId = args.toColumnId.startsWith('default:') ? null : args.toColumnId;
  // done-колонка проставляет completedAt (сохраняем прежний, если уже была done); иначе — сброс.
  const completedAt = target.isDoneColumn ? (task.completedAt ?? new Date()) : null;

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: task.id },
      data: { columnId: persistColumnId, status: target.statusAnchor, completedAt }
    });
    await recordAudit(tx, {
      userId: session.sub, action: 'task_moved', entity: 'task', entityId: task.id,
      before: { status: task.status, columnId: task.columnId },
      after: { status: target.statusAnchor, columnId: persistColumnId }
    });
  });
  return { ok: true };
}
