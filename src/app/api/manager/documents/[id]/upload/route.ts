import { NextRequest } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { createCounterpartyDocument } from '@/lib/services/manager/uploads';

/**
 * POST /api/manager/documents/[id]/upload
 *
 * `[id]` is the parent **orderId** (the document is created against an order).
 * The segment is named `[id]` to share the dynamic level with
 * `[id]/download/`, since Next.js App Router forbids sibling dynamic
 * segments with different names.
 *
 * Multipart upload endpoint for a manager-issued document attached to a
 * specific order. Delegates to `createCounterpartyDocument` for MIME/size
 * validation, three-way RBAC visibility check, object-storage upload,
 * persistence, ClamAV scan enqueue, audit log, and channel-targeted fan-out.
 *
 * The `recipient` form field selects the channel: 'organization' (default) or
 * 'partner'. Partner channel requires the order to have a partner; otherwise
 * returns 400 (invalid_recipient).
 *
 * Status codes:
 *   201 — upload succeeded; body: { ok: true, documentId }
 *   400 — no `file` field in form data, or invalid_recipient
 *   403 — order is out of the manager's three-way visibility scope
 *   404 — order does not exist
 *   413 — file exceeds 20 MB
 *   415 — MIME type not in the allow-list
 *   500 — object-storage upload failed
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireManager();
  const { id: orderId } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return Response.json({ ok: false, error: 'no_file' }, { status: 400 });
  }
  const file = form.get('file');
  const docType = String(form.get('docType') ?? 'other');
  const recipientRaw = String(form.get('recipient') ?? 'organization');
  const recipient = recipientRaw === 'partner' ? 'partner' : 'organization';

  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'no_file' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await createCounterpartyDocument(prisma, session, {
    orderId,
    recipient,
    docType,
    file: {
      name: file.name,
      size: file.size,
      mimeType: file.type,
      buffer
    }
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden' ? 403
      : result.error === 'too_large' ? 413
      : result.error === 'invalid_mime' ? 415
      : result.error === 'not_found' ? 404
      : result.error === 'invalid_recipient' ? 400
      : 500;
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json(
    { ok: true, documentId: result.documentId },
    { status: 201 }
  );
}
