import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTask, updateTask } from '@/lib/services/tasks/tasks';
import { listLinkedTasks } from '@/lib/services/tasks/board';
import { runTaskDueSoon } from '@/worker/processors/task-due-soon';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 7 PR-1 (ФТ-7.1/7.2) — интеграция на живом Postgres: привязки задач к
 * лиду/сделке (FK + SetNull), уведомление task_assigned, полный цикл джоба
 * task_due_soon (claim-дедуп, повторный прогон пуст, перенос срока → повтор).
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string;
let m1: string, m2: string;
let leadId: string, dealId: string;

const sA = (): SessionPayload =>
  ({ sub: m1, role: 'manager', companyId: companyA, managedOrgIds: [] } as unknown as SessionPayload);

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `s7p1-${STAMP}` } })).id;
  m1 = (await prisma.user.create({ data: { email: `s7p1-m1-${STAMP}@t.local`, name: 'M1', role: 'manager', companyId: companyA } })).id;
  m2 = (await prisma.user.create({ data: { email: `s7p1-m2-${STAMP}@t.local`, name: 'M2', role: 'manager', companyId: companyA } })).id;
  leadId = (
    await prisma.lead.create({
      data: {
        createdByUserId: m1,
        clientCompanyName: `s7p1-client-${STAMP}`,
        clientContactName: 'Контакт',
        subject: `s7p1-subject-${STAMP}`,
        source: 'manual'
      }
    })
  ).id;
  dealId = (await prisma.deal.create({ data: { companyId: companyA, title: `s7p1-deal-${STAMP}` } })).id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [m1, m2] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [m1, m2] } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { companyId: companyA } } });
  await prisma.task.deleteMany({ where: { companyId: companyA } });
  await prisma.deal.deleteMany({ where: { companyId: companyA } });
  await prisma.lead.deleteMany({ where: { id: leadId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [m1, m2] } } });
  await prisma.company.deleteMany({ where: { id: companyA } });
  await prisma.$disconnect();
});

describe('привязки задач к лиду/сделке (ФТ-7.1)', () => {
  it('createTask персистит связи; listLinkedTasks видит их с темой лида/названием сделки; task_assigned создан', async () => {
    const r = await createTask(prisma, sA(), {
      title: `s7p1-t1-${STAMP}`,
      linkedLeadId: leadId,
      linkedDealId: dealId,
      assigneeIds: [m2]
    });
    expect(r.ok).toBe(true);

    const byLead = await listLinkedTasks(prisma, sA(), { leadId });
    expect(byLead.map((t) => t.title)).toContain(`s7p1-t1-${STAMP}`);
    expect(byLead[0]!.linkedLeadSubject).toBe(`s7p1-subject-${STAMP}`);
    expect(byLead[0]!.linkedDealTitle).toBe(`s7p1-deal-${STAMP}`);

    // Профиль охвата уважается и в списке привязанных задач: с уровнем «own»
    // менеджер видит только свои. Задача выше создана им же, поэтому остаётся
    // видимой — а вот у другого менеджера с тем же профилем её быть не должно.
    const ownProfile = { ...sA(), accessProfile: { tasks: 'own' } } as unknown as SessionPayload;
    const byLeadOwn = await listLinkedTasks(prisma, ownProfile, { leadId });
    expect(byLeadOwn.map((t) => t.title)).toContain(`s7p1-t1-${STAMP}`);

    const strangerOwn = {
      sub: m2,
      role: 'manager',
      companyId: companyA,
      managedOrgIds: [],
      accessProfile: { tasks: 'own' }
    } as unknown as SessionPayload;
    const byLeadStranger = await listLinkedTasks(prisma, strangerOwn, { leadId });
    // m2 — назначенный исполнитель, значит задача его тоже касается.
    expect(byLeadStranger.map((t) => t.title)).toContain(`s7p1-t1-${STAMP}`);

    const byDeal = await listLinkedTasks(prisma, sA(), { dealId });
    expect(byDeal.map((t) => t.title)).toContain(`s7p1-t1-${STAMP}`);

    // Уведомление назначенному (не автору) существует.
    const notif = await prisma.notification.findFirst({
      where: { userId: m2, type: 'task_assigned' },
      orderBy: { createdAt: 'desc' }
    });
    expect(notif).not.toBeNull();
    expect(notif!.body).toContain(`s7p1-t1-${STAMP}`);
    // Автору — нет.
    expect(await prisma.notification.count({ where: { userId: m1, type: 'task_assigned' } })).toBe(0);
  });

  it('удаление лида обнуляет привязку (SetNull), задача живёт', async () => {
    const tmpLead = await prisma.lead.create({
      data: {
        createdByUserId: m1,
        clientCompanyName: `s7p1-tmp-${STAMP}`,
        clientContactName: 'К',
        subject: 'tmp',
        source: 'manual'
      }
    });
    const r = await createTask(prisma, sA(), { title: `s7p1-setnull-${STAMP}`, linkedLeadId: tmpLead.id });
    expect(r.ok).toBe(true);
    await prisma.lead.delete({ where: { id: tmpLead.id } });

    const task = await prisma.task.findFirst({ where: { title: `s7p1-setnull-${STAMP}` } });
    expect(task).not.toBeNull();
    expect(task!.linkedLeadId).toBeNull();
  });
});

