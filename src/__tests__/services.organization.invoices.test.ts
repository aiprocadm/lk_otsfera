import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  listOrgInvoices,
  parseInvoiceDate,
  parseInvoiceState,
  ORG_INVOICES_TAKE,
} from '@/lib/services/organization/invoices';

/**
 * Счета заказчика (`У-235`): скоуп канала организации, состояние оплаты тем же
 * расчётом, что в карточке документа, «к оплате», фильтры периода и состояния.
 */

const findMany = vi.fn();
const paymentFindMany = vi.fn();
/** `У-329`: заказы без документа-счёта (`where.documents`) и задолженность по заказам. */
const orphanOrders = vi.fn();
const kpiOrders = vi.fn();
const orderFindMany = vi.fn((args: { where: Record<string, unknown> }) =>
  'documents' in args.where ? orphanOrders(args) : kpiOrders(args)
);
const prisma = {
  document: { findMany },
  payment: { findMany: paymentFindMany },
  order: { findMany: orderFindMany },
} as unknown as PrismaClient;

function doc(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    number: 'С-2026-17',
    name: 'Счёт С-2026-17',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    amountGross: new Prisma.Decimal('1000.00'),
    orderId: 'o1',
    order: { orderNumber: 'З-1', title: 'Обучение' },
    ...over,
  };
}

function payment(over: Record<string, unknown> = {}) {
  return {
    orderId: 'o1',
    amount: new Prisma.Decimal('400.00'),
    isRefund: false,
    purpose: 'Оплата по счёту С-2026-17',
    note: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  paymentFindMany.mockResolvedValue([]);
  orphanOrders.mockResolvedValue([]);
  kpiOrders.mockResolvedValue([]);
});

describe('listOrgInvoices — выборка', () => {
  it('канал организации, только счета, без отменённых, свежие первыми, верхняя граница', async () => {
    await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    const args = findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      counterpartyType: 'organization',
      counterpartyId: 'org1',
      supersededAt: null,
      type: 'invoice',
      status: { not: 'cancelled' },
    });
    expect(args.where.createdAt).toBeUndefined();
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(ORG_INVOICES_TAKE);
    // Счетов нет — платежи не спрашиваем.
    expect(paymentFindMany).not.toHaveBeenCalled();
  });

  it('период — по дате выпуска; платежи — только заказов найденных счетов', async () => {
    findMany.mockResolvedValue([
      doc(),
      doc({ id: 'd2', orderId: 'o2' }),
      doc({ id: 'd3', orderId: null }),
    ]);
    // Прогон сопровождения №36: границы — то, что отдаёт `parseInvoiceDate`
    // (московские полуночи), верх — `lt`. Прежнее ожидание `lte` конца дня по
    // Гринвичу и было дефектом.
    const from = new Date('2026-08-31T21:00:00Z');
    const to = new Date('2026-09-30T21:00:00Z');
    await listOrgInvoices(prisma, { scope: null, organizationId: 'org1', from, to });
    expect(findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: from, lt: to });
    expect(paymentFindMany.mock.calls[0][0].where).toEqual({ orderId: { in: ['o1', 'o2'] } });
  });

  it('только нижняя или только верхняя граница', async () => {
    const from = new Date('2026-08-31T21:00:00Z');
    await listOrgInvoices(prisma, { scope: null, organizationId: 'org1', from });
    expect(findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: from });
    const to = new Date('2026-09-30T21:00:00Z');
    await listOrgInvoices(prisma, { scope: null, organizationId: 'org1', to });
    expect(findMany.mock.calls[1][0].where.createdAt).toEqual({ lt: to });
  });

  it('прогон №36: «с 31.08 по 31.08» — московский день целиком, 01:30 МСК следующего дня — нет', async () => {
    // Путь как на странице: поле формы → parseInvoiceDate → where сервиса.
    // `createdAt` счёта — `now()` сервера (мгновение); опасное окно —
    // 21:00–24:00 по Гринвичу (00:00–03:00 по Москве).
    await listOrgInvoices(prisma, {
      scope: null,
      organizationId: 'org1',
      from: parseInvoiceDate('2026-08-31', 'from'),
      to: parseInvoiceDate('2026-08-31', 'to'),
    });
    const cond = findMany.mock.calls[0][0].where.createdAt as { gte: Date; lt: Date };
    const inside = (d: Date) => d >= cond.gte && d < cond.lt;
    expect(inside(new Date('2026-08-30T22:30:00Z'))).toBe(true); // 31.08 01:30 МСК
    expect(inside(new Date('2026-08-31T20:30:00Z'))).toBe(true); // 31.08 23:30 МСК
    expect(inside(new Date('2026-08-31T22:30:00Z'))).toBe(false); // 01.09 01:30 МСК
    expect(inside(new Date('2026-08-30T20:30:00Z'))).toBe(false); // 30.08 23:30 МСК
  });
});

