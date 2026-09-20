import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Комментарии, чек-лист и колонки доски задач (`У-218`, `У-219`).
 *
 * Все действия — тонкие адаптеры (§3): разобрать форму, спросить сессию,
 * позвать сервис и **освежить именно ту страницу, которая изменилась**. Права
 * и правила живут в сервисах; здесь проверяется, что без номера задачи ничего
 * не уходит, а при отказе сервиса страница не перечитывается.
 */
const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  addTaskComment: vi.fn(),
  addChecklistItem: vi.fn(),
  toggleChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  createTaskColumn: vi.fn(),
  updateTaskColumn: vi.fn(),
  deleteTaskColumn: vi.fn(),
  moveTask: vi.fn(),
  listLinkedTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  assignTask: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession: mocks.requireSession }));
vi.mock('@/lib/services/tasks/board', () => ({
  moveTask: mocks.moveTask,
  listLinkedTasks: mocks.listLinkedTasks,
}));
vi.mock('@/lib/services/tasks/tasks', () => ({
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
  deleteTask: mocks.deleteTask,
  assignTask: mocks.assignTask,
}));
vi.mock('@/lib/services/tasks/comments', () => ({ addTaskComment: mocks.addTaskComment }));
vi.mock('@/lib/services/tasks/checklist', () => ({
  addChecklistItem: mocks.addChecklistItem,
  toggleChecklistItem: mocks.toggleChecklistItem,
  deleteChecklistItem: mocks.deleteChecklistItem,
}));
vi.mock('@/lib/services/tasks/columns', () => ({
  createTaskColumn: mocks.createTaskColumn,
  updateTaskColumn: mocks.updateTaskColumn,
  deleteTaskColumn: mocks.deleteTaskColumn,
}));

import {
  addTaskCommentAction,
  addChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
  createTaskColumnAction,
  updateTaskColumnAction,
  deleteTaskColumnAction,
} from '@/server-actions/tasks';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ sub: 'u1', role: 'manager', companyId: 'c1' });
  for (const name of [
    'addTaskComment',
    'addChecklistItem',
    'toggleChecklistItem',
    'deleteChecklistItem',
    'updateTaskColumn',
    'deleteTaskColumn',
  ] as const) {
    mocks[name].mockResolvedValue({ ok: true });
  }
  mocks.createTaskColumn.mockResolvedValue({ ok: true, id: 'col-1' });
});

