import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { formFields, readFile, readMultipart } from '@/lib/api/multipart';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { createPartnerDocument } from '@/lib/services/partner/documentUpload';

const FIELDS = z.object({
  orderId: z.coerce.string().default(''),
  docType: z.coerce.string().default('other'),
});

/**
 * POST /api/partner/documents/upload
 *
 * Multipart upload endpoint for a partner-sent document attached to an order
 * from the partner's portfolio. Exists as an API route (not a server action)
 * on purpose: server actions share the global `bodySizeLimit` (25 MB), which
 * silently dropped files above it while the app promises
 * DOCUMENT_MAX_FILE_SIZE_MB (200 MB default). The honest size check lives in
 * the service (`validateUploadFile`).
 *
 * Delegates to `createPartnerDocument` for portfolio scoping, MIME/size
 * validation, object-storage upload, persistence, ClamAV scan enqueue, audit
 * log and manager notification.
 *
 * `У-115`: пустой `orderId` больше не ошибка, а **общий документ партнёра** —
 * ровно как в кабинете заказчика. Компанию сервис выводит из портфеля; когда
 * вывести нельзя, отвечает `company_required` (409), и человек видит русскую
 * строку с выходом, а не молчаливый отказ.
 *
 * Status codes:
 *   201 — upload succeeded; body: { ok: true, documentId }
 *   400 — non-multipart body / no `file` field
 *   403 — order is outside the partner's portfolio scope
 *   409 — общий документ, но компанию продавца вывести не из чего
 *   404 — order does not exist
 *   413 — file exceeds the configured max size (200 MB default)
 *   415 — MIME type not in the allow-list
 *   500 — object-storage upload failed
 */

export async function POST(req: NextRequest) {
  const session = await requirePartner();

  const form = await readMultipart(req);
  if (!form) {
    return Response.json({ ok: false, error: 'no_file' }, { status: 400 });
  }
  const { orderId, docType } = formFields(form, FIELDS);

  const file = await readFile(form, 'file');
  if (file === null) {
    return Response.json({ ok: false, error: 'no_file' }, { status: 400 });
  }

  const result = await createPartnerDocument(prisma, session, {
    // Пусто → общий документ партнёра (ветка без заказа, `У-115`).
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
        : result.error === 'company_required'
          ? 409
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
