import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { moveTask } from '@/lib/services/tasks/board';

/**
 * СТРАЖ `У-219`: задача с невыполненными пунктами чек-листа не уезжает в
 * «Готово» молча.
 *
 * Почему страж, а не обычный тест: здесь легко «починить» поведение в сторону
 * удобства — убрать вопрос, чтобы карточка просто перетаскивалась, — и ничего
 * видимого не сломается. Ломается смысл: чек-лист перестаёт что-либо значить,
 * и следующий человек уже не поймёт, зачем его вообще заводили.
 *
 * Инвариант из трёх частей, каждая проверяется отдельно:
 *  1. перевод в готовую колонку при открытых пунктах → `checklist_incomplete`;
 *  2. `force: true` (человек ответил «да») → перевод проходит;
 *  3. вопрос задаётся ТОЛЬКО на переходе в «Готово» и только один раз —
 *     перетаскивание внутри готовой колонки и переносы между рабочими
 *     колонками базу о чек-листе даже не спрашивают.
 *
 * Мутация (проверено 15.09.2026): убрать проверку `hasOpenChecklistItems` в
 * `board.ts` → первый тест краснеет.
 */

const taskFindUnique = vi.fn();
const itemCount = vi.fn();
const taskUpdate = vi.fn();
const auditCreate = vi.fn();
const columnFindMany = vi.fn();

const prisma = {
  task: { findUnique: taskFindUnique, update: taskUpdate },
  taskChecklistItem: { count: itemCount },
  taskColumn: { findMany: columnFindMany },
  auditLog: { create: auditCreate },
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
} as unknown as PrismaClient;

const manager = { sub: 'u1', role: 'manager', companyId: 'co-1' } as SessionPayload;

const TASK = {
  id: 't1',
  companyId: 'co-1',
  status: 'in_progress',
  columnId: null,
  completedAt: null,
  createdById: 'u1',
  linkedOrganizationId: null,
  assignees: [{ userId: 'u1' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Пустой набор колонок компании → работают дефолты кода (`default:*`),
  // среди которых `default:done` помечена готовой.
  columnFindMany.mockResolvedValue([]);
  taskFindUnique.mockResolvedValue(TASK);
  itemCount.mockResolvedValue(0);
});

describe('страж: чек-лист переспрашивает перед завершением задачи', () => {
  it('открытые пункты + «Готово» → checklist_incomplete, задача НЕ меняется', async () => {
    itemCount.mockResolvedValue(2);
    const res = await moveTask(prisma, manager, { taskId: 't1', toColumnId: 'default:done' });
    expect(res).toEqual({ ok: false, error: 'checklist_incomplete' });
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it('человек ответил «завершить всё равно» → force проводит перенос', async () => {
    itemCount.mockResolvedValue(2);
    const res = await moveTask(prisma, manager, {
      taskId: 't1',
      toColumnId: 'default:done',
      force: true,
    });
    expect(res).toEqual({ ok: true });
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    expect(taskUpdate.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
  });

  it('все пункты закрыты → вопроса нет', async () => {
    const res = await moveTask(prisma, manager, { taskId: 't1', toColumnId: 'default:done' });
    expect(res).toEqual({ ok: true });
  });

  it('перенос между РАБОЧИМИ колонками чек-лист не спрашивает вовсе', async () => {
    itemCount.mockResolvedValue(5);
    const res = await moveTask(prisma, manager, { taskId: 't1', toColumnId: 'default:review' });
    expect(res).toEqual({ ok: true });
    expect(itemCount).not.toHaveBeenCalled();
  });

  it('уже завершённую задачу не переспрашивают повторно', async () => {
    // Карточку двигают внутри «Готово» — спрашивать второй раз про тот же
    // чек-лист значило бы наказывать человека за уже принятое решение.
    taskFindUnique.mockResolvedValue({ ...TASK, completedAt: new Date('2026-09-01') });
    itemCount.mockResolvedValue(3);
    const res = await moveTask(prisma, manager, { taskId: 't1', toColumnId: 'default:done' });
    expect(res).toEqual({ ok: true });
    expect(itemCount).not.toHaveBeenCalled();
  });

  it('чужая задача отсекается ДО вопроса про чек-лист', async () => {
    taskFindUnique.mockResolvedValue({ ...TASK, companyId: 'co-2' });
    itemCount.mockResolvedValue(3);
    const res = await moveTask(prisma, manager, { taskId: 't1', toColumnId: 'default:done' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(itemCount).not.toHaveBeenCalled();
  });
});
