import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma, DocumentType } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, managedOrgIds } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { notifyOrgUsers } from '@/lib/notifications';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';

/**
 * Manager-facing upload service for order documents.
 *
 * Mirrors the org-side write path: validates MIME + size, checks three-way
 * RBAC visibility on the parent order, uploads to Supabase Storage, persists
 * the Document row with `direction='outgoing'` (manager → org), enqueues a
 * ClamAV scan, writes an audit entry, and fans out an in-app + email
 * notification to organization users via `notifyOrgUsers`.
 *
 * RBAC uses `canSeeOrder` from managerPolicy. We additionally count historical
 * comments only when the cheaper checks miss (parity with the download route).
 *
 * Failures degrade gracefully:
 *   - Queue enqueue failure is logged + swallowed (scanStatus stays 'pending');
 *   - Notification fan-out failures are logged but do not bubble up — they
 *     must not block the upload from the manager's perspective.
 */

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const VALID_DOC_TYPES = new Set<DocumentType>([
  'contract',
  'extra_agreement',
  'invoice',
  'act',
  'waybill',
  'certificate',
  'report',
  'commission_statement',
  'other'
]);

export type CreateOrderDocumentArgs = {
  orderId: string;
  file: {
    name: string;
    size: number;
    mimeType: string;
    buffer: Buffer;
  };
  docType: string;
};

export type CreateOrderDocumentResult =
  | { ok: true; documentId: string }
  | {
      ok: false;
      error: 'forbidden' | 'too_large' | 'invalid_mime' | 'storage' | 'not_found';
    };

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function coerceDocType(input: string): DocumentType {
  return VALID_DOC_TYPES.has(input as DocumentType)
    ? (input as DocumentType)
    : 'other';
}

export async function createOrderDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateOrderDocumentArgs
): Promise<CreateOrderDocumentResult> {
  if (args.file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: 'too_large' };
  }
  if (!ALLOWED_MIME_TYPES.has(args.file.mimeType)) {
    return { ok: false, error: 'invalid_mime' };
  }
  // Defense-in-depth: fingerprint the bytes for MIME types we can validate
  // (defeats content-type spoofing). Legacy types the validator doesn't cover
  // (e.g. application/vnd.ms-excel) fall through to the async ClamAV scan.
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(args.file.mimeType)) {
    const validation = validateMagicBytes(args.file.mimeType, args.file.buffer);
    if (!validation.ok) {
      return { ok: false, error: 'invalid_mime' };
    }
  }

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      orderNumber: true,
      title: true
    }
  });

  if (!order) {
    return { ok: false, error: 'not_found' };
  }

  // Three-way visibility: managerId, org scope, or historical comments. Cheap
  // checks first; only count comments when the others miss.
  let commentsCountByMe = 0;
  if (order.managerId !== session.sub) {
    const inOrgScope =
      order.organizationId !== null &&
      managedOrgIds(session).includes(order.organizationId);
    if (!inOrgScope) {
      commentsCountByMe = await prisma.comment.count({
        where: { orderId: order.id, authorId: session.sub }
      });
    }
  }
  if (!canSeeOrder(session, { ...order, commentsCountByMe })) {
    return { ok: false, error: 'forbidden' };
  }

  const safeName = sanitizeFilename(args.file.name);
  const storagePath = `orders/${args.orderId}/${randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(documentBucket)
    .upload(storagePath, args.file.buffer, {
      contentType: args.file.mimeType,
      upsert: false
    });
  if (uploadError) {
    console.error('[manager/uploads] storage upload failed', {
      orderId: args.orderId,
      storagePath,
      providerError: uploadError.message
    });
    return { ok: false, error: 'storage' };
  }

  const docType = coerceDocType(args.docType);

  const doc = await prisma.document.create({
    data: {
      orderId: args.orderId,
      name: args.file.name,
      mimeType: args.file.mimeType,
      size: args.file.size,
      path: storagePath,
      type: docType,
      direction: 'outgoing',
      generatedBy: 'user',
      scanStatus: 'pending',
      uploadedById: session.sub
    } as Prisma.DocumentUncheckedCreateInput
  });

  // Best-effort: enqueue ClamAV scan. Failure leaves scanStatus='pending';
  // a separate backfill sweeps stuck rows.
  try {
    const payload: ScanDocumentPayload = { kind: 'document', id: doc.id };
    await getQueue('docs.scanDocument').add('scan', payload);
  } catch (err) {
    console.warn('[manager/uploads] enqueue scan failed', {
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  await recordAudit(prisma, {
    action: 'document_uploaded',
    entity: 'document',
    entityId: doc.id,
    userId: session.sub,
    before: undefined,
    after: {
      orderId: args.orderId,
      docType,
      source: 'manager',
      path: storagePath,
      mimeType: args.file.mimeType,
      size: args.file.size
    }
  });

  // Fan out to organization users (in-app + email). Best-effort: never let a
  // notification failure roll back the upload — the document is already
  // persisted and the audit row is authoritative.
  if (order.organizationId) {
    try {
      await notifyOrgUsers(prisma, {
        organizationId: order.organizationId,
        type: 'document_published',
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderTitle: order.title,
          documentName: args.file.name,
          documentType: docType
        }
      });
    } catch (err) {
      console.warn('[manager/uploads] notifyOrgUsers failed', {
        documentId: doc.id,
        organizationId: order.organizationId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return { ok: true, documentId: doc.id };
}
