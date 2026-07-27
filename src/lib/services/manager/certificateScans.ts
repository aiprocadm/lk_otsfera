import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { persistUploadedDocument } from '@/lib/services/documents/upload-core';

/**
 * Этап 12 PR-2 (Модуль 5, ФТ-5.3) — массовая загрузка сканов удостоверений.
 *
 * До этого PR закрыть пункт чек-листа «загружен скан удостоверения»
 * (`Certificate.documentId`, PR-1) через интерфейс было нечем: `documentId`
 * проставлялся только при создании удостоверения через API, а форма выдачи его
 * не передаёт. Здесь менеджер грузит пачку файлов на заказ и раскладывает их по
 * слушателям — сопоставление подсказывает `lib/orders/certificateScanMatch.ts`,
 * подтверждает человек (ТЗ: «с обязательным ручным подтверждением»).
 *
 * Скоуп — `canSeeOrder` (C8 team-mode-aware), как у остальных операций заказа.
 *
 * Каждый файл проходит общий путь загрузки (`persistUploadedDocument`): проверка
 * MIME/размера, объектное хранилище, `Document`, постановка ClamAV-скана и аудит
 * `document_uploaded`. Дополнительно пишется `certificate_scan_attached` — связь
 * файла с удостоверением.
 *
 * **Пофайловая деградация**: сбой одного файла (чужая позиция, нет
 * удостоверения, битый MIME) не отменяет остальные — ответ несёт результат по
 * каждому файлу, менеджер видит, что перезагрузить.
 */

export type CertificateScanTarget = {
  itemId: string;
  studentName: string;
  certificateId: string | null;
  certificateNumber: string | null;
  hasScan: boolean;
};

export type ScanFileError =
  | 'item_not_found'
  | 'certificate_missing'
  | 'too_large'
  | 'invalid_mime'
  | 'storage';

export type ScanFileResult =
  | { fileName: string; ok: true; orderItemId: string; documentId: string }
  | { fileName: string; ok: false; orderItemId: string; error: ScanFileError };

export type UploadCertificateScansArgs = {
  orderId: string;
  files: ReadonlyArray<{
    orderItemId: string;
    file: { name: string; size: number; mimeType: string; buffer: Buffer };
  }>;
};

const ORDER_SELECT = {
  id: true,
  managerId: true,
  organizationId: true,
  partnerId: true,
  companyId: true,
  serviceType: true,
  items: {
    select: {
      id: true,
      student: { select: { name: true } },
      certificate: { select: { id: true, number: true, documentId: true } }
    }
  }
} as const;

/** ФТ-5.3: позиции заказа как цели для сканов (ФИО + номер + уже ли есть скан). */
export async function listCertificateScanTargets(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<
  | { ok: true; targets: CertificateScanTarget[] }
  | { ok: false; error: 'not_found' | 'forbidden' }
> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order) return { ok: false, error: 'not_found' };
  if (!canSeeOrder(session, order, teamMode)) return { ok: false, error: 'forbidden' };

  return {
    ok: true,
    targets: order.items.map((item) => ({
      itemId: item.id,
      studentName: item.student.name,
      certificateId: item.certificate?.id ?? null,
      certificateNumber: item.certificate?.number ?? null,
      hasScan: item.certificate?.documentId != null
    }))
  };
}

/** ФТ-5.3: загрузка пачки сканов с уже подтверждённым сопоставлением. */
export async function uploadCertificateScans(
  prisma: PrismaClient,
  session: SessionPayload,
  args: UploadCertificateScansArgs
): Promise<
  | { ok: true; results: ScanFileResult[] }
  | { ok: false; error: 'not_found' | 'forbidden' | 'validation' }
> {
  if (args.files.length === 0) return { ok: false, error: 'validation' };

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({ where: { id: args.orderId }, select: ORDER_SELECT });
  if (!order) return { ok: false, error: 'not_found' };
  if (!canSeeOrder(session, order, teamMode)) return { ok: false, error: 'forbidden' };

  const byItemId = new Map(order.items.map((item) => [item.id, item]));
  const results: ScanFileResult[] = [];

  // Последовательно: у файлов общий заказ, а порядок результатов должен
  // совпадать с порядком строк формы.
  for (const entry of args.files) {
    const fileName = entry.file.name;
    const item = byItemId.get(entry.orderItemId);
    // Позиция чужого заказа неотличима от несуществующей — оба item_not_found.
    if (!item) {
      results.push({ fileName, ok: false, orderItemId: entry.orderItemId, error: 'item_not_found' });
      continue;
    }
    if (!item.certificate) {
      results.push({
        fileName,
        ok: false,
        orderItemId: entry.orderItemId,
        error: 'certificate_missing'
      });
      continue;
    }

    const persisted = await persistUploadedDocument(prisma, {
      counterparty: { type: 'organization', id: order.organizationId },
      orderId: order.id,
      direction: 'outgoing',
      docType: 'certificate',
      uploadedById: session.sub,
      source: 'manager',
      file: entry.file
    });
    if (!persisted.ok) {
      results.push({ fileName, ok: false, orderItemId: entry.orderItemId, error: persisted.error });
      continue;
    }

    // Замена разрешена: испорченный скан перезагружают, прежний Document
    // остаётся в истории документов заказа.
    const certificateId = item.certificate.id;
    const previousDocumentId = item.certificate.documentId;
    await prisma.certificate.update({
      where: { id: certificateId },
      data: { documentId: persisted.documentId }
    });
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'certificate_scan_attached',
      entity: 'certificate',
      entityId: certificateId,
      after: {
        orderId: order.id,
        orderItemId: item.id,
        documentId: persisted.documentId,
        replacedDocumentId: previousDocumentId
      }
    });

    results.push({ fileName, ok: true, orderItemId: entry.orderItemId, documentId: persisted.documentId });
  }

  return { ok: true, results };
}
