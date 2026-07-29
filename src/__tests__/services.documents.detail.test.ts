/**
 * §11 ТЗ v0.5 (этап 1 PR-4) — сервис карточки документа.
 *
 * Ключевой инвариант: отказ и отсутствие записи неотличимы снаружи (оба →
 * `not_found`). Иначе по коду ответа перебором узнаётся, какие id существуют.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canReadDocument } = vi.hoisted(() => ({ canReadDocument: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));

import { getDocumentDetail } from '@/lib/services/documents/detail';

const session = { sub: 'u1', role: 'admin' } as SessionPayload;

const BASE_DOC = {
  id: 'doc1',
  name: 'Счёт №5',
  type: 'invoice',
  direction: 'outgoing',
  number: 'С-2026-5',
  version: 2,
  size: 2048,
  mimeType: 'application/pdf',
  scanStatus: 'clean',
  scanReason: null,
  signedAt: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  orderId: 'ord1',
  companyId: null,
  counterpartyType: 'organization',
  counterpartyId: 'org1',
  uploadedBy: { name: 'Иванов', email: 'i@t.local' },
  order: { id: 'ord1', title: 'Заказ', orderNumber: 'ON-1', companyId: 'co1' }
};

function makePrisma(doc: unknown, orgName = 'ООО Ромашка', partnerName = 'Партнёр А') {
  return {
    document: { findUnique: vi.fn().mockResolvedValue(doc) },
    organization: { findUnique: vi.fn().mockResolvedValue(orgName ? { name: orgName } : null) },
    partner: { findUnique: vi.fn().mockResolvedValue(partnerName ? { name: partnerName } : null) }
  } as unknown as PrismaClient;
}

describe('getDocumentDetail', () => {
  beforeEach(() => {
    canReadDocument.mockReset();
  });

  it('несуществующий документ → not_found (политика даже не спрашивается)', async () => {
    const prisma = makePrisma(null);
    const res = await getDocumentDetail(prisma, session, 'nope');
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(canReadDocument).not.toHaveBeenCalled();
  });

  it('чужой документ → not_found, а НЕ forbidden', async () => {
    canReadDocument.mockResolvedValue(false);
    const prisma = makePrisma(BASE_DOC);
    const res = await getDocumentDetail(prisma, session, 'doc1');
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('доступный документ заказа отдаётся с контрагентом и заказом', async () => {
    canReadDocument.mockResolvedValue(true);
    const prisma = makePrisma(BASE_DOC);
    const res = await getDocumentDetail(prisma, session, 'doc1');

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unexpected');
    expect(res.document.name).toBe('Счёт №5');
    expect(res.document.number).toBe('С-2026-5');
    expect(res.document.uploadedByName).toBe('Иванов');
    expect(res.document.order).toEqual({ id: 'ord1', title: 'Заказ', orderNumber: 'ON-1' });
    expect(res.document.counterparty).toEqual({
      type: 'organization',
      id: 'org1',
      name: 'ООО Ромашка'
    });
  });

  it('общий документ (без заказа) отдаёт order = null', async () => {
    canReadDocument.mockResolvedValue(true);
    const prisma = makePrisma({ ...BASE_DOC, orderId: null, order: null, companyId: 'co1' });
    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('unexpected');
    expect(res.document.order).toBeNull();
  });

  it('контрагент-партнёр берётся из справочника партнёров', async () => {
    canReadDocument.mockResolvedValue(true);
    const prisma = makePrisma({
      ...BASE_DOC,
      counterpartyType: 'partner',
      counterpartyId: 'p1'
    });
    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('unexpected');
    expect(res.document.counterparty).toEqual({ type: 'partner', id: 'p1', name: 'Партнёр А' });
  });

  it('удалённый контрагент не роняет карточку — имя null', async () => {
    canReadDocument.mockResolvedValue(true);
    const prisma = makePrisma(BASE_DOC, '', '');
    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('unexpected');
    expect(res.document.counterparty.name).toBeNull();
  });

  it('удалённый партнёр-контрагент не роняет карточку — имя null', async () => {
    canReadDocument.mockResolvedValue(true);
    const prisma = makePrisma(
      { ...BASE_DOC, counterpartyType: 'partner', counterpartyId: 'p1' },
      'ООО Ромашка',
      ''
    );
    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('unexpected');
    expect(res.document.counterparty.name).toBeNull();
  });

  it('если у загрузившего нет имени, показывается почта; нет и её — null', async () => {
    canReadDocument.mockResolvedValue(true);

    const byEmail = await getDocumentDetail(
      makePrisma({ ...BASE_DOC, uploadedBy: { name: null, email: 'x@t.local' } }),
      session,
      'doc1'
    );
    if (!byEmail.ok) throw new Error('unexpected');
    expect(byEmail.document.uploadedByName).toBe('x@t.local');

    const none = await getDocumentDetail(
      makePrisma({ ...BASE_DOC, uploadedBy: null }),
      session,
      'doc1'
    );
    if (!none.ok) throw new Error('unexpected');
    expect(none.document.uploadedByName).toBeNull();
  });

  it('заражённый файл карточку отдаёт — но со статусом и причиной', async () => {
    canReadDocument.mockResolvedValue(true);
    const prisma = makePrisma({
      ...BASE_DOC,
      scanStatus: 'infected',
      scanReason: 'Eicar-Test-Signature'
    });
    const res = await getDocumentDetail(prisma, session, 'doc1');
    if (!res.ok) throw new Error('unexpected');
    expect(res.document.scanStatus).toBe('infected');
    expect(res.document.scanReason).toBe('Eicar-Test-Signature');
  });
});
