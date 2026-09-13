import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

const { writeSyncLog, getQueue } = vi.hoisted(() => {
  const queueAdd = vi.fn();
  return { writeSyncLog: vi.fn(), getQueue: vi.fn(() => ({ add: queueAdd })) };
});
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));
vi.mock('@/lib/services/oneCSync/index', () => ({ getOneCAdapter: vi.fn() }));
vi.mock('@/lib/services/oneCSync/pushDocument', () => ({ reissueChainRootId: vi.fn() }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { detectLateRefundCorrections } from '@/lib/services/commission/corrections';
import { reconcileStuckLeads } from '@/lib/services/oneCSync/reconcile';

/**
 * Фоновая задача спрашивает базу **постоянное число раз**, сколько бы строк
 * ни пришло в выборку.
 *
 * Обе задачи ниже сначала выбирали список, а потом делали отдельный запрос
 * НА КАЖДУЮ строку: поиск корректировок — четыре (период, партнёр, история
 * ставок партнёра, история ставок организации), сверка зависших лидов — два
 * (подтверждение и «уже повторяли»). Пока строк десятки, это незаметно; беда
 * в том, что часть строк из выборки не уходит никогда — возврат без закрытого
 * периода и лид, принятый 1С без своего номера, — и каждый прогон
 * перечитывает их заново. Работа росла вместе с базой, а не с объёмом дел.
 *
 * Страж меряет не время, а **число запросов чтения**: прогоняем задачу на
 * одной строке и на тридцати и требуем, чтобы счётчик совпал. Запись
 * (создание корректировки, снятие претензии, постановка задачи) считать
 * нельзя — она законно растёт вместе с числом дел, поэтому в пробах либо
 * ничего не пишется, либо пишется по одному разу на строку.
 */
const READ_METHODS = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate']);

/** Счётчик чтений: любой вызов read-метода любой модели. */
function countingPrisma(models: Record<string, Record<string, unknown>>) {
  let reads = 0;
  const wrapModel = (model: Record<string, unknown>) =>
    new Proxy(model, {
      get(target, prop: string) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (READ_METHODS.has(prop)) reads += 1;
          return (value as (...a: unknown[]) => unknown)(...args);
        };
      },
    });
  const wrapped: Record<string, unknown> = {};
  for (const [name, model] of Object.entries(models)) wrapped[name] = wrapModel(model);
  return { prisma: wrapped as unknown as PrismaClient, reads: () => reads };
}

const dec = (n: number) => new Prisma.Decimal(n);

// ── Поиск поздних возвратов ──────────────────────────────────────────────────

function refundRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `pay-${i}`,
    amount: dec(1000),
    paidAt: new Date('2026-04-20'),
    orderId: `o-${i}`,
    organizationId: `org-${i}`,
    order: { partnerId: 'p1' },
    organization: { partnerId: 'p1', partnerCommissionRate: null },
  }));
}

const STATEMENT = {
  id: 'st-1',
  partnerId: 'p1',
  periodFrom: new Date('2026-04-01'),
  periodTo: new Date('2026-04-30'),
};

function correctionsPrisma(rows: ReturnType<typeof refundRows>) {
  // Оба вида вызова — и «по одной строке», и пакетный: страж должен падать на
  // СЧЁТЧИКЕ, а не на отсутствующем методе, иначе он ловит опечатку, а не рост.
  return countingPrisma({
    payment: { findMany: vi.fn().mockResolvedValue(rows) },
    commissionStatement: {
      findFirst: vi.fn().mockResolvedValue(STATEMENT),
      findMany: vi.fn().mockResolvedValue([STATEMENT]),
    },
    partner: {
      findUnique: vi.fn().mockResolvedValue({ id: 'p1', commissionRate: dec(0.2) }),
      findMany: vi.fn().mockResolvedValue([{ id: 'p1', commissionRate: dec(0.2) }]),
    },
    commissionRateChange: { findMany: vi.fn().mockResolvedValue([]) },
    organizationCommissionRateChange: { findMany: vi.fn().mockResolvedValue([]) },
    commissionCorrection: { create: vi.fn().mockResolvedValue({ id: 'c-1' }) },
  });
}

// ── Сверка зависших лидов ────────────────────────────────────────────────────

const NOW = new Date('2026-09-12T03:00:00Z');

function leadRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `lead-${i}`,
    pushedToOneCAt: new Date('2026-09-01T00:00:00Z'),
  }));
}

