import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listTaskBoard,
  moveTask,
  getTaskFormOptions,
  getTaskEditForm,
} from '@/lib/services/tasks/board';
import { createTask, updateTask, deleteTask, assignTask } from '@/lib/services/tasks/tasks';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getTaskDetail } from '@/lib/services/tasks/detail';
import { setTaskResult, listTaskResultFiles } from '@/lib/services/tasks/result';
import type { SessionAccessProfile } from '@/lib/auth/accessProfile';

/**
 * G3.6 — доска задач (list/move) + CRUD против Postgres. Company-scope, done→
 * completedAt, привязки/исполнители валидируются по компании, per-manager охват.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string, companyB: string;
let m1: string, m2: string, mB: string;
let orgA: string, orgB: string, orderA: string, orderB: string;

const sA = (): SessionPayload =>
  ({
    sub: m1,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [],
  }) as unknown as SessionPayload;
const sM2 = (): SessionPayload =>
  ({
    sub: m2,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [],
  }) as unknown as SessionPayload;
const sB = (): SessionPayload =>
  ({
    sub: mB,
    role: 'manager',
    companyId: companyB,
    managedOrgIds: [],
  }) as unknown as SessionPayload;
const profile = (tasks: SessionAccessProfile['tasks']): SessionAccessProfile => ({
  id: 'p',
  name: 'Роль',
  orders: 'all',
  organizations: 'all',
  threads: 'all',
  documents: 'all',
  finance: 'all',
  leads: 'all',
  tasks,
  // `У-214`: варьируется только шкала задач; диалоги оставляем полными.
  dialogs: 'all',
  capabilities: [],
});
const sAOwn = (): SessionPayload =>
  ({
    sub: m1,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [],
    accessProfile: profile('own'),
  }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `g36a-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `g36b-${STAMP}` } })).id;
  m1 = (
    await prisma.user.create({
      data: { email: `g36m1-${STAMP}@t.local`, name: 'M1', role: 'manager', companyId: companyA },
    })
  ).id;
  m2 = (
    await prisma.user.create({
      data: { email: `g36m2-${STAMP}@t.local`, name: 'M2', role: 'manager', companyId: companyA },
    })
  ).id;
  mB = (
    await prisma.user.create({
      data: { email: `g36mb-${STAMP}@t.local`, name: 'MB', role: 'manager', companyId: companyB },
    })
  ).id;
  orgA = (
    await prisma.organization.create({ data: { name: `g36orgA-${STAMP}`, companyId: companyA } })
  ).id;
  orgB = (
    await prisma.organization.create({ data: { name: `g36orgB-${STAMP}`, companyId: companyB } })
  ).id;
  orderA = (
    await prisma.order.create({
      data: { title: `g36ordA-${STAMP}`, companyId: companyA, organizationId: orgA },
    })
  ).id;
  orderB = (
    await prisma.order.create({
      data: { title: `g36ordB-${STAMP}`, companyId: companyB, organizationId: orgB },
    })
  ).id;
});

afterAll(async () => {
  // Этап 7 (ФТ-7.2): назначение исполнителя создаёт task_assigned-уведомления —
  // чистим до пользователей (FK Notification.userId — Restrict).
  await prisma.notification.deleteMany({ where: { userId: { in: [m1, m2, mB] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [m1, m2, mB] } } });
  await prisma.taskAssignee.deleteMany({
    where: { task: { companyId: { in: [companyA, companyB] } } },
  });
  await prisma.task.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.order.deleteMany({ where: { id: { in: [orderA, orderB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [m1, m2, mB] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('createTask + listTaskBoard', () => {
  it('минимальная задача → колонка «К выполнению» (todo) на доске дефолтов', async () => {
    const r = await createTask(prisma, sA(), { title: `t-min-${STAMP}` });
    expect(r.ok).toBe(true);
    const board = await listTaskBoard(prisma, sA());
    expect(board.columns.map((c) => c.statusAnchor)).toEqual([
      'todo',
      'in_progress',
      'review',
      'done',
    ]);
    const todo = board.board.find((c) => c.column.statusAnchor === 'todo')!;
    expect(todo.cards.some((c) => c.id === (r.ok ? r.id : ''))).toBe(true);
  });

  it('создание сразу в done-колонку проставляет status=done и completedAt', async () => {
    const r = await createTask(prisma, sA(), {
      title: `t-done-${STAMP}`,
      columnId: 'default:done',
    });
    if (!r.ok) throw new Error('setup');
    const row = await prisma.task.findUniqueOrThrow({
      where: { id: r.id },
      select: { status: true, completedAt: true, columnId: true },
    });
    expect(row.status).toBe('done');
    expect(row.completedAt).not.toBeNull();
    expect(row.columnId).toBeNull(); // синтетический default → null
  });

  it('несуществующая колонка → invalid_column', async () => {
    expect(await createTask(prisma, sA(), { title: 'x', columnId: 'nope' })).toEqual({
      ok: false,
      error: 'invalid_column',
    });
  });

  it('привязка к заявке своей компании — ок; чужой → validation', async () => {
    expect((await createTask(prisma, sA(), { title: 'link-ok', linkedOrderId: orderA })).ok).toBe(
      true
    );
    expect(await createTask(prisma, sA(), { title: 'link-bad', linkedOrderId: orderB })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(
      await createTask(prisma, sA(), { title: 'org-bad', linkedOrganizationId: orgB })
    ).toEqual({ ok: false, error: 'validation' });
  });

  it('исполнитель своей компании — ок; чужой → validation', async () => {
    expect((await createTask(prisma, sA(), { title: 'asg-ok', assigneeIds: [m2] })).ok).toBe(true);
    expect(await createTask(prisma, sA(), { title: 'asg-bad', assigneeIds: [mB] })).toEqual({
      ok: false,
      error: 'validation',
    });
  });
});

describe('moveTask', () => {
  it('todo → done проставляет completedAt; обратно → сбрасывает', async () => {
    const c = await createTask(prisma, sA(), { title: `t-move-${STAMP}` });
    if (!c.ok) throw new Error('setup');
    expect(await moveTask(prisma, sA(), { taskId: c.id, toColumnId: 'default:done' })).toEqual({
      ok: true,
    });
    let row = await prisma.task.findUniqueOrThrow({
      where: { id: c.id },
      select: { status: true, completedAt: true },
    });
    expect(row.status).toBe('done');
    expect(row.completedAt).not.toBeNull();
    expect(await moveTask(prisma, sA(), { taskId: c.id, toColumnId: 'default:todo' })).toEqual({
      ok: true,
    });
    row = await prisma.task.findUniqueOrThrow({
      where: { id: c.id },
      select: { status: true, completedAt: true },
    });
    expect(row.status).toBe('todo');
    expect(row.completedAt).toBeNull();
  });

  it('несуществующая колонка → invalid_column; несуществующая задача → not_found', async () => {
    const c = await createTask(prisma, sA(), { title: 'mv2' });
    if (!c.ok) throw new Error('setup');
    expect(await moveTask(prisma, sA(), { taskId: c.id, toColumnId: 'nope' })).toEqual({
      ok: false,
      error: 'invalid_column',
    });
    expect(await moveTask(prisma, sA(), { taskId: 'missing', toColumnId: 'default:todo' })).toEqual(
      { ok: false, error: 'not_found' }
    );
  });
});

describe('update / delete / assign', () => {
  it('updateTask меняет заголовок; чужая компания → not_found', async () => {
    const c = await createTask(prisma, sA(), { title: 'upd' });
    if (!c.ok) throw new Error('setup');
    expect(await updateTask(prisma, sA(), c.id, { title: 'upd-2' })).toEqual({ ok: true });
    expect(await updateTask(prisma, sB(), c.id, { title: 'hack' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('assignTask синхронизирует исполнителей; чужой исполнитель → validation', async () => {
    const c = await createTask(prisma, sA(), { title: 'asg' });
    if (!c.ok) throw new Error('setup');
    expect(await assignTask(prisma, sA(), { taskId: c.id, assigneeIds: [m2] })).toEqual({
      ok: true,
    });
    expect(await prisma.taskAssignee.count({ where: { taskId: c.id } })).toBe(1);
    expect(await assignTask(prisma, sA(), { taskId: c.id, assigneeIds: [] })).toEqual({ ok: true });
    expect(await prisma.taskAssignee.count({ where: { taskId: c.id } })).toBe(0);
    expect(await assignTask(prisma, sA(), { taskId: c.id, assigneeIds: [mB] })).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('deleteTask удаляет задачу и её исполнителей', async () => {
    const c = await createTask(prisma, sA(), { title: 'del', assigneeIds: [m2] });
    if (!c.ok) throw new Error('setup');
    expect(await deleteTask(prisma, sA(), c.id)).toEqual({ ok: true });
    expect(await prisma.task.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await prisma.taskAssignee.count({ where: { taskId: c.id } })).toBe(0);
  });
});

describe('getTaskFormOptions', () => {
  it('возвращает исполнителей/организации/заявки своей компании; чужие не попадают', async () => {
    const opt = await getTaskFormOptions(prisma, sA());
    expect(opt.users.some((u) => u.id === m1)).toBe(true);
    expect(opt.users.some((u) => u.id === mB)).toBe(false);
    expect(opt.organizations.some((o) => o.id === orgA)).toBe(true);
    expect(opt.organizations.some((o) => o.id === orgB)).toBe(false);
    expect(opt.orders.some((o) => o.id === orderA)).toBe(true);
    expect(opt.orders.some((o) => o.id === orderB)).toBe(false);
  });
});

describe('per-manager scope (tasks: own)', () => {
  it('задача, созданная M2 и не назначенная M1, невидима M1 с охватом own', async () => {
    const c = await createTask(prisma, sM2(), { title: `own-${STAMP}` });
    if (!c.ok) throw new Error('setup');
    // M1 с охватом own не видит и не может двигать
    expect(
      await moveTask(prisma, sAOwn(), { taskId: c.id, toColumnId: 'default:in_progress' })
    ).toEqual({ ok: false, error: 'not_found' });
    const board = await listTaskBoard(prisma, sAOwn());
    const allCards = board.board.flatMap((col) => col.cards.map((cc) => cc.id));
    expect(allCards).not.toContain(c.id);
    // После назначения M1 — становится видимой
    expect(await assignTask(prisma, sM2(), { taskId: c.id, assigneeIds: [m1] })).toEqual({
      ok: true,
    });
    const board2 = await listTaskBoard(prisma, sAOwn());
    expect(board2.board.flatMap((col) => col.cards.map((cc) => cc.id))).toContain(c.id);
  });
});

describe('этап 5 ТЗ 13.10.2026 (`У-302`): данные формы правки для страницы задачи', () => {
  it('своя задача — карточка, колонки и списки формы; чужая и без компании — not_found', async () => {
    // Ставит коллега и назначает на себя: для «только своих» у M1 задача чужая.
    const r = await createTask(prisma, sM2(), { title: `t-edit-${STAMP}`, assigneeIds: [m2] });
    if (!r.ok) throw new Error('create failed');
    const id = r.id;

    const mine = await getTaskEditForm(prisma, sA(), id);
    if (!mine.ok) throw new Error('not ok');
    expect(mine.card).toMatchObject({ id, title: `t-edit-${STAMP}`, assigneeIds: [m2] });
    expect(mine.card.columnId).toBe(mine.columns[0]!.id);
    // `У-301`: в списке исполнителей есть e-mail — по нему ищут.
    expect(mine.options.users.find((u) => u.id === m2)?.email).toBe(`g36m2-${STAMP}@t.local`);

    expect(await getTaskEditForm(prisma, sB(), id)).toEqual({ ok: false, error: 'not_found' });
    expect(await getTaskEditForm(prisma, sAOwn(), id)).toEqual({ ok: false, error: 'not_found' });
    expect(
      await getTaskEditForm(prisma, { ...sA(), companyId: null } as unknown as SessionPayload, id)
    ).toEqual({ ok: false, error: 'not_found' });
    expect(await getTaskEditForm(prisma, sA(), 'нет-такой')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('этап 5 ТЗ 13.10.2026 (`У-299`): соисполнители, теги, результат, подробная история', () => {
  it('соисполнители — отдельной ролью; один человек в обоих списках — исполнитель', async () => {
    const r = await createTask(prisma, sA(), {
      title: `t-co-${STAMP}`,
      assigneeIds: [m1],
      coAssigneeIds: [m2, m1],
    });
    if (!r.ok) throw new Error('create failed');
    const rows = await prisma.taskAssignee.findMany({
      where: { taskId: r.id },
      select: { userId: true, role: true },
      orderBy: { userId: 'asc' },
    });
    expect(Object.fromEntries(rows.map((x) => [x.userId, x.role]))).toEqual({
      [m1]: 'executor',
      [m2]: 'co_executor',
    });
    const d = await getTaskDetail(prisma, sA(), r.id);
    if (!d.ok) throw new Error('detail');
    expect(d.task.assignees.map((a) => a.id)).toEqual([m1]);
    expect(d.task.coAssignees.map((a) => a.id)).toEqual([m2]);

    // Соисполнителя повышаем до исполнителя: строка та же, роль меняется.
    expect(
      await updateTask(prisma, sA(), r.id, {
        title: `t-co-${STAMP}`,
        assigneeIds: [m1, m2],
        coAssigneeIds: [],
      })
    ).toEqual({ ok: true });
    const after = await prisma.taskAssignee.findMany({
      where: { taskId: r.id },
      select: { role: true },
    });
    expect(after.map((x) => x.role)).toEqual(['executor', 'executor']);
    // Список соисполнителей не передан — их не трогаем.
    await prisma.taskAssignee.update({
      where: { taskId_userId: { taskId: r.id, userId: m2 } },
      data: { role: 'co_executor' },
    });
    await updateTask(prisma, sA(), r.id, { title: `t-co-${STAMP}`, assigneeIds: [m1] });
    const kept = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId: r.id, userId: m2 } },
      select: { role: true },
    });
    expect(kept?.role).toBe('co_executor');
    // Соисполнитель чужой компании — отказ.
    expect(
      await updateTask(prisma, sA(), r.id, { title: 'x', assigneeIds: [m1], coAssigneeIds: [mB] })
    ).toEqual({ ok: false, error: 'validation' });
  });

  it('теги — строчными без повторов; фильтр доски по тегу; подсказки тегов компании', async () => {
    const r = await createTask(prisma, sA(), {
      title: `t-tag-${STAMP}`,
      tags: ['Звонок', ' звонок ', 'Документы'],
    });
    if (!r.ok) throw new Error('create failed');
    const row = await prisma.task.findUniqueOrThrow({
      where: { id: r.id },
      select: { tags: true },
    });
    expect(row.tags).toEqual(['звонок', 'документы']);

    const byTag = await listTaskBoard(prisma, sA(), { tag: 'ЗВОНОК' });
    const ids = byTag.board.flatMap((c) => c.cards.map((x) => x.id));
    expect(ids).toContain(r.id);
    expect(byTag.board.flatMap((c) => c.cards).every((x) => x.tags.includes('звонок'))).toBe(true);
    const none = await listTaskBoard(prisma, sA(), { tag: `нет-${STAMP}` });
    expect(none.total).toBe(0);

    const options = await getTaskFormOptions(prisma, sA());
    expect(options.knownTags).toEqual(expect.arrayContaining(['звонок', 'документы']));
    // Чужая компания тегов этой не видит.
    expect((await getTaskFormOptions(prisma, sB())).knownTags).not.toContain('документы');

    // Тегов нет в правке — не стираются.
    await updateTask(prisma, sA(), r.id, { title: `t-tag-${STAMP}` });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: r.id }, select: { tags: true } })).tags
    ).toEqual(['звонок', 'документы']);
  });

  it('`У-302`: в историю правки пишется, что именно поменяли', async () => {
    const r = await createTask(prisma, sA(), { title: `t-hist-${STAMP}` });
    if (!r.ok) throw new Error('create failed');
    await updateTask(prisma, sA(), r.id, {
      title: `t-hist-${STAMP}-2`,
      dueDate: new Date('2026-12-01T00:00:00Z'),
      assigneeIds: [m2],
      tags: ['отчёт'],
    });
    const d = await getTaskDetail(prisma, sA(), r.id);
    if (!d.ok) throw new Error('detail');
    const edit = d.task.history.find((h) => h.details !== null);
    expect(edit?.details).toBe('название, срок, исполнители, теги');
    // Сохранили без изменений — правка в журнале есть, но перечень пуст.
    await updateTask(prisma, sA(), r.id, {
      title: `t-hist-${STAMP}-2`,
      dueDate: new Date('2026-12-01T00:00:00Z'),
      assigneeIds: [m2],
      tags: ['отчёт'],
    });
    const d2 = await getTaskDetail(prisma, sA(), r.id);
    if (!d2.ok) throw new Error('detail');
    expect(d2.task.history[0]?.details).toBeNull();
  });

  it('результат задачи: пишет тот, кто видит задачу; чужая компания — not_found', async () => {
    const r = await createTask(prisma, sA(), { title: `t-res-${STAMP}` });
    if (!r.ok) throw new Error('create failed');
    expect(await setTaskResult(prisma, sA(), { taskId: r.id, result: 'Акт подписан' })).toEqual({
      ok: true,
    });
    const d = await getTaskDetail(prisma, sA(), r.id);
    if (!d.ok) throw new Error('detail');
    expect(d.task.result).toBe('Акт подписан');
    expect(d.task.resultUpdatedAt).toBeInstanceOf(Date);
    expect(await setTaskResult(prisma, sB(), { taskId: r.id, result: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });

    // Файлы результата: заражённый не показывается; удалить — свой или постановщик.
    await prisma.taskResultFile.createMany({
      data: [
        {
          taskId: r.id,
          createdByUserId: m2,
          name: 'акт.pdf',
          path: 'p1',
          mimeType: 'application/pdf',
          size: 10,
          scanStatus: 'clean',
        },
        {
          taskId: r.id,
          createdByUserId: m2,
          name: 'вирус.pdf',
          path: 'p2',
          mimeType: 'application/pdf',
          size: 10,
          scanStatus: 'infected',
        },
      ],
    });
    const asM2 = await listTaskResultFiles(prisma, sM2(), { id: r.id, createdById: m1 });
    expect(asM2.map((f) => [f.name, f.canDelete, f.createdByName])).toEqual([
      ['акт.pdf', true, 'M2'],
    ]);
    const asBoss = await listTaskResultFiles(prisma, sA(), { id: r.id, createdById: m1 });
    expect(asBoss[0]?.canDelete).toBe(true);
    const asOther = await listTaskResultFiles(prisma, sB(), { id: r.id, createdById: m1 });
    expect(asOther[0]?.canDelete).toBe(false);
  });
});
