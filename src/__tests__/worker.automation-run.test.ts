import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';

const { createNotification, deliverNotificationToUser } = vi.hoisted(() => ({
  createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
  deliverNotificationToUser: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser }));

const { runCreateTask, runNotify, runSendMessage } = vi.hoisted(() => ({
  runCreateTask: vi.fn(),
  runNotify: vi.fn(),
  runSendMessage: vi.fn(),
}));
vi.mock('@/lib/automation/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/automation/actions')>();
  return { ...actual, runCreateTask, runNotify, runSendMessage };
});

const { logError, logInfo } = vi.hoisted(() => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, info: logInfo, warn: vi.fn() } }));

import { runAutomationRule } from '@/worker/processors/automation-run';

/**
 * Исполнение правила (`У-223`, `У-227`).
 *
 * Три обязательства и все краевые пути:
 *  1. повторная доставка события НЕ создаёт вторую задачу;
 *  2. сбой действия не валит джоб и записывается в журнал;
 *  3. сломанное правило выключается и сообщает о себе.
 */

const ruleFindUnique = vi.fn();
const runCreate = vi.fn();
const runUpdate = vi.fn();
const ruleUpdate = vi.fn();
const userFindMany = vi.fn();

const prisma = {
  automationRule: { findUnique: ruleFindUnique, update: ruleUpdate },
  automationRun: { create: runCreate, update: runUpdate },
  user: { findMany: userFindMany },
} as unknown as PrismaClient;

const RULE = {
  id: 'r1',
  name: 'Счёт выставлен',
  companyId: 'co-1',
  isActive: true,
  actions: [
    {
      kind: 'create_task',
      titleTemplate: 'Проверить оплату по счёту {{document.number}}',
      assignee: 'responsible_manager',
      dueInDays: 5,
    },
  ],
  createdById: 'u-author',
  updatedBy: null,
};

const JOB = {
  ruleId: 'r1',
  eventId: 'ev-1',
  companyId: 'co-1',
  payload: { documentNumber: 'С-2026-17' },
};

const P2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
  code: 'P2002',
  clientVersion: '5.0.0',
});

beforeEach(() => {
  vi.clearAllMocks();
  ruleFindUnique.mockResolvedValue(RULE);
  runCreate.mockResolvedValue({ id: 'run1' });
  runCreateTask.mockResolvedValue({ createdTaskIds: ['t1'], notifiedUserIds: [], error: null });
  runNotify.mockResolvedValue({ createdTaskIds: [], notifiedUserIds: ['u2'], error: null });
  runSendMessage.mockReturnValue({ createdTaskIds: [], notifiedUserIds: [], error: 'не включено' });
  userFindMany.mockResolvedValue([{ id: 'boss' }]);
});

describe('runAutomationRule — когда не исполняем', () => {
  it('правило удалено', async () => {
    ruleFindUnique.mockResolvedValue(null);
    expect(await runAutomationRule(prisma, JOB)).toEqual({
      status: 'skipped',
      reason: 'правило удалено',
    });
    expect(runCreate).not.toHaveBeenCalled();
  });

  it('правило выключили, пока событие лежало в очереди', async () => {
    ruleFindUnique.mockResolvedValue({ ...RULE, isActive: false });
    expect((await runAutomationRule(prisma, JOB)).status).toBe('skipped');
    expect(runCreateTask).not.toHaveBeenCalled();
  });

  it('СОБЫТИЕ ЧУЖОЙ КОМПАНИИ не исполняется и попадает в лог как происшествие', async () => {
    ruleFindUnique.mockResolvedValue({ ...RULE, companyId: 'co-2' });
    const res = await runAutomationRule(prisma, JOB);
    expect(res).toEqual({ status: 'skipped', reason: 'событие чужой компании' });
    expect(logError).toHaveBeenCalled();
    expect(runCreate).not.toHaveBeenCalled();
  });

  it('ПОВТОРНАЯ ДОСТАВКА того же события не создаёт вторую задачу', async () => {
    runCreate.mockRejectedValue(P2002);
    const res = await runAutomationRule(prisma, JOB);
    expect(res).toEqual({ status: 'skipped', reason: 'событие уже отработано' });
    expect(runCreateTask).not.toHaveBeenCalled();
  });

  it('не-P2002 из журнала пробрасывается — это настоящая поломка базы', async () => {
    runCreate.mockRejectedValue(new Error('диск кончился'));
    await expect(runAutomationRule(prisma, JOB)).rejects.toThrow('диск кончился');
  });
});

