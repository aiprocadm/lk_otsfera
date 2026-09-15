import type { Prisma, PrismaClient, TaskPriority } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { taskWhereForLevel, canSeeTask, NO_COMPANY_SENTINEL } from '@/lib/auth/accessProfile';
import { resolveTaskColumns, columnForTask, type TaskColumnView } from '@/lib/tasks/columns';
import { recordAudit } from '@/lib/auth/audit';
import { taskLinkField, taskLinkValue, type TaskLinkRef } from '@/lib/tasks/links';
import { hasOpenChecklistItems } from './checklist';

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
  linkedLeadId: string | null;
  linkedLeadSubject: string | null;
  linkedDealId: string | null;
  linkedDealTitle: string | null;
  /** `У-220`: задача заводится из любой карточки — контакта, переписки, документа. */
  linkedContactId: string | null;
  linkedContactName: string | null;
  linkedDialogId: string | null;
  linkedDialogPeer: string | null;
  linkedDocumentId: string | null;
  linkedDocumentName: string | null;
  /** `У-219`: прогресс чек-листа «3/5». Обе цифры 0 — чек-листа нет, подпись не рисуется. */
  checklistDone: number;
  checklistTotal: number;
};

/**
 * Прогресс чек-листов пачкой. Отдельный группирующий запрос, а не `include`
 * пунктов в карточку: у доски предел 500 карточек, и подтянуть к каждой её
 * пункты значило бы вытащить десятки тысяч строк ради двух цифр.
 */
async function checklistProgress(
  prisma: PrismaClient,
  taskIds: string[]
): Promise<Map<string, { done: number; total: number }>> {
  const progress = new Map<string, { done: number; total: number }>();
  if (taskIds.length === 0) return progress;
  const rows = await prisma.taskChecklistItem.groupBy({
    by: ['taskId', 'isDone'],
    where: { taskId: { in: taskIds } },
    _count: { _all: true },
  });
  for (const row of rows) {
    const current = progress.get(row.taskId) ?? { done: 0, total: 0 };
    current.total += row._count._all;
    if (row.isDone) current.done += row._count._all;
    progress.set(row.taskId, current);
  }
  return progress;
}

type TaskBoardColumn = { column: TaskColumnView; cards: TaskCard[] };
export type TaskBoard = {
  columns: TaskColumnView[];
  board: TaskBoardColumn[];
  /** `С-6`/`Р-27`: сколько карточек получено (≤ `BOARD_CAP`) и сколько подходит всего. */
  shown: number;
  total: number;
};

/**
 * Предел доски. `status asc` — порядок объявления `TaskStatus` в
 * `schema.prisma` (`todo, in_progress, review, done`): открытые задачи
 * попадают в предел первыми, за него уходят старые выполненные — страж
 * `prisma.enum-terminal-last.guardrail` держит порядок.
 */
export const BOARD_CAP = 500;

/** Этап 7 (ФТ-7.3): фильтры доски/списка. Всё поверх охвата профиля (не вместо). */
export type TaskBoardFilters = {
  scope?: 'mine' | 'all';
  assigneeId?: string | null;
  overdue?: boolean;
};

const CARD_INCLUDE = {
  createdBy: { select: { name: true } },
  assignees: { select: { userId: true, user: { select: { name: true } } } },
  linkedOrder: { select: { title: true } },
  linkedOrganization: { select: { name: true } },
  linkedLead: { select: { subject: true } },
  linkedDeal: { select: { title: true } },
  linkedContact: { select: { name: true } },
  linkedDialog: { select: { peerDisplay: true, peerRef: true } },
  linkedDocument: { select: { name: true } },
} as const;

const CARD_SELECT = {
  id: true,
  title: true,
  description: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  status: true,
  columnId: true,
  createdAt: true,
  linkedOrderId: true,
  linkedOrganizationId: true,
  linkedLeadId: true,
  linkedDealId: true,
  linkedContactId: true,
  linkedDialogId: true,
  linkedDocumentId: true,
  ...CARD_INCLUDE,
} as const;

type CardRow = Prisma.TaskGetPayload<{ select: typeof CARD_SELECT }>;

