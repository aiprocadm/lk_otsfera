import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  hasOpenChecklistItems,
  listChecklist,
  CHECKLIST_MAX_ITEMS,
} from '@/lib/services/tasks/checklist';

/**
 * Чек-лист задачи (`У-219`, этап 4 PR-1).
 *
 * Два инварианта, ради которых этот файл существует:
 *
 * 1. **Чужую задачу не видно и не потрогать.** Пункт чек-листа — это дверь в
 *    задачу с другого адреса: `itemId` приходит из формы, и если по нему не
 *    проверить саму задачу, любой сотрудник сможет править чек-лист чужой
 *    компании, ни разу не открыв её карточку.
 * 2. **Снятая галочка обнуляет и автора, и время.** Иначе пункт показывает
 *    «выполнил Иванов вчера» рядом с пустым квадратиком.
 */

const taskFindUnique = vi.fn();
const itemFindUnique = vi.fn();
const itemFindFirst = vi.fn();
const itemFindMany = vi.fn();
const itemCount = vi.fn();
const itemCreate = vi.fn();
const itemUpdate = vi.fn();
const itemDelete = vi.fn();
const auditCreate = vi.fn();

const prisma = {
  task: { findUnique: taskFindUnique },
  taskChecklistItem: {
    findUnique: itemFindUnique,
    findFirst: itemFindFirst,
    findMany: itemFindMany,
    count: itemCount,
    create: itemCreate,
    update: itemUpdate,
    delete: itemDelete,
  },
  auditLog: { create: auditCreate },
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
} as unknown as PrismaClient;

