import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, DocumentType, DocumentDirection } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';

/**
 * Shared write path for every document upload (manager outgoing, org/partner
 * incoming). Owns MIME/size validation, magic-byte fingerprinting, Supabase
 * upload, the Document row (with counterparty + direction), best-effort scan
 * enqueue, and the audit entry. RBAC and notification fan-out stay in the
 * callers — they differ per direction/role (CLAUDE.md §3).
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

/**
 * Validates file size, MIME type, and magic bytes before any DB or storage
 * interaction. Exported so callers can apply a fast-path rejection without
 * issuing any DB query (e.g. manager uploads.ts checks this before the order
 * lookup).
 */
export function validateUploadFile(file: { size: number; mimeType: string; buffer: Buffer }):
  | { ok: true }
  | { ok: false; error: 'too_large' | 'invalid_mime' } {
  if (file.size > MAX_FILE_SIZE_BYTES) return { ok: false, error: 'too_large' };
  if (!ALLOWED_MIME_TYPES.has(file.mimeType)) return { ok: false, error: 'invalid_mime' };
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
    const validation = validateMagicBytes(file.mimeType, file.buffer);
    if (!validation.ok) return { ok: false, error: 'invalid_mime' };
  }
  return { ok: true };
}

const VALID_DOC_TYPES = new Set<DocumentType>([
  'contract', 'extra_agreement', 'invoice', 'act', 'waybill',
  'certificate', 'report', 'commission_statement', 'other'
]);

export type UploadSource = 'manager' | 'organization' | 'partner';

export type PersistDocumentArgs = {
  counterparty: { type: 'organization' | 'partner'; id: string };
  orderId: string | null;
  companyId?: string | null;
  direction: DocumentDirection;
  docType: string;
  uploadedById: string;
  source: UploadSource;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export type PersistDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; error: 'too_large' | 'invalid_mime' | 'storage' };

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function coerceDocType(input: string): DocumentType {
  return VALID_DOC_TYPES.has(input as DocumentType) ? (input as DocumentType) : 'other';
}

export async function persistUploadedDocument(
  prisma: PrismaClient,
  args: PersistDocumentArgs
): Promise<PersistDocumentResult> {
  const fileCheck = validateUploadFile(args.file);
  if (!fileCheck.ok) return fileCheck;

  // XOR invariant: exactly one of orderId / companyId must be set.
  // Violating this would produce a DB CHECK error (500) — fail fast with a
  // clean Result instead.
  if ((args.orderId == null) === (args.companyId == null)) {
    return { ok: false, error: 'storage' };
  }

  const safeName = sanitizeFilename(args.file.name);
  const storagePath = args.orderId
    ? `orders/${args.orderId}/${randomUUID()}-${safeName}`
    : `counterparty/${args.counterparty.type}/${args.counterparty.id}/${randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(documentBucket)
    .upload(storagePath, args.file.buffer, { contentType: args.file.mimeType, upsert: false });
  if (uploadError) {
    console.error('[documents/upload-core] storage upload failed', {
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
      companyId: args.companyId ?? null,
      counterpartyType: args.counterparty.type,
      counterpartyId: args.counterparty.id,
      name: args.file.name,
      mimeType: args.file.mimeType,
      size: args.file.size,
      path: storagePath,
      type: docType,
      direction: args.direction,
      generatedBy: 'user',
      scanStatus: 'pending',
      uploadedById: args.uploadedById
    } as Prisma.DocumentUncheckedCreateInput
  });

  // Best-effort: enqueue ClamAV scan. Failure leaves scanStatus='pending'.
  try {
    const payload: ScanDocumentPayload = { kind: 'document', id: doc.id };
    await getQueue('docs.scanDocument').add('scan', payload);
  } catch (err) {
    console.warn('[documents/upload-core] enqueue scan failed', {
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  await recordAudit(prisma, {
    action: 'document_uploaded',
    entity: 'document',
    entityId: doc.id,
    userId: args.uploadedById,
    after: {
      orderId: args.orderId,
      companyId: args.companyId ?? null,
      counterpartyType: args.counterparty.type,
      counterpartyId: args.counterparty.id,
      direction: args.direction,
      docType,
      source: args.source,
      path: storagePath,
      mimeType: args.file.mimeType,
      size: args.file.size
    }
  });

  return { ok: true, documentId: doc.id };
}
