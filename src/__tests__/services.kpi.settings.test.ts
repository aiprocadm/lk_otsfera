import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  copyTargetsFromPreviousMonth,
  getKpiSettings,
  setActiveMetrics,
  upsertKpiTarget,
} from '@/lib/services/kpi/settings';

/** Настройка показателей и планов (`У-242`, этап 7). */
const LEADER = { sub: 'l1', role: 'leader', companyId: 'c1' } as unknown as SessionPayload;
const MANAGER = { sub: 'm1', role: 'manager', companyId: 'c1' } as unknown as SessionPayload;
const D = (v: string) => new Prisma.Decimal(v);

function db(over: Record<string, unknown> = {}) {
  const prisma = {
    company: {
      findUnique: vi.fn(async () => ({ activeKpiMetrics: [] })),
      update: vi.fn(async () => ({})),
    },
    user: {
      findMany: vi.fn(async () => [
        { id: 'u1', name: 'Иванов', email: 'i@x', isActive: true },
        { id: 'u2', name: '', email: 'p@x', isActive: false },
      ]),
      findUnique: vi.fn(async () => ({ companyId: 'c1' })),
    },
    salesTarget: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    ...over,
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma as any };
}

beforeEach(() => vi.clearAllMocks());

describe('getKpiSettings', () => {
  it('рядовому менеджеру — отказ, без похода в базу', async () => {
    const { prisma, raw } = db();
    expect(await getKpiSettings(prisma, MANAGER, { year: 2026, month: 9 })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(raw.company.findUnique).not.toHaveBeenCalled();
  });

  it('руководителю — реестр, свои менеджеры и планы; уволенный виден', async () => {
    const { prisma } = db({
      salesTarget: {
        findMany: vi.fn(async () => [
          { managerId: 'u1', metric: 'revenue_paid', targetAmount: D('1000') },
          { managerId: null, metric: 'certificates_issued', targetAmount: D('50') },
        ]),
      },
    });
    const res = await getKpiSettings(prisma, LEADER, { year: 2026, month: 9 });
    if (!res.ok) throw new Error('ожидался ok');
    expect(res.view.available.length).toBe(10);
    // Пустой набор — прежнее поведение: один показатель.
    expect(res.view.active).toEqual(['revenue_paid']);
    expect(res.view.managers[1]).toEqual({ id: 'u2', name: 'p@x', isActive: false });
    expect(res.view.targets['revenue_paid:u1']).toBe('1000.00');
    // План компании лежит под ключом без хвоста — иначе не нашёлся бы.
    expect(res.view.targets['certificates_issued:']).toBe('50.00');
  });
});

describe('setActiveMetrics', () => {
  it('сохраняет выбор и пишет в журнал, что было и что стало', async () => {
    const { prisma, raw } = db();
    expect(await setActiveMetrics(prisma, LEADER, ['revenue_paid', 'deals_won'])).toEqual({
      ok: true,
    });
    expect(raw.company.update.mock.calls[0][0].data.activeKpiMetrics).toEqual([
      'revenue_paid',
      'deals_won',
    ]);
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'kpi_metrics_changed' })
    );
  });

  it('незнакомый ключ, повтор и перебор — отказ с разными кодами', async () => {
    const { prisma, raw } = db();
    expect(await setActiveMetrics(prisma, LEADER, ['выдуманный'])).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await setActiveMetrics(prisma, LEADER, ['deals_won', 'deals_won'])).toEqual({
      ok: false,
      error: 'invalid',
    });
    const nine = [
      'revenue_paid',
      'orders_created',
      'leads_created',
      'proposals_sent',
      'deals_won',
      'calls_outbound',
      'dialogs_answered',
      'avg_first_response_min',
      'tasks_overdue',
    ];
    expect(await setActiveMetrics(prisma, LEADER, nine)).toEqual({ ok: false, error: 'too_many' });
    expect(raw.company.update).not.toHaveBeenCalled();
  });
});

