import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { materializeNextOccurrence } from '@/lib/services/tasks/recurrence';

/**
 * СТРАЖ `У-221`: у экземпляра серии рождается РОВНО ОДИН потомок, и рождается он
 * чистым.
 *
 * Почему это страж, а не обычный тест. Следующая задача появляется двумя путями
 * — человек закрыл текущую и ночной обход увидел прошедший срок, — и они могут
 * сойтись в одну секунду. Защита стоит в базе: `Task.recurrenceParentId`
 * уникален. Если кто-нибудь снимет уникальность «чтобы не мешала», отдел продаж
 * получит две одинаковые задачи на неделю и заметит это не сразу.
 *
 * Второе, что легко потерять при правке: чек-лист обязан копироваться
 * НЕотмеченным. Иначе задача следующей недели выглядит наполовину сделанной, и
 * человек честно её не делает.
 *
 * Мутация (проверено 16.09.2026): убрать `isDone: false` при копировании
 * чек-листа → падает «чек-лист копируется неотмеченным»; перестать ловить
 * `P2002` → падает «гонка двух путей не создаёт дубль».
 */

const TASK = {
  id: 'parent',
  companyId: 'co-1',
  createdById: 'author',
  title: 'Проверить оплаты',
  description: 'Каждую неделю',
  priority: 'high' as const,
  dueDate: new Date('2026-09-16T15:00:00.000Z'),
  recurrence: { freq: 'weekly', interval: 1 },
  linkedOrderId: null,
  linkedOrganizationId: 'org-1',
  linkedLeadId: null,
  linkedDealId: null,
  linkedContactId: null,
  linkedDialogId: null,
  linkedDocumentId: null,
  assignees: [{ userId: 'u1' }, { userId: 'u2' }],
  checklist: [
    { title: 'Сверить банк', sortOrder: 0 },
    { title: 'Позвонить клиенту', sortOrder: 1 },
  ],
  recurrenceChild: null as { id: string } | null,
};

const findUnique = vi.fn();
const taskCreate = vi.fn();
const taskUpdate = vi.fn();
const assigneeCreateMany = vi.fn();
const checklistCreateMany = vi.fn();

const tx = {
  task: { create: taskCreate, update: taskUpdate },
  taskAssignee: { createMany: assigneeCreateMany },
  taskChecklistItem: { createMany: checklistCreateMany },
};

const prisma = {
  task: { findUnique },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ ...TASK });
  taskCreate.mockResolvedValue({ id: 'child', title: TASK.title, dueDate: null });
});

describe('страж: один потомок и чистый старт', () => {
  it('следующий экземпляр ссылается на текущий и уносит правило себе', async () => {
    const res = await materializeNextOccurrence(prisma, 'parent');
    expect(res).toEqual({ created: 'child' });

    const update = taskUpdate.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'child' });
    // Правило переезжает в НОВЫЙ экземпляр: «больше не повторять» — это снять
    // его с последнего, а не искать по всей цепочке.
    expect(update.data.recurrence).toEqual({ freq: 'weekly', interval: 1 });
    expect(update.data.recurrenceParentId).toBe('parent');
  });

  it('срок считается от срока текущей задачи, а не от «сегодня»', async () => {
    await materializeNextOccurrence(prisma, 'parent');
    // 16.09 + неделя. Считать от «сейчас» значило бы: закрыл задачу на день
    // раньше — и вся серия навсегда съехала на день.
    expect(taskCreate.mock.calls[0][0].data.dueDate).toEqual(new Date('2026-09-23T15:00:00.000Z'));
  });

  it('новый экземпляр начинается С НАЧАЛА: todo, без колонки и без даты завершения', async () => {
    await materializeNextOccurrence(prisma, 'parent');
    const data = taskCreate.mock.calls[0][0].data;
    expect(data.status).toBe('todo');
    expect(data.columnId).toBeNull();
    expect(data.completedAt).toBeNull();
    // Автор — автор серии, а не тот, кто закрыл прошлую задачу.
    expect(data.createdById).toBe('author');
    expect(data.linkedOrganizationId).toBe('org-1');
  });

  it('исполнители переезжают', async () => {
    await materializeNextOccurrence(prisma, 'parent');
    expect(assigneeCreateMany.mock.calls[0][0].data).toEqual([
      { taskId: 'child', userId: 'u1' },
      { taskId: 'child', userId: 'u2' },
    ]);
  });

  it('чек-лист копируется НЕОТМЕЧЕННЫМ и в том же порядке', async () => {
    await materializeNextOccurrence(prisma, 'parent');
    expect(checklistCreateMany.mock.calls[0][0].data).toEqual([
      { taskId: 'child', title: 'Сверить банк', sortOrder: 0, isDone: false },
      { taskId: 'child', title: 'Позвонить клиенту', sortOrder: 1, isDone: false },
    ]);
  });

  it('потомок уже есть — второй не создаётся', async () => {
    findUnique.mockResolvedValue({ ...TASK, recurrenceChild: { id: 'child' } });
    expect(await materializeNextOccurrence(prisma, 'parent')).toEqual({
      skipped: 'already_materialized',
    });
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('ГОНКА двух путей не создаёт дубль: база отвергает второго потомка', async () => {
    taskCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );
    expect(await materializeNextOccurrence(prisma, 'parent')).toEqual({
      skipped: 'already_materialized',
    });
  });

  it('`until` в прошлом завершает серию без ошибки', async () => {
    findUnique.mockResolvedValue({
      ...TASK,
      recurrence: { freq: 'weekly', interval: 1, until: '2026-09-20' },
    });
    expect(await materializeNextOccurrence(prisma, 'parent')).toEqual({
      skipped: 'series_finished',
    });
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('без правила и без срока — молчим, а не выдумываем дату', async () => {
    findUnique.mockResolvedValue({ ...TASK, recurrence: null });
    expect(await materializeNextOccurrence(prisma, 'parent')).toEqual({ skipped: 'no_rule' });

    findUnique.mockResolvedValue({ ...TASK, dueDate: null });
    expect(await materializeNextOccurrence(prisma, 'parent')).toEqual({ skipped: 'no_due_date' });

    findUnique.mockResolvedValue(null);
    expect(await materializeNextOccurrence(prisma, 'parent')).toEqual({ skipped: 'not_found' });
  });

  it('испорченное правило в базе не роняет прогон', async () => {
    findUnique.mockResolvedValue({ ...TASK, recurrence: { freq: 'каждый вторник' } });
    expect(await materializeNextOccurrence(prisma, 'parent')).toEqual({ skipped: 'no_rule' });
  });
});
