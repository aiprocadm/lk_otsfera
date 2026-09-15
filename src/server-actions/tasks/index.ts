'use server';

import { revalidatePath } from 'next/cache';
import type { TaskStatus } from '@prisma/client';
import { type ActionResult, str } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import {
  moveTask,
  listLinkedTasks,
  type MoveTaskError,
  type TaskCard,
} from '@/lib/services/tasks/board';
import {
  createTask,
  updateTask,
  deleteTask,
  assignTask,
  type TaskInput,
  type TaskErrorCode,
} from '@/lib/services/tasks/tasks';
import type { TaskLinkRef } from '@/lib/tasks/links';
import { addTaskComment, type TaskCommentErrorCode } from '@/lib/services/tasks/comments';
import {
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  type ChecklistErrorCode,
} from '@/lib/services/tasks/checklist';
import {
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn,
  type TaskColumnInput,
  type TaskColumnErrorCode,
} from '@/lib/services/tasks/columns';

/**
 * Трек G3 — server-actions задач. Move/CRUD задач доступны любому сотруднику
 * (сервис энфорсит company-scope через staffGate + canSeeTask); колонки-CRUD —
 * сервис гейтит admin|leader. Достаточно requireSession().
 */

function revalidate(): void {
  revalidatePath('/manager/tasks');
  revalidatePath('/leader/tasks');
}

/**
 * Этап 4 (`У-218`): у задачи появилась своя страница, и после любого изменения
 * её надо обновлять отдельно — доска и карточка это разные адреса.
 */
function revalidateTask(taskId: string): void {
  revalidate();
  revalidatePath(`/manager/tasks/${taskId}`);
  revalidatePath(`/leader/tasks/${taskId}`);
}

function taskInput(fd: FormData): TaskInput {
  const due = str(fd, 'dueDate');
  return {
    title: str(fd, 'title'),
    description: str(fd, 'description') || null,
    priority: (str(fd, 'priority') || null) as TaskInput['priority'],
    // Пустая строка → null; иначе → Date (сервис через z.coerce.date отбраковывает невалидную дату).
    dueDate: due ? new Date(due) : null,
    columnId: str(fd, 'columnId') || null,
    linkedOrderId: str(fd, 'linkedOrderId') || null,
    linkedOrganizationId: str(fd, 'linkedOrganizationId') || null,
    linkedLeadId: str(fd, 'linkedLeadId') || null,
    linkedDealId: str(fd, 'linkedDealId') || null,
    // `У-220`: задача из карточки контакта, переписки и документа.
    linkedContactId: str(fd, 'linkedContactId') || null,
    linkedDialogId: str(fd, 'linkedDialogId') || null,
    linkedDocumentId: str(fd, 'linkedDocumentId') || null,
    assigneeIds: fd.getAll('assigneeIds').filter((v): v is string => typeof v === 'string'),
  };
}

export async function moveTaskAction(fd: FormData): Promise<ActionResult<MoveTaskError>> {
  const session = await requireSession();
  const taskId = str(fd, 'taskId');
  const toColumnId = str(fd, 'toColumnId');
  if (!taskId || !toColumnId) return { ok: false, error: 'not_found' };
  // `У-219`: «завершить всё равно» приходит вторым нажатием — то же действие с
  // флагом. Отдельного экшена «принудительно» не заводим: это один и тот же
  // перенос, просто с ответом на вопрос.
  const force = fd.get('force') === 'on' || str(fd, 'force') === 'true';
  const res = await moveTask(prisma, session, { taskId, toColumnId, force });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateTask(taskId);
  return { ok: true };
}

export async function createTaskAction(
  fd: FormData
): Promise<ActionResult<TaskErrorCode> & { id?: string }> {
  const session = await requireSession();
  const input = taskInput(fd);
  const res = await createTask(prisma, session, input);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  revalidateLinkSources(input);
  return { ok: true, id: res.id };
}

/**
 * `У-220`: задачу теперь заводят ИЗ карточки — контакта, переписки, документа,
 * организации, заказа. Блок «Задачи» на этой карточке рисует сервер, поэтому
 * без сброса кэша человек нажимает «Создать» и не видит своей же задачи, пока
 * не обновит страницу руками.
 */
function revalidateLinkSources(input: TaskInput): void {
  const paths: string[] = [];
  for (const cabinet of ['manager', 'leader'] as const) {
    if (input.linkedContactId) paths.push(`/${cabinet}/contacts/${input.linkedContactId}`);
    if (input.linkedDialogId) paths.push(`/${cabinet}/messengers/${input.linkedDialogId}`);
    if (input.linkedDocumentId) paths.push(`/${cabinet}/documents/${input.linkedDocumentId}`);
    if (input.linkedOrganizationId)
      paths.push(`/${cabinet}/organizations/${input.linkedOrganizationId}`);
    if (input.linkedLeadId) paths.push(`/${cabinet}/leads/${input.linkedLeadId}`);
  }
  for (const path of paths) revalidatePath(path);
}

