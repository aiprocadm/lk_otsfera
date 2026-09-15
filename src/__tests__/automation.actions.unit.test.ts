import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { createNotification, deliverNotificationToUser } = vi.hoisted(() => ({
  createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
  deliverNotificationToUser: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser }));

const { createTaskCore } = vi.hoisted(() => ({
  createTaskCore: vi.fn().mockResolvedValue({ id: 't1', title: 'T', dueDate: null }),
}));
vi.mock('@/lib/services/tasks/tasks', () => ({ createTaskCore }));

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: vi.fn(), info: vi.fn() } }));

import {
  resolveRecipients,
  runCreateTask,
  runNotify,
  runSendMessage,
  checkActionTemplates,
  actionsSchema,
} from '@/lib/automation/actions';
import { matchesConditions, conditionsSchema } from '@/lib/automation/conditions';
import { renderAutomationText, checkAutomationPlaceholders } from '@/lib/automation/templates';

/**
 * Действия и условия правил (`У-222`, `У-223`).
 *
 * Отдельно проверяется `Р-Э4-5` — правило выбора исполнителя. Он важнее, чем
 * кажется: задача без исполнителя на общей доске теряется, а робот, который
 * молча ничего не сделал, хуже отсутствующего.
 */

const userFindFirst = vi.fn();
const userFindMany = vi.fn();
const columnFindMany = vi.fn();
const prisma = {
  user: { findFirst: userFindFirst, findMany: userFindMany },
  taskColumn: { findMany: columnFindMany },
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  userFindFirst.mockResolvedValue({ id: 'm1' });
  userFindMany.mockResolvedValue([{ id: 'boss' }]);
  columnFindMany.mockResolvedValue([]);
  createTaskCore.mockResolvedValue({ id: 't1', title: 'T', dueDate: null });
});

describe('resolveRecipients — кому достанется (`Р-Э4-5`)', () => {
  it('ответственный менеджер объекта — первый выбор', async () => {
    const r = await resolveRecipients(prisma, {
      companyId: 'co-1',
      target: 'responsible_manager',
      payload: { responsibleManagerId: 'm1' },
    });
    expect(r).toEqual({ userIds: ['m1'], note: null });
  });

  it('ответственного нет → РУКОВОДИТЕЛИ, и это записано в пометке', async () => {
    const r = await resolveRecipients(prisma, {
      companyId: 'co-1',
      target: 'responsible_manager',
      payload: {},
    });
    expect(r.userIds).toEqual(['boss']);
    expect(r.note).toContain('нет ответственного');
  });

  it('ответственный уволен → тоже руководители, а не письмо в пустоту', async () => {
    userFindFirst.mockResolvedValue(null);
    const r = await resolveRecipients(prisma, {
      companyId: 'co-1',
      target: 'responsible_manager',
      payload: { responsibleManagerId: 'уволенный' },
    });
    expect(r.userIds).toEqual(['boss']);
  });

  it('нет ни ответственного, ни руководителей → пусто, но с объяснением', async () => {
    userFindMany.mockResolvedValue([]);
    const r = await resolveRecipients(prisma, {
      companyId: 'co-1',
      target: 'responsible_manager',
      payload: {},
    });
    expect(r.userIds).toEqual([]);
    expect(r.note).toContain('руководителей в компании нет');
  });

  it('конкретный сотрудник ЧУЖОЙ компании не получает ничего', async () => {
    userFindFirst.mockResolvedValue(null);
    const r = await resolveRecipients(prisma, {
      companyId: 'co-1',
      target: 'user:чужой',
      payload: {},
    });
    expect(r).toEqual({ userIds: [], note: 'сотрудник не найден' });
    // Граница компании стоит в самом запросе, а не в проверке после.
    expect(userFindFirst.mock.calls[0][0].where.companyId).toBe('co-1');
  });

  it('роль «руководитель» без руководителей — честная пометка', async () => {
    userFindMany.mockResolvedValue([]);
    const r = await resolveRecipients(prisma, {
      companyId: 'co-1',
      target: 'role:leader',
      payload: {},
    });
    expect(r.note).toContain('нет руководителя');
  });
});

describe('runCreateTask', () => {
  it('подставляет значения в название и связывает задачу с объектами события', async () => {
    const res = await runCreateTask(prisma, {
      action: {
        kind: 'create_task',
        titleTemplate: 'Проверить оплату по счёту {{document.number}}',
        assignee: 'responsible_manager',
        dueInDays: 5,
      },
      companyId: 'co-1',
      ruleId: 'r1',
      authorId: 'u-author',
      payload: {
        documentNumber: 'С-2026-17',
        documentId: 'd1',
        orderId: 'ord1',
        responsibleManagerId: 'm1',
      },
    });
    expect(res.createdTaskIds).toEqual(['t1']);
    const data = createTaskCore.mock.calls[0][1];
    expect(data.title).toBe('Проверить оплату по счёту С-2026-17');
    expect(data.createdById).toBe('u-author');
    expect(data.createdByRuleId).toBe('r1');
    expect(data.linkedDocumentId).toBe('d1');
    expect(data.linkedOrderId).toBe('ord1');
    expect(data.assigneeIds).toEqual(['m1']);
    expect(data.dueDate).toBeInstanceOf(Date);
  });

  it('без срока — задача без срока, а не «сегодня»', async () => {
    await runCreateTask(prisma, {
      action: { kind: 'create_task', titleTemplate: 'Дело', assignee: 'role:leader' },
      companyId: 'co-1',
      ruleId: 'r1',
      authorId: 'u',
      payload: {},
    });
    expect(createTaskCore.mock.calls[0][1].dueDate).toBeNull();
  });

  it('задача БЕЗ исполнителя создаётся, но журнал об этом говорит', async () => {
    userFindMany.mockResolvedValue([]);
    const res = await runCreateTask(prisma, {
      action: { kind: 'create_task', titleTemplate: 'Дело', assignee: 'responsible_manager' },
      companyId: 'co-1',
      ruleId: 'r1',
      authorId: 'u',
      payload: {},
    });
    // Задача есть — она видна на доске в «Без исполнителя», а не исчезла.
    expect(res.createdTaskIds).toEqual(['t1']);
    expect(res.error).toContain('без исполнителя');
    // И человек увидит причину прямо в описании задачи.
    expect(createTaskCore.mock.calls[0][1].description).toContain('нет ответственного');
  });
});

