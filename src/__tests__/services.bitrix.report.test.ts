import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import type { PrismaClient } from '@prisma/client';

/**
 * Отчёт сверки переноса из Битрикс24 (`У-198`, спека §3.6).
 *
 * Это документ приёмки: по нему человек убеждается, что в ЛК приехало ровно
 * то, что было в портале. Поэтому проверяется не «файл собрался», а то, ради
 * чего отчёт написан: каждая строка журнала видна на своём листе русскими
 * словами, «что не поехало и почему» разложено по трём листам, а названия из
 * чужой системы не превращаются в формулы Excel (`safeText`).
 *
 * Отдельно проверено, что сбой хранилища НЕ роняет перенос: пакет уже записан
 * в базу, и падать из-за недоступного S3 нельзя.
 *
 * Prisma — объект с нужными методами: живой Postgres увёл бы файл в
 * integration-слой.
 */
const { storageUpload, logError } = vi.hoisted(() => ({
  storageUpload: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: storageUpload,
    remove: vi.fn(),
    download: vi.fn(),
    createSignedUrl: vi.fn(),
  }),
}));
vi.mock('@/lib/logging', () => ({
  log: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  bestEffort: (label: string) => (err: unknown) => {
    logError(label, err);
  },
}));
// Очередь тянется в граф через `rollback.ts` (словарь причин) — Redis тесту не нужен.
vi.mock('@/lib/jobs/queues', () => ({ getQueue: vi.fn(() => ({ add: vi.fn() })) }));

import {
  buildBitrixReport,
  fieldsText,
  KEPT_MANUAL_PREFIX,
  reportKey,
  storeBitrixReport,
} from '@/lib/services/bitrix/report';
import { EXPORT_ROW_LIMIT } from '@/lib/services/export/xlsx';
import { ROW_CAP } from '@/lib/services/bitrix/pipeline';
import {
  BITRIX_ENTITIES,
  BITRIX_ENTITY_TITLES,
  type PlanRow,
} from '@/lib/services/bitrix/mapping/types';
import { ROLLBACK_CONFLICT_LABELS, type RollbackConflict } from '@/lib/services/bitrix/rollback';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Строка журнала записей — то, что реально случилось с базой. */
type WriteRow = {
  entity: string;
  entityId: string;
  bitrixId: string;
  action: string;
  before: unknown;
  after: unknown;
  reverted: boolean;
};

/** Журнал по сущностям и «сколько их всего» — для хвоста о срезанной выдаче. */
let journal: Record<string, WriteRow[]> = {};
let totals: Record<string, number> = {};
let batch: Record<string, unknown> | null = null;

const findUniqueBatch = vi.fn(async () => batch);
const updateBatch = vi.fn(async () => ({}));
const findManyWrites = vi.fn(
  async (args: { where: { entity: string } }) => journal[args.where.entity] ?? []
);
const countWrites = vi.fn(
  async (args: { where: { entity: string } }) =>
    totals[args.where.entity] ?? journal[args.where.entity]?.length ?? 0
);

const prisma = {
  bitrixImportBatch: { findUnique: findUniqueBatch, update: updateBatch },
  bitrixImportWrite: { findMany: findManyWrites, count: countWrites },
} as unknown as PrismaClient;

/**
 * Полдень UTC у всех дат — иначе часовой пояс машины сдвинул бы русскую дату
 * на сутки и тест краснел бы «через раз».
 */
function batchRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    companyId: 'c1',
    status: 'applied',
    createdAt: new Date('2026-09-01T12:00:00Z'),
    appliedAt: new Date('2026-09-02T12:00:00Z'),
    rolledBackAt: null,
    settings: {},
    importedBy: { name: 'Иван Менеджеров' },
    ...over,
  };
}

function writeRow(over: Partial<WriteRow> = {}): WriteRow {
  return {
    entity: 'organization',
    entityId: 'org-1',
    bitrixId: '101',
    action: 'created',
    before: null,
    after: { name: 'ООО Ромашка', inn: '7701234567' },
    reverted: false,
    ...over,
  };
}