export async function updateTaskAction(fd: FormData): Promise<ActionResult<TaskErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await updateTask(prisma, session, id, taskInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidateTask(id);
  return { ok: true };
}

export async function deleteTaskAction(fd: FormData): Promise<ActionResult<TaskErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await deleteTask(prisma, session, id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

/**
 * Этап 7 (ФТ-7.1), расширено этапом 4 (`У-220`) — задачи объекта для блока
 * «Задачи» на его карточке
 * (ленивая подгрузка в deal-dialog по образцу заметок). Сервис скоупит по
 * tasks-охвату профиля; клиентским ролям вернёт пусто.
 */
export async function listLinkedTasksAction(
  link: TaskLinkRef
): Promise<{ ok: true; rows: TaskCard[] } | { ok: false; error: 'forbidden' }> {
  const session = await requireSession();
  const rows = await listLinkedTasks(prisma, session, link);
  return { ok: true, rows };
}

export async function assignTaskAction(fd: FormData): Promise<ActionResult<TaskErrorCode>> {
  const session = await requireSession();
  const taskId = str(fd, 'taskId');
  if (!taskId) return { ok: false, error: 'not_found' };
  const assigneeIds = fd.getAll('assigneeIds').filter((v): v is string => typeof v === 'string');
  const res = await assignTask(prisma, session, { taskId, assigneeIds });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateTask(taskId);
  return { ok: true };
}

/** `У-218`: комментарий в задаче. */
export async function addTaskCommentAction(
  fd: FormData
): Promise<ActionResult<TaskCommentErrorCode>> {
  const session = await requireSession();
  const taskId = str(fd, 'taskId');
  if (!taskId) return { ok: false, error: 'not_found' };
  const res = await addTaskComment(prisma, session, { taskId, body: str(fd, 'body') });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateTask(taskId);
  return { ok: true };
}

/** `У-219`: пункты чек-листа. */
export async function addChecklistItemAction(
  fd: FormData
): Promise<ActionResult<ChecklistErrorCode>> {
  const session = await requireSession();
  const taskId = str(fd, 'taskId');
  if (!taskId) return { ok: false, error: 'not_found' };
  const res = await addChecklistItem(prisma, session, { taskId, title: str(fd, 'title') });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateTask(taskId);
  return { ok: true };
}

export async function toggleChecklistItemAction(
  fd: FormData
): Promise<ActionResult<ChecklistErrorCode>> {
  const session = await requireSession();
  const itemId = str(fd, 'itemId');
  const taskId = str(fd, 'taskId');
  if (!itemId || !taskId) return { ok: false, error: 'not_found' };
  const isDone = fd.get('isDone') === 'on' || str(fd, 'isDone') === 'true';
  const res = await toggleChecklistItem(prisma, session, { itemId, isDone });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateTask(taskId);
  return { ok: true };
}

export async function deleteChecklistItemAction(
  fd: FormData
): Promise<ActionResult<ChecklistErrorCode>> {
  const session = await requireSession();
  const itemId = str(fd, 'itemId');
  const taskId = str(fd, 'taskId');
  if (!itemId || !taskId) return { ok: false, error: 'not_found' };
  const res = await deleteChecklistItem(prisma, session, itemId);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateTask(taskId);
  return { ok: true };
}

function columnInput(fd: FormData): TaskColumnInput {
  return {
    name: str(fd, 'name'),
    position: Number(str(fd, 'position') || 0),
    statusAnchor: (str(fd, 'statusAnchor') || 'todo') as TaskStatus,
    color: str(fd, 'color') || null,
    isDoneColumn: fd.get('isDoneColumn') === 'on' || str(fd, 'isDoneColumn') === 'true',
  };
}

export async function createTaskColumnAction(
  fd: FormData
): Promise<ActionResult<TaskColumnErrorCode> & { id?: string }> {
  const session = await requireSession();
  const res = await createTaskColumn(prisma, session, columnInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true, id: res.id };
}

export async function updateTaskColumnAction(
  fd: FormData
): Promise<ActionResult<TaskColumnErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await updateTaskColumn(prisma, session, id, columnInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

export async function deleteTaskColumnAction(
  fd: FormData
): Promise<ActionResult<TaskColumnErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await deleteTaskColumn(prisma, session, id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}
