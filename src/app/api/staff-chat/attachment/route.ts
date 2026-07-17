import { requireSession, requireRole } from '@/lib/auth/guard';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { uploadStaffAttachment, getStaffAttachmentSignedUrl } from '@/lib/services/staffChat/attachments';

/**
 * POST /api/staff-chat/attachment
 *
 * Accepts multipart/form-data: `file` (a File), `conversationId` (string).
 * Returns 201 { ok: true, attachmentPath } on success. The attachmentPath
 * can then be passed to POST /api/staff-chat/messages as `attachmentPath`.
 *
 * GET /api/staff-chat/attachment?messageId=<id>
 *
 * Returns a 302 redirect to a short-lived presigned URL for the attachment
 * on the given message, once it has cleared the async ClamAV scan.
 */

export async function POST(req: Request) {
  const off = notFoundIfDisabled('staff_chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const staff = requireRole(sess.value, ['admin', 'manager']);
  if (!staff.ok) return staff.response;

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

  const conversationId = formData.get('conversationId');
  if (!conversationId || typeof conversationId !== 'string') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const buffer = Buffer.from(await fileEntry.arrayBuffer());

  const result = await uploadStaffAttachment(prisma, sess.value, {
    conversationId,
    file: {
      name: fileEntry.name,
      size: fileEntry.size,
      mimeType: fileEntry.type,
      buffer,
    },
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden' ? 403 :
      result.error === 'conversation_not_found' ? 404 :
      result.error === 'too_large' ? 413 :
      result.error === 'invalid_mime' ? 415 :
      500; // 'storage'
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, attachmentPath: result.attachmentPath }, { status: 201 });
}

export async function GET(req: Request) {
  const off = notFoundIfDisabled('staff_chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const staff = requireRole(sess.value, ['admin', 'manager']);
  if (!staff.ok) return staff.response;

  const url = new URL(req.url);
  const messageId = url.searchParams.get('messageId');
  if (!messageId) {
    return new Response(null, { status: 400 });
  }

  const result = await getStaffAttachmentSignedUrl(prisma, sess.value, { messageId });

  if (!result.ok) {
    const status =
      result.error === 'forbidden' ? 403 :
      result.error === 'not_found' ? 404 :
      result.error === 'not_ready' ? 409 :
      result.error === 'infected' ? 410 :
      502; // 'storage'
    return new Response(null, { status });
  }

  return Response.redirect(result.url, 302);
}