function planRow(over: Partial<PlanRow> = {}): PlanRow {
  return {
    entity: 'organization',
    bitrixId: '101',
    title: 'ООО Ромашка',
    action: 'skip',
    ...over,
  } as PlanRow;
}

async function buildBook(): Promise<ExcelJS.Workbook> {
  const buffer = await buildBitrixReport(prisma, 'b1');
  expect(buffer).not.toBeNull();
  return loadBook(buffer as Buffer);
}

async function loadBook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  expect(ws, `лист «${name}» не найден`).toBeDefined();
  return ws as ExcelJS.Worksheet;
}

function headerText(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.getRow(1).eachCell((c) => out.push(String(c.value)));
  return out;
}

/** Значения строки по номерам колонок: пустая ячейка — пустая строка. */
function rowText(ws: ExcelJS.Worksheet, rowNumber: number, columns: number): string[] {
  const row = ws.getRow(rowNumber);
  const out: string[] = [];
  for (let i = 1; i <= columns; i += 1) out.push(String(row.getCell(i).value ?? ''));
  return out;
}

/** Все содержательные строки листа (без шапки) — по числу колонок шапки. */
function bodyText(ws: ExcelJS.Worksheet): string[][] {
  const columns = headerText(ws).length;
  const out: string[][] = [];
  for (let n = 2; n <= ws.rowCount; n += 1) out.push(rowText(ws, n, columns));
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  journal = {};
  totals = {};
  batch = batchRow();
  storageUpload.mockResolvedValue(undefined);
});

describe('fieldsText — снимок полей одной строкой', () => {
  it('объект: «поле: значение» через точку с запятой, пустое значение — прочерк', () => {
    expect(fieldsText({ name: 'ООО', inn: null })).toBe('name: ООО; inn: —');
  });

  it('пустой объект — прочерк: показывать «ничего» пустой ячейкой нельзя', () => {
    expect(fieldsText({})).toBe('—');
  });

  it('не объект (строка, число, null, массив) — прочерк', () => {
    expect(fieldsText(null)).toBe('—');
    expect(fieldsText('ООО Ромашка')).toBe('—');
    expect(fieldsText(42)).toBe('—');
    expect(fieldsText([1, 2])).toBe('—');
  });

  it('числа и логические значения печатаются, вложенное — JSON', () => {
    expect(fieldsText({ amount: 1500, active: true, meta: { a: 1 } })).toBe(
      'amount: 1500; active: true; meta: {"a":1}'
    );
  });
});

describe('reportKey — путь отчёта в хранилище', () => {
  it('bitrix-import/<пакет>/report-<метка>.xlsx', () => {
    expect(reportKey('b1', new Date('2026-09-13T22:08:00.000Z'))).toBe(
      'bitrix-import/b1/report-2026-09-13T22-08-00-000Z.xlsx'
    );
  });

  it('в метке времени нет двоеточий и точек — иначе ключ S3 ломается', () => {
    const key = reportKey('b1', new Date('2026-09-13T22:08:00.000Z'));
    expect(key.slice(0, -'.xlsx'.length)).not.toMatch(/[:.]/);
  });
});

describe('buildBitrixReport — состав книги', () => {
  it('несуществующий пакет → null, журнал даже не читается', async () => {
    batch = null;
    await expect(buildBitrixReport(prisma, 'b1')).resolves.toBeNull();
    expect(findManyWrites).not.toHaveBeenCalled();
    expect(countWrites).not.toHaveBeenCalled();
  });

  it('листы и их порядок: сводка, сущности, три листа «что не поехало»', async () => {
    const wb = await buildBook();
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Сводка',
      'Организации',
      'Контакты',
      'Лиды',
      'Сделки',
      'Заметки',
      'Задачи',
      'Файлы',
      'Заказы из выигранных сделок',
      'Конфликты',
      'Пропущено',
      'Оставлено ручное',
    ]);
  });

  it('лист есть у КАЖДОЙ сущности словаря — новая сущность не потеряется молча', async () => {
    const wb = await buildBook();
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Сводка',
      ...BITRIX_ENTITIES.map((e) => BITRIX_ENTITY_TITLES[e]),
      'Конфликты',
      'Пропущено',
      'Оставлено ручное',
    ]);
  });

  it('Сводка: кто, когда и в каком состоянии пакет; пустые даты — прочерки', async () => {
    const wb = await buildBook();
    const ws = sheet(wb, 'Сводка');
    expect(headerText(ws)).toEqual(['Показатель', 'Значение']);
    expect(bodyText(ws)).toEqual([
      ['Пакет', 'b1'],
      ['Запустил', 'Иван Менеджеров'],
      ['Создан', '01.09.2026'],
      ['Применён', '02.09.2026'],
      ['Откачен', '—'],
      ['Состояние', 'applied'],
    ]);
  });

  it('пакет без имени запустившего — прочерк вместо пустоты', async () => {
    batch = batchRow({ importedBy: { name: null } });
    const wb = await buildBook();
    expect(rowText(sheet(wb, 'Сводка'), 3, 2)).toEqual(['Запустил', '—']);
  });
});

