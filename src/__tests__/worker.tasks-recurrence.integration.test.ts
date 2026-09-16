import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runTasksRecurrence } from '@/worker/processors/tasks-recurrence';
import { materializeNextOccurrence } from '@/lib/services/tasks/recurrence';
import { moveTask } from '@/lib/services/tasks/board';
import { updateTask } from '@/lib/services/tasks/tasks';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 4 PR-6 (`У-221`) — повторяющиеся задачи на живом Postgres.
 *
 * Модульный страж проверяет правила на поддельной базе; здесь проверяется то,
 * что подделать нельзя: уникальность `recurrenceParentId` (дубль отвергает сама
 * база) и что ночной обход действительно находит просроченный экземпляр.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyId: string;
let userId: string;
let seriesRoot: string;
let plainTask: string;

const session = (): SessionPayload =>
  ({ sub: userId, role: 'manager', companyId, managedOrgIds: [] }) as unknown as SessionPayload;

const DUE = new Date('2026-09-09T15:00:00.000Z');
const NOW = new Date('2026-09-16T06:00:00.000Z');

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `s4p6-${STAMP}` } })).id;
  userId = (
    await prisma.user.create({
      data: {
        email: `s4p6-u-${STAMP}@t.local`,
        name: 'Менеджер',
        role: 'manager',
        companyId,
      },
    })
  ).id;

  seriesRoot = (
    await prisma.task.create({
      data: {
        companyId,
        createdById: userId,
        title: `s4p6-повтор-${STAMP}`,
        description: 'Проверить оплаты',
        status: 'todo',
        priority: 'high',
        dueDate: DUE,
        recurrence: { freq: 'weekly', interval: 1 },
        assignees: { create: [{ userId }] },
        checklist: {
          create: [
            { title: 'Сверить банк', sortOrder: 0, isDone: true, doneById: userId },
            { title: 'Позвонить клиенту', sortOrder: 1 },
          ],
        },
      },
    })
  ).id;

  // Обычная просроченная задача без правила — обход обязан пройти мимо неё.
  plainTask = (
    await prisma.task.create({
      data: {
        companyId,
        createdById: userId,
        title: `s4p6-обычная-${STAMP}`,
        status: 'todo',
        dueDate: DUE,
      },
    })
  ).id;
});

