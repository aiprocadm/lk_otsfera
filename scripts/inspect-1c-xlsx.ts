/**
 * Инспектор выгрузки 1С (ТЗ починки импорта, Т-1).
 *
 * Показывает, что система видит в файле: листы книги, распознанные и
 * нераспознанные заголовки по ТЕКУЩЕЙ карте колонок, первые строки каждого
 * листа. Ни базы, ни сети — только чтение файла.
 *
 *   npx tsx scripts/inspect-1c-xlsx.ts <путь-к-файлу.xlsx>
 *   npm run inspect:1c -- <путь-к-файлу.xlsx>
 *
 * Карта колонок импортируется из боевого `column-map.ts` — копии здесь быть не
 * должно: разъехавшаяся копия врала бы ровно в том месте, ради которого
 * инструмент и написан.
 *
 * Код возврата всегда 0: это инструмент для оператора, а не проверка в CI.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import ExcelJS from 'exceljs';
import {
  SHEET_NAMES,
  ORG_COLS,
  ORDER_COLS,
  PAYMENT_COLS,
} from '../src/lib/services/import/column-map';

const SHEETS: Array<{ key: keyof typeof SHEET_NAMES; cols: Record<string, string> }> = [
  { key: 'orgs', cols: ORG_COLS },
  { key: 'orders', cols: ORDER_COLS },
  { key: 'payments', cols: PAYMENT_COLS },
];

/** Формат по первым байтам, а не по расширению: переименованный .xls — частый случай. */
function sniffFormat(buf: Buffer): 'xlsx' | 'xls' | 'неизвестно' {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return 'xlsx';
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)
    return 'xls';
  return 'неизвестно';
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const o = value as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText))
      return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    if ('result' in o) return cellText(o.result as ExcelJS.CellValue);
  }
  return String(value).trim();
}

function headerLabels(ws: ExcelJS.Worksheet): string[] {
  const labels: string[] = [];
  ws.getRow(1).eachCell((cell) => labels.push(cellText(cell.value)));
  return labels;
}

function printSheet(ws: ExcelJS.Worksheet, cols: Record<string, string>): void {
  const labels = headerLabels(ws);
  const known = new Set(labels);

  const recognised = Object.entries(cols)
    .filter(([, label]) => known.has(label))
    .map(([field, label]) => `${label} → ${field}`);
  const missing = Object.entries(cols)
    .filter(([, label]) => !known.has(label))
    .map(([, label]) => label);
  const mapped = new Set(Object.values(cols));
  const extra = labels.filter((l) => l && !mapped.has(l));

  console.log(`\nЛист «${ws.name}» (строк: ${Math.max(ws.rowCount - 1, 0)})`);
  console.log(`  ✔ распознано: ${recognised.length ? recognised.join(', ') : '— ничего'}`);
  if (extra.length) console.log(`  ✖ не распознано: ${extra.map((h) => `«${h}»`).join(', ')}`);
  if (missing.length) console.log(`  ✖ не найдены колонки карты: ${missing.join(', ')}`);

  const preview = Math.min(ws.rowCount, 4);
  if (preview > 1) {
    console.log('  Первые строки:');
    for (let r = 2; r <= preview; r++) {
      const cells: string[] = [];
      ws.getRow(r).eachCell((cell) => cells.push(cellText(cell.value)));
      console.log(`    ${r - 1}. ${cells.join(' | ')}`);
    }
  }
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.log('Укажите путь к файлу: npx tsx scripts/inspect-1c-xlsx.ts <файл.xlsx>');
    return;
  }

  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch (e) {
    console.log(`Не удалось прочитать файл: ${(e as Error).message}`);
    return;
  }

  const format = sniffFormat(buf);
  console.log(
    `Файл: ${basename(path)}, ${(buf.length / 1024 / 1024).toFixed(2)} МБ, формат по содержимому: ${format}`
  );
  if (format === 'xls') {
    console.log(
      '  ⚠ Внутри старый формат .xls. Страница «Загрузка Excel» его пока не принимает —\n' +
        '    пересохраните из 1С как «Лист Excel 2007-…(xlsx)» (поддержка .xls придёт этапом 3).'
    );
    return;
  }

  const wb = new ExcelJS.Workbook();
  try {
    // Типы ExcelJS объявляют load() под DOM-ArrayBuffer; Node Buffer работает в рантайме.
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch (e) {
    console.log(`Не удалось открыть книгу: ${(e as Error).message}`);
    return;
  }

  const found = wb.worksheets.map((ws) => ws.name);
  console.log(`Листов в книге: ${found.length} — ${found.map((n) => `«${n}»`).join(', ')}`);

  for (const { key, cols } of SHEETS) {
    const ws = wb.getWorksheet(SHEET_NAMES[key]);
    if (ws) printSheet(ws, cols);
  }

  const missingSheets = Object.values(SHEET_NAMES).filter((name) => !wb.getWorksheet(name));
  console.log(`\nОжидались листы: ${Object.values(SHEET_NAMES).join(', ')}`);
  if (missingSheets.length === 0) {
    console.log('  ✔ все на месте');
  } else {
    for (const name of missingSheets) {
      console.log(`  ✖ не найден лист «${name}»`);
    }
    console.log(
      '  Подсказка: сейчас имя листа сверяется точно. Если в вашей выгрузке лист называется\n' +
        '  иначе (например «Реализация товаров и услуг»), пришлите этот вывод — карта листов\n' +
        '  правится этапом 3 (Т-9, Т-10).'
    );
  }
}

void main();
