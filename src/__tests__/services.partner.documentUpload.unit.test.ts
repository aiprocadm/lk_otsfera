/**
 * Unit-тесты для src/lib/services/partner/documentUpload.ts.
 *
 * Ветки доступа и записи переехали сюда из server-action `uploadPartnerDocument`
 * (аудит A1). Ключевой инвариант изоляции: partnerId берётся из сессии, чужой
 * заказ отдаёт not_found.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { core, notify, notifyOrderLess } = vi.hoisted(() => ({
  core: vi.fn(),
  notify: vi.fn(),
  notifyOrderLess: vi.fn(),
}));
vi.mock('@/lib/services/documents/upload-core', () => ({ persistUploadedDocument: core }));
vi.mock('@/lib/notifications', () => ({
  notifyManagers: notify,
  notifyManagersPartnerOrderLess: notifyOrderLess,
}));

import { createPartnerDocument } from '@/lib/services/partner/documentUpload';
import type { SessionPayload } from '@/lib/auth/jwt';

const db = {
  order: { findUnique: vi.fn() },
  partner: { findUnique: vi.fn() },
  organization: { findMany: vi.fn() },
};
const prisma = db as never;

const partnerSession: SessionPayload = {
  sub: 'pu1',
  role: 'partner',
  partnerId: 'p1',
  email: 'p@x.ru',
  name: 'P',
};

const file = () => ({
  name: 'a.pdf',
  size: 4,
  mimeType: 'application/pdf',
  buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
});

const args = () => ({ orderId: 'o1', docType: 'act', file: file() });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createPartnerDocument — partner scope', () => {
  it('returns forbidden when the session carries no partnerId', async () => {
    const r = await createPartnerDocument(prisma, { sub: 'u1', role: 'partner' }, args());
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(db.order.findUnique).not.toHaveBeenCalled();
    expect(core).not.toHaveBeenCalled();
  });

  it('returns not_found when order does not exist', async () => {
    db.order.findUnique.mockResolvedValue(null);
    const r = await createPartnerDocument(prisma, partnerSession, args());
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });

  it("rejects an order that is not the partner's", async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      partnerId: 'OTHER',
      orderNumber: '1',
      title: 'T',
    });
    const r = await createPartnerDocument(prisma, partnerSession, args());
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });
});

describe('createPartnerDocument — upload failures', () => {
  it('returns upload error from persistUploadedDocument', async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      partnerId: 'p1',
      orderNumber: '1',
      title: 'T',
    });
    core.mockResolvedValue({ ok: false, error: 'too_large' });
    const r = await createPartnerDocument(prisma, partnerSession, args());
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('createPartnerDocument — happy path + graceful degradation', () => {
  it('persists incoming partner-channel doc + notifies managers', async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      partnerId: 'p1',
      orderNumber: '1',
      title: 'T',
    });
    db.partner.findUnique.mockResolvedValue({ name: 'ООО Партнёр' });
    core.mockResolvedValue({ ok: true, documentId: 'doc1' });
    notify.mockResolvedValue({ recipientsNotified: 1 });
    const r = await createPartnerDocument(prisma, partnerSession, args());
    expect(r).toEqual({ ok: true, documentId: 'doc1' });
    // Контрагент берётся из сессии, а не из аргументов вызова.
    expect(core.mock.calls[0][1].counterparty).toEqual({ type: 'partner', id: 'p1' });
    expect(core.mock.calls[0][1].direction).toBe('incoming');
    expect(core.mock.calls[0][1].uploadedById).toBe('pu1');
    expect(notify.mock.calls[0][1].type).toBe('document_uploaded_by_partner');
  });

  it('uses "партнёр" fallback when partner.findUnique returns null', async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      partnerId: 'p1',
      orderNumber: '1',
      title: 'T',
    });
    db.partner.findUnique.mockResolvedValue(null);
    core.mockResolvedValue({ ok: true, documentId: 'doc-np' });
    notify.mockResolvedValue({ recipientsNotified: 1 });

    const r = await createPartnerDocument(prisma, partnerSession, args());
    expect(r).toEqual({ ok: true, documentId: 'doc-np' });
    expect(notify.mock.calls[0][1].payload).toMatchObject({ partnerName: 'партнёр' });
  });

  it('still returns ok:true when notifyManagers throws (graceful degradation)', async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      partnerId: 'p1',
      orderNumber: '1',
      title: 'T',
    });
    db.partner.findUnique.mockResolvedValue({ name: 'ООО Партнёр' });
    core.mockResolvedValue({ ok: true, documentId: 'doc2' });
    notify.mockRejectedValue(new Error('notify pipeline down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await createPartnerDocument(prisma, partnerSession, args());
    expect(r).toEqual({ ok: true, documentId: 'doc2' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still returns ok:true when notifyManagers throws a non-Error (String(err) branch)', async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      partnerId: 'p1',
      orderNumber: '1',
      title: 'T',
    });
    db.partner.findUnique.mockResolvedValue({ name: 'P' });
    core.mockResolvedValue({ ok: true, documentId: 'doc3' });
    // Throw a plain string — covers `err instanceof Error ? err.message : String(err)` false branch
    notify.mockRejectedValue('string_error');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await createPartnerDocument(prisma, partnerSession, args());
    expect(r).toEqual({ ok: true, documentId: 'doc3' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

/**
 * `У-115`: общий документ партнёра — тот же канал, что у заказчика. Компания
 * выводится из портфеля; вывести не из чего — честный отказ, а не молчаливый
 * выбор одной из компаний.
 */
