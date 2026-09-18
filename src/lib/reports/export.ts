import ExcelJS from 'exceljs';
import { safeText, styleHeader } from '@/lib/services/export/xlsx';
import {
  REPORT_ROW_LIMIT,
  type ReportContext,
  type ReportDefinition,
} from '@/lib/reports/registry';

/**
 * Выгрузка отчёта в Excel (`У-244`, этап 7).
 *
 * Отказ считается **до выборки**: сначала спрашиваем, сколько строк получится,
 * и при переборе не читаем ни одной. Прежние выгрузки ведут себя иначе — режут
 * до предела и дописывают «показаны первые N из M»; там человек смотрит на
 * список, здесь считает по нему деньги, и молча срезанный отчёт хуже отказа
 * (`Р-Э7-5`).
 */
export type ReportExportResult =
  | { ok: true; buffer: Buffer; fileName: string }
  | { ok: false; error: 'too_many'; total: number; limit: number };

/** Имя файла: ключ отчёта и период — чтобы в загрузках их можно было различить. */
function fileNameFor(report: ReportDefinition, ctx: ReportContext): string {
  const month = String(ctx.month).padStart(2, '0');
  return `${report.key}-${ctx.year}-${month}.xlsx`;
}

export async function buildReportXlsx(
  report: ReportDefinition,
  ctx: ReportContext
): Promise<ReportExportResult> {
  const total = await report.count(ctx);
  if (total > REPORT_ROW_LIMIT) {
    return { ok: false, error: 'too_many', total, limit: REPORT_ROW_LIMIT };
  }

  const rows = await report.rows(ctx);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(report.title.slice(0, 31));
  ws.columns = report.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 18,
  }));

  for (const row of rows) {
    const safe: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(row)) {
      // Числа оставляем числами: иначе Excel не сложит колонку.
      safe[key] = typeof value === 'number' ? value : safeText(value);
    }
    ws.addRow(safe);
  }

  styleHeader(ws, rows.length > 0);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { ok: true, buffer, fileName: fileNameFor(report, ctx) };
}
