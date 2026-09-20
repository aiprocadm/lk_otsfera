import type { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { recordAudit } from '@/lib/auth/audit';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { documentDownloadName, uniqueArchiveName } from '@/lib/documents/fileName';
import { log } from '@/lib/logging';
import { getObjectStorage } from '@/lib/storage';
import type { ZipSkipped } from '@/lib/documents/zipSummary';

/**
 * Пакетное скачивание документов (`У-252`, этап 8).
 *
 * Человек отмечает галочками несколько бумаг и забирает их одним архивом.
 * Раньше приходилось качать по одной: десять документов — десять нажатий и
 * десять файлов с невнятными именами в папке «Загрузки».
 *
 * **Скоуп проверяется ТОЙ ЖЕ функцией, что и одиночное скачивание**
 * (`canReadDocument`, решение `Р-Э8-3`). Соблазн написать «свой» `where` по
 * ролям велик — он быстрее, — но второй набор правил доступа разъедется с
 * первым на первой же правке, и разъедется молча: архив просто окажется
 * полнее, чем должен. Поэтому проверка идёт по КАЖДОМУ документу.
 *
 * **Чужой документ молча пропускается** и попадает в счётчик «не включено».
 * Ответ «такого документа нет» подтверждал бы существование чужой бумаги — по
 * идентификаторам можно было бы перебором выяснить, что у соседа есть.
 */

/** Больше файлов в один архив не кладём (`В-8-1`). */
export const ZIP_MAX_FILES = 50;

/** И больше этого объёма тоже (`В-8-1`). */
export const ZIP_MAX_BYTES = 500 * 1024 * 1024;

export type ZipResult =
  | {
      ok: true;
      zip: Buffer;
      fileName: string;
      included: number;
      skipped: ZipSkipped;
    }
  | { ok: false; error: 'no_ids' }
  | { ok: false; error: 'empty'; skipped: ZipSkipped }
  | { ok: false; error: 'too_many_files'; requested: number; limit: number }
  | { ok: false; error: 'too_large'; bytes: number; limit: number };

/** `?ids=a,b,c` → список без пустых и без повторов, порядок сохраняется. */
export function parseDocumentIds(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

const emptySkipped = (): ZipSkipped => ({
  noAccess: 0,
  pending: 0,
  infected: 0,
  unavailable: 0,
});

/** Имя самого архива: дата в имени помогает не спутать два скачивания подряд. */
function archiveFileName(now: Date): string {
  const d = now.toISOString().slice(0, 10);
  return `Документы ${d}.zip`;
}

export async function buildDocumentsZip(
  prisma: PrismaClient,
  session: SessionPayload,
  ids: string[],
  now: Date = new Date()
): Promise<ZipResult> {
  if (ids.length === 0) return { ok: false, error: 'no_ids' };

  /**
   * Предел по числу файлов — ДО любого обращения к базе и хранилищу
   * (`Р-Э8-4`). Проверять его после сборки значит скачать полгигабайта, чтобы
   * потом сказать «нет». А молча срезать лишнее нельзя вовсе: человек примет
   * усечённый архив за полный и обнаружит потерю в самый неудобный момент.
   */
  if (ids.length > ZIP_MAX_FILES) {
    return { ok: false, error: 'too_many_files', requested: ids.length, limit: ZIP_MAX_FILES };
  }

  const rows = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      path: true,
      size: true,
      scanStatus: true,
      // `У-154`: имя внутри архива собирается по типу, номеру и дате.
      type: true,
      number: true,
      createdAt: true,
      // Всё, что нужно гейту чтения (страж `security.document-read-fields`).
      status: true,
      orderId: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      order: { select: { companyId: true } },
    },
  });

  const skipped = emptySkipped();
  // Документ мог быть удалён или принадлежать чужому контуру — и то и другое
  // для человека выглядит одинаково: бумага в архив не попала.
  skipped.noAccess += ids.length - rows.length;

  const allowed: typeof rows = [];
  for (const doc of rows) {
    if (!(await canReadDocument(session, doc))) {
      skipped.noAccess += 1;
      continue;
    }
    if (doc.scanStatus === 'infected') {
      skipped.infected += 1;
      continue;
    }
    if (doc.scanStatus !== 'clean') {
      skipped.pending += 1;
      continue;
    }
    allowed.push(doc);
  }

  if (allowed.length === 0) return { ok: false, error: 'empty', skipped };

  /**
   * Предел по объёму — по метаданным, до скачивания из хранилища. Размер у
   * строк старше этапа загрузок бывает пустым: считаем такую бумагу нулевой и
   * пропускаем вперёд, потому что отказать из-за неизвестного размера хуже,
   * чем изредка собрать архив чуть больше предела.
   */
  const bytes = allowed.reduce((sum, d) => sum + (d.size ?? 0), 0);
  if (bytes > ZIP_MAX_BYTES) {
    return { ok: false, error: 'too_large', bytes, limit: ZIP_MAX_BYTES };
  }

  const storage = getObjectStorage();
  const zip = new JSZip();
  const used = new Set<string>();
  const packedIds: string[] = [];

  for (const doc of allowed) {
    let content: Buffer;
    try {
      content = await storage.download(doc.path);
    } catch (err) {
      // Как у пакета для 1С: пропавший файл не роняет весь архив — человек
      // получит остальное и увидит в ответе, что одна бумага не вошла.
      log.error('[documents/zip] file download failed', {
        documentId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped.unavailable += 1;
      continue;
    }
    zip.file(uniqueArchiveName(documentDownloadName(doc), used), content);
    packedIds.push(doc.id);
  }

  if (packedIds.length === 0) return { ok: false, error: 'empty', skipped };

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  await recordAudit(prisma, {
    action: 'documents_zip_downloaded',
    entity: 'document',
    // Событие про пакет, а не про одну бумагу: у пакета своей строки нет,
    // поэтому якорем берём первый документ, а весь перечень — в `after`.
    // Пакет непуст — пустой отсечён проверкой `packedIds.length === 0` выше,
    // поэтому запасное значение было бы недостижимой веткой (§11b).
    entityId: packedIds[0]!,
    userId: session.sub,
    after: {
      documentIds: packedIds,
      requested: ids.length,
      included: packedIds.length,
      skipped,
    },
  });

  return {
    ok: true,
    zip: buffer,
    fileName: archiveFileName(now),
    included: packedIds.length,
    skipped,
  };
}
