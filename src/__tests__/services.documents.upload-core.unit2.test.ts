/**
 * Unit tests extending coverage for documents/upload-core.ts — covers
 * the magic-bytes validation failure branch (mimeType in SUPPORTED_MIME_TYPES
 * but magic bytes do not match).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { uploadMock, addMock, auditMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  addMock: vi.fn(),
  auditMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload: uploadMock, createSignedUrl: vi.fn(), remove: vi.fn(), download: vi.fn() }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {},
}));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: addMock }) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: auditMock }));

import { persistUploadedDocument, validateUploadFile } from '@/lib/services/documents/upload-core';

beforeEach(() => {
  vi.clearAllMocks();
});

// PDF magic bytes: %PDF = [0x25, 0x50, 0x44, 0x46]
const validPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const invalidBytesForPdf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

describe('validateUploadFile — magic bytes branch', () => {
  it('ok=true for valid PDF with correct magic bytes', () => {
    const result = validateUploadFile({
      size: validPdfBuffer.length,
      mimeType: 'application/pdf',
      buffer: validPdfBuffer,
    });
    expect(result).toEqual({ ok: true });
  });

  it('ok=false invalid_mime for PDF mimeType with wrong magic bytes', () => {
    const result = validateUploadFile({
      size: 10,
      mimeType: 'application/pdf',
      buffer: invalidBytesForPdf,
    });
    expect(result).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('ok=true for vnd.ms-excel mimeType (not in SUPPORTED_MIME_TYPES, no magic check)', () => {
    // application/vnd.ms-excel is in ALLOWED_MIME_TYPES but NOT in SUPPORTED_MIME_TYPES
    // → magic byte check is skipped → always ok if not too_large
    const result = validateUploadFile({
      size: 10,
      mimeType: 'application/vnd.ms-excel',
      buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
    });
    expect(result).toEqual({ ok: true });
  });
});

describe('persistUploadedDocument — storage upload failure', () => {
  const baseArgs = {
    counterparty: { type: 'organization' as const, id: 'org-1' },
    orderId: 'order-1',
    direction: 'incoming' as const,
    docType: 'act',
    uploadedById: 'user-1',
    source: 'organization' as const,
    file: { name: 'a.pdf', size: 10, mimeType: 'application/pdf', buffer: validPdfBuffer },
  };

  it('returns storage error when object storage (S3) upload fails', async () => {
    uploadMock.mockRejectedValue(new Error('storage error'));
    const prisma = {} as never;
    const r = await persistUploadedDocument(prisma, baseArgs);
    expect(r).toEqual({ ok: false, error: 'storage' });
    expect(addMock).not.toHaveBeenCalled();
  });

  it('returns storage error when upload throws a non-Error (String(uploadError) branch)', async () => {
    // Covers line 102: uploadError instanceof Error ? ... : String(uploadError) — non-Error arm
    uploadMock.mockRejectedValue('disk full');
    const prisma = {} as never;
    const r = await persistUploadedDocument(prisma, baseArgs);
    expect(r).toEqual({ ok: false, error: 'storage' });
    expect(addMock).not.toHaveBeenCalled();
  });

  it('best-effort scan enqueue: swallows queue error', async () => {
    uploadMock.mockResolvedValue(undefined);
    addMock.mockRejectedValue(new Error('Redis down'));
    const create = vi.fn().mockResolvedValue({ id: 'doc-scan-fail' });
    const prisma = { document: { create } } as never;
    // Should not throw even if queue throws
    const r = await persistUploadedDocument(prisma, baseArgs);
    expect(r).toEqual({ ok: true, documentId: 'doc-scan-fail' });
    expect(auditMock).toHaveBeenCalledOnce();
  });

  it('coerces unknown docType to "other"', async () => {
    uploadMock.mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ id: 'doc-other' });
    const prisma = { document: { create } } as never;
    await persistUploadedDocument(prisma, { ...baseArgs, docType: 'totally_unknown_type' });
    expect(create.mock.calls[0][0].data.type).toBe('other');
  });

  it('best-effort scan enqueue: swallows non-Error throw (String(err) branch)', async () => {
    // Covers line 132: err instanceof Error ? err.message : String(err) — arm 0 (err is not an Error)
    uploadMock.mockResolvedValue(undefined);
    addMock.mockRejectedValue('string-rejection'); // throw a plain string, not an Error
    const create = vi.fn().mockResolvedValue({ id: 'doc-string-err' });
    const prisma = { document: { create } } as never;
    const r = await persistUploadedDocument(prisma, baseArgs);
    expect(r).toEqual({ ok: true, documentId: 'doc-string-err' });
  });

  it('sanitizes filename with special chars', async () => {
    uploadMock.mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ id: 'doc-sanitized' });
    const prisma = { document: { create } } as never;
    await persistUploadedDocument(prisma, {
      ...baseArgs,
      file: { ...baseArgs.file, name: 'file (1) Тест!.pdf' },
    });
    const storagePath: string = uploadMock.mock.calls[0][0];
    // Filename part should only contain safe chars
    const filename = storagePath.split('/').pop()!;
    // UUID + sanitized name: special chars replaced with underscores
    expect(filename).toMatch(/^[a-f0-9-]+-file_.+\.pdf$/i);
    // No unsafe characters (only alphanumeric, dot, dash, underscore)
    expect(filename).toMatch(/^[a-z0-9._-]+$/i);
  });
});
