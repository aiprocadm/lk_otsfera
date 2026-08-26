import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { notifyManagers, notifyManagersPartnerOrderLess } from '@/lib/notifications';
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
 * Два канала записи, XOR по инварианту upload-core (`У-115`, зеркало кабинета
 * заказчика):
 *  - без заказа  → документ пришпилен к компании продавца;
 *  - с заказом   → документ пришпилен к `orderId`.
 *
 * Компанию для документа без заказа берём из портфеля: это компания, которой
 * принадлежат организации партнёра. Если портфель пуст или разложен по
 * НЕСКОЛЬКИМ компаниям — отказываем кодом `company_required`, а не выбираем
 * молча одну из них: молчаливый выбор отправил бы документ не тому продавцу.
 * Человеку в этом случае показывается русская строка с выходом — приложить
 * файл к конкретному заказу.
 *
 * Рассылка уведомлений — best-effort: падение логируется и проглатывается,
 * загрузку оно не откатывает (§3 degrade gracefully).
 */

export type CreatePartnerDocumentArgs = {
  /** `null` — документ вне заказа (общий документ партнёра, `У-115`). */
  orderId: string | null;
  docType: string;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export type CreatePartnerDocumentResult =
  | { ok: true; documentId: string }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'not_found'
        | 'too_large'
        | 'invalid_mime'
        | 'storage'
        | 'company_required';
    };

export async function createPartnerDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreatePartnerDocumentArgs
): Promise<CreatePartnerDocumentResult> {
  const partnerId = session.partnerId;
  if (!partnerId) return { ok: false, error: 'forbidden' };

  if (!args.orderId) {
    const orgs = await prisma.organization.findMany({
      where: { partnerId },
      select: { companyId: true },
    });
    const companyIds = new Set(
      orgs.map((o) => o.companyId).filter((id): id is string => id !== null)
    );
    // Ровно одна компания — иначе непонятно, чей это документ (см. шапку файла).
    const companyId = companyIds.size === 1 ? [...companyIds][0] : undefined;
    if (companyId === undefined) return { ok: false, error: 'company_required' };

    const persisted = await persistUploadedDocument(prisma, {
      counterparty: { type: 'partner', id: partnerId },
      orderId: null,
      companyId,
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
      await notifyManagersPartnerOrderLess(prisma, {
        partnerId,
        partnerName: partner?.name ?? 'партнёр',
        documentName: args.file.name,
        documentType: args.docType,
      });
    } catch (err) {
      log.warn('[uploadPartnerDocument] order-less notify failed', {
        documentId: persisted.documentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ok: true, documentId: persisted.documentId };
  }

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
