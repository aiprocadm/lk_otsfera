import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `У-137` — server-actions двухшагового импорта каталога: гард раздела
 * `catalogs.priceList` в КАЖДОМ действии (урок PR-1: `requireSession`-only
 * пропускал default-deny профиль), предел файла 25 МБ проверяется ДО чтения,
 * предпросмотр ничего не пишет, подтверждение ревалидирует оба хаба.
 */
const {
  requireSettingsSection,
  revalidatePath,
  listAllDirectionOptions,
  parseCatalogWorkbook,
  previewCatalogImport,
  importCatalogItems,
} = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  revalidatePath: vi.fn(),
  listAllDirectionOptions: vi.fn(),
  parseCatalogWorkbook: vi.fn(),
  previewCatalogImport: vi.fn(),
  importCatalogItems: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/services/training/directions', () => ({ listAllDirectionOptions }));
vi.mock('@/lib/services/admin/catalogExcel', () => ({
  parseCatalogWorkbook,
  previewCatalogImport,
  importCatalogItems,
}));

import {
  commitCatalogImportAction,
  previewCatalogImportAction,
} from '@/server-actions/admin/catalogImport';

const LEADER = { sub: 'l1', role: 'leader', companyId: 'co-1' };
const DIRS = [{ id: 'dir-1', name: 'Охрана труда' }];
const ROW2 = { line: 2, input: { code: 'OT-101' } } as never;
const ROW3 = { line: 3, input: { code: 'NEW-1' } } as never;

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const file = () => new File([new Uint8Array([1, 2, 3])], 'catalog.xlsx');

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue(LEADER);
  listAllDirectionOptions.mockResolvedValue(DIRS);
  parseCatalogWorkbook.mockResolvedValue({ ok: true, rows: [ROW2, ROW3], errors: [] });
  previewCatalogImport.mockResolvedValue({
    ok: true,
    preview: { toCreate: [ROW3], toUpdate: [{ row: ROW2, existingId: 'ci-1' }], errors: [] },
  });
  importCatalogItems.mockResolvedValue({ ok: true, created: 1, updated: 1 });
});

describe('гард раздела — в каждом действии', () => {
  it('оба действия спрашивают право catalogs.priceList своего кабинета', async () => {
    await previewCatalogImportAction('leader', form({ companyId: 'co-1', file: file() }));
    await commitCatalogImportAction('admin', 'co-1', []);
    expect(requireSettingsSection.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['catalogs.priceList', 'leader'],
      ['catalogs.priceList', 'admin'],
    ]);
  });

  it('отказ гарда — до сервиса: файл даже не читается, запись не идёт', async () => {
    requireSettingsSection.mockRejectedValue(new Error('REDIRECT:/forbidden'));
    await expect(
      previewCatalogImportAction('leader', form({ companyId: 'co-1', file: file() }))
    ).rejects.toThrow('REDIRECT:/forbidden');
    await expect(commitCatalogImportAction('leader', 'co-1', [ROW2])).rejects.toThrow(
      'REDIRECT:/forbidden'
    );
    expect(parseCatalogWorkbook).not.toHaveBeenCalled();
    expect(importCatalogItems).not.toHaveBeenCalled();
  });
});

describe('previewCatalogImportAction — шаг «что произойдёт»', () => {
  it('без файла или без компании просит их выбрать, файл не разбирается', async () => {
    await expect(previewCatalogImportAction('admin', form({ companyId: 'co-1' }))).resolves.toEqual(
      { ok: false, errors: ['Выберите файл и компанию.'] }
    );
    await expect(previewCatalogImportAction('admin', form({ file: file() }))).resolves.toEqual({
      ok: false,
      errors: ['Выберите файл и компанию.'],
    });
    expect(parseCatalogWorkbook).not.toHaveBeenCalled();
  });

  it('файл больше 25 МБ отбивается до чтения', async () => {
    const big = new File([''], 'big.xlsx');
    // Гигабайтный буфер в тесте не нужен: важен только размер в метаданных.
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await expect(
      previewCatalogImportAction('admin', form({ companyId: 'co-1', file: big }))
    ).resolves.toEqual({ ok: false, errors: ['Файл больше 25 МБ — разбейте на части.'] });
    expect(parseCatalogWorkbook).not.toHaveBeenCalled();
  });

  it('ошибки разбора файла возвращаются как есть, до предпросмотра не доходит', async () => {
    parseCatalogWorkbook.mockResolvedValue({ ok: false, errors: ['Нет колонки «Артикул»'] });
    await expect(
      previewCatalogImportAction('leader', form({ companyId: 'co-1', file: file() }))
    ).resolves.toEqual({ ok: false, errors: ['Нет колонки «Артикул»'] });
    expect(previewCatalogImport).not.toHaveBeenCalled();
  });

  it('отказ прав сервиса объясняется словами, а не кодом', async () => {
    previewCatalogImport.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(
      previewCatalogImportAction('leader', form({ companyId: 'co-2', file: file() }))
    ).resolves.toEqual({ ok: false, errors: ['Нет прав изменять каталог этой компании.'] });
  });

  it('happy-path: строки для шага 2 + счётчики + ошибки разбора и предпросмотра вместе', async () => {
    parseCatalogWorkbook.mockResolvedValue({
      ok: true,
      rows: [ROW2, ROW3],
      errors: ['Строка 4: единица не распознана'],
    });
    previewCatalogImport.mockResolvedValue({
      ok: true,
      preview: {
        toCreate: [ROW3],
        toUpdate: [{ row: ROW2, existingId: 'ci-1' }],
        errors: ['Строка 5: артикул уже встречался'],
      },
    });

    const res = await previewCatalogImportAction('leader', form({ companyId: 'co-1', file: file() }));

    expect(res).toEqual({
      ok: true,
      rows: [ROW2, ROW3],
      willCreate: 1,
      willUpdate: 1,
      errors: ['Строка 4: единица не распознана', 'Строка 5: артикул уже встречался'],
    });
    // Направления берутся из справочника и едут в парсер вместе с буфером.
    expect(parseCatalogWorkbook).toHaveBeenCalledWith(expect.any(ArrayBuffer), DIRS);
    expect(previewCatalogImport).toHaveBeenCalledWith({}, LEADER, {
      companyId: 'co-1',
      rows: [ROW2, ROW3],
    });
    expect(importCatalogItems).not.toHaveBeenCalled();
  });
});

describe('commitCatalogImportAction — шаг записи', () => {
  it('зовёт importCatalogItems и после успеха ревалидирует оба хаба настроек', async () => {
    const res = await commitCatalogImportAction('leader', 'co-1', [ROW2]);
    expect(res).toEqual({ ok: true, created: 1, updated: 1 });
    expect(importCatalogItems).toHaveBeenCalledWith({}, LEADER, {
      companyId: 'co-1',
      rows: [ROW2],
    });
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      '/admin/settings',
      '/leader/settings',
    ]);
  });

  it('отказ сервиса — русская строка и никакой ревалидации', async () => {
    importCatalogItems.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(commitCatalogImportAction('leader', 'co-2', [ROW2])).resolves.toEqual({
      ok: false,
      error: 'Нет прав изменять каталог этой компании.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
