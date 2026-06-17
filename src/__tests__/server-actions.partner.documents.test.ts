import { beforeEach, describe, it, expect, vi } from 'vitest';

const { core, notify, getSession } = vi.hoisted(() => ({
  core: vi.fn(), notify: vi.fn(),
  getSession: vi.fn()
}));
vi.mock('@/lib/services/documents/upload-core', () => ({ persistUploadedDocument: core }));
vi.mock('@/lib/notifications', () => ({ notifyManagers: notify }));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { db } = vi.hoisted(() => ({ db: {
  order: { findUnique: vi.fn() },
  partner: { findUnique: vi.fn() }
} }));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));

import { uploadPartnerDocument } from '@/server-actions/partner/documents';

const partnerSession = { sub: 'pu1', role: 'partner', partnerId: 'p1', email: 'p@x.ru', name: 'P' };
const fd = (e: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f; };
const file = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf', { type: 'application/pdf' });

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(partnerSession);
});

describe('uploadPartnerDocument — auth guard', () => {
  it('returns forbidden when session is null', async () => {
    getSession.mockResolvedValue(null);
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(core).not.toHaveBeenCalled();
  });

  it('returns forbidden when session role is not partner', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'organization', partnerId: null });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(core).not.toHaveBeenCalled();
  });

  it('returns forbidden when session has no partnerId', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'partner', partnerId: null });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(core).not.toHaveBeenCalled();
  });
});

describe('uploadPartnerDocument — validation', () => {
  it('returns validation when orderId is missing', async () => {
    const r = await uploadPartnerDocument(fd({ orderId: '', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'validation' });
    expect(core).not.toHaveBeenCalled();
  });

  it('returns validation when orderId key is absent from FormData (covers ?? fallback branch)', async () => {
    // When orderId key is absent: formData.get('orderId') returns null → null ?? '' → ''
    // String(null ?? '') = '' → zod min(1) fails → validation error
    const formWithoutOrderId = new FormData();
    formWithoutOrderId.set('docType', 'act');
    formWithoutOrderId.set('file', file());
    const r = await uploadPartnerDocument(formWithoutOrderId);
    expect(r).toEqual({ ok: false, error: 'validation' });
    expect(core).not.toHaveBeenCalled();
  });

  it('returns validation when file field is not a File', async () => {
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act' }));
    expect(r).toEqual({ ok: false, error: 'validation' });
    expect(core).not.toHaveBeenCalled();
  });
});

describe('uploadPartnerDocument — order scope', () => {
  it('returns not_found when order does not exist', async () => {
    db.order.findUnique.mockResolvedValue(null);
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });

  it('rejects an order that is not the partner\'s', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'OTHER', orderNumber: '1', title: 'T' });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });
});

describe('uploadPartnerDocument — upload failures', () => {
  it('returns upload error from persistUploadedDocument', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'p1', orderNumber: '1', title: 'T' });
    core.mockResolvedValue({ ok: false, error: 'too_large' });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('uploadPartnerDocument — happy path + graceful degradation', () => {
  it('persists incoming partner-channel doc + notifies managers', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'p1', orderNumber: '1', title: 'T' });
    db.partner.findUnique.mockResolvedValue({ name: 'ООО Партнёр' });
    core.mockResolvedValue({ ok: true, documentId: 'doc1' });
    notify.mockResolvedValue({ recipientsNotified: 1 });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: true, documentId: 'doc1' });
    expect(core.mock.calls[0][1].counterparty).toEqual({ type: 'partner', id: 'p1' });
    expect(core.mock.calls[0][1].direction).toBe('incoming');
    expect(notify.mock.calls[0][1].type).toBe('document_uploaded_by_partner');
  });

  it('uses "партнёр" fallback when partner.findUnique returns null', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'p1', orderNumber: '1', title: 'T' });
    db.partner.findUnique.mockResolvedValue(null);
    core.mockResolvedValue({ ok: true, documentId: 'doc-np' });
    notify.mockResolvedValue({ recipientsNotified: 1 });

    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: true, documentId: 'doc-np' });
    expect(notify.mock.calls[0][1].payload).toMatchObject({ partnerName: 'партнёр' });
  });

  it('still returns ok:true when notifyManagers throws (graceful degradation)', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'p1', orderNumber: '1', title: 'T' });
    db.partner.findUnique.mockResolvedValue({ name: 'ООО Партнёр' });
    core.mockResolvedValue({ ok: true, documentId: 'doc2' });
    notify.mockRejectedValue(new Error('notify pipeline down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: true, documentId: 'doc2' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still returns ok:true when notifyManagers throws a non-Error (String(err) branch)', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'p1', orderNumber: '1', title: 'T' });
    db.partner.findUnique.mockResolvedValue({ name: 'P' });
    core.mockResolvedValue({ ok: true, documentId: 'doc3' });
    // Throw a plain string — covers `err instanceof Error ? err.message : String(err)` false branch
    notify.mockRejectedValue('string_error');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: true, documentId: 'doc3' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('covers ?? "other" docType fallback when docType key is absent', async () => {
    // When docType key is absent from FormData: formData.get('docType') returns null
    // → String(null ?? 'other') = 'other'
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'p1', orderNumber: '1', title: 'T' });
    db.partner.findUnique.mockResolvedValue({ name: 'P' });
    core.mockResolvedValue({ ok: true, documentId: 'doc4' });
    notify.mockResolvedValue({ recipientsNotified: 1 });
    const formWithoutDocType = new FormData();
    formWithoutDocType.set('orderId', 'o1');
    formWithoutDocType.set('file', file());
    // No 'docType' key — hits null ?? 'other' fallback
    const r = await uploadPartnerDocument(formWithoutDocType);
    expect(r).toEqual({ ok: true, documentId: 'doc4' });
    expect(core.mock.calls[0][1].docType).toBe('other');
  });
});
