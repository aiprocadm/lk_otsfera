/**
 * Excel-импорт/экспорт каталога услуг (`У-137`, этап 5 PR-2).
 *
 * Разбор гоняется на НАСТОЯЩИХ xlsx-буферах (ExcelJS собирает книгу прямо в
 * тесте — эталон импорта сотрудников): моки сетки скрыли бы расхождение
 * заголовков и типов ячеек. Ключевые инварианты: предпросмотр ничего не
 * пишет; подтверждение пишет ровно показанное одной транзакцией; правила
 * полей — общие с формой (`validateCatalogItemInput`), файл не провозит то,
 * что нельзя ввести руками.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import {
  CATALOG_IMPORT_COLUMNS,
  catalogExportCells,
  importCatalogItems,
  parseCatalogWorkbook,
  previewCatalogImport,
  type CatalogImportRow,
} from '@/lib/services/admin/catalogExcel';
import type { CatalogItemInput, CatalogItemRow } from '@/lib/services/admin/catalogItems';

const DIRS = [{ id: 'dir-1', name: 'Охрана труда' }];

const adminSession = (): SessionPayload =>
  ({ sub: 'a1', role: 'admin' }) as unknown as SessionPayload;
const leaderSession = (companyId = 'co-1'): SessionPayload =>
  ({ sub: 'l1', role: 'leader', companyId }) as unknown as SessionPayload;
const managerSession = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-1' }) as unknown as SessionPayload;

async function buildXlsx(rows: unknown[][], headers?: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Каталог');
  ws.addRow(
    (headers ?? [
      `${CATALOG_IMPORT_COLUMNS.name}*`,
      `${CATALOG_IMPORT_COLUMNS.code}*`,
      CATALOG_IMPORT_COLUMNS.unit,
      `${CATALOG_IMPORT_COLUMNS.price}*`,
      CATALOG_IMPORT_COLUMNS.vatRate,
      CATALOG_IMPORT_COLUMNS.vatIncluded,
      CATALOG_IMPORT_COLUMNS.direction,
      CATALOG_IMPORT_COLUMNS.description,
      CATALOG_IMPORT_COLUMNS.sortOrder,
    ]) as never
  );
  for (const r of rows) ws.addRow(r as never);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const input = (code: string, over: Partial<CatalogItemInput> = {}): CatalogItemInput => ({
  name: 'Обучение',
  code,
  unit: 'person',
  price: '100',
  vatRate: null,
  vatIncluded: true,
  directionId: null,
  description: null,
  sortOrder: 0,
  ...over,
});
const row = (line: number, code: string): CatalogImportRow => ({ line, input: input(code) });

function fakePrisma(existing: Array<{ id: string; code: string }> = []) {
  // Первый findMany — сопоставление по code (preview), второй — снимок «как
  // было» для per-item аудита обновлений (Decimal-поля мокаются toFixed'ом).
  const beforeRows = existing.map((e) => ({
    id: e.id,
    name: 'Старое название',
    code: e.code,
    price: { toFixed: () => '100.00' },
    vatRate: null,
    vatIncluded: true,
    unit: 'person',
  }));
  const findMany = vi
    .fn()
    .mockImplementation((args: { select?: Record<string, unknown> }) =>
      Promise.resolve(args?.select && 'price' in args.select ? beforeRows : existing)
    );
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const $transaction = vi.fn().mockResolvedValue([]);
  return {
    prisma: { catalogItem: { findMany, create, update }, $transaction } as unknown as PrismaClient,
    findMany,
    create,
    update,
    $transaction,
  };
}

beforeEach(() => recordAuditMock.mockReset());

describe('parseCatalogWorkbook — разбор файла', () => {
  it('не-Excel отбивается понятным текстом со ссылкой на шаблон', async () => {
    const res = await parseCatalogWorkbook(Buffer.from('не excel'), DIRS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain('Excel');
  });

  it('книга без единого листа отбивается', async () => {
    const wb = new ExcelJS.Workbook();
    const empty = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const res = await parseCatalogWorkbook(empty, DIRS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain('нет ни одного листа');
  });

  it('без обязательных колонок файл отбивается целиком с подсказкой про шаблон', async () => {
    const alien = await parseCatalogWorkbook(await buildXlsx([['x']], ['Что-то не то']), DIRS);
    expect(alien.ok).toBe(false);
    if (!alien.ok) expect(alien.errors[0]).toContain('Скачайте шаблон');

    // Есть Название и Цена, но нет Артикула — сопоставлять было бы не по чему.
    const partial = await parseCatalogWorkbook(
      await buildXlsx([['Урок', '100']], [CATALOG_IMPORT_COLUMNS.name, CATALOG_IMPORT_COLUMNS.price]),
      DIRS
    );
    expect(partial.ok).toBe(false);
  });

  it('happy-path: «чел.», «20%», «да»/«нет», «не облагается», направление регистронезависимо', async () => {
    const buf = await buildXlsx([
      // Порядок числом — Excel хранит такие ячейки number, не строкой.
      ['Обучение по охране труда', 'OT-101', 'чел.', '4500', '20%', 'да', 'ОХРАНА ТРУДА', 'Курс', 10],
      ['Пожарный минимум', 'PB-1', '', '1000,50', 'не облагается', 'нет', '', '', ''],
    ]);
    const res = await parseCatalogWorkbook(buf, DIRS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual({
      line: 2,
      input: {
        name: 'Обучение по охране труда',
        code: 'OT-101',
        unit: 'person',
        price: '4500',
        vatRate: '0.2',
        vatIncluded: true,
        directionId: 'dir-1',
        description: 'Курс',
        sortOrder: 10,
      },
    });
    // Пустые ячейки = умолчания модели: person, НДС включён, без направления.
    expect(res.rows[1]).toEqual({
      line: 3,
      input: {
        name: 'Пожарный минимум',
        code: 'PB-1',
        unit: 'person',
        price: '1000,50',
        vatRate: null,
        vatIncluded: false,
        directionId: null,
        description: null,
        sortOrder: 0,
      },
    });
  });

  it('единица понимается и кодом enum, и подписью без точки в любом регистре', async () => {
    const buf = await buildXlsx([
      ['А', 'C-1', 'hour', '10', '', '', '', '', ''],
      ['Б', 'C-2', 'ЧЕЛ', '10', '', '', '', '', ''],
    ]);
    const res = await parseCatalogWorkbook(buf, DIRS);
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.rows.map((r) => r.input.unit)).toEqual(['hour', 'person']);
  });

  it('неизвестные единица/ставка/булево/направление — построчные ошибки, разбор продолжается', async () => {
    const buf = await buildXlsx([
      ['Урок', 'C-1', 'взвод', '100', '', '', '', '', ''],
      ['Урок', 'C-2', '', '100', '15%', '', '', '', ''],
      ['Урок', 'C-3', '', '100', '', 'возможно', '', '', ''],
      ['Урок', 'C-4', '', '100', '', '', 'Космос', '', ''],
    ]);
    const res = await parseCatalogWorkbook(buf, DIRS);
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.rows).toEqual([]);
    expect(res.errors).toHaveLength(4);
    expect(res.errors[0]).toContain('Строка 2');
    expect(res.errors[0]).toContain('единица «взвод»');
    expect(res.errors[1]).toContain('Строка 3');
    expect(res.errors[1]).toContain('ставка НДС «15%»');
    expect(res.errors[2]).toContain('Строка 4');
    expect(res.errors[2]).toContain('укажите «да» или «нет»');
    expect(res.errors[3]).toContain('Строка 5');
    expect(res.errors[3]).toContain('направление «Космос» не найдено');
  });

  it('цена проверяется общими правилами формы: «12.345» — ошибка строки', async () => {
    const buf = await buildXlsx([['Урок', 'C-5', '', '12.345', '', '', '', '', '']]);
    const res = await parseCatalogWorkbook(buf, DIRS);
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.rows).toEqual([]);
    expect(res.errors[0]).toContain('Строка 2');
    expect(res.errors[0]).toContain('Цена: неотрицательное число');
  });

  it('пустые хвостовые строки пропускаются молча', async () => {
    const buf = await buildXlsx([
      ['Урок', 'C-1', '', '100', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
    ]);
    const res = await parseCatalogWorkbook(buf, DIRS);
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.rows).toHaveLength(1);
    expect(res.errors).toEqual([]);
  });
});

  it('снимает экранирующий апостроф safeText: артикул «-А1» из выгрузки не дублируется', async () => {
    // Ревью PR-2: экспорт экранирует ведущие =+-@ апострофом; без обратного
    // снятия re-import создавал бы «'-А1» вторым артикулом.
    const buf = await buildXlsx([["'-Опасное", "'-А1", 'чел.', '100', '', '', '', '', '']]);
    const res = await parseCatalogWorkbook(buf, []);
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.rows[0]!.input.code).toBe('-А1');
    expect(res.rows[0]!.input.name).toBe('-Опасное');
  });

describe('previewCatalogImport — шаг «что произойдёт», ничего не пишет', () => {
  it('manager → forbidden; leader чужой компании → forbidden; БД не трогается', async () => {
    const { prisma, findMany } = fakePrisma();
    expect(
      await previewCatalogImport(prisma, managerSession(), { companyId: 'co-1', rows: [] })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await previewCatalogImport(prisma, leaderSession(), { companyId: 'co-2', rows: [] })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('сопоставление по артикулу: найден в компании → обновление, нет → создание', async () => {
    const { prisma, create, findMany } = fakePrisma([{ id: 'ci-1', code: 'OT-101' }]);
    const res = await previewCatalogImport(prisma, leaderSession(), {
      companyId: 'co-1',
      rows: [row(2, 'OT-101'), row(3, 'NEW-1')],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(findMany.mock.calls[0][0].where).toEqual({ companyId: 'co-1' });
    expect(res.preview.toUpdate).toEqual([{ row: row(2, 'OT-101'), existingId: 'ci-1' }]);
    expect(res.preview.toCreate).toEqual([row(3, 'NEW-1')]);
    expect(res.preview.errors).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('дубль артикула внутри файла — ошибка второй строки, первая остаётся', async () => {
    const { prisma } = fakePrisma();
    const res = await previewCatalogImport(prisma, adminSession(), {
      companyId: 'co-1',
      rows: [row(2, 'OT-101'), row(4, 'OT-101')],
    });
    if (!res.ok) throw new Error('ожидали ok');
    expect(res.preview.toCreate).toEqual([row(2, 'OT-101')]);
    expect(res.preview.errors).toHaveLength(1);
    expect(res.preview.errors[0]).toContain('Строка 4');
    expect(res.preview.errors[0]).toContain('уже встречался');
  });
});

describe('importCatalogItems — шаг записи', () => {
  it('forbidden проходит насквозь: ни транзакции, ни аудита', async () => {
    const { prisma, $transaction } = fakePrisma();
    expect(
      await importCatalogItems(prisma, managerSession(), { companyId: 'co-1', rows: [row(2, 'A')] })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect($transaction).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('создаёт и обновляет одной транзакцией, аудит catalog_imported со счётчиками', async () => {
    const { prisma, create, update, $transaction } = fakePrisma([{ id: 'ci-1', code: 'OT-101' }]);
    const res = await importCatalogItems(prisma, leaderSession(), {
      companyId: 'co-1',
      rows: [row(2, 'OT-101'), row(3, 'NEW-1')],
    });
    expect(res).toEqual({ ok: true, created: 1, updated: 1 });
    expect($transaction).toHaveBeenCalledTimes(1);
    // История цены не обходится импортом (ревью PR-2): у обновлённой позиции
    // своё catalog_item_updated с before/after.
    const updEvents = recordAuditMock.mock.calls.filter(
      (c) => c[1].action === 'catalog_item_updated'
    );
    expect(updEvents).toHaveLength(1);
    expect(updEvents[0]![1].entityId).toBe('ci-1');
    expect(updEvents[0]![1].before.price).toBe('100.00');
    expect(updEvents[0]![1].after.price).toBe('100.00');
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: 'co-1',
        name: 'Обучение',
        code: 'NEW-1',
        unit: 'person',
        price: '100.00',
        vatRate: null,
        vatIncluded: true,
        directionId: null,
        description: null,
        sortOrder: 0,
      },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ci-1' },
        data: expect.objectContaining({ code: 'OT-101' }),
      })
    );
    // Первыми идут per-item события обновлений, агрегат — последним.
    const audit = recordAuditMock.mock.calls.at(-1)![1];
    expect(audit).toMatchObject({
      userId: 'l1',
      action: 'catalog_imported',
      entity: 'company',
      entityId: 'co-1',
      after: { created: 1, updated: 1 },
    });
  });

  it('пустой список строк — без транзакции, но аудит с нулями пишется', async () => {
    const { prisma, $transaction } = fakePrisma();
    expect(
      await importCatalogItems(prisma, adminSession(), { companyId: 'co-1', rows: [] })
    ).toEqual({ ok: true, created: 0, updated: 0 });
    expect($transaction).not.toHaveBeenCalled();
    expect(recordAuditMock.mock.calls[0]![1].after).toEqual({ created: 0, updated: 0 });
  });

  it('подделанная на шаге 2 строка (кривая цена) — throw, запись не идёт', async () => {
    // Клиент возвращает строки сам; повторная валидация — защита от подмены
    // между предпросмотром и подтверждением.
    const { prisma, create } = fakePrisma();
    await expect(
      importCatalogItems(prisma, adminSession(), {
        companyId: 'co-1',
        rows: [{ line: 5, input: input('X-1', { price: '12.345' }) }],
      })
    ).rejects.toThrow('Строка 5');
    expect(create).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });
});

describe('catalogExportCells — формат, который парсер импорта понимает обратно', () => {
  const dbRow = (over: Partial<CatalogItemRow> = {}): CatalogItemRow => ({
    id: 'ci-1',
    name: 'Обучение',
    code: 'OT-101',
    unit: 'person',
    price: '100.00',
    vatRate: null,
    vatIncluded: true,
    directionId: null,
    directionName: null,
    description: null,
    isActive: true,
    sortOrder: 0,
    ...over,
  });

  it('без НДС и направления: «не облагается», пустые строки, «да»', () => {
    expect(catalogExportCells(dbRow())).toEqual({
      name: 'Обучение',
      code: 'OT-101',
      unit: 'чел.',
      price: '100.00',
      vatRate: 'не облагается',
      vatIncluded: 'да',
      direction: '',
      description: '',
      sortOrder: 0,
      isActive: 'да',
    });
  });

  it('ставка долей → проценты, направление по имени, «нет» в обоих флагах', () => {
    expect(
      catalogExportCells(
        dbRow({
          unit: 'hour',
          vatRate: '0.2',
          vatIncluded: false,
          directionId: 'dir-1',
          directionName: 'Охрана труда',
          description: 'Курс 40 часов',
          isActive: false,
          sortOrder: 7,
        })
      )
    ).toEqual({
      name: 'Обучение',
      code: 'OT-101',
      unit: 'час',
      price: '100.00',
      vatRate: '20%',
      vatIncluded: 'нет',
      direction: 'Охрана труда',
      description: 'Курс 40 часов',
      sortOrder: 7,
      isActive: 'нет',
    });
  });
});
