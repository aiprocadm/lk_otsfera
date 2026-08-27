import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 5 (`У-139`) — загрузчик блока «Состав и стоимость».
 *
 * Главное, что здесь проверяется: каталог скоупится **компанией самого
 * заказа**, а не сессии, и читается только после того, как доступ к заказу
 * подтвердил `listOrderLines`. Иначе карточка чужой компании показала бы свой
 * прайс — это была бы дыра, а не косметика.
 */

const { listOrderLines } = vi.hoisted(() => ({ listOrderLines: vi.fn() }));
vi.mock('@/lib/services/orders/orderLines', () => ({ listOrderLines }));

import { getOrderLinesPanel } from '@/lib/services/orders/linesPanel';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-1' } as unknown as SessionPayload;

const VIEW = {
  lines: [],
  totals: { net: '0.00', vat: '0.00', gross: '0.00' },
  readOnly: false,
  totalAmount: '0.00',
  totalAmountIsManual: false,
};

const findUnique = vi.fn();
const findMany = vi.fn();
const prisma = {
  order: { findUnique },
  catalogItem: { findMany },
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  listOrderLines.mockResolvedValue({ ok: true, view: VIEW });
  findUnique.mockResolvedValue({ companyId: 'co-1' });
  findMany.mockResolvedValue([]);
});

describe('getOrderLinesPanel', () => {
  it('нет доступа к заказу — блока нет, каталог даже не читается', async () => {
    listOrderLines.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(getOrderLinesPanel(prisma, SESSION, 'ord-1')).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('каталог — активные позиции компании ЗАКАЗА, узким селектом и с потолком', async () => {
    findUnique.mockResolvedValue({ companyId: 'co-42' });
    findMany.mockResolvedValue([
      {
        id: 'ci-1',
        name: 'Обучение по ОТ',
        code: 'OT-1',
        unit: 'person',
        price: new Prisma.Decimal('12500'),
        vatRate: new Prisma.Decimal('0.2'),
        vatIncluded: true,
      },
    ]);

    const panel = await getOrderLinesPanel(prisma, SESSION, 'ord-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'co-42', isActive: true },
        take: 500,
      })
    );
    expect(panel).toEqual({
      view: VIEW,
      catalog: [
        {
          id: 'ci-1',
          name: 'Обучение по ОТ',
          code: 'OT-1',
          unit: 'person',
          // Decimal через границу server→client не проходит: строки, и ставка
          // в том же формате, что у строк заказа (4 знака) — иначе диалог не
          // узнает уже выбранную ставку.
          price: '12500.00',
          vatRate: '0.2000',
          vatIncluded: true,
        },
      ],
    });
  });

  it('«не облагается» остаётся null, а не превращается в ноль', async () => {
    findMany.mockResolvedValue([
      {
        id: 'ci-2',
        name: 'Услуга без НДС',
        code: 'X',
        unit: 'service',
        price: new Prisma.Decimal('100'),
        vatRate: null,
        vatIncluded: false,
      },
    ]);
    const panel = await getOrderLinesPanel(prisma, SESSION, 'ord-1');
    expect(panel?.catalog[0]?.vatRate).toBeNull();
  });

  it('заказ-сирота без компании: строки есть, каталог пуст — а не отказ', async () => {
    findUnique.mockResolvedValue({ companyId: null });
    const panel = await getOrderLinesPanel(prisma, SESSION, 'ord-1');
    expect(panel).toEqual({ view: VIEW, catalog: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('заказ исчез между запросами — каталога нет, экран не падает', async () => {
    findUnique.mockResolvedValue(null);
    const panel = await getOrderLinesPanel(prisma, SESSION, 'ord-1');
    expect(panel).toEqual({ view: VIEW, catalog: [] });
    expect(findMany).not.toHaveBeenCalled();
  });
});
