import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: vi.fn(), info: vi.fn() } }));

const { globalFindMany } = vi.hoisted(() => ({ globalFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { task: { findMany: globalFindMany } } }));

import {
  materializeNextOccurrence,
  materializeNextOccurrenceSafely,
  sweepRecurringTasks,
} from '@/lib/services/tasks/recurrence';
import { tasksRecurrenceProcessor } from '@/worker/processors/tasks-recurrence';

/**
 * Повторяющиеся задачи (`У-221`) — что происходит, когда что-то ломается.
 *
 * Повтор — побочный эффект: человек закрыл задачу, а система заодно создала
 * следующую. Сбой побочного эффекта не имеет права отменить главное действие и
 * не имеет права остановить соседние серии (§3, graceful degrade). Проверяется
 * это отдельно от правил самого повтора — там речь про «что создаём», здесь про
 * «что делаем, когда не получилось».
 */

const TASK = {
  id: 'parent',
  companyId: 'co-1',
  createdById: 'author',
  title: 'Проверить оплаты',
  description: null,
  priority: null,
  dueDate: new Date('2026-09-16T15:00:00.000Z'),
  recurrence: { freq: 'weekly', interval: 1 },
  linkedOrderId: null,
  linkedOrganizationId: null,
  linkedLeadId: null,
  linkedDealId: null,
  linkedContactId: null,
  linkedDialogId: null,
  linkedDocumentId: null,
  assignees: [],
  checklist: [],
  recurrenceChild: null,
};

const findUnique = vi.fn();
const taskCreate = vi.fn();
const taskFindMany = vi.fn();

const prisma = {
  task: { findUnique, findMany: taskFindMany },
  $transaction: vi.fn(async (fn: (t: unknown) => unknown) =>
    fn({
      task: { create: taskCreate, update: vi.fn() },
      taskAssignee: { createMany: vi.fn() },
      taskChecklistItem: { createMany: vi.fn() },
    })
  ),
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ ...TASK });
  taskCreate.mockResolvedValue({ id: 'child', title: TASK.title, dueDate: null });
  globalFindMany.mockResolvedValue([]);
});

describe('сбой при создании следующего экземпляра', () => {
  it('ЧУЖАЯ ошибка базы пробрасывается наверх, а не выдаётся за «уже создан»', async () => {
    // Ловим только `P2002` (гонка двух путей). Всё прочее — настоящая поломка,
    // и прятать её под «пропущено» значит потерять серию молча.
    taskCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('нет связи', {
        code: 'P1001',
        clientVersion: 'test',
      })
    );
    await expect(materializeNextOccurrence(prisma, 'parent')).rejects.toThrow('нет связи');
  });

  it('безопасный вызов проглатывает сбой и пишет его в журнал', async () => {
    taskCreate.mockRejectedValue(new Error('база моргнула'));
    // Не бросает: человек уже закрыл задачу, отменять это нельзя.
    await expect(materializeNextOccurrenceSafely(prisma, 'parent')).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(
      '[tasks] не удалось создать следующий экземпляр серии',
      expect.objectContaining({ taskId: 'parent', error: 'база моргнула' })
    );
  });

  it('не-Error в сбое тоже попадает в журнал читаемой строкой', async () => {
    taskCreate.mockRejectedValue('строка вместо ошибки');
    await materializeNextOccurrenceSafely(prisma, 'parent');
    expect(logError.mock.calls[0][1].error).toBe('строка вместо ошибки');
  });
});

describe('ночной обход: одна сломанная серия не останавливает остальные', () => {
  it('падение на первой задаче не мешает создать вторую', async () => {
    taskFindMany.mockResolvedValue([{ id: 'плохая' }, { id: 'parent' }]);
    findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === 'плохая' ? Promise.reject(new Error('строка битая')) : { ...TASK }
    );

    const res = await sweepRecurringTasks(prisma, new Date('2026-09-20T06:00:00.000Z'));
    expect(res).toEqual({ scanned: 2, created: 1 });
    expect(logError).toHaveBeenCalledWith(
      '[worker] повтор задачи не создан',
      expect.objectContaining({ taskId: 'плохая', error: 'строка битая' })
    );
  });

  it('не-Error в сбое обхода тоже читается', async () => {
    taskFindMany.mockResolvedValue([{ id: 'плохая' }]);
    findUnique.mockRejectedValue({ странное: 'значение' });
    await sweepRecurringTasks(prisma, new Date());
    expect(typeof logError.mock.calls[0][1].error).toBe('string');
  });
});

/**
 * Прогон сопровождения №36 (`Р-М-3`): «срок прошёл» — закончился МОСКОВСКИЙ
 * день срока, как обещает подсказка формы («когда пройдёт срок»). Обход идёт
 * в 06:00 МСК; прежнее «срок < сейчас» рождало следующий экземпляр в сам день
 * срока, пока текущий ещё в работе.
 */
describe('ночной обход: «срок прошёл» — по московскому дню (прогон №36)', () => {
  async function pickedAt(now: Date): Promise<(due: Date) => boolean> {
    taskFindMany.mockResolvedValue([]);
    await sweepRecurringTasks(prisma, now);
    const { lt } = taskFindMany.mock.calls.at(-1)![0].where.dueDate as { lt: Date };
    return (due) => due < lt;
  }

  it('срок «сегодня» в 06:00 МСК ещё не прошёл; «вчера» — прошёл', async () => {
    const morning = await pickedAt(new Date('2026-09-16T06:00:00+03:00'));
    // Срок из формы задачи — `new Date(<input type="date">)`, полночь UTC.
    expect(morning(new Date('2026-09-16'))).toBe(false);
    expect(morning(new Date('2026-09-15'))).toBe(true);
    // Срок из Битрикс24 «16.09 01:30 МСК» (15.09 22:30 UTC) — сегодняшний.
    expect(morning(new Date('2026-09-16T01:30:00+03:00'))).toBe(false);
  });

  it('обход в 00:30 МСК (сервер ещё во вчера) видит закончившийся день', async () => {
    const night = await pickedAt(new Date('2026-09-17T00:30:00+03:00'));
    expect(night(new Date('2026-09-16'))).toBe(true);
    expect(night(new Date('2026-09-16T23:59:00+03:00'))).toBe(true);
    expect(night(new Date('2026-09-17T01:30:00+03:00'))).toBe(false);
  });
});

describe('обёртка BullMQ', () => {
  it('работает на глобальном prisma и возвращает счётчики', async () => {
    expect(await tasksRecurrenceProcessor()).toEqual({ scanned: 0, created: 0 });
    expect(globalFindMany).toHaveBeenCalled();
  });
});
