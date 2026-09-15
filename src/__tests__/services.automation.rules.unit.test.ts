import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  listAutomationRules,
  createAutomationRule,
  updateAutomationRule,
  toggleAutomationRule,
  deleteAutomationRule,
  listAutomationRuns,
} from '@/lib/services/automation/rules';

/**
 * Правила автоматизации — чтение и правка (`У-222`, `У-224`).
 *
 * Сервис намеренно ничего не знает про кабинеты: `companyId` приходит готовым
 * от server-action, который выбрал его по роли. Поэтому здесь проверяется, что
 * граница компании стоит В САМОМ ЗАПРОСЕ — чужое правило должно быть
 * неотличимо от несуществующего, а не отсеиваться проверкой после выборки.
 */

const findMany = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const del = vi.fn();
const runFindMany = vi.fn();

const prisma = {
  automationRule: { findMany, findFirst, create, update, delete: del },
  automationRun: { findMany: runFindMany },
} as unknown as PrismaClient;

const VALID = {
  name: 'Счёт выставлен',
  trigger: 'document_issued',
  actions: [
    {
      kind: 'create_task' as const,
      titleTemplate: 'Проверить оплату по счёту {{document.number}}',
      assignee: 'responsible_manager',
      dueInDays: 5,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 'r1' });
  findFirst.mockResolvedValue({ id: 'r1', createdById: 'u-author', isBuiltin: false });
});

describe('listAutomationRules', () => {
  it('переводит событие на русский и считает срабатывания', async () => {
    findMany.mockResolvedValue([
      {
        id: 'r1',
        name: 'Счёт',
        isActive: true,
        isBuiltin: true,
        trigger: 'document_issued',
        conditions: {},
        actions: VALID.actions,
        updatedAt: new Date('2026-09-15'),
        _count: { runs: 3 },
        runs: [{ createdAt: new Date('2026-09-14'), status: 'ok' }],
      },
    ]);
    const rows = await listAutomationRules(prisma, 'co-1');
    expect(findMany.mock.calls[0][0].where).toEqual({ companyId: 'co-1' });
    expect(rows[0]).toMatchObject({
      triggerLabel: 'Документ выставлен',
      runsTotal: 3,
      lastRunStatus: 'ok',
    });
  });

  it('ИСЧЕЗНУВШЕЕ событие показывается как есть, а не пустотой', async () => {
    // Правило могли сохранить, когда событие ещё было в каталоге. Человек
    // должен видеть, что правило ссылается в никуда, — иначе оно молча не
    // работает, а на экране выглядит исправным.
    findMany.mockResolvedValue([
      {
        id: 'r1',
        name: 'Старое',
        isActive: false,
        isBuiltin: false,
        trigger: 'такого_события_нет',
        conditions: {},
        actions: [],
        updatedAt: new Date(),
        _count: { runs: 0 },
        runs: [],
      },
    ]);
    const rows = await listAutomationRules(prisma, 'co-1');
    expect(rows[0]?.triggerLabel).toContain('Неизвестное событие');
    expect(rows[0]?.lastRunAt).toBeNull();
  });

  it('нечитаемые действия не роняют список — правило видно, чтобы его можно было починить', async () => {
    findMany.mockResolvedValue([
      {
        id: 'r1',
        name: 'Сломанное',
        isActive: false,
        isBuiltin: false,
        trigger: 'document_issued',
        conditions: { мусор: 1 },
        actions: { мусор: true },
        updatedAt: new Date(),
        _count: { runs: 0 },
        runs: [],
      },
    ]);
    const rows = await listAutomationRules(prisma, 'co-1');
    expect(rows[0]?.actions).toEqual([]);
    expect(rows[0]?.conditions).toEqual({});
  });
});

