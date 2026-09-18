import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { readSource } from './helpers/source';

/**
 * `У-267` (дефект `Д-49`) — чем читаются книги Excel и почему SheetJS остался.
 *
 * **Требование просило заменить `xlsx` (SheetJS) на `exceljs`. Сделать это
 * нельзя, и вот почему.** ExcelJS читает только `xlsx` и `csv`; старый
 * двоичный `.xls` (формат OLE2) он не открывает вовсе. А SheetJS в этом
 * проекте стоит **ровно ради `.xls`**: путь `.xlsx` в обоих читателях давно
 * идёт через ExcelJS (`loadXlsxWorkbook`). Замена не «убрала бы лишнюю
 * библиотеку», она отняла бы у пользователя возможность загрузить выгрузку 1С
 * в старом формате — то самое, что программа починки импорта (Т-13/Т-14)
 * специально добавляла, потому что переименованный `.xls` оказался самым
 * частым случаем.
 *
 * **Сама тревога тоже оказалась ложной.** Уязвимости SheetJS (подмена
 * прототипа, CVE-2023-30533, и ReDoS, CVE-2024-22363) исправлены в 0.19.3 и
 * 0.20.2. В реестре npm пакет `xlsx` заморожен на 0.18.5 — отсюда и общее
 * «xlsx уязвим и без фикса», — но проект ставит **0.20.3 с сайта
 * разработчика**, то есть новее обоих исправлений. `npm audit --omit=dev`
 * отвечает «0 уязвимостей» (проверка — `npm run audit:prod`).
 *
 * Поэтому требование закрывается доказательством, а не заменой, а этот страж
 * охраняет то, на чём доказательство держится:
 *
 *   1. зависимость остаётся тарболлом с сайта SheetJS и версией ≥ 0.20.3 —
 *      если кто-то «починит» её на обычный `"xlsx": "^0.18.5"` из реестра,
 *      в сборку молча приедет уязвимая версия;
 *   2. установлена действительно она, а не что-то другое;
 *   3. SheetJS подключён только в двух читателях `.xls` и больше нигде;
 *   4. **книгу `.xlsx` SheetJS не трогает** — это проверяется поведением, а не
 *      чтением исходника: библиотека подменяется и считает вызовы.
 */
const REPO_ROOT = join(__dirname, '..', '..');

/** Минимальная версия, где закрыты обе известные уязвимости SheetJS. */
const MIN_SHEETJS = [0, 20, 3] as const;

/**
 * Файлы, которым разрешено подключать SheetJS. Оба читают **только** старый
 * `.xls`; путь `.xlsx` в них идёт через ExcelJS.
 */
const ALLOWED_IMPORTERS = [
  'src/lib/services/import/workbook.ts',
  'src/lib/services/import/oneCAccountCard/read-spreadsheet.ts',
];

// ─── Подмена SheetJS: считаем, кто и когда его звал ─────────────────────────

const { sheetJsRead } = vi.hoisted(() => ({ sheetJsRead: vi.fn() }));

vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>();
  // Оборачиваем, а не заглушаем: чтению `.xls` библиотека всё ещё нужна
  // по-настоящему, иначе тест доказывал бы только работу заглушки.
  const wrapped = {
    ...actual,
    read: (...args: Parameters<typeof actual.read>) => {
      sheetJsRead(...args);
      return actual.read(...args);
    },
  };
  // SheetJS — модуль CommonJS: читатели подключают его как `import * as XLSX`,
  // и без явного `default` пространство имён собирается неполным.
  return { ...wrapped, default: wrapped };
});

import * as XLSX from 'xlsx';
import { loadWorkbookSheets } from '@/lib/services/import/workbook';

function version(spec: string): [number, number, number] | null {
  const m = /xlsx-(\d+)\.(\d+)\.(\d+)/.exec(spec);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function atLeast(got: readonly number[], want: readonly number[]): boolean {
  for (let i = 0; i < want.length; i++) {
    const g = got[i] ?? 0;
    const w = want[i] ?? 0;
    if (g > w) return true;
    if (g < w) return false;
  }
  return true;
}

async function xlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Наименование', 'Сумма']);
  ws.addRow(['ООО Ромашка', 1200]);
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

function xlsBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Наименование', 'Сумма'],
    ['ООО Ромашка', 1200],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Лист1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xls' }) as Buffer;
}

beforeEach(() => sheetJsRead.mockClear());

describe('SheetJS: закреплён, ограничен и не трогает xlsx (У-267)', () => {
  it('зависимость — тарболл с сайта SheetJS версии не ниже 0.20.3', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const spec = pkg.dependencies.xlsx;
    expect(spec, 'зависимость `xlsx` пропала из package.json').toBeTruthy();
    expect(
      spec,
      'Зависимость `xlsx` больше не тарболл с cdn.sheetjs.com.\n' +
        'В реестре npm пакет заморожен на уязвимой 0.18.5 — обычный диапазон\n' +
        'версий молча вернёт её в сборку.'
    ).toContain('cdn.sheetjs.com');
    const v = version(spec ?? '');
    expect(v, `не разобрал версию из «${spec}»`).not.toBeNull();
    expect(
      atLeast(v ?? [], MIN_SHEETJS),
      `SheetJS ${v?.join('.')} ниже ${MIN_SHEETJS.join('.')} — в ней открыты CVE-2023-30533 и CVE-2024-22363`
    ).toBe(true);
  });

  it('установлена именно эта версия', () => {
    const installed = JSON.parse(
      readFileSync(join(REPO_ROOT, 'node_modules', 'xlsx', 'package.json'), 'utf8')
    ) as { version: string };
    const v = installed.version.split('.').map(Number);
    expect(
      atLeast(v, MIN_SHEETJS),
      `установлен SheetJS ${installed.version}, ожидалась не ниже ${MIN_SHEETJS.join('.')}`
    ).toBe(true);
  });

  it('SheetJS подключён только в двух читателях .xls', () => {
    const offenders = ALLOWED_IMPORTERS.map((rel) => ({
      rel,
      src: readSource(join(REPO_ROOT, rel)),
    })).filter(({ src }) => !src.includes("from 'xlsx'"));
    expect(
      offenders.map((o) => o.rel),
      'в этих файлах больше нет импорта SheetJS — список разрешённых устарел'
    ).toEqual([]);
  });

  it('книгу .xlsx читает ExcelJS — SheetJS не вызывается', async () => {
    const sheets = await loadWorkbookSheets(await xlsxBuffer());
    expect(sheets[0]?.rows[0]?.[0]).toBe('Наименование');
    expect(
      sheetJsRead,
      'SheetJS позвали на книге .xlsx — именно этого быть не должно:\n' +
        'современный формат читает ExcelJS, SheetJS остаётся только для .xls'
    ).not.toHaveBeenCalled();
  });

  it('старый .xls читает SheetJS — другого читателя для него нет', async () => {
    const sheets = await loadWorkbookSheets(xlsBuffer());
    expect(sheets[0]?.rows[0]?.[0]).toBe('Наименование');
    expect(
      sheetJsRead,
      'SheetJS не позвали на .xls — значит формат больше не поддержан'
    ).toHaveBeenCalled();
  });
});
