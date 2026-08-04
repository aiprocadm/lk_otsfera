import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { formFields, readFileEntry, readMultipart } from '@/lib/api/multipart';
import { requireOrderAccess, requireRole, requireSession } from '@/lib/auth/guard';
import { deliverNotificationToUser, notifyDocumentCreated } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { getObjectStorage } from '@/lib/storage';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { recordAudit } from '@/lib/auth/audit';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';
import { resolveMaxFileSizeMb, maxFileSizeBytes } from '@/lib/config/upload';
import { log } from '@/lib/logging';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword', // .doc (legacy, §13)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'application/zip',
] as const;

const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.zip',
] as const;
const ALLOWED_FORMATS_ERROR = `Unsupported file format. Allowed formats: ${ALLOWED_EXTENSIONS.join(', ')}`;

const FIELDS = z.object({ orderId: z.coerce.string().default('') });

const MAX_FILE_SIZE_MB = resolveMaxFileSizeMb();
const MAX_FILE_SIZE_BYTES = maxFileSizeBytes();

function errorResponse(code: string, message: string, status: number, correlationId?: string) {
  /* v8 ignore next -- correlationId is always crypto.randomUUID(); the {} branch is unreachable in practice */
  return NextResponse.json(
    { code, message, ...(correlationId ? { correlationId } : {}) },
    { status }
  );
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function POST(req: Request) {
  const correlationId = crypto.randomUUID();
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  // Admin-only: the sole consumer is the admin DocumentsPanel. Partner and
  // organization uploads go through their channel-scoped paths (server-action /
  // manager API), which pin counterparty — this legacy route writes to the
  // org channel unconditionally and must not be reachable by other roles.
  const roleResult = requireRole(s, ['admin']);
  if (!roleResult.ok) return roleResult.response;

  const form = await readMultipart(req);
  if (!form)
    return errorResponse('BAD_REQUEST', 'Expected multipart form-data', 400, correlationId);
  const { orderId } = formFields(form, FIELDS);
  // Буфер читаем ПОСЛЕ проверок размера/MIME — отсюда readFileEntry, а не readFile.
  const file = readFileEntry(form, 'file');

  if (!orderId || !file) {
    return errorResponse('BAD_REQUEST', 'orderId and file are required', 400, correlationId);
  }

  const fileName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => fileName.endsWith(ext));

  if (
    !ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number]) ||
    !hasAllowedExtension
  ) {
    return errorResponse('INVALID_FILE_FORMAT', ALLOWED_FORMATS_ERROR, 400, correlationId);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return errorResponse(
      'FILE_TOO_LARGE',
      `File exceeds ${MAX_FILE_SIZE_MB}MB limit`,
      400,
      correlationId
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return errorResponse('NOT_FOUND', 'Not found', 404, correlationId);
  const orderAccess = await requireOrderAccess(s, order);
  if (!orderAccess.ok) return orderAccess.response;

  const organization = await prisma.organization.findFirst({
    where: { companyId: order.companyId },
    select: { id: true, partnerId: true },
  });
  if (!organization) {
    return errorResponse(
      'ORGANIZATION_CONTEXT_NOT_FOUND',
      'Organization context not found',
      400,
      correlationId
    );
  }

  const tenantPath = `partner/${organization.partnerId}/org/${organization.id}/order/${order.id}`;
  const internalPath = `${tenantPath}/${Date.now()}-${sanitizeFilename(file.name)}`;

  const arrayBuffer = await file.arrayBuffer();

  // Defense-in-depth: when the declared MIME is one we can fingerprint, the
  // file's magic bytes must match — defeats content-type/extension spoofing.
  // Types the validator can't fingerprint (e.g. application/zip) fall through
  // to the allow-list + async ClamAV scan.
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    const validation = validateMagicBytes(file.type, new Uint8Array(arrayBuffer));
    if (!validation.ok) {
      return errorResponse('INVALID_FILE_FORMAT', ALLOWED_FORMATS_ERROR, 400, correlationId);
    }
  }

  try {
    await getObjectStorage().upload(internalPath, Buffer.from(arrayBuffer), {
      contentType: file.type,
    });
  } catch (uploadError) {
    log.error('Document upload failed', {
      correlationId,
      orderId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      storagePath: internalPath,
      providerError: uploadError instanceof Error ? uploadError.message : String(uploadError),
    });
    return errorResponse('STORAGE_UPLOAD_FAILED', 'Failed to upload document', 502, correlationId);
  }

  const doc = await prisma.document.create({
    data: {
      orderId,
      counterpartyType: 'organization',
      counterpartyId: order.organizationId,
      name: file.name,
      path: internalPath,
      mimeType: file.type,
      uploadedById: s.sub,
    },
  });

  await recordAudit(prisma, {
    action: 'document_upload',
    entity: 'document',
    entityId: doc.id,
    userId: s.sub,
    after: { orderId, path: internalPath, mimeType: file.type, size: file.size },
  });

  // Best-effort enqueue of async ClamAV scan. Failure leaves scanStatus='pending'
  // (graceful — file stays usable; backfill job sweeps stuck rows separately).
  try {
    const payload: ScanDocumentPayload = { kind: 'document', id: doc.id };
    await getQueue('docs.scanDocument').add('scan', payload);
  } catch (err) {
    log.warn('[documents/upload] enqueue scan failed', {
      correlationId,
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Best-effort fan-out: the document row is already committed; a notification
  // or email transport failure must not surface as an upload error (the client
  // would retry and create a duplicate).
  try {
    const organizationId = await getPrimaryOrganizationId(s);
    const row = await notifyDocumentCreated({
      userId: s.sub,
      organizationId,
      // exactOptionalPropertyTypes: NotificationInput различает «ключа нет» и «ключ = undefined».
      ...(s.partnerId !== undefined ? { partnerId: s.partnerId } : {}),
      title: 'Новый документ',
      body: `Загружен документ ${file.name}`,
      meta: { orderId, documentId: doc.id },
    });
    await deliverNotificationToUser({
      userId: s.sub,
      title: 'Новый документ',
      body: `Загружен документ ${file.name}`,
      type: 'document_created',
      dedupKey: row.id,
    });
  } catch (err) {
    log.warn('[documents/upload] notification fan-out failed', {
      correlationId,
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({
    id: doc.id,
    name: doc.name,
    mimeType: doc.mimeType,
    createdAt: doc.createdAt,
  });
}
