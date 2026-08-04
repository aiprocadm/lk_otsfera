import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { notifyManagers, notifyManagersOrderLess } from '@/lib/notifications';
import { persistUploadedDocument } from '@/lib/services/documents/upload-core';
import { getOrganizationName } from '@/lib/services/organization/lookup';
import { log } from '@/lib/logging';

/**
 * Загрузка документа из кабинета организации (входящий канал org → компания).
 * Вынесено из server-action (CLAUDE.md §2/§3): экшен разбирает форму, сервис
 * владеет доступом, записью и рассылкой.
 *
 * Изоляция клиентского контура (§4, слой сервиса):
 *  - членство проверяется запросом в БД по `session.sub` — активная строка
 *    `OrganizationUser` в целевой организации. Это строже клеймов сессии
 *    (`organizationMemberships` могли протухнуть) и потому не заменяется ими.
 *  - заказ обязан принадлежать той же организации, иначе тихий `not_found`
 *    (существование чужого заказа не подтверждаем).
 *
 * Два канала записи, XOR по инварианту upload-core:
 *  - без заказа  → документ пришпилен к `companyId` организации;
 *  - с заказом   → документ пришпилен к `orderId`.
 *
 * Рассылка уведомлений — best-effort: падение логируется и проглатывается,
 * загрузку оно не откатывает (§3 degrade gracefully).
 */

export type CreateOrganizationDocumentArgs = {
  organizationId: string;
  /** `null` — документ вне заказа (общий документ организации). */
  orderId: string | null;
  docType: string;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export type CreateOrganizationDocumentResult =
  | { ok: true; documentId: string }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage';
    };

export async function createOrganizationDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateOrganizationDocumentArgs
): Promise<CreateOrganizationDocumentResult> {
  // Membership: user must be an active member of the target org.
  const membership = await prisma.organizationUser.findFirst({
    where: { organizationId: args.organizationId, userId: session.sub, isActive: true },
    select: { id: true },
  });
  if (!membership) return { ok: false, error: 'forbidden' };

  if (!args.orderId) {
    const org = await prisma.organization.findUnique({
      where: { id: args.organizationId },
      select: { name: true, companyId: true },
    });
    if (!org?.companyId) return { ok: false, error: 'not_found' };

    const persisted = await persistUploadedDocument(prisma, {
      counterparty: { type: 'organization', id: args.organizationId },
      orderId: null,
      companyId: org.companyId,
      direction: 'incoming',
      docType: args.docType,
      uploadedById: session.sub,
      source: 'organization',
      file: args.file,
    });
    if (!persisted.ok) return persisted;

    try {
      await notifyManagersOrderLess(prisma, {
        organizationId: args.organizationId,
        orgName: org.name,
        documentName: args.file.name,
        documentType: args.docType,
      });
    } catch (err) {
      log.warn('[uploadOrganizationDocument] order-less notify failed', {
        documentId: persisted.documentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ok: true, documentId: persisted.documentId };
  }

  // Order must belong to that org (silent not_found otherwise — no existence leak).
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { id: true, organizationId: true, orderNumber: true, title: true },
  });
  if (!order || order.organizationId !== args.organizationId) {
    return { ok: false, error: 'not_found' };
  }

  const persisted = await persistUploadedDocument(prisma, {
    counterparty: { type: 'organization', id: args.organizationId },
    orderId: order.id,
    direction: 'incoming',
    docType: args.docType,
    uploadedById: session.sub,
    source: 'organization',
    file: args.file,
  });
  if (!persisted.ok) return persisted;

  try {
    const orgName = await getOrganizationName(prisma, args.organizationId);
    await notifyManagers(prisma, {
      orderId: order.id,
      type: 'document_uploaded_by_org',
      payload: {
        orgName: orgName ?? 'организация',
        documentName: args.file.name,
        documentType: args.docType,
      },
    });
  } catch (err) {
    log.warn('[uploadOrganizationDocument] notifyManagers failed', {
      documentId: persisted.documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, documentId: persisted.documentId };
}