describe('buildBitrixReport — листы сущностей из журнала', () => {
  it('строка журнала попадает на свой лист: id, русское действие, было/стало, откат', async () => {
    journal = {
      organization: [
        writeRow(),
        writeRow({
          entityId: 'org-2',
          bitrixId: '102',
          action: 'updated',
          before: { name: 'ООО Старое', inn: null },
          after: { name: 'ООО Новое', inn: '7702' },
          reverted: true,
        }),
      ],
      deal: [
        writeRow({
          entity: 'deal',
          entityId: 'deal-1',
          bitrixId: '501',
          action: 'linked',
          before: null,
          after: { orderId: 'ord-1' },
        }),
      ],
    };
    const wb = await buildBook();

    const orgs = sheet(wb, 'Организации');
    expect(headerText(orgs)).toEqual([
      'ID в Битрикс24',
      'ID в ЛК',
      'Действие',
      'Было',
      'Стало',
      'Откачено',
    ]);
    // ОБЕ строки журнала обязаны быть на листе: отчёт, показывающий первую из
    // двух, врёт о переносе ровно так же, как не собранный вовсе.
    expect(bodyText(orgs)).toEqual([
      ['101', 'org-1', 'создано', '—', 'name: ООО Ромашка; inn: 7701234567', 'нет'],
      ['102', 'org-2', 'обновлено', 'name: ООО Старое; inn: —', 'name: ООО Новое; inn: 7702', 'да'],
    ]);

    expect(bodyText(sheet(wb, 'Сделки'))).toEqual([
      ['501', 'deal-1', 'связано', '—', 'orderId: ord-1', 'нет'],
    ]);
    // Чужая сущность на лист не заезжает.
    expect(bodyText(sheet(wb, 'Контакты'))).toEqual([]);
  });

  it('журнал читается по сущностям — по одному запросу списка и счётчика на лист', async () => {
    await buildBook();
    expect(findManyWrites).toHaveBeenCalledTimes(BITRIX_ENTITIES.length);
    expect(countWrites).toHaveBeenCalledTimes(BITRIX_ENTITIES.length);
    expect(findManyWrites).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { batchId: 'b1', entity: 'organization' },
        orderBy: { createdAt: 'asc' },
        take: EXPORT_ROW_LIMIT,
      })
    );
  });

  it('неизвестный код действия печатается как есть — строку журнала не прячем', async () => {
    journal = { organization: [writeRow({ action: 'merged' })] };
    const wb = await buildBook();
    expect(rowText(sheet(wb, 'Организации'), 2, 3)[2]).toBe('merged');
  });

  it('строк больше лимита выгрузки → хвост «показаны первые N из M»', async () => {
    journal = { organization: [writeRow()] };
    totals = { organization: EXPORT_ROW_LIMIT + 3 };
    const wb = await buildBook();
    const notice = bodyText(sheet(wb, 'Организации'))
      .flat()
      .find((v) => v.includes('Показаны первые'));
    expect(notice).toContain(String(EXPORT_ROW_LIMIT));
    expect(notice).toContain(String(EXPORT_ROW_LIMIT + 3));
  });
});

