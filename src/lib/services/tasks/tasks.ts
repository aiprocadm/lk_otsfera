import { type PrismaClient, type Prisma, type TaskPriority, type TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { resolveTaskColumns } from '@/lib/tasks/columns';
import { canSeeTask } from '@/lib/auth/accessProfile';
import { notifyTaskAssigned } from './notify';

/**
 * Трек G3 — CRUD внутренних задач (Result-контракт §3). Company-scoped: создатель
 * и целевая задача обязаны быть в `session.companyId`; чужая → not_found (IDOR не
 * leak-аем). Создавать/редактировать может любой сотрудник (admin|manager) своей
 * компании; видимость на edit/delete/assign ограничена `canSeeTask` (scope §4).
 * Привязки к заявке/организации и исполнители валидируются на принадлежность
 * компании. Смена колонки — отдельным `moveTask` (board.ts).
 */

export type TaskErrorCode = 'forbidden' | 'not_found' | 'validation' | 'invalid_column';

const inputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  priority: z.enum(['low', 'medium', 'high']).nullish(),
  dueDate: z.coerce.date().nullish(),
  columnId: z.string().trim().min(1).nullish(),
  linkedOrderId: z.string().trim().min(1).nullish(),
  linkedOrganizationId: z.string().trim().min(1).nullish(),
  // Этап 7 (ФТ-7.1): привязки к лиду и сделке.
  linkedLeadId: z.string().trim().min(1).nullish(),
  linkedDealId: z.string().trim().min(1).nullish(),
  // Этап 4 ТЗ 12.09.2026 (`У-220`): задача из карточки контакта, переписки и документа.
  linkedContactId: z.string().trim().min(1).nullish(),
  linkedDialogId: z.string().trim().min(1).nullish(),
  linkedDocumentId: z.string().trim().min(1).nullish(),
  assigneeIds: z.array(z.string()).optional(),
});
export type TaskInput = z.input<typeof inputSchema>;

class TaskError extends Error {
  readonly code: TaskErrorCode;
  constructor(code: TaskErrorCode) {
    super(code);
    this.code = code;
    this.name = 'TaskError';
  }
}

function staffGate(session: SessionPayload): { companyId: string } | { error: 'forbidden' } {
  const isStaff = session.role === 'admin' || isStaffManagerSide(session);
  if (!isStaff || !session.companyId) return { error: 'forbidden' };
  return { companyId: session.companyId };
}

/** Проверяет, что привязки и исполнители принадлежат компании задачи. */
async function validateRefs(
  tx: Prisma.TransactionClient,
  companyId: string,
  data: z.infer<typeof inputSchema>
): Promise<void> {
  if (data.linkedOrderId) {
    const o = await tx.order.findUnique({
      where: { id: data.linkedOrderId },
      select: { companyId: true },
    });
    if (!o || o.companyId !== companyId) throw new TaskError('validation');
  }
  if (data.linkedOrganizationId) {
    const org = await tx.organization.findUnique({
      where: { id: data.linkedOrganizationId },
      select: { companyId: true },
    });
    if (!org || org.companyId !== companyId) throw new TaskError('validation');
  }
  // Лид single-tenant (без companyId — зеркало leadWhereForLevel): проверяем существование.
  if (data.linkedLeadId) {
    const lead = await tx.lead.findUnique({
      where: { id: data.linkedLeadId },
      select: { id: true },
    });
    if (!lead) throw new TaskError('validation');
  }
  if (data.linkedDealId) {
    const deal = await tx.deal.findUnique({
      where: { id: data.linkedDealId },
      select: { companyId: true },
    });
    if (!deal || deal.companyId !== companyId) throw new TaskError('validation');
  }
  // `У-220`: три новые привязки. Каждая проверяется ОТДЕЛЬНО и на ту же
  // компанию — пропустить хоть одну значит открыть дверь: id приходит из формы,
  // и задача чужой компании привязалась бы к нашему контакту.
  if (data.linkedContactId) {
    const contact = await tx.contact.findUnique({
      where: { id: data.linkedContactId },
      select: { companyId: true },
    });
    if (!contact || contact.companyId !== companyId) throw new TaskError('validation');
  }
  if (data.linkedDialogId) {
    const dialog = await tx.messengerDialog.findUnique({
      where: { id: data.linkedDialogId },
      select: { companyId: true },
    });
    // Ничейный диалог (`companyId = null`) — общая очередь: его разбирают все,
    // и запретить заводить по нему задачу значило бы запретить взять его в
    // работу. Чужая компания при этом по-прежнему недоступна.
    if (!dialog || (dialog.companyId !== null && dialog.companyId !== companyId)) {
      throw new TaskError('validation');
    }
  }
  if (data.linkedDocumentId) {
    const doc = await tx.document.findUnique({
      where: { id: data.linkedDocumentId },
      select: { companyId: true },
    });
    if (!doc || doc.companyId !== companyId) throw new TaskError('validation');
  }
  if (data.assigneeIds && data.assigneeIds.length > 0) {
    const ids = [...new Set(data.assigneeIds)];
    const count = await tx.user.count({ where: { id: { in: ids }, companyId } });
    if (count !== ids.length) throw new TaskError('validation');
  }
}

