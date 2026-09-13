import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettingValues, download } = vi.hoisted(() => ({
  getSettingValues: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingValues }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    download,
    upload: vi.fn(),
    remove: vi.fn(),
    createSignedUrl: vi.fn(),
  }),
}));

import { FakeBitrixSource } from '@/lib/services/bitrix/adapter-fake';
import { FileBitrixSource } from '@/lib/services/bitrix/adapter-file';
import { RestBitrixSource } from '@/lib/services/bitrix/adapter-rest';
import { getBitrixSource } from '@/lib/services/bitrix/factory';
import { BitrixSourceError } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`Р-Б-1`): фабрика источника. Порядок решений —
 * `file` → выгрузки пакета из S3 по ключам `settings.fileKeys`;
 * `FAKE_BITRIX=1` → фикстура (без похода в базу); иначе REST по вебхуку из
 * настроек, а без вебхука — `not_configured`.
 */

const prisma = {} as never;
const WEBHOOK = 'https://demo.bitrix24.ru/rest/1/secret-token/';
const FIXTURES = path.resolve(__dirname, '..', '__fixtures__', 'bitrix');

function fixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURES, `${name}.csv`));
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of it) out.push(item);
  return out;
}

const envBefore = process.env.FAKE_BITRIX;

beforeEach(() => {
  vi.clearAllMocks();
  getSettingValues.mockResolvedValue({});
  delete process.env.FAKE_BITRIX;
});

afterEach(() => {
  if (envBefore === undefined) delete process.env.FAKE_BITRIX;
  else process.env.FAKE_BITRIX = envBefore;
});

/** Ловим отказ фабрики и отдаём ошибку источника для проверки кода. */
async function rejection(source: string, settings?: unknown): Promise<BitrixSourceError> {
  try {
    await getBitrixSource(prisma, { source, settings });
  } catch (err) {
    expect(err).toBeInstanceOf(BitrixSourceError);
    return err as BitrixSourceError;
  }
  throw new Error('фабрика должна была отказать');
}

describe('getBitrixSource — источник file', () => {
  it('ключи пакета скачиваются по порядку, источник читает выгрузку по-настоящему', async () => {
    download.mockImplementation(async (key: string) =>
      key === 'k-companies' ? fixture('companies') : fixture('contacts')
    );

    const source = await getBitrixSource(prisma, {
      source: 'file',
      settings: {
        fileKeys: [
          { key: 'k-companies', name: 'companies.csv', entity: 'company' },
          { key: 'k-contacts', name: 'contacts.csv', entity: 'contact' },
        ],
      },
    });

    expect(source).toBeInstanceOf(FileBitrixSource);
    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls.map((c) => c[0])).toEqual(['k-companies', 'k-contacts']);

    // Источник собран из настоящих буферов: записи разбираются, а не выдумываются.
    expect(await collect(source.companies({}))).toHaveLength(5);
    expect(await collect(source.contacts({}))).toHaveLength(8);
    expect(await source.check()).toMatchObject({ ok: true, user: 'файлов: 2' });
  });

  it('file имеет приоритет над FAKE_BITRIX=1 и настройки не читает', async () => {
    process.env.FAKE_BITRIX = '1';
    download.mockResolvedValue(fixture('companies'));

    const source = await getBitrixSource(prisma, {
      source: 'file',
      settings: { fileKeys: [{ key: 'k1', name: 'companies.csv', entity: 'company' }] },
    });

    expect(source).toBeInstanceOf(FileBitrixSource);
    expect(source).not.toBeInstanceOf(FakeBitrixSource);
    expect(getSettingValues).not.toHaveBeenCalled();
  });

  it.each([
    ['настроек нет вовсе', undefined],
    ['settings = null', null],
    ['settings не объект', 'строка'],
    ['нет ключа fileKeys', {}],
    ['fileKeys не массив', { fileKeys: 'k1' }],
    [
      'все записи — мусор',
      {
        fileKeys: [
          null,
          'строка',
          42,
          {},
          { key: 42, entity: 'company' },
          { key: '', entity: 'company' },
          { key: 'k1', entity: 42 },
          { key: 'k1', entity: 'организация' },
        ],
      },
    ],
  ])('%s → source_no_files, в хранилище не ходим', async (_label, settings) => {
    const err = await rejection('file', settings);
    expect(err.code).toBe('source_no_files');
    expect(download).not.toHaveBeenCalled();
  });

  it('записи были, но все негодные — текст говорит об этом, а не «файлов нет»', () => {
    // Пакет с опечаткой в сущности и пакет, куда ничего не грузили, — разные
    // беды: код один (для UI это «нет файлов»), а человек должен видеть разницу.
    return expect(
      rejection('file', { fileKeys: [{ key: 'k1', entity: 'организация' }, null] })
    ).resolves.toMatchObject({
      code: 'source_no_files',
      message:
        'В пакете нет пригодных файлов выгрузки: записей 2, у всех потерян ключ или сущность',
    });
  });

  it('файлов не грузили вовсе — прежний короткий текст', () => {
    return expect(rejection('file', { fileKeys: [] })).resolves.toMatchObject({
      message: 'В пакете нет файлов выгрузки',
    });
  });

  it('мусорные записи отбрасываются, валидная остаётся', async () => {
    download.mockResolvedValue(fixture('companies'));

    const source = await getBitrixSource(prisma, {
      source: 'file',
      settings: {
        fileKeys: [
          null,
          { key: 'k-bad', entity: 'нечто' },
          { key: 'k-companies', name: 'companies.csv', entity: 'company' },
        ],
      },
    });

    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith('k-companies');
    expect(await collect(source.companies({}))).toHaveLength(5);
  });

  it.each([
    ['имени нет', { key: 'k1', entity: 'company' }],
    ['имя не строка', { key: 'k2', name: 42, entity: 'company' }],
    ['имя пустое', { key: 'k3', name: '', entity: 'company' }],
  ])('%s → именем файла служит сам ключ', async (_label, item) => {
    download.mockRejectedValue(new Error('объект не найден'));
    const err = await rejection('file', { fileKeys: [item] });
    expect(err.code).toBe('source_not_ready');
    expect(err.message).toContain(`«${item.key}»`);
  });

  it('сбой скачивания → source_not_ready с именем файла и причиной', async () => {
    download.mockRejectedValue(new Error('объект не найден'));
    const err = await rejection('file', {
      fileKeys: [{ key: 'k1', name: 'companies.csv', entity: 'company' }],
    });
    expect(err.code).toBe('source_not_ready');
    expect(err.message).toBe(
      'Файл выгрузки «companies.csv» не прочитан из хранилища: объект не найден'
    );
  });

  it('не-Error причина сбоя попадает в сообщение строкой', async () => {
    download.mockRejectedValue('таймаут');
    const err = await rejection('file', {
      fileKeys: [{ key: 'k1', name: 'companies.csv', entity: 'company' }],
    });
    expect(err.message).toContain('таймаут');
  });
});

