import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadOrder } from '@/lib/auth/policy';
import { deliverNotificationToUser, notifyDocumentCreated } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { log } from '@/lib/logging';
import { persistUploadedDocument } from './upload-core';

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
 *
 * `У-158` (дефект `Д-18`): запись документа делает ОБЩИЙ движок
 * `persistUploadedDocument`, а не своя ветка. Прежняя писала документ с типом
 * «прочее», направлением «входящий», без размера файла и по пути **случайной**
 * организации компании (`findFirst`) — то есть документ заказчика мог лечь в
 * папку другого клиента той же компании. Теперь путь, тип, направление и
 * размер такие же, как у остальных загрузок.
 */

type AdminUploadError =
  'not_found' | 'forbidden' | 'organization_context_not_found' | 'invalid_file_format' | 'storage';

export type UploadAdminDocumentArgs = {
  orderId: string;
  correlationId: string;
  /** Тип документа из формы; неизвестный движок сведёт к «прочему». */
  docType?: string;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export type UploadAdminDocumentResult =
  | { ok: true; document: { id: string; name: string; mimeType: string; createdAt: Date } }
  | { ok: false; error: AdminUploadError };

export async function uploadAdminDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: UploadAdminDocumentArgs
): Promise<UploadAdminDocumentResult> {
  const { orderId, correlationId, file } = args;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: 'not_found' };
  if (!(await canReadOrder(session, order))) return { ok: false, error: 'forbidden' };

  // Контрагент документа — организация ЭТОГО заказа, а не первая попавшаяся
  // организация компании: иначе бумага клиента ложилась в чужую папку.
  if (!order.organizationId) return { ok: false, error: 'organization_context_not_found' };

  const persisted = await persistUploadedDocument(prisma, {
    counterparty: { type: 'organization', id: order.organizationId },
    orderId,
    direction: 'outgoing',
    docType: args.docType ?? 'other',
    uploadedById: session.sub,
    source: 'admin',
    file,
  });
  if (!persisted.ok) {
    log.warn('[documents/adminUpload] persist failed', {
      correlationId,
      orderId,
      error: persisted.error,
    });
    return {
      ok: false,
      error: persisted.error === 'storage' ? 'storage' : 'invalid_file_format',
    };
  }
  const doc = persisted.document;

  // Антивирусную проверку ставит в очередь сам движок загрузки — вторая
  // постановка создала бы дубль задачи.

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
