/**
 * `У-148` — признак оплаты счёта в карточке документа.
 *
 * Считается ТОЛЬКО у счёта и только по платежам его заказа. Проверяем и то,
 * когда он не считается вовсе: у документа без суммы (выпущен до этапа 6), у
 * счёта без номера и у акта платежи спрашивать незачем — лишний запрос к базе
 * на каждой карточке хуже, чем пустая строка на экране.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canReadDocument } = vi.hoisted(() => ({ canReadDocument: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));

import { getDocumentDetail } from '@/lib/services/documents/detail';

const session = { sub: 'u1', role: 'admin' } as SessionPayload;

/** Decimal из Prisma наружу отдаётся через `toFixed` — этого хватает. */
const dec = (v: string) => ({ toFixed: () => v }) as unknown as { toFixed: (n?: number) => string };

const INVOICE = {
  id: 'doc1',
  name: 'Счёт №5',
  type: 'invoice',
  direction: 'outgoing',
  number: 'С-2026-5',
  version: 1,
  size: 2048,
  mimeType: 'application/pdf',
  scanStatus: 'clean',
  scanReason: null,
  signedAt: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  status: 'issued',
  amountGross: dec('12000.00'),
  sentAt: null,
  acceptedAt: null,
  orderId: 'ord1',
  companyId: null,
  counterpartyType: 'organization',
  counterpartyId: 'org1',
  uploadedBy: { name: 'Иванов', email: 'i@t.local' },
  order: { id: 'ord1', title: 'Заказ', orderNumber: 'ON-1', companyId: 'co1' },
};

function makePrisma(doc: unknown, payments: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(payments);
  const prisma = {
    document: { findUnique: vi.fn().mockResolvedValue(doc) },
    organization: { findUnique: vi.fn().mockResolvedValue({ name: 'ООО Ромашка' }) },
    partner: { findUnique: vi.fn().mockResolvedValue(null) },
    payment: { findMany },
  } as unknown as PrismaClient;
  return { prisma, findMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  canReadDocument.mockResolvedValue(true);
});

describe('признак оплаты в карточке документа', () => {
  it('счёт с суммой: платежи заказа прочитаны, состояние посчитано', async () => {
    const { prisma, findMany } = makePrisma(INVOICE, [
      { amount: dec('12000.00'), isRefund: false, purpose: 'Оплата по счёту С-2026-5', note: null },
    ]);

    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.document.payment).toEqual({
      state: 'paid',
      paid: 12000,
      matched: true,
      ambiguous: false,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 'ord1' } }));
  });

  it('платёж без ссылки на счёт — «не удалось сопоставить», а не «оплачен»', async () => {
    const { prisma } = makePrisma(INVOICE, [
      { amount: dec('12000.00'), isRefund: false, purpose: 'Оплата по договору', note: null },
    ]);

    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.document.payment).toEqual({
      state: 'unpaid',
      paid: 0,
      matched: false,
      ambiguous: false,
    });
  });

  it('акт: платежи даже не спрашиваются', async () => {
    const { prisma, findMany } = makePrisma({ ...INVOICE, type: 'act' });

    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.document.payment).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('счёт без суммы (выпущен до этапа 6): признак не считается', async () => {
    const { prisma, findMany } = makePrisma({ ...INVOICE, amountGross: null });

    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.document.payment).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('счёт без номера: сослаться не на что — признака нет', async () => {
    const { prisma, findMany } = makePrisma({ ...INVOICE, number: null });

    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.document.payment).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('счёт вне заказа: платежей заказа нет — признака нет', async () => {
    const { prisma, findMany } = makePrisma({ ...INVOICE, orderId: null, order: null });

    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.document.payment).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
