/**
 * §11 ТЗ v0.5 (этап 1, PR-4) — карточка документа.
 *
 * До этого этапа документ жил только строкой в списке: открыть его отдельно
 * было негде, а решение заказчика Q3 (29.07.2026) требует полноценной
 * страницы — на ней и живут настраиваемые поля документа.
 *
 * Доступ **не изобретается заново**: используется тот же предикат
 * `canReadDocument`, что и у роута скачивания (§4 CLAUDE.md,
 * defense-in-depth). Отказ и отсутствие записи неотличимы снаружи — оба дают
 * `not_found`, иначе по коду ответа можно было бы перебором узнать, какие id
 * существуют.
 */

import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';

export type DocumentDetailError = 'not_found';

export type DocumentDetail = {
  id: string;
  name: string;
  type: string;
  direction: string;
  number: string | null;
  version: number;
  size: number | null;
  mimeType: string;
  scanStatus: string;
  scanReason: string | null;
  signedAt: Date | null;
  createdAt: Date;
  uploadedByName: string | null;
  /** Заказ, к которому относится документ (у общих документов — null). */
  order: { id: string; title: string; orderNumber: string | null } | null;
  counterparty: { type: string; id: string; name: string | null };
};

type Result =
  | { ok: true; document: DocumentDetail }
  | { ok: false; error: DocumentDetailError };

/** Русское имя контрагента по типу и id (для шапки карточки). */
async function counterpartyName(
  prisma: PrismaClient,
  type: string,
  id: string
): Promise<string | null> {
  if (type === 'organization') {
    const org = await prisma.organization.findUnique({ where: { id }, select: { name: true } });
    return org?.name ?? null;
  }
  const partner = await prisma.partner.findUnique({ where: { id }, select: { name: true } });
  return partner?.name ?? null;
}

export async function getDocumentDetail(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string
): Promise<Result> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      type: true,
      direction: true,
      number: true,
      version: true,
      size: true,
      mimeType: true,
      scanStatus: true,
      scanReason: true,
      signedAt: true,
      createdAt: true,
      orderId: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      uploadedBy: { select: { name: true, email: true } },
      order: {
        select: { id: true, title: true, orderNumber: true, companyId: true }
      }
    }
  });
  if (!doc) return { ok: false, error: 'not_found' };

  const allowed = await canReadDocument(session, doc);
  if (!allowed) return { ok: false, error: 'not_found' };

  return {
    ok: true,
    document: {
      id: doc.id,
      name: doc.name,
      type: doc.type,
      direction: doc.direction,
      number: doc.number,
      version: doc.version,
      size: doc.size,
      mimeType: doc.mimeType,
      scanStatus: doc.scanStatus,
      scanReason: doc.scanReason,
      signedAt: doc.signedAt,
      createdAt: doc.createdAt,
      uploadedByName: doc.uploadedBy?.name ?? doc.uploadedBy?.email ?? null,
      order: doc.order
        ? { id: doc.order.id, title: doc.order.title, orderNumber: doc.order.orderNumber }
        : null,
      counterparty: {
        type: doc.counterpartyType,
        id: doc.counterpartyId,
        name: await counterpartyName(prisma, doc.counterpartyType, doc.counterpartyId)
      }
    }
  };
}
