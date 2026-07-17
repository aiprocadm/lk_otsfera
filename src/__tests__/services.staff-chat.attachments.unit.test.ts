/**
 * Unit tests for src/lib/services/staffChat/attachments.ts
 * Mirrors services.chat.attachments.unit.test.ts, adapted for staff-chat's
 * differences: StaffConversation scoping (canSeeStaffConversation) instead of
 * canSeeThread, and an AV-scan gate (scanStatus pending/error/infected) on the
 * signed-URL path that client chat does not have.
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
    download: vi.fn(),
  }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {},
}));

// Mock mimeValidator
const validateMagicBytesMock = vi.fn();
vi.mock('@/lib/storage/mimeValidator', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf', 'image/jpeg', 'image/png'],
  validateMagicBytes: (...args: any[]) => validateMagicBytesMock(...args),
}));

// Mock policy
vi.mock('@/lib/services/staffChat/policy', () => ({
  canSeeStaffConversation: vi.fn(),
}));

import { uploadStaffAttachment, getStaffAttachmentSignedUrl } from '@/lib/services/staffChat/attachments';
import { canSeeStaffConversation } from '@/lib/services/staffChat/policy';
import { maxFileSizeBytes } from '@/lib/config/upload';

const canSeeStaffConversationMock = canSeeStaffConversation as ReturnType<typeof vi.fn>;

const session = { sub: 'u1', role: 'manager', companyId: 'c1' } as any;

const validFile = {
  name: 'test.pdf',
  size: 100,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 fake content'),
};

function makePrisma(conversation: object | null = { id: 'conv1', kind: 'dm', companyId: 'c1', participants: [{ userId: 'u1' }] }) {
  return {
    staffConversation: { findUnique: vi.fn().mockResolvedValue(conversation) },
  } as any;
}

function makeMessagePrisma(message: object | null) {
  return {
    staffMessage: { findUnique: vi.fn().mockResolvedValue(message) },
  } as any;
}

beforeEach(() => {
  canSeeStaffConversationMock.mockReset();
  uploadMock.mockReset();
  createSignedUrlMock.mockReset();
  validateMagicBytesMock.mockReset();
});

// ─── uploadStaffAttachment ─────────────────────────────────────────────────

describe('uploadStaffAttachment — unit', () => {
  it('rejects file exceeding the size cap', async () => {
    const bigFile = { ...validFile, size: maxFileSizeBytes() + 1024 };
    const result = await uploadStaffAttachment(makePrisma(), session, { conversationId: 'conv1', file: bigFile });
    expect(result).toEqual({ ok: false, error: 'too_large' });
  });

  it('rejects unsupported MIME type', async () => {
    const badFile = { ...validFile, mimeType: 'text/plain' };
    const result = await uploadStaffAttachment(makePrisma(), session, { conversationId: 'conv1', file: badFile });
    expect(result).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('rejects when magic-byte validation fails for PDF', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: false, error: 'magic_mismatch' });
    const result = await uploadStaffAttachment(makePrisma(), session, { conversationId: 'conv1', file: validFile });
    expect(result).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('does NOT run magic-byte check for vnd.ms-excel (unsupported in SUPPORTED_MIME_TYPES)', async () => {
    canSeeStaffConversationMock.mockReturnValue(true);
    uploadMock.mockResolvedValue(undefined);
    const excelFile = { ...validFile, mimeType: 'application/vnd.ms-excel' };
    const result = await uploadStaffAttachment(makePrisma(), session, { conversationId: 'conv1', file: excelFile });
    expect(validateMagicBytesMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('returns conversation_not_found when the conversation does not exist', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: true });
    const result = await uploadStaffAttachment(makePrisma(null), session, { conversationId: 'missing', file: validFile });
    expect(result).toEqual({ ok: false, error: 'conversation_not_found' });
  });

  it('returns forbidden for a non-staff caller', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: true });
    canSeeStaffConversationMock.mockReturnValue(false);
    const result = await uploadStaffAttachment(makePrisma(), session, { conversationId: 'conv1', file: validFile });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns forbidden for a staff member who is not a participant of the DM', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: true });
    canSeeStaffConversationMock.mockReturnValue(false);
    const dm = { id: 'conv1', kind: 'dm', companyId: 'c1', participants: [{ userId: 'u2' }, { userId: 'u3' }] };
    const result = await uploadStaffAttachment(makePrisma(dm), session, { conversationId: 'conv1', file: validFile });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns storage error when object storage (S3) upload fails', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: true });
    canSeeStaffConversationMock.mockReturnValue(true);
    uploadMock.mockRejectedValue(new Error('bucket not found'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await uploadStaffAttachment(makePrisma(), session, { conversationId: 'conv1', file: validFile });
    expect(result).toEqual({ ok: false, error: 'storage' });
    consoleSpy.mockRestore();
  });

  it('returns storage error when upload rejects with a non-Error value', async () => {
    // Exercises the String(uploadError) fallback in the providerError log (non-Error throw).
    validateMagicBytesMock.mockReturnValue({ ok: true });
    canSeeStaffConversationMock.mockReturnValue(true);
    uploadMock.mockRejectedValue('disk full');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await uploadStaffAttachment(makePrisma(), session, { conversationId: 'conv1', file: validFile });
    expect(result).toEqual({ ok: false, error: 'storage' });
    consoleSpy.mockRestore();
  });

  it('returns ok with attachmentPath shaped staff-chat/<convId>/<uuid>-<sanitized> on successful upload', async () => {
    validateMagicBytesMock.mockReturnValue({ ok: true });
    canSeeStaffConversationMock.mockReturnValue(true);
    uploadMock.mockResolvedValue(undefined);
    const weirdNameFile = { ...validFile, name: 'my report (final)!.pdf' };
    const result = await uploadStaffAttachment(makePrisma(), session, { conversationId: 'conv1', file: weirdNameFile });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attachmentPath).toMatch(
        /^staff-chat\/conv1\/[0-9a-f-]{36}-my_report__final__\.pdf$/
      );
    }
  });
});

// ─── getStaffAttachmentSignedUrl ────────────────────────────────────────────

describe('getStaffAttachmentSignedUrl — unit', () => {
  const conv = { id: 'conv1', kind: 'dm', companyId: 'c1', participants: [{ userId: 'u1' }] };

  it('returns not_found when the message does not exist', async () => {
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(null), session, { messageId: 'msg-x' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found when the message has no attachmentPath', async () => {
    const msg = { id: 'm1', attachmentPath: null, attachmentName: null, scanStatus: 'none', conversation: conv };
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found when attachmentPath does not start with staff-chat/ (belt-and-suspenders)', async () => {
    canSeeStaffConversationMock.mockReturnValue(true);
    const msg = {
      id: 'm1',
      attachmentPath: 'documents/evil.pdf',
      attachmentName: 'evil.pdf',
      scanStatus: 'clean',
      conversation: conv,
    };
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('returns forbidden when canSeeStaffConversation returns false', async () => {
    canSeeStaffConversationMock.mockReturnValue(false);
    const msg = {
      id: 'm1',
      attachmentPath: 'staff-chat/conv1/uuid-file.pdf',
      attachmentName: 'file.pdf',
      scanStatus: 'clean',
      conversation: conv,
    };
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns not_ready when scanStatus is pending', async () => {
    canSeeStaffConversationMock.mockReturnValue(true);
    const msg = {
      id: 'm1',
      attachmentPath: 'staff-chat/conv1/uuid-file.pdf',
      attachmentName: 'file.pdf',
      scanStatus: 'pending',
      conversation: conv,
    };
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: false, error: 'not_ready' });
  });

  it('returns not_ready when scanStatus is error', async () => {
    canSeeStaffConversationMock.mockReturnValue(true);
    const msg = {
      id: 'm1',
      attachmentPath: 'staff-chat/conv1/uuid-file.pdf',
      attachmentName: 'file.pdf',
      scanStatus: 'error',
      conversation: conv,
    };
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: false, error: 'not_ready' });
  });

  it('returns infected when scanStatus is infected', async () => {
    canSeeStaffConversationMock.mockReturnValue(true);
    const msg = {
      id: 'm1',
      attachmentPath: 'staff-chat/conv1/uuid-file.pdf',
      attachmentName: 'file.pdf',
      scanStatus: 'infected',
      conversation: conv,
    };
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: false, error: 'infected' });
  });

  it('returns ok with signed URL on success, using 600s TTL and the attachment name for download', async () => {
    canSeeStaffConversationMock.mockReturnValue(true);
    createSignedUrlMock.mockResolvedValue('https://cdn.example.com/signed-url');
    const msg = {
      id: 'm1',
      attachmentPath: 'staff-chat/conv1/uuid-file.pdf',
      attachmentName: 'report.pdf',
      scanStatus: 'clean',
      conversation: conv,
    };
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: true, url: 'https://cdn.example.com/signed-url' });
    expect(createSignedUrlMock).toHaveBeenCalledWith('staff-chat/conv1/uuid-file.pdf', 600, {
      download: 'report.pdf',
    });
  });

  it('falls back to download:true when attachmentName is null', async () => {
    canSeeStaffConversationMock.mockReturnValue(true);
    createSignedUrlMock.mockResolvedValue('https://cdn.example.com/signed-url-2');
    const msg = {
      id: 'm1',
      attachmentPath: 'staff-chat/conv1/uuid-file.pdf',
      attachmentName: null,
      scanStatus: 'clean',
      conversation: conv,
    };
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: true, url: 'https://cdn.example.com/signed-url-2' });
    expect(createSignedUrlMock).toHaveBeenCalledWith('staff-chat/conv1/uuid-file.pdf', 600, {
      download: true,
    });
  });

  it('returns storage error when object storage (S3) signed URL creation fails', async () => {
    canSeeStaffConversationMock.mockReturnValue(true);
    createSignedUrlMock.mockRejectedValue(new Error('provider down'));
    const msg = {
      id: 'm1',
      attachmentPath: 'staff-chat/conv1/uuid-file.pdf',
      attachmentName: 'file.pdf',
      scanStatus: 'clean',
      conversation: conv,
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: false, error: 'storage' });
    consoleSpy.mockRestore();
  });

  it('returns storage error when signed URL creation rejects with a non-Error value', async () => {
    // Exercises the String(error) fallback in the providerError log (non-Error throw).
    canSeeStaffConversationMock.mockReturnValue(true);
    createSignedUrlMock.mockRejectedValue('provider exploded');
    const msg = {
      id: 'm1',
      attachmentPath: 'staff-chat/conv1/uuid-file.pdf',
      attachmentName: 'file.pdf',
      scanStatus: 'clean',
      conversation: conv,
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getStaffAttachmentSignedUrl(makeMessagePrisma(msg), session, { messageId: 'm1' });
    expect(result).toEqual({ ok: false, error: 'storage' });
    consoleSpy.mockRestore();
  });
});
