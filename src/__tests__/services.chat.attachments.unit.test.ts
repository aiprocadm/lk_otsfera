/**
 * Unit tests for src/lib/services/chat/attachments.ts
 * Covers branches missed by the integration test (storage errors, validation paths).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock object storage
const uploadMock = vi.fn();
const createSignedUrlMock = vi.fn();
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: uploadMock,
    createSignedUrl: createSignedUrlMock,
    remove: vi.fn(),
    download: vi.fn()
  }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {}
}));

// Mock mimeValidator
const validateMagicBytesMock = vi.fn();
vi.mock('@/lib/storage/mimeValidator', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf', 'image/jpeg', 'image/png'],
  validateMagicBytes: (...args: any[]) => validateMagicBytesMock(...args)
}));

// Mock policy
vi.mock('@/lib/services/chat/policy', () => ({
  canSeeThread: vi.fn()
}));

import { uploadChatAttachment, getChatAttachmentSignedUrl } from '@/lib/services/chat/attachments';
import { canSeeThread } from '@/lib/services/chat/policy';
const canSeeThreadMock = canSeeThread as ReturnType<typeof vi.fn>;

const session = { sub: 'u1', role: 'manager', companyId: 'c1' } as any;

const validFile = {
  name: 'test.pdf',
  size: 100,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 fake content')
};

function makePrisma(order: object | null = { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' }) {
  return {
    order: { findUnique: vi.fn().mockResolvedValue(order) }
  } as any;
}

function makeMessagePrisma(message: object | null) {
  return {
    message: { findUnique: vi.fn().mockResolvedValue(message) }
  } as any;
}

beforeEach(() => {
  canSeeThreadMock.mockReset();
  uploadMock.mockReset();
  createSignedUrlMock.mockReset();
  validateMagicBytesMock.mockReset();
});

// ─── uploadChatAttachment ─────────────────────────────────────────────────────

describe('uploadChatAttachment — unit', () => {
  it('rejects file exceeding 20 MB size cap', async () => {
    const bigFile = { ...validFile, size: 21 * 1024 * 1024 };
    const result = await uploadChatAttachment(makePrisma(), session, { orderId: 'o1', side: 'org', file: bigFile });
    expect(result).toEqual({ ok: false, error: 'too_large' });
  });

  it('rejects unsupported MIME type', async () => {
    const badFile = { ...validFile, mimeType: 'text/plain' };
    const result = await uploadChatAttachment(makePrisma(), session, { orderId: 'o1', side: 'org', file: badFile });
    expect(result).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('rejects when magic-byte validation fails for PDF', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: false, error: 'magic_mismatch' });
    const result = await uploadChatAttachment(makePrisma(), session, { orderId: 'o1', side: 'org', file: validFile });
    expect(result).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('returns order_not_found when order does not exist', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: true });
    const result = await uploadChatAttachment(makePrisma(null), session, { orderId: 'x', side: 'org', file: validFile });
    expect(result).toEqual({ ok: false, error: 'order_not_found' });
  });

  it('returns forbidden when canSeeThread is false', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: true });
    canSeeThreadMock.mockReturnValue(false);
    const result = await uploadChatAttachment(makePrisma(), session, { orderId: 'o1', side: 'org', file: validFile });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns storage error when Supabase upload fails', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: true });
    canSeeThreadMock.mockReturnValue(true);
    uploadMock.mockRejectedValue(new Error('bucket not found'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await uploadChatAttachment(makePrisma(), session, { orderId: 'o1', side: 'org', file: validFile });
    expect(result).toEqual({ ok: false, error: 'storage' });
    consoleSpy.mockRestore();
  });

  it('returns ok with attachmentPath on successful upload', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: true });
    canSeeThreadMock.mockReturnValue(true);
    uploadMock.mockResolvedValue(undefined);
    const result = await uploadChatAttachment(makePrisma(), session, { orderId: 'o1', side: 'org', file: validFile });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attachmentPath).toMatch(/^chat\/o1\//);
    }
  });

  it('does NOT run magic-byte check for vnd.ms-excel (unsupported in SUPPORTED_MIME_TYPES)', async () => {
    // vnd.ms-excel is in ALLOWED_MIME_TYPES but NOT in SUPPORTED_MIME_TYPES → no magic check
    canSeeThreadMock.mockReturnValue(true);
    uploadMock.mockResolvedValue(undefined);
    const excelFile = { ...validFile, mimeType: 'application/vnd.ms-excel' };
    const result = await uploadChatAttachment(makePrisma(), session, { orderId: 'o1', side: 'org', file: excelFile });
    expect(validateMagicBytesMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

// ─── getChatAttachmentSignedUrl ───────────────────────────────────────────────

describe('getChatAttachmentSignedUrl — unit', () => {
  it('returns not_found when message does not exist', async () => {
    const result = await getChatAttachmentSignedUrl(makeMessagePrisma(null), session, 'msg-x');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found when message has no attachmentPath', async () => {
    const msg = {
      id: 'm1', attachmentPath: null,
      thread: { side: 'org', order: { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' } }
    };
    const result = await getChatAttachmentSignedUrl(makeMessagePrisma(msg), session, 'm1');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found when attachmentPath does not start with chat/ (belt-and-suspenders)', async () => {
    const msg = {
      id: 'm1', attachmentPath: 'documents/some/old-path.pdf',
      thread: { side: 'org', order: { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' } }
    };
    const result = await getChatAttachmentSignedUrl(makeMessagePrisma(msg), session, 'm1');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns forbidden when canSeeThread returns false', async () => {
    canSeeThreadMock.mockReturnValue(false);
    const msg = {
      id: 'm1', attachmentPath: 'chat/o1/uuid-file.pdf',
      thread: { side: 'org', order: { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' } }
    };
    const result = await getChatAttachmentSignedUrl(makeMessagePrisma(msg), session, 'm1');
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns storage error when Supabase signed URL creation fails', async () => {
    canSeeThreadMock.mockReturnValue(true);
    createSignedUrlMock.mockRejectedValue(new Error('provider down'));
    const msg = {
      id: 'm1', attachmentPath: 'chat/o1/uuid-file.pdf',
      thread: { side: 'org', order: { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' } }
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getChatAttachmentSignedUrl(makeMessagePrisma(msg), session, 'm1');
    expect(result).toEqual({ ok: false, error: 'storage' });
    consoleSpy.mockRestore();
  });

  it('returns storage error when the storage port throws a StorageError', async () => {
    canSeeThreadMock.mockReturnValue(true);
    createSignedUrlMock.mockRejectedValue(new Error('missing signed URL'));
    const msg = {
      id: 'm1', attachmentPath: 'chat/o1/uuid-file.pdf',
      thread: { side: 'org', order: { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' } }
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getChatAttachmentSignedUrl(makeMessagePrisma(msg), session, 'm1');
    expect(result).toEqual({ ok: false, error: 'storage' });
    consoleSpy.mockRestore();
  });

  it('returns ok with signed URL on success', async () => {
    canSeeThreadMock.mockReturnValue(true);
    createSignedUrlMock.mockResolvedValue('https://cdn.example.com/signed-url');
    const msg = {
      id: 'm1', attachmentPath: 'chat/o1/uuid-file.pdf',
      thread: { side: 'org', order: { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' } }
    };
    const result = await getChatAttachmentSignedUrl(makeMessagePrisma(msg), session, 'm1');
    expect(result).toEqual({ ok: true, url: 'https://cdn.example.com/signed-url' });
  });
});
