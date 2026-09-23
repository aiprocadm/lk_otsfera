import { describe, it, expect, vi, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { KPI_METRICS, kpiMetric, isKpiMetricKey, MAX_ACTIVE_METRICS } from '@/lib/kpi/metrics';

/**
 * Реестр показателей (`У-242`, этап 7).
 *
 * Проверяем каждый показатель по трём вопросам: пустой период даёт ноль, а не
 * ошибку; считается то, что обещано в подписи; граница компании стоит в
 * запросе, а не в разметке.
 */
const D = (v: string) => new Prisma.Decimal(v);
const PERIOD = { companyId: 'c1', from: new Date('2026-09-01'), to: new Date('2026-10-01') };

function db(over: Record<string, unknown> = {}) {
  const prisma = {
    payment: { findMany: vi.fn(async () => []) },
    order: { groupBy: vi.fn(async () => []) },
    lead: { groupBy: vi.fn(async () => []) },
    document: { groupBy: vi.fn(async () => []) },
    deal: { groupBy: vi.fn(async () => []) },
    call: { groupBy: vi.fn(async () => []) },
    task: { count: vi.fn(async () => 0) },
    taskAssignee: { groupBy: vi.fn(async () => []) },
    certificate: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async () => []),
    ...over,
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma as any };
}

describe('реестр показателей: устройство', () => {
  it('у каждого показателя есть название, единица и объяснение словами', () => {
    for (const m of KPI_METRICS) {
      expect(m.label.length, `${m.key}: нет названия`).toBeGreaterThan(2);
      expect(['money', 'count', 'minutes']).toContain(m.unit);
      // Объяснение — то, что человек читает в хабе. Одно слово вместо него
      // превращает настройку в угадайку.
      expect(m.hint.length, `${m.key}: объяснение слишком короткое`).toBeGreaterThan(20);
    }
  });

  it('ключи не повторяются, а неизвестный ключ распознаётся', () => {
    const keys = KPI_METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(isKpiMetricKey('revenue_paid')).toBe(true);
    expect(isKpiMetricKey('выдуманный')).toBe(false);
  });

  it('показателей в реестре больше, чем помещается на дашборд', () => {
    // Иначе предел в восемь ничего не ограничивает и проверять его незачем.
    expect(KPI_METRICS.length).toBeGreaterThan(MAX_ACTIVE_METRICS);
  });

  it('удостоверения — единственный показатель без ответственного', () => {
    const without = KPI_METRICS.filter((m) => !m.perManager).map((m) => m.key);
    expect(without).toEqual(['certificates_issued']);
  });
});

describe('пустой период — ноль, а не ошибка', () => {
  for (const metric of KPI_METRICS) {
    it(`${metric.key}: ноль`, async () => {
      const { prisma } = db();
      const fact = await metric.compute(prisma, PERIOD);
      expect(Number(fact.total)).toBe(0);
      expect(fact.byManager.size).toBe(0);
    });
  }
});

