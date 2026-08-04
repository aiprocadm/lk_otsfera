import { beforeEach, describe, it, expect, vi } from 'vitest';

/**
 * После аудита A1 экшен — тонкий адаптер формы: гард роли/партнёра, разбор
 * FormData, вызов сервиса, revalidate. Ветки доступа/записи проверяются в
 * services.partner.documentUpload.unit.test.ts.
 */

const { createDoc, getSession, revalidatePath } = vi.hoisted(() => ({
  createDoc: vi.fn(),
  getSession: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/lib/services/partner/documentUpload', () => ({ createPartnerDocument: createDoc }));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { uploadPartnerDocument } from '@/server-actions/partner/documents';

const partnerSession = { sub: 'pu1', role: 'partner', partnerId: 'p1', email: 'p@x.ru', name: 'P' };
const fd = (e: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(e)) f.set(k, v);
  return f;
};
const file = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf', { type: 'application/pdf' });

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(partnerSession);
});

describe('uploadPartnerDocument — auth guard', () => {
  it('returns forbidden when session is null', async () => {
    getSession.mockResolvedValue(null);
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('returns forbidden when session role is not partner', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'organization', partnerId: null });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('returns forbidden when session has no partnerId', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'partner', partnerId: null });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(createDoc).not.toHaveBeenCalled();
  });
});

describe('uploadPartnerDocument — validation', () => {
  it('returns validation when orderId is missing', async () => {
    const r = await uploadPartnerDocument(fd({ orderId: '', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'validation' });
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('returns validation when orderId key is absent from FormData (covers ?? fallback branch)', async () => {
    // When orderId key is absent: formData.get('orderId') returns null → null ?? '' → ''
    // String(null ?? '') = '' → zod min(1) fails → validation error
    const formWithoutOrderId = new FormData();
    formWithoutOrderId.set('docType', 'act');
    formWithoutOrderId.set('file', file());
    const r = await uploadPartnerDocument(formWithoutOrderId);
    expect(r).toEqual({ ok: false, error: 'validation' });
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('returns validation when file field is not a File', async () => {
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act' }));
    expect(r).toEqual({ ok: false, error: 'validation' });
    expect(createDoc).not.toHaveBeenCalled();
  });
});

describe('uploadPartnerDocument — делегирование сервису', () => {
  it('передаёт сессию и содержимое файла, ревалидирует список', async () => {
    createDoc.mockResolvedValue({ ok: true, documentId: 'doc1' });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: true, documentId: 'doc1' });
    expect(createDoc).toHaveBeenCalledWith(expect.anything(), partnerSession, {
      orderId: 'o1',
      docType: 'act',
      file: {
        name: 'a.pdf',
        size: 4,
        mimeType: 'application/pdf',
        buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/partner/documents');
  });

  it('covers ?? "other" docType fallback when docType key is absent', async () => {
    // When docType key is absent from FormData: formData.get('docType') returns null
    // → String(null ?? 'other') = 'other'
    createDoc.mockResolvedValue({ ok: true, documentId: 'doc4' });
    const formWithoutDocType = new FormData();
    formWithoutDocType.set('orderId', 'o1');
    formWithoutDocType.set('file', file());
    // No 'docType' key — hits null ?? 'other' fallback
    const r = await uploadPartnerDocument(formWithoutDocType);
    expect(r).toEqual({ ok: true, documentId: 'doc4' });
    expect(createDoc.mock.calls[0][2].docType).toBe('other');
  });

  it.each(['forbidden', 'not_found', 'too_large', 'invalid_mime', 'storage'] as const)(
    'пробрасывает %s из сервиса без revalidate',
    async (error) => {
      createDoc.mockResolvedValue({ ok: false, error });
      const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
      expect(r).toEqual({ ok: false, error });
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});