/** Синхронизирует множество исполнителей задачи (set-разница). Возвращает добавленных (ФТ-7.2). */
async function syncAssignees(
  tx: Prisma.TransactionClient,
  taskId: string,
  assigneeIds: string[]
): Promise<{ added: string[] }> {
  const desired = new Set(assigneeIds);
  const existing = await tx.taskAssignee.findMany({ where: { taskId }, select: { userId: true } });
  const existingIds = new Set(existing.map((e) => e.userId));
  const toRemove = [...existingIds].filter((id) => !desired.has(id));
  const toAdd = [...desired].filter((id) => !existingIds.has(id));
  if (toRemove.length > 0)
    await tx.taskAssignee.deleteMany({ where: { taskId, userId: { in: toRemove } } });
  if (toAdd.length > 0)
    await tx.taskAssignee.createMany({ data: toAdd.map((userId) => ({ taskId, userId })) });
  return { added: toAdd };
}

const SCOPE_SELECT = {
  companyId: true,
  createdById: true,
  linkedOrganizationId: true,
  assignees: { select: { userId: true } },
} as const;

type ScopeRow = {
  companyId: string;
  createdById: string;
  linkedOrganizationId: string | null;
  assignees: { userId: string }[];
};

function scopeArg(row: ScopeRow) {
  return {
    companyId: row.companyId,
    createdById: row.createdById,
    assigneeUserIds: row.assignees.map((a) => a.userId),
    linkedOrganizationId: row.linkedOrganizationId,
  };
}

/**
 * Ядро создания задачи: только запись, БЕЗ проверки прав.
 *
 * Появилось в этапе 4 (`Р-Э4-4`) ради правил автоматизации: процессор создаёт
 * задачу не «от имени» пользователя, и подсунуть ему фальшивую сессию, чтобы
 * пройти `staffGate`, — самый быстрый способ обойти проверку прав в месте, где
 * её никто не ищет. Поэтому гард остаётся в `createTask` (единственная точка
 * входа для человека), а сюда приходят уже готовые данные: компания задачи и
 * автор — явные аргументы, а не вывод из сессии.
 *
 * Внутри транзакции вызывающего: собственной транзакции не открывает.
 *
 * Пока не экспортируется: единственный вызывающий — `createTask` в этом же
 * файле. Экспорт появится вместе с процессором правил (PR-3), которому ядро и
 * нужно; экспортировать «на всякий случай» нельзя (§12b).
 */