describe('buildBitrixReport — защита от формульной инъекции (safeText)', () => {
  it('название организации «=SUM(A1)» приезжает текстом, а не формулой', async () => {
    batch = batchRow({
      settings: {
        rows: [
          planRow({ action: 'conflict', title: '=SUM(A1)', reason: 'ИНН у другой компании' }),
          planRow({ action: 'skip', title: '+7 (495) 000', reason: 'нет организации' }),
          planRow({
            action: 'update',
            title: '@ООО Ромашка',
            reason: `${KEPT_MANUAL_PREFIX}name`,
          }),
        ],
      },
    });
    const wb = await buildBook();

    expect(rowText(sheet(wb, 'Конфликты'), 2, 6)[4]).toBe("'=SUM(A1)");
    expect(rowText(sheet(wb, 'Пропущено'), 2, 4)[2]).toBe("'+7 (495) 000");
    expect(rowText(sheet(wb, 'Оставлено ручное'), 2, 4)[2]).toBe("'@ООО Ромашка");
  });

  it('опасные значения в id и причине тоже экранируются', async () => {
    journal = { organization: [writeRow({ bitrixId: '=1+1', entityId: '-org' })] };
    batch = batchRow({
      settings: { rows: [planRow({ action: 'skip', reason: '-нет организации' })] },
    });
    const wb = await buildBook();

    const org = rowText(sheet(wb, 'Организации'), 2, 6);
    expect(org[0]).toBe("'=1+1");
    expect(org[1]).toBe("'-org");
    expect(rowText(sheet(wb, 'Пропущено'), 2, 4)[3]).toBe("'-нет организации");
  });

  it('снимок со «=» внутри не даёт формулы: ячейка начинается с имени поля', async () => {
    journal = { organization: [writeRow({ after: { name: '=SUM(A1)' } })] };
    const wb = await buildBook();
    const cell = rowText(sheet(wb, 'Организации'), 2, 6)[4];
    expect(cell).toBe('name: =SUM(A1)');
    expect(cell).not.toMatch(/^[=+\-@\t\r]/);
  });
});

describe('buildBitrixReport — лист «Конфликты»', () => {
  const rollbackConflicts: RollbackConflict[] = [
    {
      entity: 'order',
      entityId: 'ord-1',
      label: 'Заказ ЗК-7',
      code: 'order_has_payments',
      count: 2,
    },
  ];

  it('конфликты переноса и отката в одной таблице, с колонкой «Этап»', async () => {
    batch = batchRow({
      settings: {
        rows: [
          planRow({
            entity: 'contact',
            bitrixId: '201',
            title: 'Петров Пётр',
            action: 'conflict',
            reason: 'канал уже у другого контакта',
          }),
          planRow({ action: 'skip', reason: 'нет организации' }),
          planRow({ action: 'update', reason: `${KEPT_MANUAL_PREFIX}name` }),
        ],
        rollbackConflicts,
      },
    });
    const wb = await buildBook();
    const ws = sheet(wb, 'Конфликты');

    expect(headerText(ws)).toEqual([
      'Этап',
      'Сущность',
      'ID в Битрикс24',
      'ID в ЛК',
      'Что за запись',
      'Причина',
    ]);
    // Пропуски и «оставлено ручное» на лист конфликтов не попадают.
    // У конфликта переноса записи в ЛК нет — прочерк; у конфликта отката есть
    // и её id, и число ссылок, которые помешали вернуть.
    expect(bodyText(ws)).toEqual([
      ['Перенос', 'Контакты', '201', '—', 'Петров Пётр', 'канал уже у другого контакта'],
      [
        'Откат',
        'Заказы из выигранных сделок',
        '—',
        'ord-1',
        'Заказ ЗК-7',
        `${ROLLBACK_CONFLICT_LABELS.order_has_payments} (2)`,
      ],
    ]);
    expect(ROLLBACK_CONFLICT_LABELS.order_has_payments).toBe('у заказа появились оплаты');
  });

  it('конфликт переноса без причины — прочерк', async () => {
    batch = batchRow({ settings: { rows: [planRow({ action: 'conflict' })] } });
    const wb = await buildBook();
    expect(rowText(sheet(wb, 'Конфликты'), 2, 6)[5]).toBe('—');
  });

  it('неизвестный код конфликта отката печатается кодом — причина не теряется', async () => {
    batch = batchRow({
      settings: {
        rollbackConflicts: [
          {
            entity: 'organization',
            entityId: 'org-1',
            label: 'ООО Ромашка',
            code: 'unknown_reason',
            count: 1,
          },
        ],
      },
    });
    const wb = await buildBook();
    expect(rowText(sheet(wb, 'Конфликты'), 2, 6)[5]).toBe('unknown_reason (1)');
  });

  it('конфликтов нет — лист есть, но пустой', async () => {
    const wb = await buildBook();
    expect(bodyText(sheet(wb, 'Конфликты'))).toEqual([]);
  });
});

