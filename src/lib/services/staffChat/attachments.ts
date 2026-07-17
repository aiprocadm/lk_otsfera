import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeStaffConversation } from './policy';
import { getObjectStorage } from '@/lib/storage';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';
import { maxFileSizeBytes } from '@/lib/config/upload';
import { log } from '@/lib/logging';

/**
 * Staff-chat attachment upload + signed-URL download service.
 *
 * Validation is SYNCHRONOUS: MIME allow-list + magic-byte fingerprint +
 * config-driven size cap (maxFileSizeBytes() from @/lib/config/upload) — same
 * as chat/attachments.ts. UNLIKE client chat (no AV scan in v1, deferred to
 * v1.1), staff-chat attachments DO go through the async ClamAV pipeline
 * (spec §2.4): `sendStaffMessage` enqueues a `docs.scanDocument` job with
 * `{kind:'staff_attachment', id: messageId}` and the worker processor
 * (src/worker/processors/scan-document.ts) flips `StaffMessage.scanStatus`.
 * The signed-URL getter here gates on that status: pending/error → not_ready,
 * infected → infected, only clean → url.
 *
 * Storage path: `staff-chat/<conversationId>/<uuid>-<sanitized-filename>`
 */

// Reuse the same MIME allow-list as the document/chat upload services.
const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ---------------------------------------------------------------------------
// uploadStaffAttachment
// ---------------------------------------------------------------------------

export type UploadStaffAttachmentArgs = {
  conversationId: string;
  file: {
    name: string;
    size: number;
    mimeType: string;
    buffer: Buffer;
  };
};

export type UploadStaffAttachmentResult =
  | { ok: true; attachmentPath: string }
  | { ok: false; error: 'forbidden' | 'conversation_not_found' | 'too_large' | 'invalid_mime' | 'storage' };

export async function uploadStaffAttachment(
  prisma: PrismaClient,
  session: SessionPayload,
  args: UploadStaffAttachmentArgs
): Promise<UploadStaffAttachmentResult> {
  // 1. Synchronous validation — cheapest checks first.
  if (args.file.size > maxFileSizeBytes()) {
    return { ok: false, error: 'too_large' };
  }

  if (!ALLOWED_MIME_TYPES.has(args.file.mimeType)) {
    return { ok: false, error: 'invalid_mime' };
  }

  // Defense-in-depth: fingerprint bytes for MIME types the validator covers.
  // (Legacy types like application/vnd.ms-excel fall through — no magic-byte
  // check for them, consistent with persistUploadedDocument behavior.)
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(args.file.mimeType)) {
    const validation = validateMagicBytes(args.file.mimeType, args.file.buffer);
    if (!validation.ok) {
      return { ok: false, error: 'invalid_mime' };
    }
  }

  // 2. Load conversation for RBAC check.
  const conversation = await prisma.staffConversation.findUnique({
    where: { id: args.conversationId },
    select: { id: true, kind: true, companyId: true, participants: { select: { userId: true } } },
  });

  if (!conversation) {
    return { ok: false, error: 'conversation_not_found' };
  }

  if (!canSeeStaffConversation(session, conversation, conversation.participants.map((p) => p.userId))) {
    return { ok: false, error: 'forbidden' };
  }

  // 3. Upload to object storage.
  const safeName = sanitizeFilename(args.file.name);
  const storagePath = `staff-chat/${args.conversationId}/${randomUUID()}-${safeName}`;

  try {
    await getObjectStorage().upload(storagePath, args.file.buffer, {
      contentType: args.file.mimeType,
    });
  } catch (uploadError) {
    log.error('[staffChat/attachments] storage upload failed', {
      conversationId: args.conversationId,
      storagePath,
      providerError: uploadError instanceof Error ? uploadError.message : String(uploadError),
    });
    return { ok: false, error: 'storage' };
  }

  return { ok: true, attachmentPath: storagePath };
}

// ---------------------------------------------------------------------------
// getStaffAttachmentSignedUrl
// ---------------------------------------------------------------------------

export type GetStaffAttachmentSignedUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'not_ready' | 'infected' | 'storage' };

export async function getStaffAttachmentSignedUrl(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { messageId: string }
): Promise<GetStaffAttachmentSignedUrlResult> {
  const message = await prisma.staffMessage.findUnique({
    where: { id: args.messageId },
    select: {
      id: true,
      attachmentPath: true,
      attachmentName: true,
      scanStatus: true,
      conversation: {
        select: { id: true, kind: true, companyId: true, participants: { select: { userId: true } } },
      },
    },
  });

  if (!message || !message.attachmentPath) {
    return { ok: false, error: 'not_found' };
  }

  const conversation = message.conversation;
  if (!canSeeStaffConversation(session, conversation, conversation.participants.map((p) => p.userId))) {
    return { ok: false, error: 'forbidden' };
  }

  if (message.scanStatus === 'pending' || message.scanStatus === 'error') {
    return { ok: false, error: 'not_ready' };
  }

  if (message.scanStatus === 'infected') {
    return { ok: false, error: 'infected' };
  }

  try {
    const url = await getObjectStorage().createSignedUrl(message.attachmentPath, 600, {
      download: message.attachmentName ?? true,
    });
    return { ok: true, url };
  } catch (error) {
    log.error('[staffChat/attachments] failed to create signed URL', {
      messageId: args.messageId,
      attachmentPath: message.attachmentPath,
      providerError: error instanceof Error ? error.message : String(error),
    });
    // 'storage' (→ 502), not 'not_found': the attachment row exists — masking a
    // storage outage as a missing file sends support down the wrong trail.
    return { ok: false, error: 'storage' };
  }
}