async function createTaskCore(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    createdById: string;
    title: string;
    description?: string | null;
    priority?: TaskPriority | null;
    dueDate?: Date | null;
    status: TaskStatus;
    /** Уже разрешённая колонка: `null` — синтетический дефолт (колонка выводится из статуса). */
    columnId: string | null;
    completedAt: Date | null;
    linkedOrderId?: string | null;
    linkedOrganizationId?: string | null;
    linkedLeadId?: string | null;
    linkedDealId?: string | null;
    linkedContactId?: string | null;
    linkedDialogId?: string | null;
    linkedDocumentId?: string | null;
    assigneeIds?: string[] | undefined;
    /** `У-223`: какое правило автоматизации породило задачу. */
    createdByRuleId?: string | null;
  }
): Promise<{ id: string; title: string; dueDate: Date | null }> {
  const task = await tx.task.create({
    data: {
      companyId: input.companyId,
      createdById: input.createdById,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? null,
      dueDate: input.dueDate ?? null,
      status: input.status,
      columnId: input.columnId,
      completedAt: input.completedAt,
      linkedOrderId: input.linkedOrderId ?? null,
      linkedOrganizationId: input.linkedOrganizationId ?? null,
      linkedLeadId: input.linkedLeadId ?? null,
      linkedDealId: input.linkedDealId ?? null,
      linkedContactId: input.linkedContactId ?? null,
      linkedDialogId: input.linkedDialogId ?? null,
      linkedDocumentId: input.linkedDocumentId ?? null,
      createdByRuleId: input.createdByRuleId ?? null,
    },
    select: { id: true, title: true, dueDate: true },
  });
  const assignees = [...new Set(input.assigneeIds ?? [])];
  if (assignees.length > 0) {
    await tx.taskAssignee.createMany({
      data: assignees.map((userId) => ({ taskId: task.id, userId })),
    });
  }
  return task;
}