function toCard(
  t: CardRow,
  columnId: string,
  checklist?: { done: number; total: number } | undefined
): TaskCard {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    createdByName: t.createdBy.name,
    columnId,
    assigneeIds: t.assignees.map((a) => a.userId),
    assigneeNames: t.assignees.map((a) => a.user.name),
    linkedOrderId: t.linkedOrderId,
    linkedOrderTitle: t.linkedOrder?.title ?? null,
    linkedOrganizationId: t.linkedOrganizationId,
    linkedOrganizationName: t.linkedOrganization?.name ?? null,
    linkedLeadId: t.linkedLeadId,
    linkedLeadSubject: t.linkedLead?.subject ?? null,
    linkedDealId: t.linkedDealId,
    linkedDealTitle: t.linkedDeal?.title ?? null,
    linkedContactId: t.linkedContactId,
    linkedContactName: t.linkedContact?.name ?? null,
    linkedDialogId: t.linkedDialogId,
    // У собеседника может не быть имени — тогда показываем адрес, по которому
    // он пишет. Пустая строка вместо подписи выглядела бы как поломка.
    linkedDialogPeer: t.linkedDialog
      ? (t.linkedDialog.peerDisplay ?? t.linkedDialog.peerRef)
      : null,
    linkedDocumentId: t.linkedDocumentId,
    linkedDocumentName: t.linkedDocument?.name ?? null,
    checklistDone: checklist?.done ?? 0,
    checklistTotal: checklist?.total ?? 0,
  };
}

/** Композиция where: охват профиля + пользовательские фильтры ФТ-7.3. */
export function taskFiltersWhere(
  session: SessionPayload,
  filters: TaskBoardFilters | undefined,
  now: Date
): Prisma.TaskWhereInput {
  const base = taskWhereForLevel(session, session.accessProfile?.tasks ?? 'all');
  const and: Prisma.TaskWhereInput[] = [base];
  if (filters?.scope === 'mine') {
    and.push({
      OR: [{ createdById: session.sub }, { assignees: { some: { userId: session.sub } } }],
    });
  }
  if (filters?.assigneeId) {
    and.push({ assignees: { some: { userId: filters.assigneeId } } });
  }
  if (filters?.overdue) {
    and.push({ dueDate: { lt: now }, status: { not: 'done' } });
  }
  return and.length === 1 ? base : { AND: and };
}

export async function listTaskBoard(
  prisma: PrismaClient,
  session: SessionPayload,
  filters?: TaskBoardFilters
): Promise<TaskBoard> {
  const columns = await resolveTaskColumns(prisma, session.companyId ?? '');
  const where = taskFiltersWhere(session, filters, new Date());

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: BOARD_CAP,
      select: CARD_SELECT,
    }),
    prisma.task.count({ where }),
  ]);

  const board: TaskBoardColumn[] = columns.map((column) => ({ column, cards: [] }));
  const byColumnId = new Map(board.map((c) => [c.column.id, c]));
  const progress = await checklistProgress(
    prisma,
    tasks.map((t) => t.id)
  );

  for (const t of tasks) {
    const column = columnForTask(columns, t);
    if (!column) continue; // статус без колонки (кастомный набор не покрывает якорь) — пропускаем
    byColumnId.get(column.id)?.cards.push(toCard(t, column.id, progress.get(t.id)));
  }

  return { columns, board, shown: tasks.length, total };
}

/**
 * Этап 7 (ФТ-7.1/3.2), расширено этапом 4 (`У-220`) — плоский список задач,
 * привязанных к объекту, для блока «Задачи» на его карточке. Видимость — тот
 * же tasks-охват профиля; сам родитель гейтится страницей (карточка лида,
 * контакта, диалога, документа, организации).
 *
 * Поле выборки берётся из общего справочника `taskLinkField`, а не из своей
 * лесенки `if`: иначе сервис и форма однажды разойдутся в том, какое поле
 * считать «связью с документом».
 */
