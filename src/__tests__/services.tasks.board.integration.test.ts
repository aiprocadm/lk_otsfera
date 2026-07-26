import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listTaskBoard, moveTask, getTaskFormOptions } from '@/lib/services/tasks/board';
import { createTask, updateTask, deleteTask, assignTask } from '@/lib/services/tasks/tasks';
import type { SessionPayload } from '@/lib/auth/jwt';
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
  ({ sub: m1, role: 'manager', companyId: companyA, managedOrgIds: [] } as unknown as SessionPayload);
const sM2 = (): SessionPayload =>
  ({ sub: m2, role: 'manager', companyId: companyA, managedOrgIds: [] } as unknown as SessionPayload);
const sB = (): SessionPayload =>
  ({ sub: mB, role: 'manager', companyId: companyB, managedOrgIds: [] } as unknown as SessionPayload);
const profile = (tasks: SessionAccessProfile['tasks']): SessionAccessProfile => ({
  id: 'p', name: 'Роль', orders: 'all', organizations: 'all', threads: 'all',
  documents: 'all', finance: 'all', leads: 'all', tasks, capabilities: []
});
const sAOwn = (): SessionPayload =>
  ({ sub: m1, role: 'manager', companyId: companyA, managedOrgIds: [], accessProfile: profile('own') } as unknown as SessionPayload);

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `g36a-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `g36b-${STAMP}` } })).id;
  m1 = (await prisma.user.create({ data: { email: `g36m1-${STAMP}@t.local`, name: 'M1', role: 'manager', companyId: companyA } })).id;
  m2 = (await prisma.user.create({ data: { email: `g36m2-${STAMP}@t.local`, name: 'M2', role: 'manager', companyId: companyA } })).id;
  mB = (await prisma.user.create({ data: { email: `g36mb-${STAMP}@t.local`, name: 'MB', role: 'manager', companyId: companyB } })).id;
  orgA = (await prisma.organization.create({ data: { name: `g36orgA-${STAMP}`, companyId: companyA } })).id;
  orgB = (await prisma.organization.create({ data: { name: `g36orgB-${STAMP}`, companyId: companyB } })).id;
  orderA = (await prisma.order.create({ data: { title: `g36ordA-${STAMP}`, companyId: companyA, organizationId: orgA } })).id;
  orderB = (await prisma.order.create({ data: { title: `g36ordB-${STAMP}`, companyId: companyB, organizationId: orgB } })).id;
});

afterAll(async () => {
  // Этап 7 (ФТ-7.2): назначение исполнителя создаёт task_assigned-уведомления —
  // чистим до пользователей (FK Notification.userId — Restrict).
  await prisma.notification.deleteMany({ where: { userId: { in: [m1, m2, mB] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [m1, m2, mB] } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { companyId: { in: [companyA, companyB] } } } });
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
    expect(board.columns.map((c) => c.statusAnchor)).toEqual(['todo', 'in_progress', 'review', 'done']);
    const todo = board.board.find((c) => c.column.statusAnchor === 'todo')!;
    expect(todo.cards.some((c) => c.id === (r.ok ? r.id : ''))).toBe(true);
  });

  it('создание сразу в done-колонку проставляет status=done и completedAt', async () => {
    const r = await createTask(prisma, sA(), { title: `t-done-${STAMP}`, columnId: 'default:done' });
    if (!r.ok) throw new Error('setup');
    const row = await prisma.task.findUniqueOrThrow({ where: { id: r.id }, select: { status: true, completedAt: true, columnId: true } });
    expect(row.status).toBe('done');
    expect(row.completedAt).not.toBeNull();
    expect(row.columnId).toBeNull(); // синтетический default → null
  });

  it('несуществующая колонка → invalid_column', async () => {
    expect(await createTask(prisma, sA(), { title: 'x', columnId: 'nope' })).toEqual({ ok: false, error: 'invalid_column' });
  });

  it('привязка к заявке своей компании — ок; чужой → validation', async () => {
    expect((await createTask(prisma, sA(), { title: 'link-ok', linkedOrderId: orderA })).ok).toBe(true);
    expect(await createTask(prisma, sA(), { title: 'link-bad', linkedOrderId: orderB })).toEqual({ ok: false, error: 'validation' });
    expect(await createTask(prisma, sA(), { title: 'org-bad', linkedOrganizationId: orgB })).toEqual({ ok: false, error: 'validation' });
  });

  it('исполнитель своей компании — ок; чужой → validation', async () => {
    expect((await createTask(prisma, sA(), { title: 'asg-ok', assigneeIds: [m2] })).ok).toBe(true);
    expect(await createTask(prisma, sA(), { title: 'asg-bad', assigneeIds: [mB] })).toEqual({ ok: false, error: 'validation' });
  });
});

describe('moveTask', () => {
  it('todo → done проставляет completedAt; обратно → сбрасывает', async () => {
    const c = await createTask(prisma, sA(), { title: `t-move-${STAMP}` });
    if (!c.ok) throw new Error('setup');
    expect(await moveTask(prisma, sA(), { taskId: c.id, toColumnId: 'default:done' })).toEqual({ ok: true });
    let row = await prisma.task.findUniqueOrThrow({ where: { id: c.id }, select: { status: true, completedAt: true } });
    expect(row.status).toBe('done');
    expect(row.completedAt).not.toBeNull();
    expect(await moveTask(prisma, sA(), { taskId: c.id, toColumnId: 'default:todo' })).toEqual({ ok: true });
    row = await prisma.task.findUniqueOrThrow({ where: { id: c.id }, select: { status: true, completedAt: true } });
    expect(row.status).toBe('todo');
    expect(row.completedAt).toBeNull();
  });

  it('несуществующая колонка → invalid_column; несуществующая задача → not_found', async () => {
    const c = await createTask(prisma, sA(), { title: 'mv2' });
    if (!c.ok) throw new Error('setup');
    expect(await moveTask(prisma, sA(), { taskId: c.id, toColumnId: 'nope' })).toEqual({ ok: false, error: 'invalid_column' });
    expect(await moveTask(prisma, sA(), { taskId: 'missing', toColumnId: 'default:todo' })).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('update / delete / assign', () => {
  it('updateTask меняет заголовок; чужая компания → not_found', async () => {
    const c = await createTask(prisma, sA(), { title: 'upd' });
    if (!c.ok) throw new Error('setup');
    expect(await updateTask(prisma, sA(), c.id, { title: 'upd-2' })).toEqual({ ok: true });
    expect(await updateTask(prisma, sB(), c.id, { title: 'hack' })).toEqual({ ok: false, error: 'not_found' });
  });

  it('assignTask синхронизирует исполнителей; чужой исполнитель → validation', async () => {
    const c = await createTask(prisma, sA(), { title: 'asg' });
    if (!c.ok) throw new Error('setup');
    expect(await assignTask(prisma, sA(), { taskId: c.id, assigneeIds: [m2] })).toEqual({ ok: true });
    expect(await prisma.taskAssignee.count({ where: { taskId: c.id } })).toBe(1);
    expect(await assignTask(prisma, sA(), { taskId: c.id, assigneeIds: [] })).toEqual({ ok: true });
    expect(await prisma.taskAssignee.count({ where: { taskId: c.id } })).toBe(0);
    expect(await assignTask(prisma, sA(), { taskId: c.id, assigneeIds: [mB] })).toEqual({ ok: false, error: 'validation' });
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
    expect(await moveTask(prisma, sAOwn(), { taskId: c.id, toColumnId: 'default:in_progress' })).toEqual({ ok: false, error: 'not_found' });
    const board = await listTaskBoard(prisma, sAOwn());
    const allCards = board.board.flatMap((col) => col.cards.map((cc) => cc.id));
    expect(allCards).not.toContain(c.id);
    // После назначения M1 — становится видимой
    expect(await assignTask(prisma, sM2(), { taskId: c.id, assigneeIds: [m1] })).toEqual({ ok: true });
    const board2 = await listTaskBoard(prisma, sAOwn());
    expect(board2.board.flatMap((col) => col.cards.map((cc) => cc.id))).toContain(c.id);
  });
});