export async function createTask(
  prisma: PrismaClient,
  session: SessionPayload,
  input: TaskInput
): Promise<{ ok: true; id: string } | { ok: false; error: TaskErrorCode }> {
  const g = staffGate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const data = parsed.data;

  const columns = await resolveTaskColumns(prisma, g.companyId);
  const targetId = data.columnId ?? columns[0]?.id;
  const target = columns.find((c) => c.id === targetId);
  if (!target) return { ok: false, error: 'invalid_column' };
  const persistColumnId = target.id.startsWith('default:') ? null : target.id;

  try {
    const created = await prisma.$transaction(async (tx) => {
      await validateRefs(tx, g.companyId, data);
      const task = await createTaskCore(tx, {
        companyId: g.companyId,
        createdById: session.sub,
        title: data.title.trim(),
        description: data.description ?? null,
        priority: data.priority ?? null,
        dueDate: data.dueDate ?? null,
        status: target.statusAnchor,
        columnId: persistColumnId,
        completedAt: target.isDoneColumn ? new Date() : null,
        linkedOrderId: data.linkedOrderId ?? null,
        linkedOrganizationId: data.linkedOrganizationId ?? null,
        linkedLeadId: data.linkedLeadId ?? null,
        linkedDealId: data.linkedDealId ?? null,
        linkedContactId: data.linkedContactId ?? null,
        linkedDialogId: data.linkedDialogId ?? null,
        linkedDocumentId: data.linkedDocumentId ?? null,
        assigneeIds: data.assigneeIds,
      });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'task_created',
        entity: 'task',
        entityId: task.id,
        after: { title: task.title, status: target.statusAnchor, columnId: persistColumnId },
      });
      return task;
    });
    // ФТ-7.2: уведомление новым исполнителям — после коммита, graceful внутри notify.
    await notifyTaskAssigned({
      taskId: created.id,
      taskTitle: created.title,
      dueDate: created.dueDate,
      actorUserId: session.sub,
      assigneeUserIds: data.assigneeIds ?? [],
    });
    return { ok: true, id: created.id };
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function updateTask(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  input: TaskInput
): Promise<{ ok: true } | { ok: false; error: TaskErrorCode }> {
  const g = staffGate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const data = parsed.data;

  try {
    const notifyAdded = await prisma.$transaction(async (tx) => {
      const before = await tx.task.findUnique({
        where: { id },
        select: { ...SCOPE_SELECT, title: true, dueDate: true },
      });
      if (!before) throw new TaskError('not_found');
      if (!canSeeTask(session, scopeArg(before))) throw new TaskError('not_found');
      await validateRefs(tx, before.companyId, data);
      const nextDue = data.dueDate ?? null;
      const dueChanged = (before.dueDate?.getTime() ?? null) !== (nextDue?.getTime() ?? null);
      await tx.task.update({
        where: { id },
        data: {
          title: data.title.trim(),
          description: data.description ?? null,
          priority: data.priority ?? null,
          dueDate: nextDue,
          linkedOrderId: data.linkedOrderId ?? null,
          linkedOrganizationId: data.linkedOrganizationId ?? null,
          linkedLeadId: data.linkedLeadId ?? null,
          linkedDealId: data.linkedDealId ?? null,
          linkedContactId: data.linkedContactId ?? null,
          linkedDialogId: data.linkedDialogId ?? null,
          linkedDocumentId: data.linkedDocumentId ?? null,
          // ФТ-7.2: перенос срока → джоб «скоро срок» уведомит заново.
          ...(dueChanged ? { dueSoonNotifiedAt: null } : {}),
        },
      });
      const added =
        data.assigneeIds !== undefined ? (await syncAssignees(tx, id, data.assigneeIds)).added : [];
      await recordAudit(tx, {
        userId: session.sub,
        action: 'task_updated',
        entity: 'task',
        entityId: id,
        before: { title: before.title },
        after: { title: data.title.trim() },
      });
      return added;
    });
    await notifyTaskAssigned({
      taskId: id,
      taskTitle: data.title.trim(),
      dueDate: data.dueDate ?? null,
      actorUserId: session.sub,
      assigneeUserIds: notifyAdded,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function deleteTask(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true } | { ok: false; error: TaskErrorCode }> {
  const g = staffGate(session);
  if ('error' in g) return { ok: false, error: g.error };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.task.findUnique({
        where: { id },
        select: { ...SCOPE_SELECT, title: true },
      });
      if (!before) throw new TaskError('not_found');
      if (!canSeeTask(session, scopeArg(before))) throw new TaskError('not_found');
      // TaskAssignee — ON DELETE CASCADE.
      await tx.task.delete({ where: { id } });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'task_deleted',
        entity: 'task',
        entityId: id,
        before: { title: before.title },
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function assignTask(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { taskId: string; assigneeIds: string[] }
): Promise<{ ok: true } | { ok: false; error: TaskErrorCode }> {
  const g = staffGate(session);
  if ('error' in g) return { ok: false, error: g.error };

  try {
    const notifyArgs = await prisma.$transaction(async (tx) => {
      const before = await tx.task.findUnique({
        where: { id: args.taskId },
        select: { ...SCOPE_SELECT, title: true, dueDate: true },
      });
      if (!before) throw new TaskError('not_found');
      if (!canSeeTask(session, scopeArg(before))) throw new TaskError('not_found');
      if (args.assigneeIds.length > 0) {
        const ids = [...new Set(args.assigneeIds)];
        const count = await tx.user.count({
          where: { id: { in: ids }, companyId: before.companyId },
        });
        if (count !== ids.length) throw new TaskError('validation');
      }
      const { added } = await syncAssignees(tx, args.taskId, args.assigneeIds);
      await recordAudit(tx, {
        userId: session.sub,
        action: 'task_assigned',
        entity: 'task',
        entityId: args.taskId,
        before: { assigneeUserIds: before.assignees.map((a) => a.userId) },
        after: { assigneeUserIds: [...new Set(args.assigneeIds)] },
      });
      return { added, title: before.title, dueDate: before.dueDate };
    });
    await notifyTaskAssigned({
      taskId: args.taskId,
      taskTitle: notifyArgs.title,
      dueDate: notifyArgs.dueDate,
      actorUserId: session.sub,
      assigneeUserIds: notifyArgs.added,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.code };
    throw e;
  }
}