afterAll(async () => {
  // Сначала потомки: `recurrenceParentId` — SetNull, но чек-листы и исполнители
  // висят каскадом на задачах.
  await prisma.task.deleteMany({ where: { companyId } });
  // Перенос и правка задачи пишут журнал действий — он держит пользователя
  // внешним ключом, поэтому уходит первым.
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('ночной обход повторяющихся задач', () => {
  it('создаёт следующий экземпляр просроченной серии и не трогает обычные задачи', async () => {
    const res = await runTasksRecurrence(prisma, NOW);
    expect(res.created).toBeGreaterThanOrEqual(1);

    const child = await prisma.task.findFirst({
      where: { recurrenceParentId: seriesRoot },
      include: {
        assignees: { select: { userId: true } },
        checklist: { orderBy: { sortOrder: 'asc' } },
      },
    });
    expect(child, 'следующий экземпляр серии').not.toBeNull();

    // Срок — ровно через неделю от срока предыдущего.
    expect(child!.dueDate?.toISOString()).toBe('2026-09-16T15:00:00.000Z');
    expect(child!.status).toBe('todo');
    expect(child!.completedAt).toBeNull();
    expect(child!.title).toBe(`s4p6-повтор-${STAMP}`);
    // Правило переехало в новый экземпляр — серия живёт в последнем.
    expect(child!.recurrence).toEqual({ freq: 'weekly', interval: 1 });

    expect(child!.assignees.map((a) => a.userId)).toEqual([userId]);
    // Чек-лист скопирован ЦЕЛИКОМ и НЕотмеченным, хотя у прошлой задачи один
    // пункт был закрыт: новая неделя начинается с чистого листа.
    expect(child!.checklist.map((c) => ({ title: c.title, isDone: c.isDone }))).toEqual([
      { title: 'Сверить банк', isDone: false },
      { title: 'Позвонить клиенту', isDone: false },
    ]);

    // Обычная просроченная задача потомка не получила.
    expect(await prisma.task.count({ where: { recurrenceParentId: plainTask } })).toBe(0);
  });

  it('ПОВТОРНЫЙ обход не создаёт второй экземпляр', async () => {
    const before = await prisma.task.count({ where: { companyId } });
    await runTasksRecurrence(prisma, NOW);
    expect(await prisma.task.count({ where: { companyId } })).toBe(before);
  });

  it('база сама отвергает второго потомка — уникальность, а не удача', async () => {
    // Прямой вызов в обход проверки «потомок уже есть»: так выглядит гонка
    // ночного обхода с завершением задачи человеком.
    const res = await materializeNextOccurrence(prisma, seriesRoot);
    expect(res).toEqual({ skipped: 'already_materialized' });
    expect(await prisma.task.count({ where: { recurrenceParentId: seriesRoot } })).toBe(1);
  });

  it('серия с истёкшим `until` больше не продолжается', async () => {
    const finished = await prisma.task.create({
      data: {
        companyId,
        createdById: userId,
        title: `s4p6-конец-${STAMP}`,
        status: 'todo',
        dueDate: DUE,
        recurrence: { freq: 'weekly', interval: 1, until: '2026-09-12' },
      },
    });
    expect(await materializeNextOccurrence(prisma, finished.id)).toEqual({
      skipped: 'series_finished',
    });
    expect(await prisma.task.count({ where: { recurrenceParentId: finished.id } })).toBe(0);
  });

  it('человек ЗАВЕРШИЛ задачу — следующий экземпляр рождается сразу, не дожидаясь ночи', async () => {
    const task = await prisma.task.create({
      data: {
        companyId,
        createdById: userId,
        title: `s4p6-закрыли-${STAMP}`,
        status: 'todo',
        dueDate: DUE,
        recurrence: { freq: 'daily', interval: 2 },
      },
    });

    expect(
      await moveTask(prisma, session(), { taskId: task.id, toColumnId: 'default:done' })
    ).toEqual({ ok: true });

    const child = await prisma.task.findFirst({ where: { recurrenceParentId: task.id } });
    expect(child, 'следующий экземпляр после завершения').not.toBeNull();
    // Срок считается от СРОКА прошлой задачи, а не от момента завершения:
    // закрыл раньше — серия не съезжает.
    expect(child!.dueDate?.toISOString()).toBe('2026-09-11T15:00:00.000Z');
  });

  it('правка «только эту» отпускает серию дальше, а сама задача становится обычной', async () => {
    const task = await prisma.task.create({
      data: {
        companyId,
        createdById: userId,
        title: `s4p6-одну-${STAMP}`,
        status: 'todo',
        dueDate: DUE,
        recurrence: { freq: 'weekly', interval: 1 },
      },
    });

    expect(
      await updateTask(prisma, session(), task.id, {
        title: `s4p6-одну-правка-${STAMP}`,
        dueDate: DUE,
        recurrenceScope: 'this',
        recurrence: { freq: 'weekly', interval: 1 },
      })
    ).toEqual({ ok: true });

    const after = await prisma.task.findUnique({ where: { id: task.id } });
    // Сама задача больше не повторяется…
    expect(after!.recurrence).toBeNull();
    expect(after!.title).toBe(`s4p6-одну-правка-${STAMP}`);

    // …а серия продолжилась ПРЕЖНИМ названием: правка «только эту» не должна
    // была уехать в будущие задачи.
    const child = await prisma.task.findFirst({ where: { recurrenceParentId: task.id } });
    expect(child, 'серия продолжена отдельной задачей').not.toBeNull();
    expect(child!.title).toBe(`s4p6-одну-${STAMP}`);
    expect(child!.recurrence).toEqual({ freq: 'weekly', interval: 1 });
  });

  it('правка «эта и все будущие» оставляет серию на самой задаче', async () => {
    const task = await prisma.task.create({
      data: {
        companyId,
        createdById: userId,
        title: `s4p6-все-${STAMP}`,
        status: 'todo',
        dueDate: DUE,
        recurrence: { freq: 'weekly', interval: 1 },
      },
    });

    expect(
      await updateTask(prisma, session(), task.id, {
        title: `s4p6-все-правка-${STAMP}`,
        dueDate: DUE,
        recurrence: { freq: 'weekly', interval: 2 },
      })
    ).toEqual({ ok: true });

    const after = await prisma.task.findUnique({ where: { id: task.id } });
    expect(after!.recurrence).toEqual({ freq: 'weekly', interval: 2 });
    // Никого досрочно не родили: следующий появится при завершении или ночью.
    expect(await prisma.task.count({ where: { recurrenceParentId: task.id } })).toBe(0);
  });

  it('«не повторять» выключает серию', async () => {
    const task = await prisma.task.create({
      data: {
        companyId,
        createdById: userId,
        title: `s4p6-выкл-${STAMP}`,
        status: 'todo',
        dueDate: DUE,
        recurrence: { freq: 'daily', interval: 1 },
      },
    });

    await updateTask(prisma, session(), task.id, {
      title: `s4p6-выкл-${STAMP}`,
      dueDate: DUE,
      recurrence: null,
    });

    const after = await prisma.task.findUnique({ where: { id: task.id } });
    expect(after!.recurrence).toBeNull();
    expect(await materializeNextOccurrence(prisma, task.id)).toEqual({ skipped: 'no_rule' });
  });
});
