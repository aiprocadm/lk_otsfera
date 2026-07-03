import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  revalidatePath,
  moveTask,
  createTask,
  updateTask,
  deleteTask,
  assignTask,
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  moveTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  assignTask: vi.fn(),
  createTaskColumn: vi.fn(),
  updateTaskColumn: vi.fn(),
  deleteTaskColumn: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/tasks/board', () => ({ moveTask }));
vi.mock('@/lib/services/tasks/tasks', () => ({ createTask, updateTask, deleteTask, assignTask }));
vi.mock('@/lib/services/tasks/columns', () => ({ createTaskColumn, updateTaskColumn, deleteTaskColumn }));

import {
  moveTaskAction,
  createTaskAction,
  updateTaskAction,
  deleteTaskAction,
  assignTaskAction,
  createTaskColumnAction,
  updateTaskColumnAction,
  deleteTaskColumnAction
} from '@/server-actions/tasks';

const SESSION = { sub: 'u1', role: 'manager', managerRole: 'leader', companyId: 'co-A' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  revalidatePath.mockReturnValue(undefined);
});

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe('moveTaskAction', () => {
  it('calls service, revalidates both cabinets on success', async () => {
    moveTask.mockResolvedValue({ ok: true });
    const res = await moveTaskAction(form({ taskId: 't1', toColumnId: 'default:in_progress' }));
    expect(res).toEqual({ ok: true });
    expect(moveTask).toHaveBeenCalledWith({}, SESSION, { taskId: 't1', toColumnId: 'default:in_progress' });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/tasks');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/tasks');
  });
  it('missing ids → not_found, no service call', async () => {
    expect(await moveTaskAction(form({ taskId: 't1' }))).toEqual({ ok: false, error: 'not_found' });
    expect(moveTask).not.toHaveBeenCalled();
  });
  it('maps service error, no revalidate', async () => {
    moveTask.mockResolvedValue({ ok: false, error: 'invalid_column' });
    expect(await moveTaskAction(form({ taskId: 't1', toColumnId: 'x' }))).toEqual({ ok: false, error: 'invalid_column' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('task CRUD actions', () => {
  it('create builds input (assignees via getAll), returns id', async () => {
    createTask.mockResolvedValue({ ok: true, id: 't9' });
    const fd = form({ title: 'Позвонить', priority: 'high', columnId: 'default:todo' });
    fd.append('assigneeIds', 'u2');
    fd.append('assigneeIds', 'u3');
    const res = await createTaskAction(fd);
    expect(res).toEqual({ ok: true, id: 't9' });
    expect(createTask).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ title: 'Позвонить', priority: 'high', columnId: 'default:todo', assigneeIds: ['u2', 'u3'] })
    );
  });
  it('create maps validation error', async () => {
    createTask.mockResolvedValue({ ok: false, error: 'validation' });
    expect(await createTaskAction(form({ title: '' }))).toEqual({ ok: false, error: 'validation' });
  });
  it('update requires id', async () => {
    expect(await updateTaskAction(form({ title: 'x' }))).toEqual({ ok: false, error: 'validation' });
    expect(updateTask).not.toHaveBeenCalled();
  });
  it('update with id calls service', async () => {
    updateTask.mockResolvedValue({ ok: true });
    expect(await updateTaskAction(form({ id: 't5', title: 'x' }))).toEqual({ ok: true });
    expect(updateTask).toHaveBeenCalledWith({}, SESSION, 't5', expect.objectContaining({ title: 'x' }));
  });
  it('delete requires id; with id calls service', async () => {
    expect(await deleteTaskAction(new FormData())).toEqual({ ok: false, error: 'validation' });
    deleteTask.mockResolvedValue({ ok: true });
    expect(await deleteTaskAction(form({ id: 't3' }))).toEqual({ ok: true });
    expect(deleteTask).toHaveBeenCalledWith({}, SESSION, 't3');
  });
  it('assign requires taskId; with taskId passes assignee list', async () => {
    expect(await assignTaskAction(new FormData())).toEqual({ ok: false, error: 'not_found' });
    assignTask.mockResolvedValue({ ok: true });
    const fd = form({ taskId: 't7' });
    fd.append('assigneeIds', 'u2');
    expect(await assignTaskAction(fd)).toEqual({ ok: true });
    expect(assignTask).toHaveBeenCalledWith({}, SESSION, { taskId: 't7', assigneeIds: ['u2'] });
  });
});

describe('column CRUD actions', () => {
  it('create builds input, returns id', async () => {
    createTaskColumn.mockResolvedValue({ ok: true, id: 'c1' });
    const res = await createTaskColumnAction(form({ name: 'Бэклог', position: '0', statusAnchor: 'todo', isDoneColumn: 'on' }));
    expect(res).toEqual({ ok: true, id: 'c1' });
    expect(createTaskColumn).toHaveBeenCalledWith({}, SESSION, expect.objectContaining({ name: 'Бэклог', position: 0, statusAnchor: 'todo', isDoneColumn: true }));
  });
  it('update requires id; delete requires id', async () => {
    expect(await updateTaskColumnAction(form({ name: 'x' }))).toEqual({ ok: false, error: 'validation' });
    expect(await deleteTaskColumnAction(new FormData())).toEqual({ ok: false, error: 'validation' });
    updateTaskColumn.mockResolvedValue({ ok: true });
    deleteTaskColumn.mockResolvedValue({ ok: true });
    expect(await updateTaskColumnAction(form({ id: 'c2', name: 'x', position: '1', statusAnchor: 'review' }))).toEqual({ ok: true });
    expect(await deleteTaskColumnAction(form({ id: 'c3' }))).toEqual({ ok: true });
    expect(deleteTaskColumn).toHaveBeenCalledWith({}, SESSION, 'c3');
  });
});
