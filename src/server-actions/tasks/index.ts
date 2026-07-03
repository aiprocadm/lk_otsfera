'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { moveTask, type MoveTaskError } from '@/lib/services/tasks/board';
import {
  createTask,
  updateTask,
  deleteTask,
  assignTask,
  type TaskInput,
  type TaskErrorCode
} from '@/lib/services/tasks/tasks';
import {
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn,
  type TaskColumnInput,
  type TaskColumnErrorCode
} from '@/lib/services/tasks/columns';
import type { TaskStatus } from '@prisma/client';

/**
 * Трек G3 — server-actions задач. Move/CRUD задач доступны любому сотруднику
 * (сервис энфорсит company-scope через staffGate + canSeeTask); колонки-CRUD —
 * сервис гейтит admin|leader. Достаточно requireSession().
 */

type ActionResult<E extends string> = { ok: true } | { ok: false; error: E };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function revalidate(): void {
  revalidatePath('/manager/tasks');
  revalidatePath('/leader/tasks');
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
    assigneeIds: fd.getAll('assigneeIds').filter((v): v is string => typeof v === 'string')
  };
}

export async function moveTaskAction(fd: FormData): Promise<ActionResult<MoveTaskError>> {
  const session = await requireSession();
  const taskId = str(fd, 'taskId');
  const toColumnId = str(fd, 'toColumnId');
  if (!taskId || !toColumnId) return { ok: false, error: 'not_found' };
  const res = await moveTask(prisma, session, { taskId, toColumnId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

export async function createTaskAction(fd: FormData): Promise<ActionResult<TaskErrorCode> & { id?: string }> {
  const session = await requireSession();
  const res = await createTask(prisma, session, taskInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true, id: res.id };
}

export async function updateTaskAction(fd: FormData): Promise<ActionResult<TaskErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await updateTask(prisma, session, id, taskInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
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

export async function assignTaskAction(fd: FormData): Promise<ActionResult<TaskErrorCode>> {
  const session = await requireSession();
  const taskId = str(fd, 'taskId');
  if (!taskId) return { ok: false, error: 'not_found' };
  const assigneeIds = fd.getAll('assigneeIds').filter((v): v is string => typeof v === 'string');
  const res = await assignTask(prisma, session, { taskId, assigneeIds });
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

function columnInput(fd: FormData): TaskColumnInput {
  return {
    name: str(fd, 'name'),
    position: Number(str(fd, 'position') || 0),
    statusAnchor: (str(fd, 'statusAnchor') || 'todo') as TaskStatus,
    color: str(fd, 'color') || null,
    isDoneColumn: fd.get('isDoneColumn') === 'on' || str(fd, 'isDoneColumn') === 'true'
  };
}

export async function createTaskColumnAction(fd: FormData): Promise<ActionResult<TaskColumnErrorCode> & { id?: string }> {
  const session = await requireSession();
  const res = await createTaskColumn(prisma, session, columnInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true, id: res.id };
}

export async function updateTaskColumnAction(fd: FormData): Promise<ActionResult<TaskColumnErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await updateTaskColumn(prisma, session, id, columnInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

export async function deleteTaskColumnAction(fd: FormData): Promise<ActionResult<TaskColumnErrorCode>> {
  const session = await requireSession();
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await deleteTaskColumn(prisma, session, id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}