describe('upsertKpiTarget', () => {
  it('новый план создаётся, существующий правится', async () => {
    const { prisma, raw } = db();
    expect(
      await upsertKpiTarget(prisma, LEADER, {
        metric: 'revenue_paid',
        managerId: 'u1',
        year: 2026,
        month: 9,
        amount: '1500',
      })
    ).toEqual({ ok: true });
    expect(raw.salesTarget.create.mock.calls[0][0].data.metric).toBe('revenue_paid');

    raw.salesTarget.findFirst.mockResolvedValueOnce({ id: 't1' });
    await upsertKpiTarget(prisma, LEADER, {
      metric: 'revenue_paid',
      managerId: 'u1',
      year: 2026,
      month: 9,
      amount: '2000',
    });
    expect(raw.salesTarget.update.mock.calls[0][0].where).toEqual({ id: 't1' });
  });

  it('пустое значение убирает план, а не ставит ноль', async () => {
    const { prisma, raw } = db();
    await upsertKpiTarget(prisma, LEADER, {
      metric: 'revenue_paid',
      managerId: 'u1',
      year: 2026,
      month: 9,
      amount: null,
    });
    expect(raw.salesTarget.deleteMany).toHaveBeenCalled();
    expect(raw.salesTarget.create).not.toHaveBeenCalled();
  });

  it('показателю без ответственного план по менеджеру не ставится', async () => {
    const { prisma, raw } = db();
    expect(
      await upsertKpiTarget(prisma, LEADER, {
        metric: 'certificates_issued',
        managerId: 'u1',
        year: 2026,
        month: 9,
        amount: '10',
      })
    ).toEqual({ ok: false, error: 'invalid' });
    expect(raw.salesTarget.create).not.toHaveBeenCalled();
  });

  it('чужой сотрудник — отказ; мусор в сумме — отказ', async () => {
    const { prisma, raw } = db();
    raw.user.findUnique.mockResolvedValueOnce({ companyId: 'другая' });
    expect(
      await upsertKpiTarget(prisma, LEADER, {
        metric: 'revenue_paid',
        managerId: 'чужой',
        year: 2026,
        month: 9,
        amount: '100',
      })
    ).toEqual({ ok: false, error: 'forbidden' });

    for (const bad of ['NaN', '-5', '0', 'не число']) {
      expect(
        await upsertKpiTarget(prisma, LEADER, {
          metric: 'revenue_paid',
          managerId: 'u1',
          year: 2026,
          month: 9,
          amount: bad,
        }),
        `«${bad}» приняли как план`
      ).toEqual({ ok: false, error: 'invalid' });
    }
  });
});

