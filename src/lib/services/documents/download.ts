import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { documentDownloadName } from '@/lib/documents/fileName';

/**
 * Разрешение на скачивание документа общим (не кабинетным) роутом
 * POST /api/documents/[id]/download.
 *
 * Доступ не изобретается заново — тот же предикат `canReadDocument`, что и у
 * карточки документа (§4, defense-in-depth). Выборка тянет ровно те поля,
 * которые предикату нужны, чтобы он не перезапрашивал строку.
 *
 * Заражённый файл — это 410 (`infected`), а не 404: «файл есть, но в карантине»
 * и «файла нет» — разные сигналы (§10). Платформенный админ карантин видит:
 * ему файл нужен для расследования.
 *
 * Подписанная ссылка, TTL, аудит и отметка просмотра остаются в роуте —
 * так же, как у соседнего менеджерского роута скачивания.
 */

export type DocumentDownloadTarget =
  | { ok: true; id: string; path: string; name: string; downloadName: string }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'forbidden' }
  | { ok: false; error: 'infected'; scanReason: string | null };

export async function getDocumentForSignedDownload(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string
): Promise<DocumentDownloadTarget> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      path: true,
      name: true,
      scanStatus: true,
      scanReason: true,
      orderId: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      // `У-154`: имя файла при скачивании собирается по типу, номеру и дате.
      type: true,
      // `У-164`: гейту чтения нужно состояние — черновик КП клиенту не
      // показывается, и без этого поля он сходил бы в базу второй раз.
      status: true,
      number: true,
      createdAt: true,
      order: { select: { companyId: true } },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'forbidden' };
  if (doc.scanStatus === 'infected' && session.role !== 'admin') {
    return { ok: false, error: 'infected', scanReason: doc.scanReason };
  }

  return {
    ok: true,
    id: doc.id,
    path: doc.path,
    name: doc.name,
    downloadName: documentDownloadName(doc),
  };
}
