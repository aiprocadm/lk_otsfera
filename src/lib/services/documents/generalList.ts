import type { PrismaClient } from '@prisma/client';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

/**
 * Общие документы — те, что не привязаны ни к одному заказу (`orderId = null`).
 *
 * Админское зеркало (Model A) видит их по всей платформе без скоупа: гард
 * `requireAdmin` остаётся на странице, сервис только читает.
 */
export async function listGeneralDocuments(prisma: PrismaClient): Promise<OrgDocumentRow[]> {
  const rows = await prisma.document.findMany({
    where: { orderId: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      name: true,
      type: true,
      direction: true,
      signedAt: true,
      createdAt: true,
      size: true,
      // `У-154`: номер и версия документа — их показывает список.
      number: true,
      version: true,
    },
  });

  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    direction: d.direction,
    signedAt: d.signedAt,
    createdAt: d.createdAt,
    size: d.size,
    orderId: null,
    orderNumber: null,
    orderTitle: null,
    number: d.number,
    version: d.version,
  }));
}