describe('listOrgInvoices — состояние оплаты', () => {
  it('частичная оплата: зачтено, остаток, состояние; «к оплате» и счётчики', async () => {
    findMany.mockResolvedValue([doc()]);
    paymentFindMany.mockResolvedValue([payment()]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    expect(r.rows[0]).toMatchObject({
      id: 'd1',
      number: 'С-2026-17',
      orderNumber: 'З-1',
      orderTitle: 'Обучение',
      amountGross: '1000.00',
      paid: '400.00',
      due: '600.00',
      state: 'partially_paid',
      matched: true,
      ambiguous: false,
    });
    expect(r.total).toBe(1);
    expect(r.counts).toEqual({ unpaid: 0, partially_paid: 1, paid: 0, unknown: 0 });
  });

  it('оплачен полностью (в том числе с переплатой) — остаток 0 и в «к оплате» не входит', async () => {
    findMany.mockResolvedValue([doc()]);
    paymentFindMany.mockResolvedValue([payment({ amount: new Prisma.Decimal('1200.00') })]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    expect(r.rows[0]).toMatchObject({ state: 'paid', paid: '1200.00', due: '0.00' });
  });

  it('платёж не сослался на счёт — не оплачен и не сопоставлен', async () => {
    findMany.mockResolvedValue([doc()]);
    paymentFindMany.mockResolvedValue([payment({ purpose: 'Аванс' })]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    expect(r.rows[0]).toMatchObject({
      state: 'unpaid',
      matched: false,
      paid: '0.00',
      due: '1000.00',
    });
  });

  it('возврат больше оплаты: зачтено 0, остаток — не больше счёта', async () => {
    findMany.mockResolvedValue([doc()]);
    paymentFindMany.mockResolvedValue([
      payment({ amount: new Prisma.Decimal('100.00') }),
      payment({ amount: new Prisma.Decimal('300.00'), isRefund: true }),
    ]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    expect(r.rows[0]).toMatchObject({
      state: 'unpaid',
      matched: true,
      paid: '0.00',
      due: '1000.00',
    });
  });

  it('платёж назвал два счёта — не разнесён, счёт помечен ambiguous', async () => {
    findMany.mockResolvedValue([doc()]);
    paymentFindMany.mockResolvedValue([
      payment({ purpose: 'Оплата по счёту С-2026-17 и по счёту С-2026-18' }),
    ]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    expect(r.rows[0]).toMatchObject({ state: 'unpaid', matched: false, ambiguous: true });
  });

  it('признак не считается: без заказа, без суммы, без номера → «не определено», без остатка', async () => {
    findMany.mockResolvedValue([
      doc({ id: 'noOrder', orderId: null, order: null }),
      doc({ id: 'noGross', amountGross: null }),
      doc({ id: 'noNumber', number: null }),
    ]);
    paymentFindMany.mockResolvedValue([payment()]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    const byId = new Map(r.rows.map((x) => [x.id, x]));
    expect(byId.get('noOrder')).toMatchObject({
      state: 'unknown',
      amountGross: '1000.00',
      paid: null,
      due: null,
      orderNumber: null,
      orderTitle: null,
    });
    expect(byId.get('noGross')).toMatchObject({ state: 'unknown', amountGross: null });
    expect(byId.get('noNumber')).toMatchObject({ state: 'unknown', amountGross: '1000.00' });
    expect(r.counts.unknown).toBe(3);
  });

  it('фильтр по состоянию сужает строки, но не общий счёт и не сумму к оплате', async () => {
    findMany.mockResolvedValue([doc(), doc({ id: 'd2', number: 'С-2026-18' })]);
    paymentFindMany.mockResolvedValue([payment({ amount: new Prisma.Decimal('1000.00') })]);
    const r = await listOrgInvoices(prisma, {
      scope: null,
      organizationId: 'org1',
      state: 'unpaid',
    });
    expect(r.rows.map((x) => x.id)).toEqual(['d2']);
    expect(r.total).toBe(2);
    expect(r.counts).toEqual({ unpaid: 1, partially_paid: 0, paid: 1, unknown: 0 });
  });
});

describe('разбор параметров адреса', () => {
  it('состояние — только известное', () => {
    expect(parseInvoiceState('paid')).toBe('paid');
    expect(parseInvoiceState('unknown')).toBe('unknown');
    expect(parseInvoiceState('x')).toBeUndefined();
    expect(parseInvoiceState(undefined)).toBeUndefined();
  });

  // Прогон №36: сутки — московские. Прежние ожидания «00:00Z» и «23:59:59.999Z»
  // закрепляли сутки по Гринвичу — это и был дефект.
  it('дата — YYYY-MM-DD, «с» — московская полночь, «по» — полночь следующих суток; мусор — без границы', () => {
    expect(parseInvoiceDate('2026-09-01', 'from')?.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(parseInvoiceDate('2026-09-30', 'to')?.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(parseInvoiceDate('30.09.2026', 'to')).toBeUndefined();
    expect(parseInvoiceDate('2026-13-45', 'from')).toBeUndefined();
    expect(parseInvoiceDate('2026-02-30', 'to')).toBeUndefined();
    expect(parseInvoiceDate(undefined, 'from')).toBeUndefined();
  });
});

// `У-329` (`Д-63`, ТЗ 28.10.2026): «Задолженность» считалась по заказам, а
// список и «К оплате» — по документам-счетам. Заказ со счётом из 1С без файла
// давал долг 100 000 ₽ при «Счетов пока нет» и «К оплате: 0».
describe('listOrgInvoices — один источник с «Задолженностью» (У-329)', () => {
  function order(over: Record<string, unknown> = {}) {
    return {
      id: 'o9',
      orderNumber: 'DEMO-1',
      title: 'Обучение ОТ',
      createdAt: new Date('2026-09-05T10:00:00Z'),
      totalAmount: new Prisma.Decimal('100000.00'),
      paidAmount: new Prisma.Decimal('0.00'),
      ...over,
    };
  }

  it('«К оплате» = задолженность по заказам, даже когда документов-счетов нет', async () => {
    kpiOrders.mockResolvedValue([
      {
        organizationId: 'org1',
        totalAmount: new Prisma.Decimal('100000'),
        paidAmount: new Prisma.Decimal('0'),
      },
    ]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    expect(r.toPay).toBe('100000.00');
  });

  it('заказ со счётом без документа — строка списка со ссылкой на заказ и без файла', async () => {
    orphanOrders.mockResolvedValue([order()]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    expect(r.rows).toEqual([
      expect.objectContaining({
        id: 'order:o9',
        name: 'Счёт по заказу DEMO-1',
        orderId: 'o9',
        amountGross: '100000.00',
        paid: '0.00',
        due: '100000.00',
        state: 'unpaid',
        hasFile: false,
      }),
    ]);
    expect(r.total).toBe(1);
    expect(r.counts.unpaid).toBe(1);
    const where = orphanOrders.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      organizationId: 'org1',
      financialStatus: { in: ['billed', 'partially_paid', 'paid'] },
      documents: {
        none: { type: 'invoice', counterpartyType: 'organization', counterpartyId: 'org1' },
      },
    });
  });

  it('частичная и полная оплата заказа — своё состояние, переплата не уходит в минус', async () => {
    orphanOrders.mockResolvedValue([
      order({ id: 'a', paidAmount: new Prisma.Decimal('40000') }),
      order({ id: 'b', paidAmount: new Prisma.Decimal('120000') }),
    ]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect([byId['order:a']!.state, byId['order:a']!.due]).toEqual(['partially_paid', '60000.00']);
    expect([byId['order:b']!.state, byId['order:b']!.due]).toEqual(['paid', '0.00']);
  });

  it('документ-счёт и строка заказа идут вместе, свежие первыми; у документа файл есть', async () => {
    findMany.mockResolvedValue([doc()]);
    orphanOrders.mockResolvedValue([order({ createdAt: new Date('2026-09-10T10:00:00Z') })]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    expect(r.rows.map((x) => [x.id, x.hasFile])).toEqual([
      ['order:o9', false],
      ['d1', true],
    ]);
  });

  it('переплата по заказам — «К оплате» 0, а не минус', async () => {
    kpiOrders.mockResolvedValue([
      {
        organizationId: 'org1',
        totalAmount: new Prisma.Decimal('100'),
        paidAmount: new Prisma.Decimal('150'),
      },
    ]);
    const r = await listOrgInvoices(prisma, { scope: null, organizationId: 'org1' });
    expect(r.toPay).toBe('0.00');
  });
});