describe('createAutomationRule', () => {
  it('создаёт правило ВЫКЛЮЧЕННЫМ и записывает автора', async () => {
    const res = await createAutomationRule(prisma, {
      companyId: 'co-1',
      authorId: 'u-author',
      input: VALID,
    });
    expect(res).toEqual({ ok: true, id: 'r1' });
    expect(create.mock.calls[0][0].data).toMatchObject({
      companyId: 'co-1',
      isActive: false,
      createdById: 'u-author',
    });
  });

  it('НЕИЗВЕСТНАЯ ПОДСТАНОВКА — отказ сохранить, а не пустота в готовой задаче', async () => {
    const res = await createAutomationRule(prisma, {
      companyId: 'co-1',
      authorId: 'u',
      input: {
        ...VALID,
        actions: [{ ...VALID.actions[0]!, titleTemplate: 'Счёт {{order.nomer}}' }],
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидали отказ');
    expect(res.error).toBe('unknown_placeholder');
    expect(res.unknown).toContain('order.nomer');
    expect(create).not.toHaveBeenCalled();
  });

  it('несуществующее событие — отказ', async () => {
    const res = await createAutomationRule(prisma, {
      companyId: 'co-1',
      authorId: 'u',
      input: { ...VALID, trigger: 'выдуманное' },
    });
    expect(res).toMatchObject({ ok: false, error: 'unknown_trigger' });
  });

  it('пустое название или пустой список действий — отказ', async () => {
    expect(
      (
        await createAutomationRule(prisma, {
          companyId: 'co-1',
          authorId: 'u',
          input: { ...VALID, name: '  ' },
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await createAutomationRule(prisma, {
          companyId: 'co-1',
          authorId: 'u',
          input: { ...VALID, actions: [] },
        })
      ).ok
    ).toBe(false);
  });
});

describe('updateAutomationRule', () => {
  it('ЧУЖОЕ правило неотличимо от несуществующего — граница в запросе', async () => {
    findFirst.mockResolvedValue(null);
    const res = await updateAutomationRule(prisma, {
      companyId: 'co-1',
      authorId: 'u',
      ruleId: 'чужое',
      input: VALID,
    });
    expect(res).toMatchObject({ ok: false, error: 'not_found' });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'чужое', companyId: 'co-1' });
    expect(update).not.toHaveBeenCalled();
  });

  it('встроенное правило править МОЖНО — текст правил из коробки правится (`У-224`)', async () => {
    findFirst.mockResolvedValue({ id: 'r1' });
    const res = await updateAutomationRule(prisma, {
      companyId: 'co-1',
      authorId: 'u',
      ruleId: 'r1',
      input: VALID,
    });
    expect(res.ok).toBe(true);
  });
});

describe('toggleAutomationRule', () => {
  it('ВКЛЮЧЕНИЕ записывает автора, если его не было — иначе задачу создать некому', async () => {
    findFirst.mockResolvedValue({ id: 'r1', createdById: null });
    await toggleAutomationRule(prisma, {
      companyId: 'co-1',
      authorId: 'u-boss',
      ruleId: 'r1',
      isActive: true,
    });
    expect(update.mock.calls[0][0].data).toMatchObject({ isActive: true, createdById: 'u-boss' });
  });

  it('у правила с автором автор НЕ переписывается', async () => {
    findFirst.mockResolvedValue({ id: 'r1', createdById: 'u-first' });
    await toggleAutomationRule(prisma, {
      companyId: 'co-1',
      authorId: 'u-second',
      ruleId: 'r1',
      isActive: true,
    });
    expect(update.mock.calls[0][0].data.createdById).toBeUndefined();
  });

  it('выключение автора не трогает вовсе', async () => {
    findFirst.mockResolvedValue({ id: 'r1', createdById: null });
    await toggleAutomationRule(prisma, {
      companyId: 'co-1',
      authorId: 'u',
      ruleId: 'r1',
      isActive: false,
    });
    expect(update.mock.calls[0][0].data.createdById).toBeUndefined();
  });

  it('чужое правило — not_found', async () => {
    findFirst.mockResolvedValue(null);
    expect(
      await toggleAutomationRule(prisma, {
        companyId: 'co-1',
        authorId: 'u',
        ruleId: 'x',
        isActive: true,
      })
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('deleteAutomationRule', () => {
  it('ПРАВИЛО ИЗ КОРОБКИ не удаляется — его выключают', async () => {
    findFirst.mockResolvedValue({ id: 'r1', isBuiltin: true });
    const res = await deleteAutomationRule(prisma, { companyId: 'co-1', ruleId: 'r1' });
    expect(res).toEqual({ ok: false, error: 'builtin' });
    expect(del).not.toHaveBeenCalled();
  });

  it('своё правило удаляется', async () => {
    findFirst.mockResolvedValue({ id: 'r1', isBuiltin: false });
    expect(await deleteAutomationRule(prisma, { companyId: 'co-1', ruleId: 'r1' })).toEqual({
      ok: true,
    });
  });

  it('чужое — not_found', async () => {
    findFirst.mockResolvedValue(null);
    expect(await deleteAutomationRule(prisma, { companyId: 'co-1', ruleId: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('listAutomationRuns', () => {
  it('журнал своей компании, свежее сверху, с числом созданного', async () => {
    runFindMany.mockResolvedValue([
      {
        id: 'run1',
        createdAt: new Date('2026-09-15'),
        status: 'ok',
        error: null,
        createdTaskIds: ['t1', 't2'],
        notifiedUserIds: ['u1'],
        rule: { name: 'Счёт' },
      },
    ]);
    const rows = await listAutomationRuns(prisma, 'co-1');
    expect(runFindMany.mock.calls[0][0].where).toEqual({ companyId: 'co-1' });
    expect(runFindMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(rows[0]).toMatchObject({ ruleName: 'Счёт', createdTasks: 2, notified: 1 });
  });
});