describe('buildBitrixReport — листы «Пропущено» и «Оставлено ручное»', () => {
  it('«Пропущено» — только строки плана с действием skip', async () => {
    batch = batchRow({
      settings: {
        rows: [
          planRow({
            entity: 'note',
            bitrixId: '301',
            title: 'Комментарий',
            reason: 'пустая запись',
          }),
          planRow({ action: 'conflict', reason: 'ИНН у другой компании' }),
          planRow({ action: 'update', reason: `${KEPT_MANUAL_PREFIX}name` }),
        ],
      },
    });
    const wb = await buildBook();
    const ws = sheet(wb, 'Пропущено');

    expect(headerText(ws)).toEqual(['Сущность', 'ID в Битрикс24', 'Что за запись', 'Причина']);
    expect(bodyText(ws)).toEqual([['Заметки', '301', 'Комментарий', 'пустая запись']]);
  });

  it('пропуск без причины — прочерк', async () => {
    batch = batchRow({ settings: { rows: [planRow({ action: 'skip' })] } });
    const wb = await buildBook();
    expect(rowText(sheet(wb, 'Пропущено'), 2, 4)[3]).toBe('—');
  });

  it('«Оставлено ручное»: только строки с префиксом, в колонке «Поля» — без него', async () => {
    batch = batchRow({
      settings: {
        rows: [
          planRow({
            entity: 'lead',
            bitrixId: '401',
            title: 'Заявка с сайта',
            action: 'update',
            reason: `${KEPT_MANUAL_PREFIX}subject, notes`,
          }),
          planRow({ action: 'skip', reason: 'нет организации' }),
          planRow({ action: 'conflict', reason: 'ИНН у другой компании' }),
        ],
      },
    });
    const wb = await buildBook();
    const ws = sheet(wb, 'Оставлено ручное');

    expect(headerText(ws)).toEqual(['Сущность', 'ID в Битрикс24', 'Что за запись', 'Поля']);
    expect(bodyText(ws)).toEqual([['Лиды', '401', 'Заявка с сайта', 'subject, notes']]);
  });

  it('строка «оставлено ручное» не дублируется на листах конфликтов и пропусков', async () => {
    batch = batchRow({
      settings: { rows: [planRow({ action: 'update', reason: `${KEPT_MANUAL_PREFIX}name` })] },
    });
    const wb = await buildBook();
    expect(bodyText(sheet(wb, 'Конфликты'))).toEqual([]);
    expect(bodyText(sheet(wb, 'Пропущено'))).toEqual([]);
    expect(bodyText(sheet(wb, 'Оставлено ручное'))).toHaveLength(1);
  });

  it('старый пакет без строк плана — три листа с одной шапкой, без падения', async () => {
    batch = batchRow({ settings: null });
    const wb = await buildBook();
    expect(bodyText(sheet(wb, 'Конфликты'))).toEqual([]);
    expect(bodyText(sheet(wb, 'Пропущено'))).toEqual([]);
    expect(bodyText(sheet(wb, 'Оставлено ручное'))).toEqual([]);
  });
});

