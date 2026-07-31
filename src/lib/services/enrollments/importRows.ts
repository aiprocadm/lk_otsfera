import type ExcelJS from 'exceljs';
import { loadXlsxWorkbook } from '@/lib/services/import/load-xlsx';
import { cellToString } from '@/lib/services/import/parse-workbook';
import { validateEnrollmentItems, type ValidatedItem } from './validate';

/**
 * Разбор Excel-файла со слушателями для мастера заявки (этап 2 PR-2, ФТ-2.1).
 * В отличие от validateEnrollmentItems (всё-или-ничего при подаче), импорт
 * построчный: валидные строки уходят в таблицу мастера, невалидные —
 * русскими сообщениями «Строка N: …» (§3 спеки). Дубликаты email/строк
 * внутри файла пропускаются с предупреждением.
 */

/** Колонки шаблона; заголовки сверяются без учёта регистра и «*». */
export const ENROLLMENT_IMPORT_COLUMNS = {
  fullName: 'ФИО',
  email: 'Email',
  position: 'Должность',
  snils: 'СНИЛС',
  birthDate: 'Дата рождения',
  extra: 'Дополнительно',
} as const;

export type EnrollmentImportResult =
  | { ok: true; items: ValidatedItem[]; errors: string[]; warnings: string[] }
  | { ok: false; errors: string[] };

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Дата из ячейки: Date (exceljs), serial-число или строка `ДД.ММ.ГГГГ`/ISO → ISO для parseBirthDate. */
function cellToIsoDate(value: ExcelJS.CellValue): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(EXCEL_EPOCH_MS + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  }
  const text = cellToString(value);
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  return text;
}

function normalizeHeader(text: string): string {
  return text.replace(/\*/g, '').trim().toLowerCase();
}

export async function parseEnrollmentImportWorkbook(
  buffer: Buffer | ArrayBuffer
): Promise<EnrollmentImportResult> {
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadXlsxWorkbook(buffer);
  } catch {
    return {
      ok: false,
      errors: ['Не удалось прочитать файл — ожидается файл Excel (.xlsx). Скачайте шаблон.'],
    };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, errors: ['В файле нет ни одного листа. Скачайте шаблон.'] };

  const colIndex = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) =>
    colIndex.set(normalizeHeader(cellToString(cell.value)), col)
  );
  const fieldToCol = new Map(
    Object.entries(ENROLLMENT_IMPORT_COLUMNS)
      .map(([field, label]) => [field, colIndex.get(normalizeHeader(label))] as const)
      .filter((pair): pair is [string, number] => pair[1] !== undefined)
  );
  if (!fieldToCol.has('fullName') || !fieldToCol.has('email')) {
    return {
      ok: false,
      errors: ['В первой строке файла не найдены колонки «ФИО» и «Email». Скачайте шаблон.'],
    };
  }

  const items: ValidatedItem[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenEmails = new Set<string>();

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cellAt = (field: string): ExcelJS.CellValue => {
      const col = fieldToCol.get(field);
      return col === undefined ? null : row.getCell(col).value;
    };
    const input = {
      fullName: cellToString(cellAt('fullName')),
      email: cellToString(cellAt('email')),
      position: cellToString(cellAt('position')),
      snils: cellToString(cellAt('snils')),
      birthDate: cellToIsoDate(cellAt('birthDate')),
      extra: cellToString(cellAt('extra')),
    };
    if (Object.values(input).every((v) => !v)) continue; // пустая строка листа

    const res = validateEnrollmentItems([input], () => `Строка ${r}`);
    if (!res.ok) {
      errors.push(...res.errors);
      continue;
    }
    const item = res.items[0];
    if (seenEmails.has(item.email)) {
      warnings.push(`Строка ${r}: дубликат email «${item.email}» — строка пропущена`);
      continue;
    }
    seenEmails.add(item.email);
    items.push(item);
  }

  if (!items.length && !errors.length && !warnings.length) {
    return {
      ok: false,
      errors: ['В файле нет ни одной строки со слушателями (заполняются строки со 2-й).'],
    };
  }
  return { ok: true, items, errors, warnings };
}