const manager = { sub: 'u1', role: 'manager', companyId: 'co-1' } as SessionPayload;
const OWN_TASK = {
  companyId: 'co-1',
  createdById: 'u1',
  linkedOrganizationId: null,
  assignees: [{ userId: 'u1' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  taskFindUnique.mockResolvedValue(OWN_TASK);
  itemCount.mockResolvedValue(0);
  itemFindFirst.mockResolvedValue(null);
  itemCreate.mockResolvedValue({ id: 'it-1' });
  itemFindMany.mockResolvedValue([]);
});

describe('addChecklistItem', () => {
  it('добавляет пункт и ставит его в конец списка', async () => {
    itemFindFirst.mockResolvedValue({ sortOrder: 4 });
    const res = await addChecklistItem(prisma, manager, { taskId: 't1', title: '  Позвонить  ' });
    expect(res).toEqual({ ok: true, id: 'it-1' });
    expect(itemCreate.mock.calls[0][0].data).toEqual({
      taskId: 't1',
      title: 'Позвонить',
      sortOrder: 5,
    });
  });

  it('первый пункт получает порядок 0, а не «после ничего»', async () => {
    await addChecklistItem(prisma, manager, { taskId: 't1', title: 'Шаг' });
    expect(itemCreate.mock.calls[0][0].data.sortOrder).toBe(0);
  });

  it('пустой заголовок — отказ, базу не трогаем', async () => {
    expect(await addChecklistItem(prisma, manager, { taskId: 't1', title: '   ' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(taskFindUnique).not.toHaveBeenCalled();
    expect(itemCreate).not.toHaveBeenCalled();
  });

  it('слишком длинный заголовок — отказ', async () => {
    const res = await addChecklistItem(prisma, manager, { taskId: 't1', title: 'x'.repeat(201) });
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('чек-лист не превращают в реестр: после предела — отказ', async () => {
    itemCount.mockResolvedValue(CHECKLIST_MAX_ITEMS);
    expect(await addChecklistItem(prisma, manager, { taskId: 't1', title: 'Ещё' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(itemCreate).not.toHaveBeenCalled();
  });

  it('сессия без компании — forbidden', async () => {
    const res = await addChecklistItem(
      prisma,
      { ...manager, companyId: null } as SessionPayload,
      { taskId: 't1', title: 'Шаг' }
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('задачи нет — not_found', async () => {
    taskFindUnique.mockResolvedValue(null);
    expect(await addChecklistItem(prisma, manager, { taskId: 'нет', title: 'Шаг' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('ЧУЖАЯ КОМПАНИЯ: отвечаем not_found, а не forbidden — существование задачи не подтверждаем', async () => {
    taskFindUnique.mockResolvedValue({ ...OWN_TASK, companyId: 'co-2' });
    expect(await addChecklistItem(prisma, manager, { taskId: 't1', title: 'Шаг' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(itemCreate).not.toHaveBeenCalled();
  });
});

describe('toggleChecklistItem', () => {
  beforeEach(() => itemFindUnique.mockResolvedValue({ id: 'it-1', taskId: 't1' }));

  it('отметка пишет автора и время', async () => {
    const res = await toggleChecklistItem(prisma, manager, { itemId: 'it-1', isDone: true });
    expect(res).toEqual({ ok: true });
    const data = itemUpdate.mock.calls[0][0].data;
    expect(data.isDone).toBe(true);
    expect(data.doneById).toBe('u1');
    expect(data.doneAt).toBeInstanceOf(Date);
  });

  it('СНЯТАЯ галочка обнуляет и автора, и время', async () => {
    await toggleChecklistItem(prisma, manager, { itemId: 'it-1', isDone: false });
    expect(itemUpdate.mock.calls[0][0].data).toEqual({
      isDone: false,
      doneById: null,
      doneAt: null,
    });
  });

  it('пункта нет — not_found', async () => {
    itemFindUnique.mockResolvedValue(null);
    expect(await toggleChecklistItem(prisma, manager, { itemId: 'нет', isDone: true })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('пункт ЧУЖОЙ задачи не отмечается: id пункта — это дверь в задачу с другого адреса', async () => {
    taskFindUnique.mockResolvedValue({ ...OWN_TASK, companyId: 'co-2' });
    expect(await toggleChecklistItem(prisma, manager, { itemId: 'it-1', isDone: true })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(itemUpdate).not.toHaveBeenCalled();
  });
});

describe('deleteChecklistItem', () => {
  beforeEach(() =>
    itemFindUnique.mockResolvedValue({ id: 'it-1', taskId: 't1', title: 'Позвонить' })
  );

  it('удаляет пункт и пишет в журнал', async () => {
    expect(await deleteChecklistItem(prisma, manager, 'it-1')).toEqual({ ok: true });
    expect(itemDelete).toHaveBeenCalledWith({ where: { id: 'it-1' } });
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      action: 'task_checklist_item_deleted',
      entity: 'task',
      entityId: 't1',
    });
  });

  it('пункта нет — not_found', async () => {
    itemFindUnique.mockResolvedValue(null);
    expect(await deleteChecklistItem(prisma, manager, 'нет')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('пункт чужой задачи не удаляется', async () => {
    taskFindUnique.mockResolvedValue({ ...OWN_TASK, companyId: 'co-2' });
    expect(await deleteChecklistItem(prisma, manager, 'it-1')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(itemDelete).not.toHaveBeenCalled();
  });
});

describe('hasOpenChecklistItems и listChecklist', () => {
  it('считает ИМЕННО невыполненные пункты', async () => {
    itemCount.mockResolvedValue(2);
    expect(await hasOpenChecklistItems(prisma, 't1')).toBe(true);
    expect(itemCount).toHaveBeenCalledWith({ where: { taskId: 't1', isDone: false } });
  });

  it('все пункты закрыты — открытых нет', async () => {
    itemCount.mockResolvedValue(0);
    expect(await hasOpenChecklistItems(prisma, 't1')).toBe(false);
  });

  it('список идёт в порядке пунктов, а не как база вернёт', async () => {
    await listChecklist(prisma, 't1');
    expect(itemFindMany.mock.calls[0][0].orderBy).toEqual([
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ]);
  });
});
