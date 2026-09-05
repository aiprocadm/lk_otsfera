import type { OneCPushStatus, Prisma, PrismaClient } from '@prisma/client';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';

/**
 * Общие документы — те, что не привязаны ни к одному заказу (`orderId = null`).
 *
 * Админское зеркало (Model A) видит их по всей платформе без скоупа: гард
 * `requireAdmin` остаётся на странице, сервис только читает.
 *
 * `С-6`: список режется по `take`, поэтому рядом отдаётся `total` — полный
 * счётчик по тому же условию, чтобы экран честно сказал «показаны 200 из M».
 */
export async function listGeneralDocuments(
  prisma: PrismaClient,
  /** `У-169`: фильтр «Выгрузка в 1С» — значение уже разобрано страницей. */
  opts: { oneCPushStatus?: OneCPushStatus | undefined } = {}
): Promise<{ rows: OrgDocumentRow[]; total: number }> {
  // `У-151`: заменённая перевыпуском версия из списка скрыта — два
  // одинаковых номера рядом человек прочитал бы как дубль в системе.
  const where: Prisma.DocumentWhereInput = {
    orderId: null,
    supersededAt: null,
    ...(opts.oneCPushStatus ? { oneCPushStatus: opts.oneCPushStatus } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
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
        oneCPushStatus: true,
      },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((d) => ({
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
      oneCPushStatus: d.oneCPushStatus,
    })),
  };
}
