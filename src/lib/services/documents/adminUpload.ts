import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadOrder } from '@/lib/auth/policy';
import { deliverNotificationToUser, notifyDocumentCreated } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { getObjectStorage } from '@/lib/storage';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { recordAudit } from '@/lib/auth/audit';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';
import { log } from '@/lib/logging';

/**
 * Загрузка документа из админ-панели (legacy-канал POST /api/documents/upload).
 *
 * Канал жёстко организационный: строка `Document` пишется с
 * `counterpartyType: 'organization'`, поэтому роль вызывающего ограничена
 * `admin` гардом роута — партнёр/организация грузят через свои канальные пути.
 * Форма входа (MIME/расширение/размер) проверяется в роуте до чтения файла в
 * память; сюда приходит уже прочитанный буфер.
 *
 * Порядок проверок сохранён с точностью до шага (это важно: спуфленный файл в
 * чужом заказе обязан получить 403, а не 400): заказ → доступ → организация →
 * magic bytes → хранилище → запись.
 *
 * Деградация (§3): постановка скана в очередь и рассылка уведомлений
 * логируются и проглатываются — документ уже записан, повтор создал бы дубль.
 */

type AdminUploadError =
  'not_found' | 'forbidden' | 'organization_context_not_found' | 'invalid_file_format' | 'storage';

export type UploadAdminDocumentArgs = {
  orderId: string;
  correlationId: string;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export type UploadAdminDocumentResult =
  | { ok: true; document: { id: string; name: string; mimeType: string; createdAt: Date } }
  | { ok: false; error: AdminUploadError };

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function uploadAdminDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: UploadAdminDocumentArgs
): Promise<UploadAdminDocumentResult> {
  const { orderId, correlationId, file } = args;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: 'not_found' };
  if (!(await canReadOrder(session, order))) return { ok: false, error: 'forbidden' };

  const organization = await prisma.organization.findFirst({
    where: { companyId: order.companyId },
    select: { id: true, partnerId: true },
  });
  if (!organization) return { ok: false, error: 'organization_context_not_found' };

  const tenantPath = `partner/${organization.partnerId}/org/${organization.id}/order/${order.id}`;
  const internalPath = `${tenantPath}/${Date.now()}-${sanitizeFilename(file.name)}`;

  // Defense-in-depth: when the declared MIME is one we can fingerprint, the
  // file's magic bytes must match — defeats content-type/extension spoofing.
  // Types the validator can't fingerprint (e.g. application/zip) fall through
  // to the allow-list + async ClamAV scan.
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
    const validation = validateMagicBytes(file.mimeType, file.buffer);
    if (!validation.ok) return { ok: false, error: 'invalid_file_format' };
  }

  try {
    await getObjectStorage().upload(internalPath, file.buffer, { contentType: file.mimeType });
  } catch (uploadError) {
    log.error('Document upload failed', {
      correlationId,
      orderId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.mimeType,
      storagePath: internalPath,
      providerError: uploadError instanceof Error ? uploadError.message : String(uploadError),
    });
    return { ok: false, error: 'storage' };
  }

  const doc = await prisma.document.create({
    data: {
      orderId,
      counterpartyType: 'organization',
      counterpartyId: order.organizationId,
      name: file.name,
      path: internalPath,
      mimeType: file.mimeType,
      uploadedById: session.sub,
    },
  });

  await recordAudit(prisma, {
    action: 'document_upload',
    entity: 'document',
    entityId: doc.id,
    userId: session.sub,
    after: { orderId, path: internalPath, mimeType: file.mimeType, size: file.size },
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
    const organizationId = await getPrimaryOrganizationId(session);
    const row = await notifyDocumentCreated({
      userId: session.sub,
      organizationId,
      // exactOptionalPropertyTypes: NotificationInput различает «ключа нет» и «ключ = undefined».
      ...(session.partnerId !== undefined ? { partnerId: session.partnerId } : {}),
      title: 'Новый документ',
      body: `Загружен документ ${file.name}`,
      meta: { orderId, documentId: doc.id },
    });
    await deliverNotificationToUser({
      userId: session.sub,
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

  return {
    ok: true,
    document: {
      id: doc.id,
      name: doc.name,
      mimeType: doc.mimeType,
      createdAt: doc.createdAt,
    },
  };
}
