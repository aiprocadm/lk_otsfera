import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { moveTask } from '@/lib/services/tasks/board';
import { createTask, updateTask, deleteTask, assignTask } from '@/lib/services/tasks/tasks';
import { canSeeTask } from '@/lib/auth/accessProfile';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * G3.8 — контракт изоляции (§4): внутренние задачи НЕ доступны клиентским ролям
 * (partner/organization/student) и не пересекают границу компании (C8). Клиентский
 * контур не имеет ни route, ни nav, ни service-пути к задачам — здесь проверяем
 * последний рубеж (service-layer): любые мутации от клиентских ролей и чужой
 * компании отклоняются (forbidden|not_found), задача не изменяется.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string, companyB: string, m1: string, mB: string, taskA: string;

const client = (role: 'partner' | 'organization' | 'student'): SessionPayload =>
  ({ sub: `${role}-1`, role, companyId: companyA, managedOrgIds: [] } as unknown as SessionPayload);
const sMB = (): SessionPayload =>
  ({ sub: mB, role: 'manager', companyId: companyB, managedOrgIds: [] } as unknown as SessionPayload);

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `g38a-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `g38b-${STAMP}` } })).id;
  m1 = (await prisma.user.create({ data: { email: `g38m1-${STAMP}@t.local`, name: 'M1', role: 'manager', companyId: companyA } })).id;
  mB = (await prisma.user.create({ data: { email: `g38mb-${STAMP}@t.local`, name: 'MB', role: 'manager', companyId: companyB } })).id;
  taskA = (await prisma.task.create({ data: { companyId: companyA, createdById: m1, title: `g38task-${STAMP}`, status: 'todo' } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [m1, mB] } } });
  await prisma.taskAssignee.deleteMany({ where: { taskId: taskA } });
  await prisma.task.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [m1, mB] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('canSeeTask — клиентские роли не видят задачи никогда (pure)', () => {
  const task = { companyId: companyA, createdById: m1, assigneeUserIds: [] as string[], linkedOrganizationId: null };
  it.each(['partner', 'organization', 'student'] as const)('роль %s → false даже в своей компании', (role) => {
    expect(canSeeTask(client(role), task)).toBe(false);
  });
});

describe('service-layer: клиентские роли отклонены', () => {
  it.each(['partner', 'organization', 'student'] as const)('createTask от %s → forbidden', async (role) => {
    expect(await createTask(prisma, client(role), { title: 'взлом' })).toEqual({ ok: false, error: 'forbidden' });
  });

  it('updateTask/deleteTask/assignTask от partner → forbidden (staffGate)', async () => {
    expect(await updateTask(prisma, client('partner'), taskA, { title: 'x' })).toEqual({ ok: false, error: 'forbidden' });
    expect(await deleteTask(prisma, client('partner'), taskA)).toEqual({ ok: false, error: 'forbidden' });
    expect(await assignTask(prisma, client('partner'), { taskId: taskA, assigneeIds: [] })).toEqual({ ok: false, error: 'forbidden' });
  });

  it('moveTask от partner своей компании → not_found (canSeeTask deny роли)', async () => {
    expect(await moveTask(prisma, client('partner'), { taskId: taskA, toColumnId: 'default:done' })).toEqual({ ok: false, error: 'not_found' });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskA }, select: { status: true } });
    expect(row.status).toBe('todo'); // не изменилась
  });
});

describe('cross-company (C8): менеджер чужой компании не трогает задачу', () => {
  it('move/update/delete задачи компании A от менеджера компании B → not_found', async () => {
    expect(await moveTask(prisma, sMB(), { taskId: taskA, toColumnId: 'default:in_progress' })).toEqual({ ok: false, error: 'not_found' });
    expect(await updateTask(prisma, sMB(), taskA, { title: 'hack' })).toEqual({ ok: false, error: 'not_found' });
    expect(await deleteTask(prisma, sMB(), taskA)).toEqual({ ok: false, error: 'not_found' });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskA }, select: { status: true, title: true } });
    expect(row.status).toBe('todo');
  });
});
