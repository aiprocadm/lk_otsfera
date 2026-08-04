import { beforeEach, describe, it, expect, vi } from 'vitest';

/**
 * После аудита A1 экшен — тонкий адаптер формы: гард роли, разбор FormData,
 * вызов сервиса, revalidate. Ветки доступа/записи проверяются в
 * services.organization.documentUpload.unit.test.ts.
 */

const { createDoc, getSession, revalidatePath } = vi.hoisted(() => ({
  createDoc: vi.fn(),
  getSession: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/lib/services/organization/documentUpload', () => ({
  createOrganizationDocument: createDoc,
}));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { uploadOrganizationDocument } from '@/server-actions/organization/documents';

const orgSession = { sub: 'u1', role: 'organization', email: 'o@x.ru', name: 'O' };

function fd(entries: Record<string, string | File>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const file = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf', { type: 'application/pdf' });

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(orgSession);
});

describe('uploadOrganizationDocument — auth guard', () => {
  it('returns forbidden when session is null', async () => {
    getSession.mockResolvedValue(null);
    const r = await uploadOrganizationDocument(
      fd({ organizationId: 'org1', docType: 'act', file: file() })
    );
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('returns forbidden when session role is not organization', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'partner' });
    const r = await uploadOrganizationDocument(
      fd({ organizationId: 'org1', docType: 'act', file: file() })
    );
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(createDoc).not.toHaveBeenCalled();
  });
});

describe('uploadOrganizationDocument — validation', () => {
  it('returns validation when organizationId is missing', async () => {
    const r = await uploadOrganizationDocument(
      fd({ organizationId: '', docType: 'act', file: file() })
    );
    expect(r).toEqual({ ok: false, error: 'validation' });
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('returns validation when file is not a File instance', async () => {
    const r = await uploadOrganizationDocument(fd({ organizationId: 'org1', docType: 'act' }));
    expect(r).toEqual({ ok: false, error: 'validation' });
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('covers ?? fallbacks when organizationId and docType keys are absent from FormData', async () => {
    // When 'organizationId' is absent: formData.get('organizationId') returns null
    // → String(null ?? '') = '' → schema fails validation
    // This covers the `?? ''` and `?? 'other'` false branches
    const formWithNothing = new FormData();
    formWithNothing.set('orderId', 'o1');
    formWithNothing.set('file', file());
    // No 'organizationId' or 'docType' keys
    const r = await uploadOrganizationDocument(formWithNothing);
    // organizationId = '' → schema.min(1) fails → validation error
    expect(r).toEqual({ ok: false, error: 'validation' });
  });
});

describe('uploadOrganizationDocument — делегирование сервису', () => {
  it('передаёт сессию, orderId и содержимое файла, ревалидирует список', async () => {
    createDoc.mockResolvedValue({ ok: true, documentId: 'doc1' });
    const r = await uploadOrganizationDocument(
      fd({ organizationId: 'org1', orderId: 'o1', docType: 'act', file: file() })
    );
    expect(r).toEqual({ ok: true, documentId: 'doc1' });
    expect(createDoc).toHaveBeenCalledWith(expect.anything(), orgSession, {
      organizationId: 'org1',
      orderId: 'o1',
      docType: 'act',
      file: {
        name: 'a.pdf',
        size: 4,
        mimeType: 'application/pdf',
        buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/documents');
  });

  it('без orderId в форме передаёт orderId=null (общий документ организации)', async () => {
    createDoc.mockResolvedValue({ ok: true, documentId: 'doc2' });
    const r = await uploadOrganizationDocument(
      fd({ organizationId: 'org1', docType: 'contract', file: file() })
    );
    expect(r).toEqual({ ok: true, documentId: 'doc2' });
    expect(createDoc.mock.calls[0][2]).toMatchObject({ orderId: null, docType: 'contract' });
  });

  it.each(['forbidden', 'not_found', 'too_large', 'invalid_mime', 'storage'] as const)(
    'пробрасывает %s из сервиса без revalidate',
    async (error) => {
      createDoc.mockResolvedValue({ ok: false, error });
      const r = await uploadOrganizationDocument(
        fd({ organizationId: 'org1', orderId: 'o1', docType: 'act', file: file() })
      );
      expect(r).toEqual({ ok: false, error });
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});
