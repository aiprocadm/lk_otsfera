import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Фирменный стиль компании: логотип и печать (спека §7-1).
 *
 * Здесь проверяются две вещи, которые дороже остального. **SVG фильтруется по
 * содержимому**, причём сущности декодируются перед проверкой: `javascript:`
 * прячут как `&#x6a;avascript:`, и фильтр обязан видеть то же, что увидит
 * браузер. И **уборка за собой — best-effort**: если старый файл не удалился
 * из хранилища, это не повод отказать человеку в загрузке нового.
 */
const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
  getQueue: vi.fn(),
  recordAudit: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: mocks.upload,
    remove: mocks.remove,
    createSignedUrl: mocks.createSignedUrl,
  }),
}));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: mocks.getQueue }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/logging', () => ({
  log: { warn: mocks.logWarn, error: mocks.logError, info: vi.fn() },
}));

import {
  setCompanyDocumentNumbering,
  uploadCompanyBrandingAsset,
  deleteCompanyBrandingAsset,
  listCompanyBranding,
} from '@/lib/services/admin/companyBranding';
import type { SessionPayload } from '@/lib/auth/jwt';

const admin = { sub: 'u1', role: 'admin', companyId: null } as unknown as SessionPayload;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('данные'),
]);

function db(over: Record<string, unknown> = {}) {
  return {
    company: { findUnique: vi.fn(async () => ({ id: 'c1' })), update: vi.fn(async () => ({})) },
    companyBrandingAsset: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ id: 'a1' })),
      delete: vi.fn(async () => ({})),
    },
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.createSignedUrl.mockResolvedValue('https://s3.local/подпись');
  mocks.getQueue.mockReturnValue({ add: vi.fn(async () => undefined) });
});

describe('setCompanyDocumentNumbering — нумерация документов', () => {
  it('компании нет — «не найдено», а не тихая правка пустоты', async () => {
    const prisma = db({
      company: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
    });

    await expect(
      setCompanyDocumentNumbering(prisma, admin, 'нет', {
        prefixes: { invoice: 'С' },
        resetYearly: true,
      })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
  });

  it('кривой префикс — понятный отказ, в базу ничего не уходит', async () => {
    const prisma = db();

    const res = await setCompanyDocumentNumbering(prisma, admin, 'c1', {
      prefixes: { invoice: 'слишком-длинный-префикс' },
      resetYearly: false,
    });

    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });
});

describe('uploadCompanyBrandingAsset — загрузка логотипа', () => {
  it('PNG по подписи принимается и ставится в очередь антивируса', async () => {
    const prisma = db();

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      buffer: PNG,
      mime: 'image/png',
    });

    expect(res).toEqual({ ok: true });
    expect(mocks.upload).toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'company_branding_uploaded' })
    );
  });

  it('подделка под PNG отклоняется', async () => {
    const prisma = db();

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      buffer: Buffer.from('не png'),
      mime: 'image/png',
    });

    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('файл, не похожий на SVG, отклоняется по началу содержимого', async () => {
    const prisma = db();

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      buffer: Buffer.from('просто текст'),
      mime: 'image/svg+xml',
    });

    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(String((res as { messages: string[] }).messages[0])).toContain('не похож на SVG');
  });

  it('честный SVG принимается', async () => {
    const prisma = db();

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
      mime: 'image/svg+xml',
    });

    expect(res).toEqual({ ok: true });
  });

  it('спрятанный за сущностями `javascript:` всё равно виден фильтру', async () => {
    const prisma = db();

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      // «j» записана числовой сущностью, двоеточие — именованной.
      buffer: Buffer.from('<svg><a href="&#x6a;avascript&colon;alert(1)">x</a></svg>'),
      mime: 'image/svg+xml',
    });

    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('десятичная сущность тоже раскрывается', async () => {
    const prisma = db();

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      buffer: Buffer.from('<svg><a href="&#106;avascript&#58;alert(1)">x</a></svg>'),
      mime: 'image/svg+xml',
    });

    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });

  it('чужой тип файла не принимается вовсе', async () => {
    const prisma = db();

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      buffer: Buffer.from('%PDF'),
      mime: 'application/pdf',
    });

    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });

  it('компании нет — загрузка не делается', async () => {
    const prisma = db({
      company: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
    });

    await expect(
      uploadCompanyBrandingAsset(prisma, admin, 'нет', 'logo', { buffer: PNG, mime: 'image/png' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
  });

  it('хранилище недоступно — честный отказ, а не «сохранено»', async () => {
    mocks.upload.mockRejectedValue(new Error('S3 лёг'));
    const prisma = db();

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      buffer: PNG,
      mime: 'image/png',
    });

    expect(res).toEqual({ ok: false, error: 'storage' });
    expect(mocks.logError).toHaveBeenCalled();
  });

  it('старый файл не удалился — загрузка всё равно удалась', async () => {
    mocks.remove.mockRejectedValue(new Error('нет доступа'));
    const prisma = db({
      companyBrandingAsset: {
        findUnique: vi.fn(async () => ({ path: 'company/c1/branding/старый.png' })),
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async () => ({ id: 'a1' })),
        delete: vi.fn(async () => ({})),
      },
    });

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      buffer: PNG,
      mime: 'image/png',
    });

    expect(res).toEqual({ ok: true });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      '[companyBranding] stale object not removed',
      expect.objectContaining({ path: 'company/c1/branding/старый.png' })
    );
  });

  it('очередь антивируса недоступна — файл остаётся «на проверке», а не теряется', async () => {
    mocks.getQueue.mockReturnValue({
      add: vi.fn(async () => {
        throw new Error('Redis лёг');
      }),
    });
    const prisma = db();

    const res = await uploadCompanyBrandingAsset(prisma, admin, 'c1', 'logo', {
      buffer: PNG,
      mime: 'image/png',
    });

    expect(res).toEqual({ ok: true });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      '[companyBranding] enqueue scan failed',
      expect.objectContaining({ assetId: 'a1' })
    );
  });
});