describe('расчёт каждого показателя', () => {
  it('Оплачено: возвраты вычитаются, платёж без заказа в разрез не попадает', async () => {
    const { prisma, raw } = db({
      payment: {
        findMany: vi.fn(async () => [
          { amount: D('1000.00'), isRefund: false, order: { managerId: 'm1' } },
          { amount: D('300.00'), isRefund: true, order: { managerId: 'm1' } },
          { amount: D('500.00'), isRefund: false, order: null },
        ]),
      },
    });
    const fact = await kpiMetric('revenue_paid').compute(prisma, PERIOD);
    expect(fact.total).toBe('1200.00');
    expect(fact.byManager.get('m1')).toBe('700.00');
    // Компания достаётся через заказ: у платежа своей колонки нет.
    expect(raw.payment.findMany.mock.calls[0][0].where.order).toEqual({ companyId: 'c1' });
  });

  it('Заказы заведены: группировка по ответственному, граница компании в запросе', async () => {
    const { prisma, raw } = db({
      order: {
        groupBy: vi.fn(async () => [
          { managerId: 'm1', _count: { _all: 3 } },
          { managerId: null, _count: { _all: 2 } },
        ]),
      },
    });
    const fact = await kpiMetric('orders_created').compute(prisma, PERIOD);
    expect(fact.total).toBe('5');
    expect(fact.byManager.get('m1')).toBe('3');
    expect(raw.order.groupBy.mock.calls[0][0].where.companyId).toBe('c1');
  });

  it('Лиды заведены: граница — ответственный ИЛИ организация компании', async () => {
    const { prisma, raw } = db({
      lead: { groupBy: vi.fn(async () => [{ assignedManagerId: 'm2', _count: { _all: 4 } }]) },
    });
    const fact = await kpiMetric('leads_created').compute(prisma, PERIOD);
    expect(fact.byManager.get('m2')).toBe('4');
    // Прежнее правило «ответственного нет вовсе» пускало чужие лиды (`Р-Э7-2`).
    expect(raw.lead.groupBy.mock.calls[0][0].where.OR).toEqual([
      { assignedManager: { companyId: 'c1' } },
      { organization: { companyId: 'c1' } },
    ]);
  });

  it('КП отправлено: перевыпущенные версии не считаются дважды', async () => {
    const { prisma, raw } = db({
      document: { groupBy: vi.fn(async () => [{ sentById: 'm1', _count: { _all: 2 } }]) },
    });
    await kpiMetric('proposals_sent').compute(prisma, PERIOD);
    const where = raw.document.groupBy.mock.calls[0][0].where;
    expect(where.type).toBe('commercial_proposal');
    expect(where.supersededAt).toBeNull();
  });

  it('Сделки выиграны: только выигранные и только по дате выигрыша', async () => {
    const { prisma, raw } = db({
      deal: { groupBy: vi.fn(async () => [{ managerId: 'm1', _count: { _all: 1 } }]) },
    });
    await kpiMetric('deals_won').compute(prisma, PERIOD);
    const where = raw.deal.groupBy.mock.calls[0][0].where;
    expect(where.status).toBe('won');
    expect(where.wonAt).toEqual({ gte: PERIOD.from, lt: PERIOD.to });
  });

  it('Звонки исходящие: входящие не считаются', async () => {
    const { prisma, raw } = db({
      call: { groupBy: vi.fn(async () => [{ initiatedByUserId: 'm1', _count: { _all: 7 } }]) },
    });
    const fact = await kpiMetric('calls_outbound').compute(prisma, PERIOD);
    expect(fact.total).toBe('7');
    expect(raw.call.groupBy.mock.calls[0][0].where.direction).toBe('outbound');
  });

  it('Диалоги с ответом и среднее время считаются по парам «первое входящее → первый ответ»', async () => {
    const { prisma, raw } = db({
      $queryRaw: vi.fn(async () => [
        { assigneeId: 'm1', minutes: 10 },
        { assigneeId: 'm1', minutes: 20 },
        { assigneeId: null, minutes: 30 },
      ]),
    });
    const answered = await kpiMetric('dialogs_answered').compute(prisma, PERIOD);
    expect(answered.total).toBe('3');
    expect(answered.byManager.get('m1')).toBe('2');

    const avg = await kpiMetric('avg_first_response_min').compute(prisma, PERIOD);
    expect(avg.total).toBe('20.0');
    expect(avg.byManager.get('m1')).toBe('15.0');
    // Один запрос на весь расчёт: выборка в цикле убила бы отчёт (`У-248`).
    expect(raw.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('Просроченные задачи: задачи без исполнителя попадают в итог, но не в разрез', async () => {
    const { prisma, raw } = db({
      taskAssignee: { groupBy: vi.fn(async () => [{ userId: 'm1', _count: { _all: 2 } }]) },
      task: { count: vi.fn(async () => 3) },
    });
    const fact = await kpiMetric('tasks_overdue').compute(prisma, PERIOD);
    expect(fact.total).toBe('5');
    expect(fact.byManager.get('m1')).toBe('2');
    expect(raw.task.count.mock.calls[0][0].where.companyId).toBe('c1');
  });

  /**
   * Прогон сопровождения №36 (`Р-М-3`). Было `dueDate < to`: у текущего
   * месяца `to` — 00:00 МСК 1 октября, и задача со сроком «28.09», открытая
   * 23.09, уже считалась просроченной, хотя подсказка обещает счёт «на момент
   * показа». Срок из формы — полночь UTC (03:00 МСК того же дня).
   */
  describe('Просроченные задачи — на момент показа, по московскому дню', () => {
    afterEach(() => vi.useRealTimers());

    async function overdueWhere(nowIso: string, period = PERIOD) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(nowIso));
      const { prisma, raw } = db({
        taskAssignee: { groupBy: vi.fn(async () => []) },
        task: { count: vi.fn(async () => 0) },
      });
      await kpiMetric('tasks_overdue').compute(prisma, period);
      const byAssignee = raw.taskAssignee.groupBy.mock.calls[0][0].where.task.dueDate;
      const unassigned = raw.task.count.mock.calls[0][0].where.dueDate;
      // Итог и разрез считаются от одной границы — иначе они разойдутся.
      expect(unassigned).toEqual(byAssignee);
      return byAssignee as { lt: Date };
    }

    const overdue = (w: { lt: Date }, dueIso: string) => new Date(dueIso) < w.lt;

    it('текущий месяц, 12:00 МСК 23.09: срок 28.09 — ещё не просрочен, срок 22.09 — просрочен', async () => {
      const w = await overdueWhere('2026-09-23T09:00:00.000Z');
      expect(w).toEqual({ lt: new Date('2026-09-22T21:00:00.000Z') });
      expect(overdue(w, '2026-09-28T00:00:00.000Z')).toBe(false);
      expect(overdue(w, '2026-09-23T00:00:00.000Z')).toBe(false);
      expect(overdue(w, '2026-09-22T00:00:00.000Z')).toBe(true);
    });

    it('00:30 МСК 23.09 (21:30 UTC 22.09): срок 22.09 уже просрочен', async () => {
      const w = await overdueWhere('2026-09-22T21:30:00.000Z');
      expect(overdue(w, '2026-09-22T00:00:00.000Z')).toBe(true);
    });

    it('23:59 МСК 22.09: срок 22.09 ещё не просрочен — день не закончился', async () => {
      const w = await overdueWhere('2026-09-22T20:59:00.000Z');
      expect(overdue(w, '2026-09-22T00:00:00.000Z')).toBe(false);
    });

    it('прошедший месяц — состояние на его конец, как и было: граница `to`', async () => {
      const august = {
        companyId: 'c1',
        from: new Date('2026-07-31T21:00:00.000Z'),
        to: new Date('2026-08-31T21:00:00.000Z'),
      };
      const w = await overdueWhere('2026-09-23T09:00:00.000Z', august);
      expect(w).toEqual({ lt: august.to });
      expect(overdue(w, '2026-08-31T00:00:00.000Z')).toBe(true);
      expect(overdue(w, '2026-09-01T00:00:00.000Z')).toBe(false);
    });
  });

  it('Удостоверения: считаются по компании организации, разреза нет', async () => {
    const { prisma, raw } = db({ certificate: { count: vi.fn(async () => 9) } });
    const fact = await kpiMetric('certificates_issued').compute(prisma, PERIOD);
    expect(fact.total).toBe('9');
    expect(fact.byManager.size).toBe(0);
    expect(raw.certificate.count.mock.calls[0][0].where.organization).toEqual({ companyId: 'c1' });
  });
});
