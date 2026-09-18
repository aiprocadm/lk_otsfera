import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getCrossCompanyMonth } from '@/lib/services/admin/crossCompany';

/**
 * Свод по компаниям за месяц (`У-246`, этап 7).
 *
 * Главное здесь — разворачивание связей: у лида и обращения своей колонки
 * «компания» нет, и если развернуть неправильно, строки просто утекут не в ту
 * компанию — молча, без единой ошибки.
 */
const { countFailedDocumentPushes } = vi.hoisted(() => ({
  countFailedDocumentPushes: vi.fn(async () => 3),
}));
vi.mock('@/lib/services/oneCSync/pushFailures', () => ({ countFailedDocumentPushes }));

const companyFindMany = vi.fn();
const orgFindMany = vi.fn();
const userFindMany = vi.fn();
const orderGroupBy = vi.fn();
const paymentFindMany = vi.fn();
const leadGroupBy = vi.fn();
const requestGroupBy = vi.fn();
const batchFindMany = vi.fn();

const prisma = {
  company: { findMany: companyFindMany },
  organization: { findMany: orgFindMany },
  user: { findMany: userFindMany },
  order: { groupBy: orderGroupBy },
  payment: { findMany: paymentFindMany },
  lead: { groupBy: leadGroupBy },
  clientRequest: { groupBy: requestGroupBy },
  bitrixImportBatch: { findMany: batchFindMany },
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  companyFindMany.mockResolvedValue([
    { id: 'c1', name: 'Первая' },
    { id: 'c2', name: 'Вторая' },
  ]);
  orgFindMany.mockResolvedValue([
    { id: 'o1', companyId: 'c1' },
    { id: 'o2', companyId: 'c2' },
  ]);
  userFindMany.mockResolvedValue([
    { id: 'm1', companyId: 'c1' },
    { id: 'm2', companyId: 'c2' },
  ]);
  orderGroupBy.mockResolvedValue([{ companyId: 'c1', _count: { _all: 4 } }]);
  paymentFindMany.mockResolvedValue([]);
  leadGroupBy.mockResolvedValue([]);
  requestGroupBy.mockResolvedValue([]);
  batchFindMany.mockResolvedValue([]);
});

describe('getCrossCompanyMonth (У-246)', () => {
  it('строка есть у КАЖДОЙ компании, даже пустой', async () => {
    const res = await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    // Пропавшая строка читается как «компании нет», а не «за месяц ничего».
    expect(res.rows.map((r) => r.companyName)).toEqual(['Первая', 'Вторая']);
    expect(res.rows[1]).toMatchObject({ orders: 0, paid: '0.00', leads: 0, requests: 0 });
  });

  it('оплаты разворачиваются через заказ; возврат вычитается', async () => {
    paymentFindMany.mockResolvedValue([
      { amount: 1000, isRefund: false, order: { companyId: 'c1' } },
      { amount: 250, isRefund: true, order: { companyId: 'c1' } },
      { amount: 500, isRefund: false, order: { companyId: 'c2' } },
    ]);
    const res = await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    expect(res.rows[0]!.paid).toBe('750.00');
    expect(res.rows[1]!.paid).toBe('500.00');
  });

  it('платёж без заказа не приписывается никакой компании', async () => {
    paymentFindMany.mockResolvedValue([{ amount: 900, isRefund: false, order: null }]);
    const res = await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    // «Ничья» строка не должна оседать в первой попавшейся компании.
    expect(res.rows.map((r) => r.paid)).toEqual(['0.00', '0.00']);
  });

  it('лид считается по ответственному, а при его отсутствии — по организации', async () => {
    leadGroupBy.mockResolvedValue([
      { assignedManagerId: 'm1', organizationId: null, _count: { _all: 2 } },
      { assignedManagerId: null, organizationId: 'o2', _count: { _all: 5 } },
      // Ответственный из первой компании, организация клиента — из второй.
      // Лид ведёт компания ответственного.
      { assignedManagerId: 'm1', organizationId: 'o2', _count: { _all: 1 } },
      // Ни ответственного, ни организации — такой лид ничьей компании не свой.
      { assignedManagerId: null, organizationId: null, _count: { _all: 9 } },
    ]);
    const res = await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    expect(res.rows[0]!.leads).toBe(3);
    expect(res.rows[1]!.leads).toBe(5);
  });

  it('обращения разворачиваются через организацию', async () => {
    requestGroupBy.mockResolvedValue([
      { organizationId: 'o2', _count: { _all: 7 } },
      { organizationId: null, _count: { _all: 4 } },
    ]);
    const res = await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    expect(res.rows[0]!.requests).toBe(0);
    expect(res.rows[1]!.requests).toBe(7);
  });

  it('невыгруженные документы берутся общим счётчиком светофора (У-174)', async () => {
    const res = await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    expect(countFailedDocumentPushes).toHaveBeenCalledTimes(1);
    expect(res.docsNotPushed).toBe(3);
  });

  it('последний пакет миграции — один, самый свежий', async () => {
    batchFindMany.mockResolvedValue([
      {
        companyId: 'c2',
        status: 'applied',
        mode: 'initial',
        createdAt: new Date('2026-09-10T10:00:00Z'),
      },
    ]);
    const res = await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    expect(res.lastMigration).toMatchObject({ companyName: 'Вторая', status: 'applied' });
    const args = (batchFindMany.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(args.take, 'из базы тянется больше одного пакета').toBe(1);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('переносов не было — null, а не выдуманная строка', async () => {
    const res = await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    expect(res.lastMigration).toBeNull();
  });

  it('компания пакета пропала — прочерк, а не падение главной', async () => {
    batchFindMany.mockResolvedValue([
      {
        companyId: 'удалённая',
        status: 'applied',
        mode: 'resync',
        createdAt: new Date('2026-09-10T10:00:00Z'),
      },
    ]);
    const res = await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    expect(res.lastMigration?.companyName).toBe('—');
  });

  it('база спрашивается один раз на сущность, без обхода по компаниям', async () => {
    await getCrossCompanyMonth(prisma, { year: 2026, month: 9 });
    for (const [name, fn] of [
      ['компании', companyFindMany],
      ['организации', orgFindMany],
      ['сотрудники', userFindMany],
      ['заказы', orderGroupBy],
      ['оплаты', paymentFindMany],
      ['лиды', leadGroupBy],
      ['обращения', requestGroupBy],
    ] as const) {
      expect(fn.mock.calls.length, `${name}: запрос повторяется — это обход по компаниям`).toBe(1);
    }
  });
});