describe('runNotify', () => {
  it('шлёт всем получателям и записывает, кому дошло', async () => {
    userFindMany.mockResolvedValue([{ id: 'boss' }, { id: 'boss2' }]);
    const res = await runNotify(prisma, {
      action: { kind: 'notify', audience: 'role:leader', template: 'Смотри {{order.number}}' },
      companyId: 'co-1',
      ruleName: 'Правило',
      payload: { orderNumber: '17' },
    });
    expect(res.notifiedUserIds).toEqual(['boss', 'boss2']);
    expect(createNotification.mock.calls[0][0].body).toBe('Смотри 17');
    expect(createNotification.mock.calls[0][0].type).toBe('automation_notice');
  });

  it('некому слать — честный отказ в журнал', async () => {
    userFindMany.mockResolvedValue([]);
    const res = await runNotify(prisma, {
      action: { kind: 'notify', audience: 'role:leader', template: 'Текст' },
      companyId: 'co-1',
      ruleName: 'Правило',
      payload: {},
    });
    expect(res.error).toContain('некому отправить');
  });

  it('один недоступный получатель не отменяет рассылку остальным', async () => {
    userFindMany.mockResolvedValue([{ id: 'boss' }, { id: 'boss2' }]);
    createNotification.mockRejectedValueOnce(new Error('почта легла'));
    const res = await runNotify(prisma, {
      action: { kind: 'notify', audience: 'role:leader', template: 'Текст' },
      companyId: 'co-1',
      ruleName: 'Правило',
      payload: {},
    });
    expect(res.notifiedUserIds).toEqual(['boss2']);
    expect(logError).toHaveBeenCalled();
  });
});

describe('runSendMessage', () => {
  it('пока честно отказывает, а не делает вид, что отправил', () => {
    expect(runSendMessage().error).toContain('ещё не включена');
  });
});

describe('условия и подстановки', () => {
  it('неизвестное поле условия не сохраняется', () => {
    expect(conditionsSchema.safeParse({ такогоНет: 1 }).success).toBe(false);
  });

  it('неизвестная сумма — это НЕ совпадение: робота на «не знаю» не запускаем', () => {
    expect(matchesConditions({ amountGte: 100 }, {})).toBe(false);
    expect(matchesConditions({ amountGte: 100 }, { amount: 50 })).toBe(false);
    expect(matchesConditions({ amountGte: 100 }, { amount: 100 })).toBe(true);
  });

  it('пустые условия совпадают со всем', () => {
    expect(matchesConditions({}, {})).toBe(true);
  });

  it.each([
    [{ organizationIdIn: ['o1'] }, { organizationId: 'o1' }, true],
    [{ organizationIdIn: ['o1'] }, { organizationId: 'o2' }, false],
    [{ organizationIdIn: ['o1'] }, {}, false],
    [{ hasPartner: true }, { partnerId: 'p1' }, true],
    [{ hasPartner: true }, {}, false],
    [{ hasPartner: false }, {}, true],
    [{ source: 'website' }, { source: 'website' }, true],
    [{ source: 'website' }, { source: 'cabinet' }, false],
    [{ toStatus: 'paid' }, { toStatus: 'paid' }, true],
    [{ toStatus: 'paid' }, { toStatus: 'new' }, false],
  ])('условие %o против %o → %s', (cond, payload, expected) => {
    expect(matchesConditions(cond, payload)).toBe(expected);
  });

  it('неизвестная подстановка — отказ сохранить правило', () => {
    const res = checkAutomationPlaceholders('Счёт {{order.nomer}}');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.unknown).toContain('order.nomer');
  });

  it('известная подстановка проходит, а отсутствующие данные дают прочерк', () => {
    expect(checkAutomationPlaceholders('Счёт {{document.number}}').ok).toBe(true);
    expect(renderAutomationText('Счёт {{document.number}}', {})).toBe('Счёт —');
  });

  it('checkActionTemplates смотрит ВСЕ тексты действия, а не только название', () => {
    const res = checkActionTemplates([
      {
        kind: 'create_task',
        titleTemplate: 'Ок {{order.number}}',
        descriptionTemplate: 'Плохо {{выдумка}}',
        assignee: 'role:leader',
      },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.unknown).toContain('выдумка');
  });

  it('форма действий: пустой список и неизвестное действие отвергаются', () => {
    expect(actionsSchema.safeParse([]).success).toBe(false);
    expect(actionsSchema.safeParse([{ kind: 'удалить_всё' }]).success).toBe(false);
  });
});
