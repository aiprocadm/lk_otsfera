import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Приём выгрузок Битрикс24 (`У-189` file, `У-200`) — `storeBitrixUploads`.
 *
 * Разбор файлов НЕ мокается: тест кормит сервис настоящими фикстурами
 * выгрузки, поэтому «распознано/не распознано» проверяется тем же кодом, что
 * работает в бою. Мокаются только внешние границы — объектное хранилище и
 * логгер.
 */
const { storageUpload, storageRemove, logError, logWarn } = vi.hoisted(() => ({
  storageUpload: vi.fn(),
  storageRemove: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: storageUpload,
    remove: storageRemove,
    download: vi.fn(),
    createSignedUrl: vi.fn(),
  }),
}));
vi.mock('@/lib/logging', () => ({
  log: { error: logError, warn: logWarn, info: vi.fn() },
  bestEffort: (label: string) => (err: unknown) => {
    logWarn(label, err);
  },
}));

import type { FormFile } from '@/lib/api/multipart';
import { IMPORT_MAX_FILE_BYTES } from '@/lib/config/import-limits';
import { storeBitrixUploads } from '@/lib/services/bitrix/upload';

const CSV_MIME = 'text/csv';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FIXTURES = path.resolve(__dirname, '..', '__fixtures__', 'bitrix');

/** Ключ выгрузки: `bitrix-import/uploads/<uuid>/<номер>-<безопасное имя>`. */
const KEY_RE = /^bitrix-import\/uploads\/([0-9a-f-]{36})\/(\d+)-(.+)$/;

function fixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURES, `${name}.csv`));
}

function formFile(name: string, buffer: Buffer, size?: number): FormFile {
  return { name, type: CSV_MIME, size: size ?? buffer.length, buffer };
}

/** Читаемый файл, шапка которого не подходит ни одной сущности Битрикса. */
function unknownCsv(name = 'неведомое.csv'): FormFile {
  return formFile(name, Buffer.from('Фу;Бар\n1;2\n', 'utf8'));
}