describe('storeBitrixReport', () => {
  it('успех: книга уехала в хранилище с типом xlsx, путь записан в пакет', async () => {
    journal = { organization: [writeRow()] };
    const key = await storeBitrixReport(prisma, 'b1');

    expect(key).toMatch(/^bitrix-import\/b1\/report-[\dTZ-]+\.xlsx$/);
    expect(storageUpload).toHaveBeenCalledTimes(1);
    const [uploadedKey, body, opts] = storageUpload.mock.calls[0];
    expect(uploadedKey).toBe(key);
    expect(opts).toEqual({ contentType: XLSX_MIME });

    // В хранилище легла именно книга отчёта, а не пустой буфер.
    const wb = await loadBook(body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toContain('Сводка');
    expect(bodyText(sheet(wb, 'Организации'))).toHaveLength(1);

    expect(updateBatch).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { reportPath: key },
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('хранилище недоступно → null и запись в журнал, перенос не падает', async () => {
    storageUpload.mockRejectedValueOnce(new Error('S3 недоступен'));

    await expect(storeBitrixReport(prisma, 'b1')).resolves.toBeNull();

    expect(logError).toHaveBeenCalledWith('[bitrix/report] отчёт сверки не собран', {
      batchId: 'b1',
      error: 'S3 недоступен',
    });
    // Путь не записан: кнопка «Отчёт» останется неактивной, а не поведёт в никуда.
    expect(updateBatch).not.toHaveBeenCalled();
  });

  it('падение не-ошибкой тоже переживается — в журнал уходит текст', async () => {
    storageUpload.mockRejectedValueOnce('хранилище отвалилось');
    await expect(storeBitrixReport(prisma, 'b1')).resolves.toBeNull();
    expect(logError).toHaveBeenCalledWith('[bitrix/report] отчёт сверки не собран', {
      batchId: 'b1',
      error: 'хранилище отвалилось',
    });
  });

  it('запись пути в базу упала → тоже null, без исключения наружу', async () => {
    updateBatch.mockRejectedValueOnce(new Error('база занята'));
    await expect(storeBitrixReport(prisma, 'b1')).resolves.toBeNull();
    expect(logError).toHaveBeenCalledWith('[bitrix/report] отчёт сверки не собран', {
      batchId: 'b1',
      error: 'база занята',
    });
  });

  it('пакета нет → null, хранилище не трогаем и в журнал не шумим', async () => {
    batch = null;
    await expect(storeBitrixReport(prisma, 'b1')).resolves.toBeNull();
    expect(storageUpload).not.toHaveBeenCalled();
    expect(updateBatch).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('buildBitrixReport — обрезанный список «нужно решение»', () => {
  it('три листа разбора честно говорят, что предпросмотр запомнил не всё', async () => {
    // Конвейер хранит первые `ROW_CAP` строк плана (§3.8 спеки), а человеку
    // обещает, что столько же будет и в отчёте. Молчать об обрезке нельзя:
    // по неполному списку пропусков выключают Битрикс24.
    const rows = Array.from({ length: ROW_CAP }, (_, i) =>
      planRow({
        bitrixId: String(100 + i),
        action: i % 3 === 0 ? 'conflict' : i % 3 === 1 ? 'skip' : 'update',
        ...(i % 3 === 2 ? { reason: `${KEPT_MANUAL_PREFIX}name` } : { reason: 'причина' }),
      })
    );
    batch = batchRow({ settings: { rows } });
    const wb = await buildBook();

    for (const name of ['Конфликты', 'Пропущено', 'Оставлено ручное']) {
      const notice = bodyText(sheet(wb, name))
        .flat()
        .find((v) => v.includes('Показаны'));
      expect(notice, `лист «${name}» молчит об обрезке`).toBeDefined();
      expect(notice).toContain(String(ROW_CAP));
      expect(notice).toContain('на листах сущностей');
    }
  });

  it('список короче предела — про обрезку не выдумываем', async () => {
    batch = batchRow({ settings: { rows: [planRow({ action: 'skip' })] } });
    const wb = await buildBook();
    const notice = bodyText(sheet(wb, 'Пропущено'))
      .flat()
      .find((v) => v.includes('Показаны'));
    expect(notice).toBeUndefined();
  });
});
