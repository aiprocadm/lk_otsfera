/**
 * Инспектор выгрузки 1С (ТЗ починки импорта, Т-1; этап 3 — алиасы и .xls).
 *
 * Показывает, что система видит в файле: листы книги, распознанные и
 * нераспознанные заголовки по ТЕКУЩЕЙ карте колонок, первые строки каждого
 * листа. Ни базы, ни сети — только чтение файла.
 *
 *   npx tsx scripts/inspect-1c-xlsx.ts <путь-к-файлу>
 *   npm run inspect:1c -- <путь-к-файлу>
 *
 * С этапа 3 скрипт исполняет ТОТ ЖЕ разбор, что и боевой импорт
 * (`parseWorkbook`): алиасы листов и колонок, нормализация «ё/е» и пробелов,
 * `.xls` по сигнатуре. Копий карты здесь нет — разъехавшаяся копия врала бы
 * ровно в том месте, ради которого инструмент и написан.
 *
 * Код возврата всегда 0: это инструмент для оператора, а не проверка в CI.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { SHEET_NAMES } from '../src/lib/services/import/column-map';
import { sniffWorkbookFormat } from '../src/lib/services/import/workbook';
import { parseWorkbook } from '../src/lib/services/import/parse-workbook';

function fmtRow(row: unknown): string {
  const cells = Object.entries(row as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(
      ([field, v]) => `${field}=${v instanceof Date ? v.toISOString().slice(0, 10) : String(v)}`
    );
  return cells.length ? cells.join(' | ') : '(пустая строка)';
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.log('Укажите путь к файлу: npx tsx scripts/inspect-1c-xlsx.ts <файл.xlsx|файл.xls>');
    return;
  }

  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch (e) {
    console.log(`Не удалось прочитать файл: ${(e as Error).message}`);
    return;
  }

  const format = sniffWorkbookFormat(buf);
  console.log(
    `Файл: ${basename(path)}, ${(buf.length / 1024 / 1024).toFixed(2)} МБ, формат по содержимому: ${format ?? 'не Excel'}`
  );
  if (format === null) {
    console.log(
      '  ✖ Это не похоже на книгу Excel. Проверьте, что выгружали из 1С именно\n' +
        '    «Лист Excel 2007-…(xlsx)», а не .mxl или PDF.'
    );
    return;
  }
  if (format === 'xls') {
    console.log('  ℹ Внутри старый формат .xls — читается по содержимому (этап 3).');
  }

  let parsed: Awaited<ReturnType<typeof parseWorkbook>>;
  try {
    parsed = await parseWorkbook(buf);
  } catch (e) {
    console.log(`Не удалось открыть книгу: ${(e as Error).message}`);
    return;
  }
  const d = parsed.diagnostics;

  console.log(
    `Листов в книге: ${d.sheetsFound.length} — ${d.sheetsFound.map((n) => `«${n}»`).join(', ')}`
  );

  const kinds = [
    { label: 'Контрагенты', rows: parsed.orgs, aliases: SHEET_NAMES.orgs },
    { label: 'Реализации', rows: parsed.orders, aliases: SHEET_NAMES.orders },
    { label: 'Поступления', rows: parsed.payments, aliases: SHEET_NAMES.payments },
  ] as const;

  // Ключи unmatchedHeaders — фактические имена РАСПОЗНАННЫХ листов.
  const matchedSheets = Object.keys(d.unmatchedHeaders);

  for (const sheet of matchedSheets) {
    console.log(`\nЛист «${sheet}» — распознан`);
    const unmatched = d.unmatchedHeaders[sheet] ?? [];
    if (unmatched.length) {
      console.log(`  ✖ не распознаны заголовки: ${unmatched.map((h) => `«${h}»`).join(', ')}`);
    } else {
      console.log('  ✔ все заголовки известны карте');
    }
    const missing = d.missingColumns[sheet] ?? [];
    if (missing.length) {
      console.log(`  ✖ не найдены ОБЯЗАТЕЛЬНЫЕ колонки: ${missing.join(', ')}`);
    }
  }

  for (const kind of kinds) {
    if (kind.rows.length > 0) {
      console.log(`\n${kind.label}: строк прочитано — ${kind.rows.length}. Первые:`);
      for (const row of kind.rows.slice(0, 3)) console.log(`    ${fmtRow(row)}`);
    }
  }

  for (const [kind, names] of Object.entries(d.duplicateSheets)) {
    console.log(
      `\n⚠ Под вид «${kind}» подошло несколько листов — взят первый, ещё: ${names
        .map((n) => `«${n}»`)
        .join(', ')}`
    );
  }

  console.log(`\nОжидались листы: ${d.sheetsExpected.join(', ')} (плюс алиасы карты)`);
  if (matchedSheets.length === 0) {
    console.log('  ✖ не распознан НИ ОДИН лист.');
    console.log(
      '  Пришлите этот вывод — точные имена ваших листов добавятся в карту алиасов\n' +
        '  одной строкой (column-map.ts).'
    );
  } else if (matchedSheets.length < kinds.length) {
    const missingKinds = kinds.filter((k) => k.rows.length === 0).map((k) => k.label);
    console.log(`  ℹ распознаны не все виды: нет данных по — ${missingKinds.join(', ')}`);
  } else {
    console.log('  ✔ все виды листов распознаны');
  }
}

void main();
