import type { ThreadSide } from '@prisma/client';
import { z } from 'zod';
import { formFields, readFile, readMultipart } from '@/lib/api/multipart';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { requireSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { uploadChatAttachment, getChatAttachmentSignedUrl } from '@/lib/services/chat/attachments';
import { deriveSide } from '@/lib/services/chat/policy';

/**
 * POST /api/messages/attachment
 *
 * Accepts multipart/form-data: `file` (a File), `orderId` (string),
 * optional `side` (for manager/admin — external roles have their side
 * derived automatically via deriveSide).
 *
 * Returns 201 { ok: true, attachmentPath } on success. The attachmentPath
 * can then be passed to POST /api/messages as `attachmentPath`.
 *
 * Validation is SYNCHRONOUS: MIME allow-list + magic-byte check + size cap.
 * Async ClamAV scan is enqueued by POST /api/messages (sendMessage) once the
 * attachment is bound to a Message row.
 *
 * GET /api/messages/attachment?messageId=<id>
 *
 * Returns a 302 redirect to a short-lived (600 s) object-storage presigned URL
 * for the attachment on the given message. Requires the caller to have
 * visibility on the message's parent thread/order. Scan gate (mirror of the
 * staff chat): 409 while the scan has not finished (`not_ready`), 410 Gone for
 * quarantined files (`infected`, §10 CLAUDE.md).
 */

const FIELDS = z.object({
  // Не строка / поля нет → '' , и роут отвечает bad_request (как и раньше).
  orderId: z.string().catch(''),
  side: z.string().catch(''),
});

export async function POST(req: Request) {
  const off = notFoundIfDisabled('chat');
  if (off) return off;

  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const s = sess.value;

  const formData = await readMultipart(req);
  if (!formData) {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const fileEntry = await readFile(formData, 'file');
  if (fileEntry === null) {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const { orderId, side: formSide } = formFields(formData, FIELDS);
  if (!orderId) {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  // External role (org/partner) forces its side; team (manager/admin) passes side explicitly.
  const side: ThreadSide | null =
    deriveSide(s) ?? (formSide === 'org' || formSide === 'partner' ? formSide : null);

  if (side !== 'org' && side !== 'partner') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const result = await uploadChatAttachment(prisma, s, {
    orderId,
    side,
    file: {
      name: fileEntry.name,
      size: fileEntry.size,
      mimeType: fileEntry.type,
      buffer: fileEntry.buffer,
    },
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden'
        ? 403
        : result.error === 'order_not_found'
          ? 404
          : result.error === 'too_large'
            ? 413
            : result.error === 'invalid_mime'
              ? 415
              : 500; // 'storage'
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, attachmentPath: result.attachmentPath }, { status: 201 });
}

export async function GET(req: Request) {
  const off = notFoundIfDisabled('chat');
  if (off) return off;

  const sess = await requireSession();
  if (!sess.ok) return sess.response;

  const url = new URL(req.url);
  const messageId = url.searchParams.get('messageId') ?? '';

  const result = await getChatAttachmentSignedUrl(prisma, sess.value, messageId);

  if (!result.ok) {
    const status =
      result.error === 'forbidden'
        ? 403
        : result.error === 'not_ready'
          ? 409
          : result.error === 'infected'
            ? 410
            : result.error === 'storage'
              ? 502
              : 404;
    return new Response(null, { status });
  }

  return Response.redirect(result.url, 302);
}
