import { describe, it, expect, vi, beforeEach } from 'vitest';

const { uploadMock, addMock, auditMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  addMock: vi.fn(),
  auditMock: vi.fn()
}));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload: uploadMock, createSignedUrl: vi.fn(), remove: vi.fn(), download: vi.fn() }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {}
}));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: addMock }) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: auditMock }));

import { persistUploadedDocument } from '@/lib/services/documents/upload-core';

const baseArgs = {
  counterparty: { type: 'organization' as const, id: 'org-1' },
  orderId: 'order-1',
  direction: 'incoming' as const,
  docType: 'act',
  uploadedById: 'user-1',
  source: 'organization' as const,
  file: { name: 'a.pdf', size: 10, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
};

describe('persistUploadedDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects oversize files before any storage call', async () => {
    const prisma = {} as never;
    const r = await persistUploadedDocument(prisma, {
      ...baseArgs,
      file: { ...baseArgs.file, size: 201 * 1024 * 1024 } // config-driven 200 MB limit §11
    });
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rejects disallowed MIME types', async () => {
    const prisma = {} as never;
    const r = await persistUploadedDocument(prisma, {
      ...baseArgs,
      file: { ...baseArgs.file, mimeType: 'application/x-msdownload' }
    });
    expect(r).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('persists with counterparty + direction and enqueues a scan', async () => {
    uploadMock.mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ id: 'doc-9' });
    const prisma = { document: { create } } as never;
    const r = await persistUploadedDocument(prisma, baseArgs);
    expect(r).toEqual({ ok: true, documentId: 'doc-9' });
    const data = create.mock.calls[0][0].data;
    expect(data.counterpartyType).toBe('organization');
    expect(data.counterpartyId).toBe('org-1');
    expect(data.direction).toBe('incoming');
    expect(addMock).toHaveBeenCalledOnce();
    expect(auditMock).toHaveBeenCalledOnce();
  });

  it('order-less upload sets companyId, null orderId, and counterparty storage path', async () => {
    uploadMock.mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ id: 'doc-orderless' });
    const prisma = { document: { create } } as never;
    const result = await persistUploadedDocument(prisma, {
      counterparty: { type: 'partner', id: 'p1' },
      orderId: null,
      companyId: 'co-1',
      direction: 'outgoing',
      docType: 'other',
      uploadedById: 'u1',
      source: 'manager',
      file: { name: 'x.pdf', size: 10, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
    });
    expect(result.ok).toBe(true);
    const data = create.mock.calls[0][0].data;
    expect(data.orderId).toBeNull();
    expect(data.companyId).toBe('co-1');
    const uploadedPath = uploadMock.mock.calls.at(-1)![0] as string;
    expect(uploadedPath).toMatch(/^counterparty\/partner\/p1\//);
  });

  describe('XOR invariant: exactly one of orderId / companyId must be set', () => {
    it('returns storage error when BOTH orderId and companyId are set', async () => {
      const prisma = {} as never;
      const r = await persistUploadedDocument(prisma, {
        ...baseArgs,
        orderId: 'order-1',
        companyId: 'co-1'
      });
      expect(r).toEqual({ ok: false, error: 'storage' });
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('returns storage error when NEITHER orderId nor companyId is set', async () => {
      const prisma = {} as never;
      const r = await persistUploadedDocument(prisma, {
        ...baseArgs,
        orderId: null,
        companyId: null
      });
      expect(r).toEqual({ ok: false, error: 'storage' });
      expect(uploadMock).not.toHaveBeenCalled();
    });
  });
});
