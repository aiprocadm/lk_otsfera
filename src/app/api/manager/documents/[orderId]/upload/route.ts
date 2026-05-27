import { NextRequest } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { createOrderDocument } from '@/lib/services/manager/uploads';

/**
 * POST /api/manager/documents/[orderId]/upload
 *
 * Multipart upload endpoint for a manager-issued document attached to a
 * specific order. Delegates to `createOrderDocument` for MIME/size validation,
 * three-way RBAC visibility check, Supabase Storage upload, persistence,
 * ClamAV scan enqueue, audit log, and org-side fan-out.
 *
 * Status codes:
 *   201 — upload succeeded; body: { ok: true, documentId }
 *   400 — no `file` field in form data
 *   403 — order is out of the manager's three-way visibility scope
 *   404 — order does not exist
 *   413 — file exceeds 20 MB
 *   415 — MIME type not in the allow-list
 *   500 — Supabase Storage upload failed
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await requireManager();
  const { orderId } = await params;

  const form = await req.formData();
  const file = form.get('file');
  const docType = String(form.get('docType') ?? 'other');

  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'no_file' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await createOrderDocument(prisma, session, {
    orderId,
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
      result.error === 'forbidden'
        ? 403
        : result.error === 'too_large'
          ? 413
          : result.error === 'invalid_mime'
            ? 415
            : result.error === 'not_found'
              ? 404
              : 500;
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json(
    { ok: true, documentId: result.documentId },
    { status: 201 }
  );
}
