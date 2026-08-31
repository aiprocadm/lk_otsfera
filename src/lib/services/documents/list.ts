import type { PrismaClient } from '@prisma/client';
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

export async function listAllDocuments(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; documents: DocumentListRow[] }> {
  const documents = await prisma.document.findMany({
    // `У-151`: действующая версия документа, а не вся цепочка перевыпусков.
    where: { ...hideInfectedForSession(session), supersededAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, mimeType: true, createdAt: true, orderId: true },
  });

  return { ok: true, documents };
}