async function xlsxCompanies(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Компании');
  ws.addRow(['ID', 'Название компании']);
  ws.addRow([1, 'ООО Ромашка']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function keyOf(res: Awaited<ReturnType<typeof storeBitrixUploads>>, i: number): string {
  expect(res.ok).toBe(true);
  const file = res.ok ? res.files[i] : undefined;
  expect(file?.key).toEqual(expect.stringMatching(KEY_RE));
  return file?.key ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  storageUpload.mockResolvedValue(undefined);
  storageRemove.mockResolvedValue(undefined);
});

describe('storeBitrixUploads — отказы до записи в хранилище', () => {
  it('пустой список → no_files', async () => {
    expect(await storeBitrixUploads([])).toEqual({ ok: false, error: 'no_files' });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('шесть файлов → too_many_files (предел — пять сущностей выгрузки)', async () => {
    const files = Array.from({ length: 6 }, (_, i) => formFile(`f${i}.csv`, fixture('companies')));
    expect(await storeBitrixUploads(files)).toEqual({ ok: false, error: 'too_many_files' });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('размер больше предела → too_large с именем файла (размер берётся из поля, не из буфера)', async () => {
    const big = formFile('огромный.csv', fixture('companies'), IMPORT_MAX_FILE_BYTES + 1);
    expect(await storeBitrixUploads([big])).toEqual({
      ok: false,
      error: 'too_large',
      file: 'огромный.csv',
    });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('ровно предел размера — проходит (граница не «больше или равно»)', async () => {
    const edge = formFile('край.csv', fixture('companies'), IMPORT_MAX_FILE_BYTES);
    const res = await storeBitrixUploads([edge]);
    expect(res.ok).toBe(true);
  });

  it.each([
    ['заметки.txt', 'расширение не CSV/XLSX'],
    ['без-расширения', 'расширения нет вовсе'],
    ['старый.xls', 'старый бинарный формат Excel'],
  ])('%s → invalid_mime (%s)', async (name) => {
    expect(await storeBitrixUploads([formFile(name, fixture('companies'))])).toEqual({
      ok: false,
      error: 'invalid_mime',
      file: name,
    });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('расширение проверяется без учёта регистра: .CSV и .Xlsx проходят', async () => {
    const res = await storeBitrixUploads([
      formFile('КОМПАНИИ.CSV', fixture('companies')),
      formFile('Компании.Xlsx', await xlsxCompanies()),
    ]);
    expect(res.ok).toBe(true);
    expect(storageUpload).toHaveBeenCalledTimes(2);
    expect(storageUpload.mock.calls[0]?.[2]).toEqual({ contentType: CSV_MIME });
    expect(storageUpload.mock.calls[1]?.[2]).toEqual({ contentType: XLSX_MIME });
  });
});

describe('storeBitrixUploads — «расширение» из цепочки прототипов', () => {
  /**
   * Список разрешённых расширений — обычный объект, и проверка `ext in CONTENT_TYPES`
   * видела бы цепочку прототипов: имя `дамп.constructor` проходило бы allow-list,
   * а в хранилище уходил бы `contentType` со значением функции `Object`. Проверка
   * ведётся по собственным ключам (`Object.hasOwn`); страж — этот тест.
   */
  it('унаследованный ключ не считается расширением — invalid_mime и ни одной записи', async () => {
    Object.defineProperty(Object.prototype, 'csvx', { value: undefined, configurable: true });
    try {
      for (const name of ['дамп.constructor', 'дамп.csvx', 'дамп.toString']) {
        const res = await storeBitrixUploads([formFile(name, fixture('companies'))]);
        expect(res).toEqual({ ok: false, error: 'invalid_mime', file: name });
      }
      expect(storageUpload).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Object.prototype, 'csvx');
    }
  });
});

describe('storeBitrixUploads — нечитаемый файл', () => {
  it.each([
    ['пустой файл', 'пустой.csv', Buffer.alloc(0)],
    ['не XLSX под видом XLSX', 'битый.xlsx', Buffer.from('PKмусор', 'utf8')],
  ])('%s → file_unreadable с именем файла', async (_label, name, buffer) => {
    const res = await storeBitrixUploads([
      formFile('companies.csv', fixture('companies')),
      formFile(name, buffer),
    ]);
    expect(res).toEqual({ ok: false, error: 'file_unreadable', file: name });
    // Проверка идёт ДО записи: соседний хороший файл в хранилище не попал.
    expect(storageUpload).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });
});

describe('storeBitrixUploads — успешный приём пакета', () => {
  it('пять фикстур выгрузки: сущности распознаны, ключи под общим uuid, нумерация 1..5', async () => {
    const names = ['companies', 'contacts', 'leads', 'deals', 'tasks'] as const;
    const res = await storeBitrixUploads(names.map((n) => formFile(`${n}.csv`, fixture(n))));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.files).toHaveLength(5);
    expect(res.files.map((f) => f.entity)).toEqual(['company', 'contact', 'lead', 'deal', 'task']);
    expect(res.files.map((f) => f.rows)).toEqual([5, 8, 6, 6, 4]);
    expect(res.files.map((f) => f.name)).toEqual(names.map((n) => `${n}.csv`));

    const folders = new Set<string>();
    res.files.forEach((f, i) => {
      const m = KEY_RE.exec(f.key ?? '');
      expect(m).not.toBeNull();
      folders.add(m?.[1] ?? '');
      expect(m?.[2]).toBe(String(i + 1));
      expect(m?.[3]).toBe(`${names[i]}.csv`);
    });
    // Один заход — одна папка на все пять файлов.
    expect(folders.size).toBe(1);

    expect(storageUpload).toHaveBeenCalledTimes(5);
    for (const [i, name] of names.entries()) {
      const call = storageUpload.mock.calls[i];
      expect(call?.[0]).toBe(res.files[i]?.key);
      expect(call?.[1]).toEqual(fixture(name));
      expect(call?.[2]).toEqual({ contentType: CSV_MIME });
    }
    expect(storageRemove).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('имя файла в ключе: пробелы и скобки → «_», кириллица и расширение сохранены', async () => {
    const res = await storeBitrixUploads([
      formFile('Компании (выгрузка) 2026.csv', fixture('companies')),
    ]);
    expect(keyOf(res, 0).split('/').at(-1)).toBe('1-Компании_выгрузка_2026.csv');
  });

  it('очень длинное имя обрезается до 120 символов с конца (расширение остаётся)', async () => {
    const long = `${'я'.repeat(200)}.csv`;
    const res = await storeBitrixUploads([formFile(long, fixture('companies'))]);
    const tail = keyOf(res, 0).split('/').at(-1)?.replace(/^1-/, '') ?? '';
    expect(tail).toHaveLength(120);
    expect(tail).toBe(`${'я'.repeat(116)}.csv`);
  });

  it('нераспознанная шапка: key/entity/candidate = null, файл не записан, пакет принят', async () => {
    const res = await storeBitrixUploads([
      unknownCsv(),
      formFile('companies.csv', fixture('companies')),
    ]);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.files[0]).toMatchObject({
      name: 'неведомое.csv',
      entity: null,
      candidate: null,
      key: null,
      rows: 1,
      unmatchedHeaders: ['Фу', 'Бар'],
    });
    expect(res.files[1]?.entity).toBe('company');
    expect(res.files[1]?.key).toEqual(expect.stringMatching(KEY_RE));

    // Записан только распознанный файл, и он получил номер своей позиции.
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(storageUpload.mock.calls[0]?.[0]).toContain('/2-companies.csv');
  });
});

describe('storeBitrixUploads — сбой хранилища', () => {
  const pair = (): FormFile[] => [
    formFile('companies.csv', fixture('companies')),
    formFile('contacts.csv', fixture('contacts')),
  ];

  it('падение на втором файле → storage, первый ключ подчищен, ошибка в журнале', async () => {
    storageUpload.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('S3 упал'));
    const res = await storeBitrixUploads(pair());

    expect(res).toEqual({ ok: false, error: 'storage', file: 'contacts.csv' });
    expect(logError).toHaveBeenCalledWith('[bitrix/upload] storage upload failed', {
      file: 'contacts.csv',
      error: 'S3 упал',
    });
    expect(storageRemove).toHaveBeenCalledTimes(1);
    const removed = storageRemove.mock.calls[0]?.[0] as string[];
    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain('/1-companies.csv');
  });

  it('падение на первом файле → подчищать нечего, remove не зовётся', async () => {
    storageUpload.mockRejectedValueOnce(new Error('S3 упал'));
    const res = await storeBitrixUploads(pair());

    expect(res).toEqual({ ok: false, error: 'storage', file: 'companies.csv' });
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it('не-Error причина отказа попадает в журнал строкой', async () => {
    storageUpload.mockRejectedValueOnce('таймаут');
    expect(await storeBitrixUploads(pair())).toEqual({
      ok: false,
      error: 'storage',
      file: 'companies.csv',
    });
    expect(logError).toHaveBeenCalledWith('[bitrix/upload] storage upload failed', {
      file: 'companies.csv',
      error: 'таймаут',
    });
  });

  it('сбой самой подчистки не ломает ответ — остаётся storage', async () => {
    storageUpload.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('S3 упал'));
    storageRemove.mockRejectedValue(new Error('remove упал'));

    const res = await storeBitrixUploads(pair());

    expect(res).toEqual({ ok: false, error: 'storage', file: 'contacts.csv' });
    expect(logWarn).toHaveBeenCalledWith(
      '[bitrix/upload] cleanup failed',
      expect.objectContaining({ message: 'remove упал' })
    );
  });
});
