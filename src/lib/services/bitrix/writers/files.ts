import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { validateUploadFile } from '@/lib/services/documents/upload-core';
import { getQueue } from '@/lib/jobs/queues';
import { bestEffort, log } from '@/lib/logging';
import { getObjectStorage } from '@/lib/storage';
import type { FileData } from '../mapping/files';
import type { Plan } from '../mapping/types';
import { snapshot, writeJournal, type ApplyContext, type WriteOutcome } from './journal';

/**
 * Вложение сделки или компании → `Document` (`У-191`, спека §3.3).
 *
 * Файл — единственная сущность, которую нельзя записать одной транзакцией:
 * сначала его надо скачать из Битрикса и положить в хранилище, а это сеть.
 * Поэтому порядок такой: скачали → проверили → положили в хранилище →
 * короткая транзакция «строка документа + журнал» → очередь антивируса.
 *
 * Штатный `persistUploadedDocument` здесь не годится: он берёт только
 * глобального клиента, пишет свой аудит и не умеет проставлять `bitrixId`.
 * Зато проверку файла (размер, тип, магические байты) зовём ту же самую —
 * заводить вторую проверку значило бы развести их поведение.
 */
export type FileWriterDeps = {
  download: (file: { id: string; name: string; downloadUrl: string | null }) => Promise<Buffer>;
};

export type FileWriteResult = { ok: true; outcome: WriteOutcome } | { ok: false; reason: string };

/** Тип содержимого по имени файла: Битрикс не всегда присылает его явно. */
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeOf(name: string): string {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function writeFile(
  prisma: PrismaClient,
  ctx: ApplyContext,
  plan: Plan<FileData>,
  source: { id: string; name: string; downloadUrl: string | null },
  deps: FileWriterDeps
): Promise<FileWriteResult> {
  if (plan.action !== 'create') return { ok: false, reason: 'нечего переносить' };
  const d = plan.data;

  let buffer: Buffer;
  try {
    buffer = await deps.download(source);
  } catch (e) {
    return { ok: false, reason: `файл не скачался: ${e instanceof Error ? e.message : String(e)}` };
  }

  const mimeType = mimeOf(d.name);
  const check = validateUploadFile({ size: buffer.length, mimeType, buffer });
  if (!check.ok) {
    return {
      ok: false,
      reason:
        check.error === 'too_large'
          ? 'файл больше допустимого размера'
          : 'тип файла не поддерживается',
    };
  }

  const path = `counterparty/organization/${d.organizationId}/${randomUUID()}-${safeName(d.name)}`;
  try {
    await getObjectStorage().upload(path, buffer, { contentType: mimeType });
  } catch (e) {
    log.error('[bitrix/files] storage upload failed', {
      file: d.name,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: 'хранилище файлов недоступно' };
  }

  // Запись документа обёрнута: один битый файл не должен ронять весь перенос —
  // он уходит строкой в отчёт, а остальные сущности пишутся дальше.
  let documentId: string;
  try {
    documentId = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          name: d.name,
          path,
          mimeType,
          size: buffer.length,
          type: 'other',
          direction: 'incoming',
          companyId: d.companyId,
          counterpartyType: 'organization',
          counterpartyId: d.organizationId,
          uploadedById: ctx.importerId,
          generatedBy: 'system',
          scanStatus: 'pending',
          bitrixId: d.bitrixId,
        },
        select: { id: true },
      });
      await writeJournal(tx, ctx, {
        entity: 'file',
        entityId: doc.id,
        bitrixId: d.bitrixId,
        action: 'created',
        after: snapshot({ name: d.name, organizationId: d.organizationId, path }),
      });
      return doc.id;
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn('[bitrix/files] document not written', { file: d.name, error: message });
    // Самый частый случай — файл уже переносили: `bitrixId` уникален.
    return {
      ok: false,
      reason: message.includes('bitrixId') ? 'файл уже переносили' : 'документ не записан',
    };
  }

  // Антивирус — как у любого другого файла кабинета; сбой очереди не повод
  // терять уже записанный документ (§3, degrade gracefully).
  await getQueue('docs.scanDocument')
    .add('scan', { kind: 'document', id: documentId })
    .catch(bestEffort('[bitrix/files] scan enqueue failed'));

  return { ok: true, outcome: { entityId: documentId, action: 'created', keptManual: [] } };
}