describe('runAutomationRule — исполнение', () => {
  it('заявка в журнал создаётся ДО действий — иначе повтор проскочит', async () => {
    await runAutomationRule(prisma, JOB);
    expect(runCreate).toHaveBeenCalledTimes(1);
    expect(runCreate.mock.calls[0][0].data).toMatchObject({
      ruleId: 'r1',
      eventId: 'ev-1',
      companyId: 'co-1',
    });
    expect(runCreateTask).toHaveBeenCalled();
  });

  it('успех: журнал получает созданные задачи и статус ok', async () => {
    const res = await runAutomationRule(prisma, JOB);
    expect(res).toEqual({ status: 'ok' });
    expect(runUpdate.mock.calls[0][0].data).toMatchObject({
      status: 'ok',
      error: null,
      createdTaskIds: ['t1'],
    });
  });

  it('автор задачи — человек, включивший правило (`Р-Э4-4`)', async () => {
    await runAutomationRule(prisma, JOB);
    expect(runCreateTask.mock.calls[0][1].authorId).toBe('u-author');
  });

  it('у встроенного правила без автора задача не создаётся, и это записано', async () => {
    ruleFindUnique.mockResolvedValue({ ...RULE, createdById: null, updatedBy: null });
    const res = await runAutomationRule(prisma, JOB);
    expect(res.status).toBe('failed');
    expect(runUpdate.mock.calls[0][0].data.error).toContain('нет автора');
    expect(runCreateTask).not.toHaveBeenCalled();
  });

  it('СБОЙ действия не роняет джоб и попадает в журнал', async () => {
    runCreateTask.mockRejectedValue(new Error('колонок нет'));
    const res = await runAutomationRule(prisma, JOB);
    expect(res.status).toBe('failed');
    expect(runUpdate.mock.calls[0][0].data.error).toContain('колонок нет');
    expect(logError).toHaveBeenCalled();
  });

  it('одно действие упало — соседнее всё равно выполняется', async () => {
    ruleFindUnique.mockResolvedValue({
      ...RULE,
      actions: [
        RULE.actions[0],
        { kind: 'notify', audience: 'role:leader', template: 'Смотри почту' },
      ],
    });
    runCreateTask.mockRejectedValue(new Error('колонок нет'));
    const res = await runAutomationRule(prisma, JOB);
    expect(res.status).toBe('failed');
    expect(runNotify).toHaveBeenCalled();
    expect(runUpdate.mock.calls[0][0].data.notifiedUserIds).toEqual(['u2']);
  });

  it('СЛОМАННОЕ правило выключается и сообщает о себе (§9 пакета)', async () => {
    ruleFindUnique.mockResolvedValue({ ...RULE, actions: { мусор: true } });
    const res = await runAutomationRule(prisma, JOB);
    expect(res.status).toBe('failed');
    expect(ruleUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: 'r1' },
      data: { isActive: false },
    });
    // Получатели — руководители компании и администраторы.
    expect(createNotification.mock.calls[0][0].type).toBe('automation_failed');
    expect(deliverNotificationToUser).toHaveBeenCalled();
  });

  it('сбой самого выключения не роняет джоб', async () => {
    ruleFindUnique.mockResolvedValue({ ...RULE, actions: null });
    ruleUpdate.mockRejectedValue(new Error('база занята'));
    const res = await runAutomationRule(prisma, JOB);
    expect(res.status).toBe('failed');
    expect(logError).toHaveBeenCalled();
  });

  it('действие «написать клиенту» пока честно отказывает, а не делает вид', async () => {
    ruleFindUnique.mockResolvedValue({
      ...RULE,
      actions: [{ kind: 'send_message', channel: 'email', template: 'Добрый день' }],
    });
    const res = await runAutomationRule(prisma, JOB);
    expect(res.status).toBe('failed');
    expect(runUpdate.mock.calls[0][0].data.error).toContain('не включено');
  });
});
