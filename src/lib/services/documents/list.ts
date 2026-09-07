import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { hideInfectedForSession } from '@/lib/services/scan/visibility';

/**
 * Плоский список документов для админ-панели (DocumentsPanel).
 *
 * Роль здесь НЕ фильтрует выборку по контрагенту: канальные скоупы живут в
 * organizationChannelWhere / partnerChannelWhere / managerDocumentScope, а этот
 * список — админский. Роль проверяется гардом роута (только `admin`); внутри
 * остаётся единственный скоуп-фильтр — сокрытие заражённых файлов от всех,
 * кроме платформенного админа (`hideInfectedForSession`).
 */

type DocumentListRow = {
  id: string;
  name: string;
  mimeType: string;
  createdAt: Date;
  orderId: string | null;
};

/**
 * `С-8`: список режется по `take`, поэтому рядом отдаётся `total` — экран
 * честно говорит «показаны первые N из M», а не выдаёт срез за весь список.
 */
export const DOCUMENTS_API_CAP = 200;

export async function listAllDocuments(
  prisma: PrismaClient,
  session: SessionPayload,
  /**
   * Фильтр по заказу — на СЕРВЕРЕ. Карточка заказа показывает документы
   * одного заказа, и раньше панель просила весь список платформы, а нужные
   * три строки отбирала в браузере (`docs.filter(...)`): чтобы показать три
   * документа, администратору уезжали метаданные всех документов системы
   * (сопровождение `С-8`, 07.09.2026, хотфикс №18).
   */
  opts: { orderId?: string | undefined } = {}
): Promise<{ ok: true; documents: DocumentListRow[]; total: number }> {
  const where: Prisma.DocumentWhereInput = {
    ...hideInfectedForSession(session),
    // `У-151`: действующая версия документа, а не вся цепочка перевыпусков.
    supersededAt: null,
    ...(opts.orderId ? { orderId: opts.orderId } : {}),
  };
  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: DOCUMENTS_API_CAP,
      select: { id: true, name: true, mimeType: true, createdAt: true, orderId: true },
    }),
    prisma.document.count({ where }),
  ]);

  return { ok: true, documents, total };
}
