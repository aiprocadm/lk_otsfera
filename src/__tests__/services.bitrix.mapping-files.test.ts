import { afterEach, describe, expect, it } from 'vitest';

import { maxFileSizeBytes } from '@/lib/config/upload';
import { planFile, type FileLookup } from '@/lib/services/bitrix/mapping/files';
import type { MappingContext } from '@/lib/services/bitrix/mapping/types';
import type { BitrixFile } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 «Миграция из Битрикс24» (`У-191`): вложение сделки или
 * компании → `Document`. Документ в ЛК всегда принадлежит контрагенту, поэтому
 * файл без организации перенести некуда; файл больше предела не тянем в память.
 *
 * Записи взяты из фикстуры портала: файлы 701 (сделка 401) и 703 (компания 101).
 */

function ctxOf(over: Partial<MappingContext> = {}): MappingContext {
  return {
    companyId: 'company-1',
    importerId: 'user-importer',
    defaultManagerId: 'user-default',
    tables: { stageMap: {}, leadStageMap: {}, taskColumnMap: {}, userMap: {} },
    resolveUser: () => null,
    ...over,
  };
}

function fileOf(over: Partial<BitrixFile> = {}): BitrixFile {
  return {
    id: '701',
    entity: 'deal',
    entityId: '401',
    name: 'договор-альфа.pdf',
    size: 1024,
    downloadUrl: 'https://demo.bitrix24.ru/disk/701',
    ...over,
  };
}

function lookupOf(over: Partial<FileLookup> = {}): FileLookup {
  return {
    byBitrixId: () => undefined,
    organizationByBitrixId: (id) => (id === '101' ? 'org-1' : undefined),
    dealOrganization: (id) => (id === '401' ? 'org-1' : undefined),
    ...over,
  };
}

const ENV_KEY = 'DOCUMENT_MAX_FILE_SIZE_MB';
const ENV_BEFORE = process.env[ENV_KEY];

afterEach(() => {
  if (ENV_BEFORE === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = ENV_BEFORE;
});

describe('planFile — куда ляжет вложение', () => {
  it('файл сделки берёт организацию сделки', () => {
    const plan = planFile(fileOf(), ctxOf(), lookupOf());

    expect(plan).toEqual({
      action: 'create',
      data: {
        companyId: 'company-1',
        organizationId: 'org-1',
        name: 'договор-альфа.pdf',
        size: 1024,
        downloadUrl: 'https://demo.bitrix24.ru/disk/701',
        bitrixId: '701',
      },
    });
  });

  it('файл компании ищет организацию по идентификатору компании портала', () => {
    const plan = planFile(
      fileOf({ id: '703', entity: 'company', entityId: '101', name: 'реквизиты-альфа.pdf' }),
      ctxOf(),
      lookupOf({ dealOrganization: () => 'org-не-должна-спрашиваться' })
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { organizationId: 'org-1', name: 'реквизиты-альфа.pdf', bitrixId: '703' },
    });
  });

  it('ссылки на скачивание нет → переносим план без неё', () => {
    const plan = planFile(fileOf({ downloadUrl: null }), ctxOf(), lookupOf());

    expect(plan).toMatchObject({ action: 'create', data: { downloadUrl: null } });
  });
});

describe('planFile — когда переносить нечего', () => {
  it('файл уже переносили → пропуск already_linked', () => {
    const plan = planFile(
      fileOf(),
      ctxOf(),
      lookupOf({ byBitrixId: (id) => (id === '701' ? { id: 'document-1' } : undefined) })
    );

    expect(plan).toEqual({ action: 'skip', reason: 'already_linked' });
  });

  it('сделка не перенеслась → файлу некуда лечь', () => {
    const plan = planFile(fileOf({ entityId: '406' }), ctxOf(), lookupOf());

    expect(plan).toEqual({ action: 'skip', reason: 'no_organization' });
  });

  it('организация компании не перенеслась → тот же пропуск', () => {
    const plan = planFile(fileOf({ entity: 'company', entityId: '105' }), ctxOf(), lookupOf());

    expect(plan).toEqual({ action: 'skip', reason: 'no_organization' });
  });
});

describe('planFile — предел размера', () => {
  it('файл больше предела пропускается: потоковой загрузки нет', () => {
    const plan = planFile(fileOf({ size: maxFileSizeBytes() + 1 }), ctxOf(), lookupOf());

    expect(plan).toEqual({ action: 'skip', reason: 'too_large' });
  });

  it('файл ровно по пределу ещё переносится', () => {
    const plan = planFile(fileOf({ size: maxFileSizeBytes() }), ctxOf(), lookupOf());

    expect(plan).toMatchObject({ action: 'create' });
  });

  it('предел берётся из настройки: понизили до 1 МБ — тот же файл уже не проходит', () => {
    process.env[ENV_KEY] = '1';

    const small = planFile(fileOf({ size: 1024 }), ctxOf(), lookupOf());
    const big = planFile(fileOf({ size: 2 * 1024 * 1024 }), ctxOf(), lookupOf());

    expect(small).toMatchObject({ action: 'create' });
    expect(big).toEqual({ action: 'skip', reason: 'too_large' });
  });

  it('размер неизвестен → переносу не мешает', () => {
    process.env[ENV_KEY] = '1';

    const plan = planFile(fileOf({ size: null }), ctxOf(), lookupOf());

    expect(plan).toMatchObject({ action: 'create', data: { size: null } });
  });
});
