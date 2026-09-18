/**
 * `У-257` — сверка дебиторки с 1С.
 *
 * Два правила держат всё остальное. **Сверка ничего не правит** (`Р-Э8-6`):
 * двигать суммы заказов по внешнему источнику — решение заказчика, а не
 * фоновой задачи. И **«метод не подключён» — не ошибка**: пока 1С не
 * реализовала `GET /api/debts`, красная строка «1С не отвечает» заставляла бы
 * администратора чинить работающий обмен.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

const { writeSyncLog } = vi.hoisted(() => ({ writeSyncLog: vi.fn() }));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));

import { OneCMethodNotImplementedError, type OneCAdapter } from '@/lib/services/oneCSync/adapter';
import { reconcileDebts, DEBT_MISMATCH_THRESHOLD } from '@/lib/services/oneCSync/reconcileDebts';

function order(over: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    orderNumber: 'ON-1',
    externalId: '1c-order-001',
    totalAmount: new Prisma.Decimal('100000'),
    paidAmount: new Prisma.Decimal('40000'),
    organization: { name: 'ООО Ромашка', inn: '7701234567' },
    ...over,
  };
}

function db(orders: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(orders);
  return { prisma: { order: { findMany } } as unknown as PrismaClient, findMany };
}

function adapterWith(debts: unknown[]): OneCAdapter {
  return { pullDebts: vi.fn().mockResolvedValue(debts) } as unknown as OneCAdapter;
}

describe('reconcileDebts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('долги совпали — расхождений нет, в историю уходит успех', async () => {
    const { prisma } = db([order()]);
    const res = await reconcileDebts(prisma, {
      adapter: adapterWith([
        { orderExternalId: '1c-order-001', debt: 60000, asOf: '2026-09-18T00:00:00Z' },
      ]),
    });
    expect(res).toMatchObject({ ok: true, checked: 1 });
    expect(res.ok && res.mismatches).toEqual([]);
    expect(writeSyncLog.mock.calls[0]![0]).toMatchObject({
      entity: 'debt',
      status: 'success',
      errorMessage: 'Расхождений по дебиторке нет',
    });
  });

  it('расхождение больше рубля попадает в отчёт со знаком', async () => {
    const { prisma } = db([order()]);
    const res = await reconcileDebts(prisma, {
      adapter: adapterWith([
        { orderExternalId: '1c-order-001', debt: 45000, asOf: '2026-09-18T00:00:00Z' },
      ]),
    });
    expect(res.ok && res.mismatches).toEqual([
      {
        orderId: 'o1',
        orderNumber: 'ON-1',
        organizationName: 'ООО Ромашка',
        ours: '60000.00',
        theirs: '45000.00',
        diff: '15000.00',
      },
    ]);
    expect(writeSyncLog.mock.calls[0]![0]).toMatchObject({
      status: 'warn',
      errorMessage: 'Расхождения по дебиторке: 1',
    });
  });

  it('разница меньше рубля расхождением не считается — это округление копеек', async () => {
    const { prisma } = db([order()]);
    const res = await reconcileDebts(prisma, {
      adapter: adapterWith([
        {
          orderExternalId: '1c-order-001',
          debt: 60000 - (DEBT_MISMATCH_THRESHOLD - 0.01),
          asOf: '2026-09-18T00:00:00Z',
        },
      ]),
    });
    expect(res.ok && res.mismatches).toEqual([]);
    expect(res.ok && res.checked).toBe(1);
  });

  it('долг по ИНН сверяется, когда ключа заказа нет', async () => {
    const { prisma } = db([order({ externalId: null })]);
    const res = await reconcileDebts(prisma, {
      adapter: adapterWith([
        { organizationInn: '7701234567', debt: 10, asOf: '2026-09-18T00:00:00Z' },
      ]),
    });
    expect(res.ok && res.checked).toBe(1);
    expect(res.ok && res.mismatches).toHaveLength(1);
  });

  it('ключ заказа точнее ключа контрагента', async () => {
    // У организации может быть несколько неоплаченных заказов, и общий долг по
    // ИНН к одному из них не отнести.
    const { prisma } = db([order()]);
    const res = await reconcileDebts(prisma, {
      adapter: adapterWith([
        { orderExternalId: '1c-order-001', debt: 60000, asOf: '2026-09-18T00:00:00Z' },
        { organizationInn: '7701234567', debt: 1, asOf: '2026-09-18T00:00:00Z' },
      ]),
    });
    expect(res.ok && res.mismatches).toEqual([]);
    // Долг по ИНН остался несопоставленным — и это видно в итоге.
    expect(res.ok && res.unmatched).toBe(1);
  });

  it('кривая строка не роняет сверку целиком', async () => {
    const { prisma } = db([order()]);
    const res = await reconcileDebts(prisma, {
      adapter: adapterWith([
        { debt: 'много' },
        { orderExternalId: '1c-order-001', debt: 60000, asOf: '2026-09-18T00:00:00Z' },
      ]),
    });
    expect(res.ok && res.checked).toBe(1);
  });

  it('строка без ключа отбрасывается — сопоставлять её не с чем', async () => {
    const { prisma } = db([order()]);
    const res = await reconcileDebts(prisma, {
      adapter: adapterWith([{ debt: 100, asOf: '2026-09-18T00:00:00Z' }]),
    });
    expect(res.ok && res.checked).toBe(0);
  });

  it('метод не подключён — предупреждение, а не ошибка', async () => {
    const { prisma } = db([]);
    const adapter = {
      pullDebts: vi.fn().mockRejectedValue(new OneCMethodNotImplementedError('/api/debts')),
    } as unknown as OneCAdapter;
    const res = await reconcileDebts(prisma, { adapter });
    expect(res).toMatchObject({ ok: false, error: 'not_implemented' });
    expect(writeSyncLog.mock.calls[0]![0]).toMatchObject({
      entity: 'debt',
      status: 'warn',
      errorMessage: 'Сверка дебиторки: метод не подключён на стороне 1С',
    });
  });

  it('1С не ответила — это ошибка, её видно в истории', async () => {
    const { prisma } = db([]);
    const adapter = {
      pullDebts: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as OneCAdapter;
    const res = await reconcileDebts(prisma, { adapter });
    expect(res).toMatchObject({ ok: false, error: 'transport' });
    expect(writeSyncLog.mock.calls[0]![0]).toMatchObject({ status: 'error' });
  });

  it('сверяются только неоплаченные заказы — у оплаченных сверять нечего', async () => {
    const { prisma, findMany } = db([]);
    await reconcileDebts(prisma, { adapter: adapterWith([]) });
    expect(findMany.mock.calls[0]![0].where).toEqual({
      financialStatus: { in: ['billed', 'partially_paid'] },
    });
  });

  it('сверка НИЧЕГО не правит: ни одного update у заказов', async () => {
    // Главный инвариант `Р-Э8-6`. Мок намеренно без `update`: появись такой
    // вызов — тест упадёт с «is not a function», а не покажет зелёный.
    const { prisma } = db([order()]);
    const res = await reconcileDebts(prisma, {
      adapter: adapterWith([
        { orderExternalId: '1c-order-001', debt: 1, asOf: '2026-09-18T00:00:00Z' },
      ]),
    });
    expect(res.ok).toBe(true);
    expect((prisma.order as unknown as Record<string, unknown>).update).toBeUndefined();
  });
});
