import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { notifyManagers } from '@/lib/notifications';
import { persistUploadedDocument } from '@/lib/services/documents/upload-core';
import { log } from '@/lib/logging';

/**
 * Загрузка документа из кабинета партнёра (входящий канал партнёр → компания).
 * Вынесено из server-action (CLAUDE.md §2/§3).
 *
 * Изоляция портфеля (§4, слой сервиса): `partnerId` берётся ТОЛЬКО из сессии и
 * никогда не приходит аргументом — иначе вызывающий мог бы подставить чужой
 * идентификатор. Заказ вне портфеля → тихий `not_found` (существование чужого
 * заказа не подтверждаем). Сессия без `partnerId` → `forbidden`.
 *
 * Рассылка уведомлений — best-effort: падение логируется и проглатывается,
 * загрузку оно не откатывает (§3 degrade gracefully).
 */

export type CreatePartnerDocumentArgs = {
  orderId: string;
  docType: string;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export type CreatePartnerDocumentResult =
  | { ok: true; documentId: string }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage';
    };

export async function createPartnerDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreatePartnerDocumentArgs
): Promise<CreatePartnerDocumentResult> {
  const partnerId = session.partnerId;
  if (!partnerId) return { ok: false, error: 'forbidden' };

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { id: true, partnerId: true, orderNumber: true, title: true },
  });
  if (!order || order.partnerId !== partnerId) {
    return { ok: false, error: 'not_found' };
  }

  const persisted = await persistUploadedDocument(prisma, {
    counterparty: { type: 'partner', id: partnerId },
    orderId: order.id,
    direction: 'incoming',
    docType: args.docType,
    uploadedById: session.sub,
    source: 'partner',
    file: args.file,
  });
  if (!persisted.ok) return persisted;

  try {
    const partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { name: true },
    });
    await notifyManagers(prisma, {
      orderId: order.id,
      type: 'document_uploaded_by_partner',
      payload: {
        partnerName: partner?.name ?? 'партнёр',
        documentName: args.file.name,
        documentType: args.docType,
      },
    });
  } catch (err) {
    log.warn('[uploadPartnerDocument] notifyManagers failed', {
      documentId: persisted.documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, documentId: persisted.documentId };
}