describe('getBitrixSource — выбор источника', () => {
  it('FAKE_BITRIX=1 → фикстура, база не спрашивается', async () => {
    process.env.FAKE_BITRIX = '1';
    const source = await getBitrixSource(prisma, { source: 'rest' });
    expect(source).toBeInstanceOf(FakeBitrixSource);
    expect(getSettingValues).not.toHaveBeenCalled();
  });

  it('FAKE_BITRIX с другим значением (0, true, пусто) фикстуру не включает', async () => {
    for (const value of ['0', 'true', '']) {
      process.env.FAKE_BITRIX = value;
      const err = await rejection('rest');
      expect(err.code).toBe('not_configured');
    }
  });

  it('без вебхука → not_configured с понятным текстом без URL', async () => {
    getSettingValues.mockResolvedValue({ 'bitrix.portalUrl': 'https://demo.bitrix24.ru' });
    const err = await rejection('rest');
    expect(err.code).toBe('not_configured');
    expect(err.message).toBe('Не задан входящий вебхук Битрикс24');
    expect(getSettingValues).toHaveBeenCalledWith(
      prisma,
      expect.arrayContaining(['bitrix.webhookUrl'])
    );
  });

  it('с вебхуком → REST-источник; домен портала без токена', async () => {
    getSettingValues.mockResolvedValue({ 'bitrix.webhookUrl': WEBHOOK });
    const source = await getBitrixSource(prisma, { source: 'rest' });
    expect(source).toBeInstanceOf(RestBitrixSource);
    // Единственное, что источник знает о вебхуке наружу, — домен (У-199).
    expect((source as any).host).toBe('demo.bitrix24.ru');
    expect(JSON.stringify((source as any).host)).not.toContain('secret-token');
  });

  it('неизвестный source (не file) трактуется как rest', async () => {
    getSettingValues.mockResolvedValue({ 'bitrix.webhookUrl': WEBHOOK });
    const source = await getBitrixSource(prisma, { source: 'что-то' });
    expect(source).toBeInstanceOf(RestBitrixSource);
  });
});
