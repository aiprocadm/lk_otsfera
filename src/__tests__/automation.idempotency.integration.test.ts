import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runAutomationRule } from '@/worker/processors/automation-run';

/**
 * СТРАЖ `У-227` на живой базе: повторная доставка события НЕ создаёт вторую
 * задачу.
 *
 * Моками это не проверить по-настоящему: гарантию даёт уникальный ключ
 * `AutomationRun(ruleId, eventId)` в самой базе, а не наша ветка `if`. BullMQ
 * доставляет задачу повторно при ретрае и при перезапуске воркера — это
 * штатное поведение очереди, а не редкий сбой.
 *
 * Здесь же проверяется сквозной путь: правило действительно создаёт задачу с
 * правильным автором, исполнителем, сроком и пометкой «создана правилом».
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyId: string;
let authorId: string;
let managerId: string;
let ruleId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `auto-${STAMP}` } })).id;
  authorId = (
    await prisma.user.create({
      data: { email: `auto-a-${STAMP}@t.local`, name: 'Автор', role: 'leader', companyId },
    })
  ).id;
  managerId = (
    await prisma.user.create({
      data: { email: `auto-m-${STAMP}@t.local`, name: 'Менеджер', role: 'manager', companyId },
    })
  ).id;
  ruleId = (
    await prisma.automationRule.create({
      data: {
        companyId,
        name: `Счёт выставлен ${STAMP}`,
        isActive: true,
        trigger: 'document_issued',
        conditions: {},
        actions: [
          {
            kind: 'create_task',
            titleTemplate: 'Проверить оплату по счёту {{document.number}}',
            assignee: 'responsible_manager',
            dueInDays: 5,
          },
        ],
        createdById: authorId,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [authorId, managerId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [authorId, managerId] } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { companyId } } });
  await prisma.task.deleteMany({ where: { companyId } });
  await prisma.automationRun.deleteMany({ where: { companyId } });
  await prisma.automationRule.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { id: { in: [authorId, managerId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

const job = (eventId: string) => ({
  ruleId,
  eventId,
  companyId,
  payload: { documentNumber: `С-${STAMP}`, responsibleManagerId: managerId },
});

describe('идемпотентность правил на живой базе (`У-227`)', () => {
  it('первое событие создаёт РОВНО ОДНУ задачу с верным автором, исполнителем и сроком', async () => {
    const res = await runAutomationRule(prisma, job('ev-1'));
    expect(res.status).toBe('ok');

    const tasks = await prisma.task.findMany({
      where: { companyId, createdByRuleId: ruleId },
      include: { assignees: true },
    });
    expect(tasks).toHaveLength(1);
    const task = tasks[0]!;
    expect(task.title).toBe(`Проверить оплату по счёту С-${STAMP}`);
    // Автор — человек, включивший правило (`Р-Э4-4`): системную сессию не
    // подделывали, и задача не «ничья».
    expect(task.createdById).toBe(authorId);
    expect(task.assignees.map((a) => a.userId)).toEqual([managerId]);
    expect(task.dueDate).not.toBeNull();
    // Срок ровно через пять дней, а не «когда-нибудь».
    const days = Math.round((task.dueDate!.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(5);
  });

  it('ПОВТОРНАЯ доставка того же события не создаёт вторую задачу', async () => {
    const res = await runAutomationRule(prisma, job('ev-1'));
    expect(res).toEqual({ status: 'skipped', reason: 'событие уже отработано' });

    const count = await prisma.task.count({ where: { companyId, createdByRuleId: ruleId } });
    expect(count).toBe(1);
    // И в журнале по-прежнему одна запись — вторую уникальный ключ не пустил.
    expect(await prisma.automationRun.count({ where: { ruleId, eventId: 'ev-1' } })).toBe(1);
  });

  it('ДРУГОЕ событие того же правила задачу создаёт — ключ по паре, а не по правилу', async () => {
    const res = await runAutomationRule(prisma, job('ev-2'));
    expect(res.status).toBe('ok');
    expect(await prisma.task.count({ where: { companyId, createdByRuleId: ruleId } })).toBe(2);
  });

  it('журнал срабатываний хранит результат: статус и созданные задачи', async () => {
    const run = await prisma.automationRun.findFirstOrThrow({
      where: { ruleId, eventId: 'ev-2' },
    });
    expect(run.status).toBe('ok');
    expect(run.error).toBeNull();
    expect(run.createdTaskIds).toHaveLength(1);
  });

  it('выключенное правило не срабатывает, даже если событие дошло', async () => {
    await prisma.automationRule.update({ where: { id: ruleId }, data: { isActive: false } });
    const res = await runAutomationRule(prisma, job('ev-3'));
    expect(res).toEqual({ status: 'skipped', reason: 'правило выключено' });
    expect(await prisma.task.count({ where: { companyId, createdByRuleId: ruleId } })).toBe(2);
    await prisma.automationRule.update({ where: { id: ruleId }, data: { isActive: true } });
  });
});
