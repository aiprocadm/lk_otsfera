import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { downloadMock, warnMock } = vi.hoisted(() => ({
  downloadMock: vi.fn(),
  warnMock: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ download: downloadMock }) }));
vi.mock('@/lib/logging', () => ({ log: { warn: warnMock, error: vi.fn(), info: vi.fn() } }));

import { loadDocumentBranding } from '@/lib/services/documents/branding';

/**
 * `У-153` — логотип, подпись и печать в документах.
 *
 * Проверяем не «функция что-то вернула», а три правила: непроверенный файл не
 * печатается, сбой хранилища не мешает выпустить счёт, чужой формат не роняет
 * рендер.
 */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rest')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function prismaWith(assets: Array<{ slot: string; path: string }>) {
  // Аргумент типизируем явно: без этого `mock.calls[0]` — пустой кортеж.
  const findMany = vi.fn(async (args: { where: unknown }) => {
    void args;
    return assets;
  });
  return {
    prisma: { companyBrandingAsset: { findMany } } as unknown as PrismaClient,
    findMany,
  };
}

beforeEach(() => {
  downloadMock.mockReset();
  warnMock.mockReset();
});

describe('loadDocumentBranding', () => {
  it('берёт файлы трёх слотов и отдаёт их байтами', async () => {
    const { prisma } = prismaWith([
      { slot: 'logo', path: 'company/c1/branding/logo.png' },
      { slot: 'signature', path: 'company/c1/branding/signature.svg' },
      { slot: 'stamp', path: 'company/c1/branding/stamp.png' },
    ]);
    downloadMock.mockImplementation(async (p: string) => (p.endsWith('.svg') ? SVG : PNG));

    const branding = await loadDocumentBranding(prisma, 'c1');
    expect(branding.logo).toBe(PNG);
    expect(branding.signature).toBe(SVG);
    expect(branding.stamp).toBe(PNG);
  });

  it('запрашивает ТОЛЬКО проверенные антивирусом файлы', async () => {
    // Слот с `pending`/`infected` в документ попасть не должен — иначе
    // антивирус слотов оформления был бы декорацией.
    const { prisma, findMany } = prismaWith([]);
    await loadDocumentBranding(prisma, 'c1');
    expect(findMany.mock.calls[0]![0].where).toEqual({ companyId: 'c1', scanStatus: 'clean' });
  });

  it('сбой хранилища не мешает выпустить документ — слот просто пустой', async () => {
    const { prisma } = prismaWith([{ slot: 'logo', path: 'company/c1/branding/logo.png' }]);
    downloadMock.mockRejectedValue(new Error('S3 down'));

    const branding = await loadDocumentBranding(prisma, 'c1');
    expect(branding).toEqual({ logo: null, signature: null, stamp: null });
    expect(warnMock).toHaveBeenCalled();
  });

  it('чужой формат отбрасывается ДО рендера', async () => {
    // Иначе `@react-pdf` упал бы уже внутри транзакции, когда номер счёта из
    // счётчика уже израсходован.
    const { prisma } = prismaWith([{ slot: 'stamp', path: 'company/c1/branding/stamp.png' }]);
    downloadMock.mockResolvedValue(Buffer.from('GIF89a...'));

    const branding = await loadDocumentBranding(prisma, 'c1');
    expect(branding.stamp).toBeNull();
    expect(warnMock).toHaveBeenCalled();
  });

  it('slot без файлов — пустое оформление, запросов в хранилище нет', async () => {
    const { prisma } = prismaWith([]);
    expect(await loadDocumentBranding(prisma, 'c1')).toEqual({
      logo: null,
      signature: null,
      stamp: null,
    });
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
