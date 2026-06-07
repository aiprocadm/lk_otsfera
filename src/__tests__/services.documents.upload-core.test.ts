import { describe, it, expect, vi } from 'vitest';

const { uploadMock, addMock, auditMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  addMock: vi.fn(),
  auditMock: vi.fn()
}));
vi.mock('@/lib/storage/supabase', () => ({
  documentBucket: 'documents',
  supabaseAdmin: { storage: { from: () => ({ upload: uploadMock }) } }
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
  it('rejects oversize files before any storage call', async () => {
    const prisma = {} as never;
    const r = await persistUploadedDocument(prisma, {
      ...baseArgs,
      file: { ...baseArgs.file, size: 21 * 1024 * 1024 }
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
    uploadMock.mockResolvedValue({ error: null });
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
});
