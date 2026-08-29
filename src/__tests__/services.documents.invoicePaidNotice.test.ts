import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { notifyManagers, warn } = vi.hoisted(() => ({
  notifyManagers: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ notifyManagers }));
vi.mock('@/lib/logging', () => ({ log: { warn, error: vi.fn(), info: vi.fn() } }));

import { notifyInvoicesPaid } from '@/lib/services/documents/invoicePaidNotice';

/**
 * `У-148`, `У-159` — «счёт оплачен» доходит до менеджера.
 *
 * Проверяем два молчания, которые важнее самого уведомления: недоплаченный
 * счёт молчит (иначе сообщение врёт), и повторный платёж по уже закрытому
 * счёту молчит тоже (иначе менеджер получает одно и то же дважды).
 */

const dec = (v: string) => ({ toFixed: () => v }) as unknown as { toFixed: (n?: number) => string };

function fake(opts: {
  invoices?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  already?: boolean;
  order?: unknown;
}) {
  const documentFindMany = vi.fn(async () => opts.invoices ?? []);
  const paymentFindMany = vi.fn(async () => opts.payments ?? []);
  const notificationFindFirst = vi.fn(async () => (opts.already ? { id: 'n-1' } : null));
  const orderFindUnique = vi.fn(async () =>
    opts.order === undefined ? { id: 'ord-1', orderNumber: '123' } : opts.order
  );
  const prisma = {
    document: { findMany: documentFindMany },
    payment: { findMany: paymentFindMany },
    notification: { findFirst: notificationFindFirst },
    order: { findUnique: orderFindUnique },
  } as unknown as PrismaClient;
  return { prisma, notificationFindFirst };
}

const INVOICE = { id: 'doc-1', number: 'С-2026-17', amountGross: dec('12000.00') };
const FULL = [
  { amount: dec('12000.00'), isRefund: false, purpose: 'Оплата по счёту С-2026-17', note: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  notifyManagers.mockResolvedValue({});
});

describe('уведомление «счёт оплачен»', () => {
  it('закрытый счёт — менеджер уведомлён с номером и суммой', async () => {
    const f = fake({ invoices: [INVOICE], payments: FULL });
    expect(await notifyInvoicesPaid(f.prisma, 'ord-1')).toBe(1);
    expect(notifyManagers).toHaveBeenCalledWith(
      f.prisma,
      expect.objectContaining({
        orderId: 'ord-1',
        type: 'invoice_paid',
        payload: expect.objectContaining({
          documentId: 'doc-1',
          documentNumber: 'С-2026-17',
          amount: '12000.00',
        }),
      })
    );
  });

  it('оплачен частично — молчим', async () => {
    const f = fake({
      invoices: [INVOICE],
      payments: [
        {
          amount: dec('5000.00'),
          isRefund: false,
          purpose: 'Аванс по счёту С-2026-17',
          note: null,
        },
      ],
    });
    expect(await notifyInvoicesPaid(f.prisma, 'ord-1')).toBe(0);
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it('о таком счёте уже сообщали — второй раз не тревожим', async () => {
    const f = fake({ invoices: [INVOICE], payments: FULL, already: true });
    expect(await notifyInvoicesPaid(f.prisma, 'ord-1')).toBe(0);
    expect(notifyManagers).not.toHaveBeenCalled();
    expect(f.notificationFindFirst).toHaveBeenCalled();
  });

  it('счетов у заказа нет — платежи даже не читаются', async () => {
    const f = fake({ invoices: [] });
    expect(await notifyInvoicesPaid(f.prisma, 'ord-1')).toBe(0);
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it('заказ исчез — тихо ничего не делаем', async () => {
    const f = fake({ invoices: [INVOICE], payments: FULL, order: null });
    expect(await notifyInvoicesPaid(f.prisma, 'ord-1')).toBe(0);
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it('сбой не-ошибкой тоже попадает в журнал с причиной', async () => {
    notifyManagers.mockRejectedValue('строка вместо ошибки');
    const f = fake({ invoices: [INVOICE], payments: FULL });
    expect(await notifyInvoicesPaid(f.prisma, 'ord-1')).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('сбой доставки не роняет запись платежей', async () => {
    notifyManagers.mockRejectedValue(new Error('почта легла'));
    const f = fake({ invoices: [INVOICE], payments: FULL });
    expect(await notifyInvoicesPaid(f.prisma, 'ord-1')).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});
