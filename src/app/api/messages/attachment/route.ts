import { notFoundIfDisabled } from '@/lib/featureFlags';
import { requireSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { uploadChatAttachment, getChatAttachmentSignedUrl } from '@/lib/services/chat/attachments';
import { deriveSide } from '@/lib/services/chat/policy';
import type { ThreadSide } from '@prisma/client';

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
 * Validation is SYNCHRONOUS: MIME allow-list + magic-byte check + 20 MB cap.
 * No ClamAV scan in v1; AV scanning for chat attachments is deferred to v1.1.
 *
 * GET /api/messages/attachment?messageId=<id>
 *
 * Returns a 302 redirect to a short-lived (600 s) Supabase Storage signed URL
 * for the attachment on the given message. Requires the caller to have
 * visibility on the message's parent thread/order.
 */

export async function POST(req: Request) {
  const off = notFoundIfDisabled('chat');
  if (off) return off;

  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const s = sess.value;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || !(fileEntry instanceof File)) {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const orderId = formData.get('orderId');
  if (!orderId || typeof orderId !== 'string') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  // External role (org/partner) forces its side; team (manager/admin) passes side explicitly.
  const formSide = formData.get('side');
  const side: ThreadSide | null =
    deriveSide(s) ?? (typeof formSide === 'string' ? (formSide as ThreadSide) : null);

  if (side !== 'org' && side !== 'partner') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const buffer = Buffer.from(await fileEntry.arrayBuffer());

  const result = await uploadChatAttachment(prisma, s, {
    orderId,
    side,
    file: {
      name: fileEntry.name,
      size: fileEntry.size,
      mimeType: fileEntry.type,
      buffer,
    },
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden'      ? 403 :
      result.error === 'order_not_found'? 404 :
      result.error === 'too_large'      ? 413 :
      result.error === 'invalid_mime'   ? 415 :
      500; // 'storage'
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
    return new Response(null, {
      status:
        result.error === 'forbidden' ? 403 : result.error === 'storage' ? 502 : 404,
    });
  }

  return Response.redirect(result.url, 302);
}