describe('deleteCompanyBrandingAsset — удаление', () => {
  it('нечего удалять — «не найдено»', async () => {
    await expect(deleteCompanyBrandingAsset(db(), admin, 'c1', 'logo')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('файл из хранилища не удалился — запись всё равно убрана', async () => {
    mocks.remove.mockRejectedValue(new Error('нет доступа'));
    const prisma = db({
      companyBrandingAsset: {
        findUnique: vi.fn(async () => ({ id: 'a1', path: 'p1' })),
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async () => ({ id: 'a1' })),
        delete: vi.fn(async () => ({})),
      },
    });

    await expect(deleteCompanyBrandingAsset(prisma, admin, 'c1', 'logo')).resolves.toEqual({
      ok: true,
    });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      '[companyBranding] object not removed on delete',
      expect.anything()
    );
  });
});

describe('listCompanyBranding — слоты со статусами', () => {
  const assets = (rows: Array<Record<string, unknown>>) =>
    db({
      companyBrandingAsset: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => rows),
        upsert: vi.fn(async () => ({ id: 'a1' })),
        delete: vi.fn(async () => ({})),
      },
    });

  it('проверенный файл получает ссылку на предпросмотр «скачиванием»', async () => {
    const prisma = assets([
      { id: 'a1', slot: 'logo', path: 'p1', mime: 'image/png', scanStatus: 'clean' },
    ]);

    const res = await listCompanyBranding(prisma, admin, 'c1');

    expect(res).toMatchObject({ ok: true });
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('p1', 600, { download: 'logo.png' });
  });

  it('SVG получает своё расширение в имени скачивания', async () => {
    const prisma = assets([
      { id: 'a1', slot: 'logo', path: 'p1', mime: 'image/svg+xml', scanStatus: 'clean' },
    ]);

    await listCompanyBranding(prisma, admin, 'c1');

    expect(mocks.createSignedUrl).toHaveBeenCalledWith('p1', 600, { download: 'logo.svg' });
  });

  it('подпись ссылки не удалась — страница настроек всё равно открывается', async () => {
    mocks.createSignedUrl.mockRejectedValue(new Error('нет ключа'));
    const prisma = assets([
      { id: 'a1', slot: 'logo', path: 'p1', mime: 'image/png', scanStatus: 'clean' },
    ]);

    const res = await listCompanyBranding(prisma, admin, 'c1');

    expect(res).toMatchObject({ ok: true });
    expect(mocks.logWarn).toHaveBeenCalledWith('[companyBranding] sign failed', expect.anything());
  });

  it('заражённый файл убирается при первом же чтении', async () => {
    const prisma = assets([
      { id: 'a1', slot: 'logo', path: 'p1', mime: 'image/png', scanStatus: 'infected' },
    ]);

    const res = await listCompanyBranding(prisma, admin, 'c1');

    expect(res).toMatchObject({ ok: true, slots: [] });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ after: expect.objectContaining({ reason: 'infected' }) })
    );
  });

  it('заражённый файл не удалился из хранилища — запись всё равно убрана', async () => {
    mocks.remove.mockRejectedValue(new Error('нет доступа'));
    const prisma = assets([
      { id: 'a1', slot: 'logo', path: 'p1', mime: 'image/png', scanStatus: 'infected' },
    ]);

    await listCompanyBranding(prisma, admin, 'c1');

    expect(mocks.logWarn).toHaveBeenCalledWith(
      '[companyBranding] infected object not removed',
      expect.anything()
    );
  });

  it('файл ещё на проверке — ссылки нет, но слот виден', async () => {
    const prisma = assets([
      { id: 'a1', slot: 'logo', path: 'p1', mime: 'image/png', scanStatus: 'pending' },
    ]);

    const res = await listCompanyBranding(prisma, admin, 'c1');

    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect((res as { slots: unknown[] }).slots.length).toBe(1);
  });
});