describe('copyTargetsFromPreviousMonth', () => {
  it('копирует только то, чего ещё нет — заданное вручную не перетирается', async () => {
    const { prisma, raw } = db({
      salesTarget: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { managerId: 'u1', metric: 'revenue_paid', targetAmount: D('1000') },
            { managerId: 'u2', metric: 'revenue_paid', targetAmount: D('2000') },
          ])
          .mockResolvedValueOnce([{ managerId: 'u1', metric: 'revenue_paid' }]),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    });
    const res = await copyTargetsFromPreviousMonth(prisma, LEADER, { year: 2026, month: 9 });
    expect(res).toEqual({ ok: true, copied: 1 });
    const data = raw.salesTarget.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].managerId).toBe('u2');
  });

  it('план на компанию целиком тоже не перетирается', async () => {
    // У такого плана нет ответственного (`managerId: null`), и ключ «показатель
    // без менеджера» обязан совпасть с прошлым месяцем. Иначе кнопка создаст
    // второй план на ту же клетку — а это уже двойной счёт в отчёте.
    const { prisma, raw } = db({
      salesTarget: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { managerId: null, metric: 'certificates_issued', targetAmount: D('50') },
            { managerId: null, metric: 'revenue_paid', targetAmount: D('9000') },
          ])
          .mockResolvedValueOnce([{ managerId: null, metric: 'certificates_issued' }]),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    });

    const res = await copyTargetsFromPreviousMonth(prisma, LEADER, { year: 2026, month: 9 });

    expect(res).toEqual({ ok: true, copied: 1 });
    const data = raw.salesTarget.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].metric).toBe('revenue_paid');
  });

  it('январь берёт декабрь прошлого года', async () => {
    const { prisma, raw } = db();
    await copyTargetsFromPreviousMonth(prisma, LEADER, { year: 2026, month: 1 });
    expect(raw.salesTarget.findMany.mock.calls[0][0].where).toMatchObject({
      year: 2025,
      month: 12,
    });
  });

  it('рядовому менеджеру — отказ', async () => {
    const { prisma } = db();
    expect(await copyTargetsFromPreviousMonth(prisma, MANAGER, { year: 2026, month: 9 })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});

/**
 * Краевые пути настроек (`У-242`).
 *
 * Все они выглядят одинаково — «отказ», — но означают разное, и потому
 * проверяются поимённо: у пропавшей компании нет данных (`not_found`), у
 * рядового менеджера нет права (`forbidden`), у кривого месяца нет смысла
 * (`invalid`). Общий код отправил бы человека чинить не то.
 */
describe('Краевые пути', () => {
  it('компания пропала — «не найдено», а не пустой экран настроек', async () => {
    const { prisma } = db({
      company: { findUnique: vi.fn(async () => null), update: vi.fn() },
    });

    expect(await getKpiSettings(prisma, LEADER, { year: 2026, month: 9 })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('выбор показателей: рядовому — отказ, в базу не ходим', async () => {
    const { prisma, raw } = db();

    expect(await setActiveMetrics(prisma, MANAGER, ['revenue_paid'])).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(raw.company.update).not.toHaveBeenCalled();
  });

  it('выбор показателей: компания пропала — ничего не пишем', async () => {
    const { prisma, raw } = db({
      company: { findUnique: vi.fn(async () => null), update: vi.fn() },
    });

    expect(await setActiveMetrics(prisma, LEADER, ['revenue_paid'])).toEqual({
      ok: false,
      error: 'not_found',
    });
    // Запись без «как было» сделала бы журнал бесполезным — поэтому и не пишем.
    expect(raw.company.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('план: рядовому — отказ, до проверки показателя дело не доходит', async () => {
    const { prisma, raw } = db();

    expect(
      await upsertKpiTarget(prisma, MANAGER, {
        metric: 'revenue_paid',
        managerId: null,
        year: 2026,
        month: 9,
        amount: '100',
      })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(raw.salesTarget.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['придуманный показатель', { metric: 'выдумка' }],
    ['год дробью', { year: 2026.5 }],
    ['год из будущего', { year: 2101 }],
    ['год из прошлого века', { year: 1999 }],
    ['месяц дробью', { month: 9.5 }],
    ['месяц нулевой', { month: 0 }],
    ['месяц тринадцатый', { month: 13 }],
  ])('план: %s — отказ «неверно», база не трогается', async (_name, over) => {
    const { prisma, raw } = db();

    expect(
      await upsertKpiTarget(prisma, LEADER, {
        metric: 'revenue_paid',
        managerId: null,
        year: 2026,
        month: 9,
        amount: '100',
        ...over,
      })
    ).toEqual({ ok: false, error: 'invalid' });
    expect(raw.salesTarget.findFirst).not.toHaveBeenCalled();
  });

  it('план: сотрудника нет вовсе — «не найдено», а не «нет доступа»', async () => {
    const { prisma } = db({
      user: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    });

    expect(
      await upsertKpiTarget(prisma, LEADER, {
        metric: 'revenue_paid',
        managerId: 'ghost',
        year: 2026,
        month: 9,
        amount: '100',
      })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it.each([
    ['год дробью', { year: 2026.5, month: 9 }],
    ['месяц дробью', { year: 2026, month: 9.5 }],
  ])('копирование: %s — отказ до любых выборок', async (_name, args) => {
    const { prisma, raw } = db();

    expect(await copyTargetsFromPreviousMonth(prisma, LEADER, args)).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(raw.salesTarget.findMany).not.toHaveBeenCalled();
  });
});
