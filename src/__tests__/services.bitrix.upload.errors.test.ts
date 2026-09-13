import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `storeBitrixUploads`: что происходит с ошибкой разбора, которая НЕ «файл
 * нечитаем». Такую ошибку сервис обязан пробросить наверх, а не превращать в
 * код результата — иначе поломка разбора замаскируется под отказ пользователя.
 *
 * Здесь разбор мокается (в основном файле теста он настоящий, на фикстурах):
 * подделать «неожиданное» исключение живой выгрузкой нечем.
 */
const { inspectBitrixFile, storageUpload, storageRemove, logError } = vi.hoisted(() => ({
  inspectBitrixFile: vi.fn(),
  storageUpload: vi.fn(),
  storageRemove: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/services/bitrix/adapter-file', () => ({ inspectBitrixFile }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: storageUpload,
    remove: storageRemove,
    download: vi.fn(),
    createSignedUrl: vi.fn(),
  }),
}));
vi.mock('@/lib/logging', () => ({
  log: { error: logError, warn: vi.fn(), info: vi.fn() },
  bestEffort: () => () => {},
}));

import type { FormFile } from '@/lib/api/multipart';
import { storeBitrixUploads } from '@/lib/services/bitrix/upload';
import { BitrixSourceError } from '@/lib/services/bitrix/source';

const file: FormFile = {
  name: 'companies.csv',
  type: 'text/csv',
  size: 10,
  buffer: Buffer.from('ID;Название компании\n', 'utf8'),
};

beforeEach(() => {
  vi.clearAllMocks();
  storageUpload.mockResolvedValue(undefined);
});

describe('storeBitrixUploads — неожиданная ошибка разбора', () => {
  it('обычное исключение пробрасывается, в хранилище ничего не пишется', async () => {
    inspectBitrixFile.mockRejectedValue(new TypeError('колонка не та'));
    await expect(storeBitrixUploads([file])).rejects.toThrow('колонка не та');
    expect(storageUpload).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it('BitrixSourceError с другим кодом тоже пробрасывается (ловится только file_unreadable)', async () => {
    inspectBitrixFile.mockRejectedValue(new BitrixSourceError('api', 'портал ответил 500'));
    await expect(storeBitrixUploads([file])).rejects.toMatchObject({
      name: 'BitrixSourceError',
      code: 'api',
    });
    expect(storageUpload).not.toHaveBeenCalled();
  });
});
