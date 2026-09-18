import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { safeText, styleHeader } from '@/lib/services/export/xlsx';
import type { DebtMismatchRow } from './reconcileDebts';

/**
 * Отчёт «Расхождения по дебиторке» в Excel (`У-257`, этап 8).
 *
 * Строка в истории обмена отвечает на вопрос «а сверка вообще была?». Разбирают
 * расхождения не в ней: бухгалтеру нужен файл, который можно открыть рядом с
 * 1С и пройти по строкам. Поэтому отчёт собирается из ТОЙ ЖЕ записи журнала,
 * что показана в истории, — второй раз к 1С не ходим и второй раз не считаем:
 * иначе файл и строка на экране однажды разошлись бы цифрами.
 */

export type DebtsReportResult =
  | { ok: true; buffer: Buffer; fileName: string; mismatches: number }
  | { ok: false; error: 'not_found' };

type StoredPayload = {
  channel?: unknown;
  mismatches?: unknown;
};

function rowsOf(payload: unknown): DebtMismatchRow[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const list = (payload as StoredPayload).mismatches;
  return Array.isArray(list) ? (list as DebtMismatchRow[]) : [];
}

export async function buildDebtsReport(
  prisma: PrismaClient,
  opts: { logId?: string | undefined } = {}
): Promise<DebtsReportResult> {
  const row = opts.logId
    ? await prisma.syncLog.findUnique({
        where: { id: opts.logId },
        select: { id: true, createdAt: true, entity: true, payload: true },
      })
    : await prisma.syncLog.findFirst({
        where: { entity: 'debt', operation: 'reconcile' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, entity: true, payload: true },
      });
  // Чужая запись журнала по прямой ссылке отчётом не становится: отдать её
  // значило бы сделать из выгрузки универсальный просмотрщик журнала.
  if (!row || row.entity !== 'debt') return { ok: false, error: 'not_found' };

  const mismatches = rowsOf(row.payload);

  // Расхождений нет — файл всё равно собираем: пустая таблица с шапкой честно
  // отвечает «сверка была, расхождений нет», а отказ человек прочитал бы как
  // «отчёт сломался».
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Расхождения');
  sheet.columns = [
    { header: 'Заказ', key: 'order', width: 22 },
    { header: 'Организация', key: 'org', width: 38 },
    { header: 'Долг в кабинете', key: 'ours', width: 18 },
    { header: 'Долг в 1С', key: 'theirs', width: 18 },
    { header: 'Разница', key: 'diff', width: 16 },
  ];
  styleHeader(sheet, mismatches.length > 0);

  for (const m of mismatches) {
    sheet.addRow({
      order: safeText(m.orderNumber ?? m.orderId),
      org: safeText(m.organizationName ?? '—'),
      ours: safeText(m.ours),
      theirs: safeText(m.theirs),
      diff: safeText(m.diff),
    });
  }

  const day = row.createdAt.toISOString().slice(0, 10);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    ok: true,
    buffer,
    fileName: `Расхождения по дебиторке ${day}.xlsx`,
    mismatches: mismatches.length,
  };
}