export async function listLinkedTasks(
  prisma: PrismaClient,
  session: SessionPayload,
  link: TaskLinkRef
): Promise<TaskCard[]> {
  const isStaff = session.role === 'admin' || isStaffManagerSide(session);
  if (!isStaff || !session.companyId) return [];
  const columns = await resolveTaskColumns(prisma, session.companyId);
  const base = taskWhereForLevel(session, session.accessProfile?.tasks ?? 'all');
  const linkWhere = { [taskLinkField(link)]: taskLinkValue(link) } as Prisma.TaskWhereInput;

  const tasks = await prisma.task.findMany({
    where: { AND: [base, linkWhere] },
    orderBy: [
      { completedAt: 'asc' },
      { dueDate: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
    ],
    take: 50,
    select: CARD_SELECT,
  });
  const progress = await checklistProgress(
    prisma,
    tasks.map((t) => t.id)
  );
  return tasks
    .map((t) => {
      const column = columnForTask(columns, t);
      return column ? toCard(t, column.id, progress.get(t.id)) : null;
    })
    .filter((c): c is TaskCard => c !== null);
}

/** Данные для селектов диалога задачи (исполнители/организации/заявки), company-scoped. */
export type TaskFormOptions = {
  users: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  orders: { id: string; title: string }[];
  /** `Р-27`: полные счётчики — диалог подписывает усечённый селект «показаны N из M». */
  organizationsTotal: number;
  ordersTotal: number;
};

/** Пределы селектов диалога задачи (`Р-27`: организации — по последней активности). */
export const FORM_ORGANIZATIONS_CAP = 200;
export const FORM_ORDERS_CAP = 100;

export async function getTaskFormOptions(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<TaskFormOptions> {
  const companyId = session.companyId ?? NO_COMPANY_SENTINEL; // нет компании → пустые списки (fail-safe)
  const [users, organizations, orders, organizationsTotal, ordersTotal] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, role: { in: ['manager', 'leader'] }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
    // `Р-27`: по последней активности, а не по алфавиту — в 200 попадают
    // организации, с которыми сейчас работают, а не 200 на «А…».
    prisma.organization.findMany({
      where: { companyId },
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: FORM_ORGANIZATIONS_CAP,
    }),
    prisma.order.findMany({
      where: { companyId },
      select: { id: true, title: true },
      orderBy: { createdAt: 'desc' },
      take: FORM_ORDERS_CAP,
    }),
    prisma.organization.count({ where: { companyId } }),
    prisma.order.count({ where: { companyId } }),
  ]);
  return { users, organizations, orders, organizationsTotal, ordersTotal };
}

export type MoveTaskError = 'not_found' | 'forbidden' | 'invalid_column' | 'checklist_incomplete';

/**
 * Перемещение карточки. Единственный сайд-эффект — done-колонка ставит
 * `completedAt`.
 *
 * Этап 4 (`У-219`, `Р-Э4-9`): перевод в готовую колонку при незакрытом
 * чек-листе возвращает `checklist_incomplete`. Это **не запрет**, а вопрос:
 * интерфейс показывает «в чек-листе остались пункты — завершить всё равно?», и
 * повторный вызов приходит с `force: true`. Жёсткий замок здесь был бы
 * вредительством — пункт «позвонить» иногда становится неактуальным.
 */
export async function moveTask(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { taskId: string; toColumnId: string; force?: boolean }
): Promise<{ ok: true } | { ok: false; error: MoveTaskError }> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const columns = await resolveTaskColumns(prisma, session.companyId);
  const target = columns.find((c) => c.id === args.toColumnId);
  if (!target) return { ok: false, error: 'invalid_column' };

  const task = await prisma.task.findUnique({
    where: { id: args.taskId },
    select: {
      id: true,
      companyId: true,
      status: true,
      columnId: true,
      completedAt: true,
      createdById: true,
      linkedOrganizationId: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!task) return { ok: false, error: 'not_found' };
  const scopeTask = {
    companyId: task.companyId,
    createdById: task.createdById,
    assigneeUserIds: task.assignees.map((a) => a.userId),
    linkedOrganizationId: task.linkedOrganizationId,
  };
  if (!canSeeTask(session, scopeTask)) return { ok: false, error: 'not_found' }; // scope: не leak-аем

  // `У-219`: спрашиваем ТОЛЬКО при переводе в готовую колонку и только если
  // задача ещё не была завершена — повторное перетаскивание внутри «Готово» не
  // должно каждый раз переспрашивать.
  if (target.isDoneColumn && !task.completedAt && !args.force) {
    if (await hasOpenChecklistItems(prisma, task.id)) {
      return { ok: false, error: 'checklist_incomplete' };
    }
  }

  // Синтетический дефолт-id (`default:*`) не FK — columnId остаётся null (колонка
  // выводится из status-якоря); кастомная колонка → реальный cuid.
  const persistColumnId = args.toColumnId.startsWith('default:') ? null : args.toColumnId;
  // done-колонка проставляет completedAt (сохраняем прежний, если уже была done); иначе — сброс.
  const completedAt = target.isDoneColumn ? (task.completedAt ?? new Date()) : null;

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: task.id },
      data: { columnId: persistColumnId, status: target.statusAnchor, completedAt },
    });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'task_moved',
      entity: 'task',
      entityId: task.id,
      before: { status: task.status, columnId: task.columnId },
      after: { status: target.statusAnchor, columnId: persistColumnId },
    });
  });
  return { ok: true };
}