describe('addTaskCommentAction — комментарий в задаче', () => {
  it('без номера задачи ничего не пишем', async () => {
    await expect(addTaskCommentAction(fd({ body: 'текст' }))).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(mocks.addTaskComment).not.toHaveBeenCalled();
  });

  it('комментарий уходит в сервис, страница задачи перечитывается', async () => {
    const res = await addTaskCommentAction(fd({ taskId: 't1', body: 'сделал' }));

    expect(res).toEqual({ ok: true });
    expect(mocks.addTaskComment).toHaveBeenCalledWith({}, expect.anything(), {
      taskId: 't1',
      body: 'сделал',
    });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it('отказ сервиса страницу не трогает', async () => {
    mocks.addTaskComment.mockResolvedValue({ ok: false, error: 'forbidden' });

    const res = await addTaskCommentAction(fd({ taskId: 't1', body: 'x' }));

    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('Чек-лист задачи', () => {
  it('пункт без задачи не заводится', async () => {
    await expect(addChecklistItemAction(fd({ title: 'шаг' }))).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('пункт добавляется', async () => {
    const res = await addChecklistItemAction(fd({ taskId: 't1', title: 'шаг' }));

    expect(res).toEqual({ ok: true });
    expect(mocks.addChecklistItem).toHaveBeenCalledWith({}, expect.anything(), {
      taskId: 't1',
      title: 'шаг',
    });
  });

  it('отказ добавления страницу не трогает', async () => {
    mocks.addChecklistItem.mockResolvedValue({ ok: false, error: 'forbidden' });

    await addChecklistItemAction(fd({ taskId: 't1', title: 'шаг' }));

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['галочка формы', { isDone: 'on' }, true],
    ['строковое true', { isDone: 'true' }, true],
    ['снятая галочка', {}, false],
  ])('отметка «%s» понимается как %s', async (_name, extra, expected) => {
    await toggleChecklistItemAction(fd({ itemId: 'i1', taskId: 't1', ...extra }));

    expect(mocks.toggleChecklistItem).toHaveBeenCalledWith({}, expect.anything(), {
      itemId: 'i1',
      isDone: expected,
    });
  });

  it.each([
    ['без пункта', { taskId: 't1' }],
    ['без задачи', { itemId: 'i1' }],
  ])('переключение %s — отказ', async (_name, entries) => {
    await expect(toggleChecklistItemAction(fd(entries))).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(mocks.toggleChecklistItem).not.toHaveBeenCalled();
  });

  it('отказ переключения страницу не трогает', async () => {
    mocks.toggleChecklistItem.mockResolvedValue({ ok: false, error: 'not_found' });

    await toggleChecklistItemAction(fd({ itemId: 'i1', taskId: 't1' }));

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('удаление пункта требует и пункт, и задачу', async () => {
    await expect(deleteChecklistItemAction(fd({ itemId: 'i1' }))).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });

    const res = await deleteChecklistItemAction(fd({ itemId: 'i1', taskId: 't1' }));
    expect(res).toEqual({ ok: true });
    expect(mocks.deleteChecklistItem).toHaveBeenCalledWith({}, expect.anything(), 'i1');
  });

  it('отказ удаления страницу не трогает', async () => {
    mocks.deleteChecklistItem.mockResolvedValue({ ok: false, error: 'forbidden' });

    await deleteChecklistItemAction(fd({ itemId: 'i1', taskId: 't1' }));

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('Колонки доски задач', () => {
  it('новая колонка получает разобранные поля и возвращает свой номер', async () => {
    const res = await createTaskColumnAction(
      fd({
        name: 'В работе',
        position: '2',
        statusAnchor: 'in_progress',
        color: '#F97316',
        isDoneColumn: 'on',
      })
    );

    expect(res).toEqual({ ok: true, id: 'col-1' });
    expect(mocks.createTaskColumn).toHaveBeenCalledWith({}, expect.anything(), {
      name: 'В работе',
      position: 2,
      statusAnchor: 'in_progress',
      color: '#F97316',
      isDoneColumn: true,
    });
  });

  it('пустые поля превращаются в разумные умолчания, а не в «NaN» и пустой цвет', async () => {
    await createTaskColumnAction(fd({ name: 'Новая' }));

    expect(mocks.createTaskColumn).toHaveBeenCalledWith({}, expect.anything(), {
      name: 'Новая',
      position: 0,
      statusAnchor: 'todo',
      color: null,
      isDoneColumn: false,
    });
  });

  it('строковое true в отметке «колонка завершения» тоже понимается', async () => {
    await createTaskColumnAction(fd({ name: 'Готово', isDoneColumn: 'true' }));

    expect(mocks.createTaskColumn).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ isDoneColumn: true })
    );
  });

  it('отказ создания доску не перечитывает', async () => {
    mocks.createTaskColumn.mockResolvedValue({ ok: false, error: 'forbidden' });

    const res = await createTaskColumnAction(fd({ name: 'x' }));

    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('правка без номера колонки — отказ', async () => {
    await expect(updateTaskColumnAction(fd({ name: 'x' }))).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    expect(mocks.updateTaskColumn).not.toHaveBeenCalled();
  });

  it('правка передаёт номер и поля', async () => {
    const res = await updateTaskColumnAction(fd({ id: 'col-1', name: 'Переименована' }));

    expect(res).toEqual({ ok: true });
    expect(mocks.updateTaskColumn).toHaveBeenCalledWith(
      {},
      expect.anything(),
      'col-1',
      expect.objectContaining({ name: 'Переименована' })
    );
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it('отказ правки доску не перечитывает', async () => {
    mocks.updateTaskColumn.mockResolvedValue({ ok: false, error: 'not_found' });

    await updateTaskColumnAction(fd({ id: 'col-1', name: 'x' }));

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('удаление без номера — отказ', async () => {
    await expect(deleteTaskColumnAction(fd({}))).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('удаление колонки перечитывает доску', async () => {
    const res = await deleteTaskColumnAction(fd({ id: 'col-1' }));

    expect(res).toEqual({ ok: true });
    expect(mocks.deleteTaskColumn).toHaveBeenCalledWith({}, expect.anything(), 'col-1');
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it('отказ удаления доску не перечитывает', async () => {
    mocks.deleteTaskColumn.mockResolvedValue({ ok: false, error: 'has_tasks' });

    await deleteTaskColumnAction(fd({ id: 'col-1' }));

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
