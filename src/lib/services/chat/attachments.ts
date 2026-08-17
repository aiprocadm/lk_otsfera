import { randomUUID } from 'node:crypto';
import type { PrismaClient, ThreadSide } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getObjectStorage } from '@/lib/storage';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';
import { maxFileSizeBytes, ALLOWED_MIME_TYPES } from '@/lib/config/upload';
import { log } from '@/lib/logging';
import { canSeeThread } from './policy';

/**
 * Chat attachment upload + signed-URL download service.
 *
 * Validation is SYNCHRONOUS: MIME allow-list + magic-byte fingerprint +
 * config-driven size cap (maxFileSizeBytes() from @/lib/config/upload).
 *
 * Async ClamAV scan (added 2026-08-17, closing the v1 deferral): `sendMessage`
 * stores the row with `scanStatus='pending'` and enqueues `docs.scanDocument`
 * with `{kind:'chat_attachment', id: messageId}`; the shared worker flips the
 * status, the hourly backfill sweep re-collects stuck `pending` rows. Download
 * is gated below: only `clean` gets a signed URL — `infected` → 'infected'
 * (410), anything else → 'not_ready' (409), mirroring the staff chat.
 *
 * Storage path: `chat/<orderId>/<uuid>-<sanitized-filename>`
 * No Document row is created — the scan tracks `Message.scanStatus`.
 */

/**
 * Список форматов — общий (§12b, `lib/config/upload`).
 *
 * Раньше здесь лежала копия с комментарием «тот же список, что у загрузки
 * документов». Комментарий врал: копия разъехалась и не принимала
 * `application/msword` — старый Word прикладывался к заказу, но не к
 * сообщению, и человек видел «формат не поддерживается» без объяснения.
 */

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ---------------------------------------------------------------------------
// uploadChatAttachment
// ---------------------------------------------------------------------------

export type UploadChatAttachmentArgs = {
  orderId: string;
  side: ThreadSide;
  file: {
    name: string;
    size: number;
    mimeType: string;
    buffer: Buffer;
  };
};

export type UploadChatAttachmentResult =
  | { ok: true; attachmentPath: string }
  | {
      ok: false;
      error: 'forbidden' | 'order_not_found' | 'too_large' | 'invalid_mime' | 'storage';
    };

export async function uploadChatAttachment(
  prisma: PrismaClient,
  session: SessionPayload,
  args: UploadChatAttachmentArgs
): Promise<UploadChatAttachmentResult> {
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

  // 2. Load order for RBAC check.
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { id: true, organizationId: true, partnerId: true, companyId: true },
  });

  if (!order) {
    return { ok: false, error: 'order_not_found' };
  }

  if (!canSeeThread(session, args.side, order)) {
    return { ok: false, error: 'forbidden' };
  }

  // 3. Upload to object storage.
  const safeName = sanitizeFilename(args.file.name);
  const storagePath = `chat/${args.orderId}/${randomUUID()}-${safeName}`;

  try {
    await getObjectStorage().upload(storagePath, args.file.buffer, {
      contentType: args.file.mimeType,
    });
  } catch (uploadError) {
    log.error('[chat/attachments] storage upload failed', {
      orderId: args.orderId,
      storagePath,
      providerError: uploadError instanceof Error ? uploadError.message : String(uploadError),
    });
    return { ok: false, error: 'storage' };
  }

  return { ok: true, attachmentPath: storagePath };
}

// ---------------------------------------------------------------------------
// getChatAttachmentSignedUrl
// ---------------------------------------------------------------------------

export type GetChatAttachmentSignedUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'not_ready' | 'infected' | 'storage' };

export async function getChatAttachmentSignedUrl(
  prisma: PrismaClient,
  session: SessionPayload,
  messageId: string
): Promise<GetChatAttachmentSignedUrlResult> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      attachmentPath: true,
      scanStatus: true,
      thread: {
        select: {
          side: true,
          order: { select: { id: true, organizationId: true, partnerId: true, companyId: true } },
        },
      },
    },
  });

  if (!message || !message.attachmentPath) {
    return { ok: false, error: 'not_found' };
  }

  // FIX 1: belt-and-suspenders — reject any path not under the chat/ prefix
  // (guards against legacy/edge data that may have slipped in)
  if (!message.attachmentPath.startsWith('chat/')) {
    return { ok: false, error: 'not_found' };
  }

  if (!canSeeThread(session, message.thread.side, message.thread.order)) {
    return { ok: false, error: 'forbidden' };
  }

  // AV-гейт (зеркало staffChat): наружу уходит только проверенный файл.
  // `infected` — карантин (роут отвечает 410); всё, что не `clean`
  // (pending/error/none-с-вложением), — «ещё не проверено» (409), а не отказ
  // навсегда: часовой sweep добьёт pending, и ссылка оживёт.
  if (message.scanStatus === 'infected') {
    return { ok: false, error: 'infected' };
  }
  if (message.scanStatus !== 'clean') {
    return { ok: false, error: 'not_ready' };
  }

  try {
    const url = await getObjectStorage().createSignedUrl(message.attachmentPath, 600);
    return { ok: true, url };
  } catch (error) {
    log.error('[chat/attachments] failed to create signed URL', {
      messageId,
      attachmentPath: message.attachmentPath,
      providerError: error instanceof Error ? error.message : String(error),
    });
    // 'storage' (→ 502), not 'not_found': the attachment row exists — masking a
    // storage outage as a missing file sends support down the wrong trail.
    return { ok: false, error: 'storage' };
  }
}
