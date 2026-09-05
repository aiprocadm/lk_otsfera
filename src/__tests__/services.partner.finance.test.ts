import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  getFinanceKpis,
  listStatements,
  countStatements,
  getStatementWithItems,
  getStatementFilePath,
} from '@/lib/services/partner/finance';
import type { SessionPayload } from '@/lib/auth/jwt';

const { findMany, findFirst, count } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
}));
const prisma = { commissionStatement: { findMany, findFirst, count } } as never;

beforeEach(() => vi.clearAllMocks());

describe('getFinanceKpis', () => {
  it('распределяет суммы по earned/pending/paid согласно статусу', async () => {
    findMany.mockResolvedValue([
      { status: 'draft', totalCommissionAmount: 100 },
      { status: 'approved', totalCommissionAmount: 200 },
      { status: 'paid', totalCommissionAmount: 50 },
    ]);
    const r = await getFinanceKpis(prisma, 'p1');
    expect(r).toEqual({ earnedTotal: 250, pendingTotal: 300, paidTotal: 50 });
    expect(findMany).toHaveBeenCalledWith({
      where: { partnerId: 'p1', supersededBy: null },
      select: { status: true, totalCommissionAmount: true },
    });
  });

  it('суммирует деньги без float-дрейфа (фаза 5, аудит D1)', async () => {
    // Во float 10.10 + 20.20 + 0.03 = 30.330000000000002; на Decimal — ровно 30.33.
    findMany.mockResolvedValue([
      { status: 'paid', totalCommissionAmount: new Prisma.Decimal('10.10') },
      { status: 'paid', totalCommissionAmount: new Prisma.Decimal('20.20') },
      { status: 'paid', totalCommissionAmount: new Prisma.Decimal('0.03') },
    ]);
    const r = await getFinanceKpis(prisma, 'p1');
    expect(r.paidTotal).toBe(30.33);
    expect(r.earnedTotal).toBe(30.33);
  });

  it('возвращает нули на пустом наборе', async () => {
    findMany.mockResolvedValue([]);
    expect(await getFinanceKpis(prisma, 'p1')).toEqual({
      earnedTotal: 0,
      pendingTotal: 0,
      paidTotal: 0,
    });
  });
});

describe('listStatements', () => {
  beforeEach(() =>
    findMany.mockResolvedValue([
      {
        id: 's1',
        status: 'paid',
        totalCommissionAmount: new Prisma.Decimal('500'),
        _count: { items: 3 },
      },
    ])
  );

  it('без фильтров: дефолтные skip/take, маппит itemCount', async () => {
    const r = await listStatements(prisma, { partnerId: 'p1' });
    expect(r).toEqual([
      { id: 's1', status: 'paid', totalCommissionAmount: '500.00', itemCount: 3 },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partnerId: 'p1', supersededBy: null },
        skip: 0,
        take: 20,
      })
    );
  });

  it('со статусом и диапазоном from/to строит where.periodFrom', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    await listStatements(prisma, {
      partnerId: 'p1',
      status: 'approved',
      from,
      to,
      skip: 5,
      take: 10,
    });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('approved');
    expect(arg.where.periodFrom).toEqual({ gte: from, lte: to });
    expect(arg.skip).toBe(5);
    expect(arg.take).toBe(10);
  });

  it('только from (без to)', async () => {
    const from = new Date('2026-01-01');
    await listStatements(prisma, { partnerId: 'p1', from });
    expect(findMany.mock.calls[0][0].where.periodFrom).toEqual({ gte: from });
  });

  it('только to (без from)', async () => {
    const to = new Date('2026-02-01');
    await listStatements(prisma, { partnerId: 'p1', to });
    expect(findMany.mock.calls[0][0].where.periodFrom).toEqual({ lte: to });
  });

  it('сериализует Decimal totalCommissionAmount в строку (RSC-safe, не утекает Prisma.Decimal в клиент)', async () => {
    findMany.mockResolvedValue([
      {
        id: 's1',
        status: 'paid',
        totalCommissionAmount: new Prisma.Decimal('1234.5'),
        _count: { items: 2 },
      },
    ]);
    const r = await listStatements(prisma, { partnerId: 'p1' });
    expect(typeof r[0].totalCommissionAmount).toBe('string');
    expect(r[0].totalCommissionAmount).toBe('1234.50');
    expect(r[0]).not.toBeInstanceOf(Prisma.Decimal);
  });
});

