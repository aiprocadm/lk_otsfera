import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeTask } from '@/lib/auth/accessProfile';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Чек-лист задачи (`У-219`, спека этапа 4 §3.9).
 *
 * Зачем: задача «подготовить документы по заказу» — это пять шагов, и пока их
 * негде записать, они живут в голове исполнителя. Чек-лист даёт шаги и прогресс
 * «3 из 5» прямо на карточке доски.
 *
 * Чек-лист **не запрещает** завершить задачу — он переспрашивает. Жёсткий замок
 * здесь был бы вредительством: пункт «позвонить» иногда становится
 * неактуальным, и человек не должен ради этого выдумывать «выполнил». Сервер
 * отдаёт код `checklist_incomplete`, интерфейс показывает подтверждение,
 * повторный вызов приходит с `force: true`.
 */

export type ChecklistErrorCode = 'forbidden' | 'not_found' | 'validation';

const CHECKLIST_ITEM_MAX = 200;
/** Предел пунктов на задачу: чек-лист — это шаги, а не импортированный реестр. */
export const CHECKLIST_MAX_ITEMS = 50;

export type ChecklistItemView = {
  id: string;
  title: string;
  isDone: boolean;
  sortOrder: number;
  doneAt: Date | null;
};

const SCOPE_SELECT = {
  companyId: true,
  createdById: true,
  linkedOrganizationId: true,
  assignees: { select: { userId: true } },
} as const;

/**
 * Задача, которую сессии разрешено трогать. Чужая → `not_found`, а не
 * `forbidden`: существование чужой задачи наружу не подтверждаем (идиома
 * `tasks.ts`).
 */
async function requireVisibleTask(
  tx: Prisma.TransactionClient | PrismaClient,
  session: SessionPayload,
  taskId: string
): Promise<{ ok: true; companyId: string } | { ok: false; error: ChecklistErrorCode }> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const task = await tx.task.findUnique({ where: { id: taskId }, select: SCOPE_SELECT });
  if (!task) return { ok: false, error: 'not_found' };
  const visible = canSeeTask(session, {
    companyId: task.companyId,
    createdById: task.createdById,
    assigneeUserIds: task.assignees.map((a) => a.userId),
    linkedOrganizationId: task.linkedOrganizationId,
  });
  if (!visible) return { ok: false, error: 'not_found' };
  return { ok: true, companyId: task.companyId };
}

export async function listChecklist(
  prisma: PrismaClient,
  taskId: string
): Promise<ChecklistItemView[]> {
  return prisma.taskChecklistItem.findMany({
    where: { taskId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, isDone: true, sortOrder: true, doneAt: true },
  });
}

/**
 * Есть ли в задаче незакрытые пункты. Отдельная функция, потому что её зовёт и
 * `moveTask` (перевод в «Готово»), и карточка задачи — а считать это в двух
 * местах по-разному значит однажды разойтись.
 */
export async function hasOpenChecklistItems(
  tx: Prisma.TransactionClient | PrismaClient,
  taskId: string
): Promise<boolean> {
  const open = await tx.taskChecklistItem.count({ where: { taskId, isDone: false } });
  return open > 0;
}

export async function addChecklistItem(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { taskId: string; title: string }
): Promise<{ ok: true; id: string } | { ok: false; error: ChecklistErrorCode }> {
  const title = args.title.trim();
  if (!title || title.length > CHECKLIST_ITEM_MAX) return { ok: false, error: 'validation' };

  const gate = await requireVisibleTask(prisma, session, args.taskId);
  if (!gate.ok) return gate;

  const count = await prisma.taskChecklistItem.count({ where: { taskId: args.taskId } });
  if (count >= CHECKLIST_MAX_ITEMS) return { ok: false, error: 'validation' };

  const last = await prisma.taskChecklistItem.findFirst({
    where: { taskId: args.taskId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  const item = await prisma.taskChecklistItem.create({
    data: {
      taskId: args.taskId,
      title,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });
  return { ok: true, id: item.id };
}

export async function toggleChecklistItem(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { itemId: string; isDone: boolean }
): Promise<{ ok: true } | { ok: false; error: ChecklistErrorCode }> {
  const item = await prisma.taskChecklistItem.findUnique({
    where: { id: args.itemId },
    select: { id: true, taskId: true },
  });
  if (!item) return { ok: false, error: 'not_found' };

  const gate = await requireVisibleTask(prisma, session, item.taskId);
  if (!gate.ok) return gate;

  await prisma.taskChecklistItem.update({
    where: { id: item.id },
    data: {
      isDone: args.isDone,
      // Снятая галочка обнуляет и автора, и время: иначе пункт показывал бы
      // «выполнил Иванов» рядом с пустым квадратиком.
      doneById: args.isDone ? session.sub : null,
      doneAt: args.isDone ? new Date() : null,
    },
  });
  return { ok: true };
}

export async function deleteChecklistItem(
  prisma: PrismaClient,
  session: SessionPayload,
  itemId: string
): Promise<{ ok: true } | { ok: false; error: ChecklistErrorCode }> {
  const item = await prisma.taskChecklistItem.findUnique({
    where: { id: itemId },
    select: { id: true, taskId: true, title: true },
  });
  if (!item) return { ok: false, error: 'not_found' };

  const gate = await requireVisibleTask(prisma, session, item.taskId);
  if (!gate.ok) return gate;

  await prisma.$transaction(async (tx) => {
    await tx.taskChecklistItem.delete({ where: { id: item.id } });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'task_checklist_item_deleted',
      entity: 'task',
      entityId: item.taskId,
      before: { title: item.title },
    });
  });
  return { ok: true };
}