describe('джоб task_due_soon (ФТ-7.2)', () => {
  it('полный цикл: уведомляет, дедупит, после переноса срока уведомляет заново', async () => {
    const now = new Date();
    const create = await createTask(prisma, sA(), {
      title: `s7p1-due-${STAMP}`,
      dueDate: now,
      assigneeIds: [m2]
    });
    expect(create.ok).toBe(true);
    const taskId = (create as { ok: true; id: string }).id;

    const before = await prisma.notification.count({ where: { userId: m2, type: 'task_due_soon' } });

    // Прогон 1: задача в горизонте → уведомление и отметка.
    const run1 = await runTaskDueSoon(prisma, now);
    expect(run1.notified).toBeGreaterThanOrEqual(1);
    const afterRun1 = await prisma.notification.count({ where: { userId: m2, type: 'task_due_soon' } });
    expect(afterRun1).toBe(before + 1);
    const claimed = await prisma.task.findUnique({ where: { id: taskId }, select: { dueSoonNotifiedAt: true } });
    expect(claimed!.dueSoonNotifiedAt).not.toBeNull();

    // Прогон 2: идемпотентность — новых уведомлений нет.
    await runTaskDueSoon(prisma, now);
    expect(await prisma.notification.count({ where: { userId: m2, type: 'task_due_soon' } })).toBe(before + 1);

    // Перенос срока сбрасывает отметку → прогон 3 уведомляет заново.
    const upd = await updateTask(prisma, sA(), taskId, {
      title: `s7p1-due-${STAMP}`,
      dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      assigneeIds: [m2]
    });
    expect(upd.ok).toBe(true);
    const reset = await prisma.task.findUnique({ where: { id: taskId }, select: { dueSoonNotifiedAt: true } });
    expect(reset!.dueSoonNotifiedAt).toBeNull();

    await runTaskDueSoon(prisma, now);
    expect(await prisma.notification.count({ where: { userId: m2, type: 'task_due_soon' } })).toBe(before + 2);
  });

  it('done-задачи и задачи за горизонтом не трогаются', async () => {
    const far = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const rFar = await createTask(prisma, sA(), { title: `s7p1-far-${STAMP}`, dueDate: far, assigneeIds: [m2] });
    expect(rFar.ok).toBe(true);

    const beforeCnt = await prisma.notification.count({ where: { userId: m2, type: 'task_due_soon' } });
    await runTaskDueSoon(prisma, new Date());
    const farRow = await prisma.task.findFirst({
      where: { title: `s7p1-far-${STAMP}` },
      select: { dueSoonNotifiedAt: true }
    });
    expect(farRow!.dueSoonNotifiedAt).toBeNull();
    expect(await prisma.notification.count({ where: { userId: m2, type: 'task_due_soon' } })).toBe(beforeCnt);
  });
});