function leadsPrisma(rows: ReturnType<typeof leadRows>) {
  // Все лиды уже подтверждены 1С (`success`-строка обмена) — задача ничего не
  // пишет, значит весь счётчик состоит из чтений.
  const accepted = rows.map((l) => ({ id: `log-${l.id}`, payload: { cabinetLeadId: l.id } }));
  return countingPrisma({
    lead: {
      findMany: vi.fn().mockResolvedValue(rows),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    syncLog: {
      findFirst: vi.fn().mockResolvedValue(accepted[0] ?? null),
      findMany: vi.fn().mockResolvedValue(accepted),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('фоновая задача не делает запрос на каждую строку', () => {
  it('поиск поздних возвратов: тридцать возвратов стоят столько же запросов, сколько один', async () => {
    const one = correctionsPrisma(refundRows(1));
    await detectLateRefundCorrections(one.prisma);

    const many = correctionsPrisma(refundRows(30));
    await detectLateRefundCorrections(many.prisma);

    expect(
      many.reads(),
      `на 30 возвратах чтений ${many.reads()}, на одном ${one.reads()} — задача спрашивает базу построчно`
    ).toBe(one.reads());
  });

  it('сверка зависших лидов: тридцать лидов стоят столько же запросов, сколько один', async () => {
    const one = leadsPrisma(leadRows(1));
    await reconcileStuckLeads(one.prisma, { now: NOW });

    const many = leadsPrisma(leadRows(30));
    await reconcileStuckLeads(many.prisma, { now: NOW });

    expect(
      many.reads(),
      `на 30 лидах чтений ${many.reads()}, на одном ${one.reads()} — сверка спрашивает базу построчно`
    ).toBe(one.reads());
  });

  it('у партнёра несколько закрытых периодов — берётся тот, что покрывает дату возврата', async () => {
    // Раскладка пакетной выборки по партнёру складывает строки в одну корзину;
    // выбор периода после этого делается в памяти и должен остаться прежним.
    const rows = refundRows(1);
    const created: unknown[] = [];
    const { prisma } = countingPrisma({
      payment: { findMany: vi.fn().mockResolvedValue(rows) },
      commissionStatement: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'st-march',
            partnerId: 'p1',
            periodFrom: new Date('2026-03-01'),
            periodTo: new Date('2026-03-31'),
          },
          STATEMENT,
        ]),
      },
      partner: { findMany: vi.fn().mockResolvedValue([{ id: 'p1', commissionRate: dec(0.2) }]) },
      commissionRateChange: { findMany: vi.fn().mockResolvedValue([]) },
      organizationCommissionRateChange: { findMany: vi.fn().mockResolvedValue([]) },
      commissionCorrection: {
        create: vi.fn().mockImplementation(({ data }: { data: unknown }) => {
          created.push(data);
          return { id: 'c-1' };
        }),
      },
    });
    expect(await detectLateRefundCorrections(prisma)).toBe(1);
    expect((created[0] as { originalStatementId: string }).originalStatementId).toBe('st-1');
  });

  it('чужая строка истории без ключа лида в подтверждения не попадает', async () => {
    // В выборку по телу записи может попасть строка старого формата: ключа
    // `cabinetLeadId` в ней нет, и считать лид подтверждённым по ней нельзя.
    const rows = leadRows(1);
    const { prisma } = countingPrisma({
      lead: {
        findMany: vi.fn().mockResolvedValue(rows),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      syncLog: { findMany: vi.fn().mockResolvedValue([{ payload: { note: 'без ключа' } }]) },
    });
    const res = await reconcileStuckLeads(prisma, { now: NOW });
    expect(res.requeued, 'лид сочли подтверждённым по строке без ключа').toEqual(['lead-0']);
  });

  it('возврат без партнёра корректировку получить не может — он не должен попадать в выборку', async () => {
    // `CommissionCorrection.partnerId` обязателен: возврат, у которого партнёра
    // нет ни у заказа, ни у организации, не даст корректировки НИКОГДА. Если
    // такие строки не отсечь запросом, они перечитываются каждым прогоном.
    // Хотфикс №49: выборка идёт от закрытых периодов — без единого периода
    // возвраты не спрашиваются вовсе, поэтому период здесь нужен.
    const findMany = vi.fn().mockResolvedValue([]);
    const { prisma } = countingPrisma({
      payment: { findMany },
      commissionStatement: { findMany: vi.fn().mockResolvedValue([STATEMENT]) },
      partner: { findMany: vi.fn().mockResolvedValue([]) },
      commissionRateChange: { findMany: vi.fn().mockResolvedValue([]) },
      organizationCommissionRateChange: { findMany: vi.fn().mockResolvedValue([]) },
      commissionCorrection: { create: vi.fn() },
    });
    await detectLateRefundCorrections(prisma);

    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(
      JSON.stringify(where),
      'выборка возвратов не требует партнёра — строки без него будут перечитываться вечно'
    ).toContain('partnerId');
  });
});
