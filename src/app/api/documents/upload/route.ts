import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrderAccess, requireSession } from '@/lib/auth/guard';
import { notifyDocumentCreated, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'application/zip'
] as const;

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg', '.zip'] as const;
const ALLOWED_FORMATS_ERROR = `Unsupported file format. Allowed formats: ${ALLOWED_EXTENSIONS.join(', ')}`;

const DEFAULT_MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_MB_RAW = Number(process.env.DOCUMENT_MAX_FILE_SIZE_MB ?? DEFAULT_MAX_FILE_SIZE_MB);
const MAX_FILE_SIZE_MB = Number.isFinite(MAX_FILE_SIZE_MB_RAW) && MAX_FILE_SIZE_MB_RAW > 0 ? MAX_FILE_SIZE_MB_RAW : DEFAULT_MAX_FILE_SIZE_MB;
if (MAX_FILE_SIZE_MB !== MAX_FILE_SIZE_MB_RAW) {
  console.warn('[documents/upload] Invalid DOCUMENT_MAX_FILE_SIZE_MB, fallback to default', {
    fallbackMb: DEFAULT_MAX_FILE_SIZE_MB
  });
}
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function errorResponse(code: string, message: string, status: number, correlationId?: string) {
  return NextResponse.json({ code, message, ...(correlationId ? { correlationId } : {}) }, { status });
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function POST(req: Request) {
  const correlationId = crypto.randomUUID();
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  const form = await req.formData();
  const orderId = String(form.get('orderId') ?? '');
  const file = form.get('file');

  if (!orderId || !(file instanceof File)) {
    return errorResponse('BAD_REQUEST', 'orderId and file are required', 400, correlationId);
  }

  const fileName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => fileName.endsWith(ext));

  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number]) || !hasAllowedExtension) {
    return errorResponse('INVALID_FILE_FORMAT', ALLOWED_FORMATS_ERROR, 400, correlationId);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return errorResponse('FILE_TOO_LARGE', `File exceeds ${MAX_FILE_SIZE_MB}MB limit`, 400, correlationId);
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return errorResponse('NOT_FOUND', 'Not found', 404, correlationId);
  const orderAccess = await requireOrderAccess(s, order);
  if (!orderAccess.ok) return orderAccess.response;

  const organization = await prisma.organization.findFirst({ where: { companyId: order.companyId }, select: { id: true, partnerId: true } });
  if (!organization) {
    return errorResponse('ORGANIZATION_CONTEXT_NOT_FOUND', 'Organization context not found', 400, correlationId);
  }

  const tenantPath = `partner/${organization.partnerId}/org/${organization.id}/order/${order.id}`;
  const internalPath = `${tenantPath}/${Date.now()}-${sanitizeFilename(file.name)}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabaseAdmin.storage
    .from(documentBucket)
    .upload(internalPath, Buffer.from(arrayBuffer), { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error('Document upload failed', {
      correlationId,
      orderId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      storageBucket: documentBucket,
      storagePath: internalPath,
      providerError: uploadError.message
    });
    return errorResponse('STORAGE_UPLOAD_FAILED', 'Failed to upload document', 502, correlationId);
  }

  const doc = await prisma.document.create({
    data: { orderId, name: file.name, path: internalPath, mimeType: file.type, uploadedById: s.sub }
  });

  await prisma.auditLog.create({
    data: {
      action: 'document_upload',
      entity: 'document',
      entityId: doc.id,
      userId: s.sub,
      meta: { orderId, path: internalPath, mimeType: file.type, size: file.size }
    }
  });

  const organizationId = await getPrimaryOrganizationId(s);

  await notifyDocumentCreated({
    userId: s.sub,
    organizationId,
    partnerId: s.partnerId,
    title: 'Новый документ',
    body: `Загружен документ ${file.name}`,
    meta: { orderId, documentId: doc.id }
  });

  await triggerNotificationEmail({ userId: s.sub, title: 'Новый документ', body: `Загружен документ ${file.name}`, type: 'document_created' });

  return NextResponse.json({ id: doc.id, name: doc.name, mimeType: doc.mimeType, createdAt: doc.createdAt });
}
