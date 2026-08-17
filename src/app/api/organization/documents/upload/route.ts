import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { formFields, readFile, readMultipart } from '@/lib/api/multipart';
import { requireOrganization } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { createOrganizationDocument } from '@/lib/services/organization/documentUpload';

const FIELDS = z.object({
  organizationId: z.coerce.string().default(''),
  orderId: z.coerce.string().default(''),
  docType: z.coerce.string().default('other'),
});

/**
 * POST /api/organization/documents/upload
 *
 * Multipart upload endpoint for a document sent from the organization cabinet.
 * Exists as an API route (not a server action) on purpose: server actions
 * share the global `bodySizeLimit` (25 MB), which silently dropped files above
 * it while the app promises DOCUMENT_MAX_FILE_SIZE_MB (200 MB default). The
 * honest size check lives in the service (`validateUploadFile`).
 *
 * An empty/absent `orderId` selects the order-less branch (a general document
 * pinned to the organization's company). Membership in `organizationId` is
 * verified by the service against the DB — the route grants nothing.
 *
 * Status codes:
 *   201 — upload succeeded; body: { ok: true, documentId }
 *   400 — non-multipart body / no `file` field / empty `organizationId`
 *   403 — user is not an active member of the organization
 *   404 — order (or organization's company) not found
 *   413 — file exceeds the configured max size (200 MB default)
 *   415 — MIME type not in the allow-list
 *   500 — object-storage upload failed
 */

export async function POST(req: NextRequest) {
  const disabled = notFoundIfDisabled('organization_cabinet');
  if (disabled) return disabled;

  const session = await requireOrganization();

  const form = await readMultipart(req);
  if (!form) {
    return Response.json({ ok: false, error: 'no_file' }, { status: 400 });
  }
  const { organizationId, orderId, docType } = formFields(form, FIELDS);
  if (organizationId === '') {
    return Response.json({ ok: false, error: 'validation' }, { status: 400 });
  }

  const file = await readFile(form, 'file');
  if (file === null) {
    return Response.json({ ok: false, error: 'no_file' }, { status: 400 });
  }

  const result = await createOrganizationDocument(prisma, session, {
    organizationId,
    orderId: orderId === '' ? null : orderId,
    docType,
    file: {
      name: file.name,
      size: file.size,
      mimeType: file.type,
      buffer: file.buffer,
    },
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden'
        ? 403
        : result.error === 'not_found'
          ? 404
          : result.error === 'too_large'
            ? 413
            : result.error === 'invalid_mime'
              ? 415
              : 500;
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, documentId: result.documentId }, { status: 201 });
}