describe('createPartnerDocument — общий документ без заказа (У-115)', () => {
  const generalArgs = () => ({ orderId: null, docType: 'contract', file: file() });

  it('пишет документ на компанию портфеля и не трогает заказы', async () => {
    db.organization.findMany.mockResolvedValue([{ companyId: 'c1' }, { companyId: 'c1' }]);
    core.mockResolvedValue({ ok: true, documentId: 'd7' });
    db.partner.findUnique.mockResolvedValue({ name: 'ООО Партнёр' });

    const r = await createPartnerDocument(prisma, partnerSession, generalArgs());

    expect(r).toEqual({ ok: true, documentId: 'd7' });
    expect(db.order.findUnique).not.toHaveBeenCalled();
    expect(core).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        orderId: null,
        companyId: 'c1',
        counterparty: { type: 'partner', id: 'p1' },
        direction: 'incoming',
      })
    );
    expect(notifyOrderLess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ partnerId: 'p1', partnerName: 'ООО Партнёр' })
    );
  });

  it('пустой портфель — company_required, ничего не пишем', async () => {
    db.organization.findMany.mockResolvedValue([]);
    const r = await createPartnerDocument(prisma, partnerSession, generalArgs());
    expect(r).toEqual({ ok: false, error: 'company_required' });
    expect(core).not.toHaveBeenCalled();
  });

  it('портфель по двум компаниям — company_required, а не молчаливый выбор', async () => {
    db.organization.findMany.mockResolvedValue([{ companyId: 'c1' }, { companyId: 'c2' }]);
    const r = await createPartnerDocument(prisma, partnerSession, generalArgs());
    expect(r).toEqual({ ok: false, error: 'company_required' });
    expect(core).not.toHaveBeenCalled();
  });

  it('организации без компании в расчёт не идут', async () => {
    db.organization.findMany.mockResolvedValue([{ companyId: null }, { companyId: 'c9' }]);
    core.mockResolvedValue({ ok: true, documentId: 'd8' });
    db.partner.findUnique.mockResolvedValue({ name: 'P' });
    const r = await createPartnerDocument(prisma, partnerSession, generalArgs());
    expect(r).toEqual({ ok: true, documentId: 'd8' });
    expect(core).toHaveBeenCalledWith(prisma, expect.objectContaining({ companyId: 'c9' }));
  });

  it('сбой хранилища возвращается как есть, рассылки не будет', async () => {
    db.organization.findMany.mockResolvedValue([{ companyId: 'c1' }]);
    core.mockResolvedValue({ ok: false, error: 'storage' });
    const r = await createPartnerDocument(prisma, partnerSession, generalArgs());
    expect(r).toEqual({ ok: false, error: 'storage' });
    expect(notifyOrderLess).not.toHaveBeenCalled();
  });

  it('падение рассылки не откатывает загрузку (§3 degrade gracefully)', async () => {
    db.organization.findMany.mockResolvedValue([{ companyId: 'c1' }]);
    core.mockResolvedValue({ ok: true, documentId: 'd9' });
    db.partner.findUnique.mockResolvedValue(null);
    notifyOrderLess.mockRejectedValue(new Error('smtp down'));
    const r = await createPartnerDocument(prisma, partnerSession, generalArgs());
    expect(r).toEqual({ ok: true, documentId: 'd9' });
    expect(notifyOrderLess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ partnerName: 'партнёр' })
    );
  });

  it('строка-не-Error в рассылке тоже проглатывается', async () => {
    db.organization.findMany.mockResolvedValue([{ companyId: 'c1' }]);
    core.mockResolvedValue({ ok: true, documentId: 'd10' });
    db.partner.findUnique.mockResolvedValue({ name: 'P' });
    notifyOrderLess.mockRejectedValue('строка вместо ошибки');
    const r = await createPartnerDocument(prisma, partnerSession, generalArgs());
    expect(r).toEqual({ ok: true, documentId: 'd10' });
  });
});