describe('countStatements — счётчик для пагинации (С-6, хотфикс №5)', () => {
  it('считает по тому же условию, что и listStatements (partnerId + не заменённые)', async () => {
    count.mockResolvedValue(45);
    findMany.mockResolvedValue([]);
    await listStatements(prisma, { partnerId: 'p1' });
    const r = await countStatements(prisma, { partnerId: 'p1' });
    expect(r).toBe(45);
    expect(count).toHaveBeenCalledWith({ where: findMany.mock.calls[0][0].where });
  });

  it('уважает status и диапазон from/to — иначе «всего» не сойдётся со списком', async () => {
    count.mockResolvedValue(3);
    const from = new Date('2026-01-01');
    const to = new Date('2026-03-31');
    await countStatements(prisma, { partnerId: 'p1', status: 'paid', from, to });
    expect(count).toHaveBeenCalledWith({
      where: {
        partnerId: 'p1',
        supersededBy: null,
        status: 'paid',
        periodFrom: { gte: from, lte: to },
      },
    });
  });
});

describe('getStatementWithItems', () => {
  it('пробрасывает findFirst с include items', async () => {
    findFirst.mockResolvedValue({ id: 's1', items: [] });
    const r = await getStatementWithItems(prisma, 's1', 'p1');
    expect(r).toEqual({ id: 's1', items: [] });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 's1', partnerId: 'p1' },
      include: { items: { orderBy: { organizationName: 'asc' } } },
    });
  });
});

describe('getStatementFilePath — скоуп акта (аудит A1: запрос уехал из pdf/xlsx-роутов)', () => {
  const partnerSession = { sub: 'u-p', role: 'partner', partnerId: 'p1' } as SessionPayload;
  const adminSession = { sub: 'u-a', role: 'admin' } as SessionPayload;

  it('партнёр: фильтр по своему partnerId + select pdfPath', async () => {
    findFirst.mockResolvedValue({ pdfPath: 'uploads/s1.pdf' });

    const r = await getStatementFilePath(prisma, partnerSession, { id: 's1', format: 'pdf' });

    expect(r).toEqual({ ok: true, path: 'uploads/s1.pdf' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 's1', partnerId: 'p1' },
      select: { pdfPath: true },
    });
  });

  it('партнёр: xlsx берёт свой столбец', async () => {
    findFirst.mockResolvedValue({ xlsxPath: 'uploads/s1.xlsx' });

    const r = await getStatementFilePath(prisma, partnerSession, { id: 's1', format: 'xlsx' });

    expect(r).toEqual({ ok: true, path: 'uploads/s1.xlsx' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 's1', partnerId: 'p1' },
      select: { xlsxPath: true },
    });
  });

  it('admin (Model A): без partnerId-фильтра', async () => {
    findFirst.mockResolvedValue({ pdfPath: 'uploads/s1.pdf' });

    await getStatementFilePath(prisma, adminSession, { id: 's1', format: 'pdf' });

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 's1' }, select: { pdfPath: true } });
  });

  it('сессия партнёра без partnerId → not_found и НИ ОДНОГО запроса (фильтр не снимается)', async () => {
    const broken = { sub: 'u-p', role: 'partner' } as SessionPayload;

    const r = await getStatementFilePath(prisma, broken, { id: 's1', format: 'pdf' });

    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('чужой/несуществующий акт → not_found', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      getStatementFilePath(prisma, partnerSession, { id: 's1', format: 'pdf' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
  });

  it.each([
    ['pdf', { pdfPath: null }],
    ['xlsx', { xlsxPath: null }],
  ] as const)('файл %s ещё не собран → not_generated', async (format, row) => {
    findFirst.mockResolvedValue(row);
    await expect(
      getStatementFilePath(prisma, partnerSession, { id: 's1', format })
    ).resolves.toEqual({ ok: false, error: 'not_generated' });
  });
});
