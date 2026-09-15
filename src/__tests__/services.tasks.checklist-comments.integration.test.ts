import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { createTask, deleteTask } from '@/lib/services/tasks/tasks';
import { listTaskBoard, moveTask } from '@/lib/services/tasks/board';
import { addChecklistItem, toggleChecklistItem } from '@/lib/services/tasks/checklist';
import { addTaskComment } from '@/lib/services/tasks/comments';
import { getTaskDetail } from '@/lib/services/tasks/detail';

/**
 * Этап 4 PR-1 (`У-218`, `У-219`) — на живом Postgres.
 *
 * Здесь проверяется то, чего моки не покажут:
 *  - прогресс чек-листа на доске считается настоящим `groupBy`;
 *  - `checklist_incomplete` срабатывает против реальных строк, а `force`
 *    проводит перевод;
 *  - удаление задачи **каскадом** уносит и обсуждение, и чек-лист. Забытый
 *    каскад не ломает ни один экран — он просто оставляет в базе сирот,
 *    которые всплывут через год.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyId: string;
let m1: string;
let m2: string;

const session = (): SessionPayload =>
  ({ sub: m1, role: 'manager', companyId, managedOrgIds: [] }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `s4p1-${STAMP}` } })).id;
  m1 = (
    await prisma.user.create({
      data: { email: `s4p1-m1-${STAMP}@t.local`, name: 'Первый', role: 'manager', companyId },
    })
  ).id;
  m2 = (
    await prisma.user.create({
      data: { email: `s4p1-m2-${STAMP}@t.local`, name: 'Второй', role: 'manager', companyId },
    })
  ).id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [m1, m2] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [m1, m2] } } });
  await prisma.taskComment.deleteMany({ where: { task: { companyId } } });
  await prisma.taskChecklistItem.deleteMany({ where: { task: { companyId } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { companyId } } });
  await prisma.task.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { id: { in: [m1, m2] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

async function newTask(title: string): Promise<string> {
  const res = await createTask(prisma, session(), { title, assigneeIds: [m2] });
  if (!res.ok) throw new Error(`не удалось создать задачу: ${res.error}`);
  return res.id;
}

describe('чек-лист на живой базе (`У-219`)', () => {
  it('прогресс «сделано/всего» доходит до карточки доски', async () => {
    const taskId = await newTask(`s4p1-progress-${STAMP}`);
    const a = await addChecklistItem(prisma, session(), { taskId, title: 'Первый шаг' });
    await addChecklistItem(prisma, session(), { taskId, title: 'Второй шаг' });
    await addChecklistItem(prisma, session(), { taskId, title: 'Третий шаг' });
    if (!a.ok) throw new Error('пункт не создан');
    await toggleChecklistItem(prisma, session(), { itemId: a.id, isDone: true });

    const board = await listTaskBoard(prisma, session());
    const card = board.board.flatMap((c) => c.cards).find((c) => c.id === taskId);
    expect(card).toBeDefined();
    expect(card?.checklistTotal).toBe(3);
    expect(card?.checklistDone).toBe(1);
  });

  it('задача без чек-листа показывает нули, а не отсутствующие поля', async () => {
    const taskId = await newTask(`s4p1-nolist-${STAMP}`);
    const board = await listTaskBoard(prisma, session());
    const card = board.board.flatMap((c) => c.cards).find((c) => c.id === taskId);
    expect(card?.checklistTotal).toBe(0);
    expect(card?.checklistDone).toBe(0);
  });

  it('перевод в «Готово» с открытыми пунктами отклоняется, с подтверждением — проходит', async () => {
    const taskId = await newTask(`s4p1-gate-${STAMP}`);
    await addChecklistItem(prisma, session(), { taskId, title: 'Незакрытый шаг' });

    const columns = await listTaskBoard(prisma, session());
    const done = columns.columns.find((c) => c.isDoneColumn);
    expect(done, 'у компании должна быть готовая колонка').toBeDefined();

    const refused = await moveTask(prisma, session(), { taskId, toColumnId: done!.id });
    expect(refused).toEqual({ ok: false, error: 'checklist_incomplete' });

    const forced = await moveTask(prisma, session(), {
      taskId,
      toColumnId: done!.id,
      force: true,
    });
    expect(forced).toEqual({ ok: true });
    const after = await prisma.task.findUnique({
      where: { id: taskId },
      select: { completedAt: true },
    });
    expect(after?.completedAt).not.toBeNull();
  });
});

describe('обсуждение на живой базе (`У-218`)', () => {
  it('комментарий виден в карточке задачи вместе с именем автора', async () => {
    const taskId = await newTask(`s4p1-comment-${STAMP}`);
    const added = await addTaskComment(prisma, session(), { taskId, body: 'Проверил документы' });
    expect(added.ok).toBe(true);

    const detail = await getTaskDetail(prisma, session(), taskId);
    if (!detail.ok) throw new Error('карточка не открылась');
    expect(detail.task.comments.map((c) => c.body)).toEqual(['Проверил документы']);
    expect(detail.task.comments[0]?.authorName).toBe('Первый');
    // История берётся из аудита: создание задачи и сам комментарий.
    expect(detail.task.history.length).toBeGreaterThanOrEqual(2);
  });

  it('УДАЛЕНИЕ ЗАДАЧИ каскадом уносит обсуждение и чек-лист — сирот не остаётся', async () => {
    const taskId = await newTask(`s4p1-cascade-${STAMP}`);
    await addTaskComment(prisma, session(), { taskId, body: 'Комментарий' });
    await addChecklistItem(prisma, session(), { taskId, title: 'Шаг' });

    expect(await prisma.taskComment.count({ where: { taskId } })).toBe(1);
    expect(await prisma.taskChecklistItem.count({ where: { taskId } })).toBe(1);

    const removed = await deleteTask(prisma, session(), taskId);
    expect(removed).toEqual({ ok: true });

    expect(await prisma.taskComment.count({ where: { taskId } })).toBe(0);
    expect(await prisma.taskChecklistItem.count({ where: { taskId } })).toBe(0);
  });
});
