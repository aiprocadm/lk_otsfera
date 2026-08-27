/**
 * Этап 5 (PR-3) — сервис налогов, нумерации и оформления компании (`У-138`):
 * граница «admin — любая компания, leader — только своя», валидация ставки
 * НДС и префиксов нумерации, PNG magic-bytes / SVG-фильтр скриптов, лимит
 * 1 МБ, S3-жизненный цикл файла (upsert + удаление старого + антивирус
 * best-effort), presigned-предпросмотр только для clean.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit, upload, remove, createSignedUrl, queueAdd, logError, logWarn } = vi.hoisted(
  () => ({
    recordAudit: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    createSignedUrl: vi.fn(),
    queueAdd: vi.fn(),
    logError: vi.fn(),
    logWarn: vi.fn(),
  })
);

vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload, remove, createSignedUrl }),
}));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: queueAdd }) }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: logWarn, info: vi.fn() } }));

import {
  BRANDING_MAX_BYTES,
  deleteCompanyBrandingAsset,
  listCompanyBranding,
  parseDocumentNumbering,
  setCompanyDocumentNumbering,
  setCompanyTaxSettings,
  uploadCompanyBrandingAsset,
} from '@/lib/services/admin/companyBranding';

const adminSession = (): SessionPayload =>
  ({ sub: 'a1', role: 'admin', companyId: null }) as unknown as SessionPayload;
const leaderSession = (companyId = 'co-1'): SessionPayload =>
  ({ sub: 'l1', role: 'leader', companyId }) as unknown as SessionPayload;
const managerSession = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-1' }) as unknown as SessionPayload;

/** У number есть toFixed — как у Prisma.Decimal (приём services.catalogItems). */
function fake(
  over: {
    company?: Record<string, unknown> | null;
    previousAsset?: { path: string } | null;
    deleteAsset?: { id: string; path: string } | null;
    assets?: unknown[];
  } = {}
) {
  const companyFindUnique = vi
    .fn()
    .mockResolvedValue(
      over.company === undefined
        ? { id: 'co-1', defaultVatRate: null, pricesIncludeVat: false, documentNumbering: null }
        : over.company
    );
  const companyUpdate = vi.fn().mockResolvedValue({});
  const assetFindUnique = vi
    .fn()
    .mockResolvedValue(over.previousAsset ?? over.deleteAsset ?? null);
  const assetUpsert = vi.fn().mockResolvedValue({ id: 'cba-1' });
  const assetDelete = vi.fn().mockResolvedValue({});
  const assetFindMany = vi.fn().mockResolvedValue(over.assets ?? []);
  return {
    prisma: {
      company: { findUnique: companyFindUnique, update: companyUpdate },
      companyBrandingAsset: {
        findUnique: assetFindUnique,
        upsert: assetUpsert,
        delete: assetDelete,
        findMany: assetFindMany,
      },
    } as unknown as PrismaClient,
    companyFindUnique,
    companyUpdate,
    assetFindUnique,
    assetUpsert,
    assetDelete,
    assetFindMany,
  };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body'),
]);
const SVG_OK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>');

beforeEach(() => {
  vi.clearAllMocks();
  upload.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
  createSignedUrl.mockResolvedValue('https://signed.example/u');
  queueAdd.mockResolvedValue({});
});

describe('setCompanyTaxSettings — граница и валидация', () => {
  it('менеджеру и руководителю чужой компании — forbidden, база не тронута', async () => {
    const f = fake();
    expect(
      await setCompanyTaxSettings(f.prisma, managerSession(), 'co-1', {
        defaultVatRate: '0.2',
        pricesIncludeVat: false,
      })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await setCompanyTaxSettings(f.prisma, leaderSession('co-1'), 'co-2', {
        defaultVatRate: '0.2',
        pricesIncludeVat: false,
      })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(f.companyFindUnique).not.toHaveBeenCalled();
    expect(f.companyUpdate).not.toHaveBeenCalled();
  });

  it('руководитель СВОЕЙ компании проходит (страж мутации guardCompany)', async () => {
    const f = fake();
    expect(
      await setCompanyTaxSettings(f.prisma, leaderSession('co-1'), 'co-1', {
        defaultVatRate: null,
        pricesIncludeVat: true,
      })
    ).toEqual({ ok: true });
    expect(f.companyUpdate).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { defaultVatRate: null, pricesIncludeVat: true },
    });
  });

  it('ставка вне списка — validation, до базы не доходит', async () => {
    const f = fake();
    expect(
      await setCompanyTaxSettings(f.prisma, adminSession(), 'co-1', {
        defaultVatRate: '0.15',
        pricesIncludeVat: false,
      })
    ).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Ставка НДС: 0%, 5%, 7%, 10%, 20% или «не облагается»'],
    });
    expect(f.companyFindUnique).not.toHaveBeenCalled();
  });

  it('null = «не облагается» пишется как null; аудит несёт before/after в формате 0.2000', async () => {
    const f = fake({ company: { defaultVatRate: 0.1, pricesIncludeVat: true } });
    expect(
      await setCompanyTaxSettings(f.prisma, adminSession(), 'co-1', {
        defaultVatRate: null,
        pricesIncludeVat: false,
      })
    ).toEqual({ ok: true });
    expect(f.companyUpdate).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { defaultVatRate: null, pricesIncludeVat: false },
    });
    expect(recordAudit).toHaveBeenCalledWith(f.prisma, {
      userId: 'a1',
      action: 'company_tax_settings_changed',
      entity: 'company',
      entityId: 'co-1',
      before: { defaultVatRate: '0.1000', pricesIncludeVat: true },
      after: { defaultVatRate: null, pricesIncludeVat: false },
    });
  });

  it('ставка 0.2 нормализуется в 0.2000 (и в базе, и в after аудита)', async () => {
    const f = fake({ company: { defaultVatRate: null, pricesIncludeVat: false } });
    await setCompanyTaxSettings(f.prisma, adminSession(), 'co-1', {
      defaultVatRate: '0.2',
      pricesIncludeVat: true,
    });
    expect(f.companyUpdate).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { defaultVatRate: '0.2000', pricesIncludeVat: true },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      f.prisma,
      expect.objectContaining({
        before: { defaultVatRate: null, pricesIncludeVat: false },
        after: { defaultVatRate: '0.2000', pricesIncludeVat: true },
      })
    );
  });

  it('компании нет — not_found, без update и аудита', async () => {
    const f = fake({ company: null });
    expect(
      await setCompanyTaxSettings(f.prisma, adminSession(), 'co-x', {
        defaultVatRate: '0.2',
        pricesIncludeVat: false,
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(f.companyUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('setCompanyDocumentNumbering', () => {
  it('кривой ввод (resetYearly не boolean) — validation, база не тронута', async () => {
    const f = fake();
    expect(
      await setCompanyDocumentNumbering(f.prisma, adminSession(), 'co-1', {
        prefixes: {},
        resetYearly: 'да',
      })
    ).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Префикс: до 12 символов — буквы, цифры, дефис.'],
    });
    expect(f.companyFindUnique).not.toHaveBeenCalled();
  });

  it('префикс из 13 символов — validation', async () => {
    const f = fake();
    const res = await setCompanyDocumentNumbering(f.prisma, adminSession(), 'co-1', {
      prefixes: { invoice: 'А'.repeat(13) },
      resetYearly: true,
    });
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Префикс: до 12 символов — буквы, цифры, дефис.'],
    });
    expect(f.companyUpdate).not.toHaveBeenCalled();
  });

  it('happy-path: пишет Json и аудит company_numbering_changed', async () => {
    const f = fake({ company: { documentNumbering: null } });
    const input = { prefixes: { invoice: 'СЧ-2026', act: 'АКТ' }, resetYearly: true };
    expect(
      await setCompanyDocumentNumbering(f.prisma, leaderSession('co-1'), 'co-1', input)
    ).toEqual({ ok: true });
    expect(f.companyUpdate).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { documentNumbering: input },
    });
    expect(recordAudit).toHaveBeenCalledWith(f.prisma, {
      userId: 'l1',
      action: 'company_numbering_changed',
      entity: 'company',
      entityId: 'co-1',
      before: { documentNumbering: null },
      after: { documentNumbering: input },
    });
  });
});

describe('parseDocumentNumbering', () => {
  it('кривой сохранённый JSON — null, а не падение', () => {
    expect(parseDocumentNumbering(null)).toBeNull();
    expect(parseDocumentNumbering({ garbage: true })).toBeNull();
    expect(parseDocumentNumbering({ prefixes: { invoice: 42 }, resetYearly: true })).toBeNull();
  });

  it('валидное содержимое возвращается как есть', () => {
    expect(parseDocumentNumbering({ prefixes: { act: 'АКТ' }, resetYearly: false })).toEqual({
      prefixes: { act: 'АКТ' },
      resetYearly: false,
    });
  });
});

describe('uploadCompanyBrandingAsset — формат и содержимое', () => {
  it('не PNG и не SVG — validation', async () => {
    const f = fake();
    expect(
      await uploadCompanyBrandingAsset(f.prisma, adminSession(), 'co-1', 'logo', {
        buffer: PNG,
        mime: 'image/jpeg',
      })
    ).toEqual({ ok: false, error: 'validation', messages: ['Допустимы только PNG и SVG.'] });
    expect(upload).not.toHaveBeenCalled();
  });

  it('PNG с кривой сигнатурой — validation', async () => {
    const f = fake();
    expect(
      await uploadCompanyBrandingAsset(f.prisma, adminSession(), 'co-1', 'logo', {
        buffer: Buffer.from('definitely-not-png'),
        mime: 'image/png',
      })
    ).toEqual({ ok: false, error: 'validation', messages: ['Файл не похож на PNG.'] });
  });

  it('SVG со <script>, on*= или javascript: не принимается', async () => {
    const f = fake();
    // Набор расширен по находкам ревью PR-3: разделителем перед `on…=` годится
    // не только пробел, но и слэш; сущности прячут `javascript:`; XXE и
    // foreignObject — отдельные векторы.
    const bad = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="steal()"></svg>',
      '<svg/onload=alert(1)>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#x6a;avascript:alert(1)">x</a></svg>',
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body>x</body></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="onload" to="alert(1)"/></svg>',
      // Префикс пространства имён: `<svg:script>` исполняется так же, как
      // `<script>`, а простой поиск `<script` его не видел (второй заход ревью).
      '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg:svg>',
    ];
    for (const svg of bad) {
      const res = await uploadCompanyBrandingAsset(f.prisma, adminSession(), 'co-1', 'stamp', {
        buffer: Buffer.from(svg),
        mime: 'image/svg+xml',
      });
      expect(res.ok, 'должен быть отклонён: ' + svg.slice(0, 60)).toBe(false);
      if (!res.ok && res.error === 'validation') {
        expect(res.messages[0]).toContain('SVG отклонён');
      }
    }
    expect(upload).not.toHaveBeenCalled();
  });

  it('безопасный SVG принимается — фильтр не глухой', async () => {
    const f = fake();
    const good = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const res = await uploadCompanyBrandingAsset(f.prisma, adminSession(), 'co-1', 'logo', {
      buffer: Buffer.from(good),
      mime: 'image/svg+xml',
    });
    expect(res).toEqual({ ok: true });
    expect(upload).toHaveBeenCalled();
  });

  it('больше 1 МБ — validation до любых обращений к базе и S3', async () => {
    const f = fake();
    expect(
      await uploadCompanyBrandingAsset(f.prisma, adminSession(), 'co-1', 'logo', {
        buffer: Buffer.alloc(BRANDING_MAX_BYTES + 1),
        mime: 'image/png',
      })
    ).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Файл больше 1 МБ — уменьшите изображение.'],
    });
    expect(f.companyFindUnique).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('S3 недоступен — error storage, строка в базе НЕ создаётся', async () => {
    const f = fake();
    upload.mockRejectedValueOnce(new Error('S3 down'));
    expect(
      await uploadCompanyBrandingAsset(f.prisma, adminSession(), 'co-1', 'logo', {
        buffer: PNG,
        mime: 'image/png',
      })
    ).toEqual({ ok: false, error: 'storage' });
    expect(f.assetUpsert).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  it('happy-path: upsert, удаление старого объекта, антивирус company_branding, аудит', async () => {
    const f = fake({ previousAsset: { path: 'company/co-1/branding/logo-old.png' } });
    expect(
      await uploadCompanyBrandingAsset(f.prisma, leaderSession('co-1'), 'co-1', 'logo', {
        buffer: SVG_OK,
        mime: 'image/svg+xml',
      })
    ).toEqual({ ok: true });

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^company\/co-1\/branding\/logo-[0-9a-f-]+\.svg$/),
      SVG_OK,
      { contentType: 'image/svg+xml' }
    );
    expect(f.assetUpsert).toHaveBeenCalledWith({
      where: { companyId_slot: { companyId: 'co-1', slot: 'logo' } },
      create: {
        companyId: 'co-1',
        slot: 'logo',
        path: expect.stringMatching(/^company\/co-1\/branding\/logo-/),
        mime: 'image/svg+xml',
      },
      update: {
        path: expect.stringMatching(/^company\/co-1\/branding\/logo-/),
        mime: 'image/svg+xml',
        scanStatus: 'pending',
        scanReason: null,
        scannedAt: null,
      },
      select: { id: true },
    });
    expect(remove).toHaveBeenCalledWith(['company/co-1/branding/logo-old.png']);
    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'company_branding', id: 'cba-1' });
    expect(recordAudit).toHaveBeenCalledWith(f.prisma, {
      userId: 'l1',
      action: 'company_branding_uploaded',
      entity: 'company',
      entityId: 'co-1',
      after: { slot: 'logo', mime: 'image/svg+xml' },
    });
  });

  it('первый файл слота: старого объекта нет — remove не зовётся', async () => {
    const f = fake({ previousAsset: null });
    expect(
      await uploadCompanyBrandingAsset(f.prisma, adminSession(), 'co-1', 'signature', {
        buffer: PNG,
        mime: 'image/png',
      })
    ).toEqual({ ok: true });
    expect(remove).not.toHaveBeenCalled();
  });

  it('сбой очереди антивируса глотается: результат ok, файл остаётся pending', async () => {
    const f = fake();
    queueAdd.mockRejectedValueOnce(new Error('redis down'));
    expect(
      await uploadCompanyBrandingAsset(f.prisma, adminSession(), 'co-1', 'logo', {
        buffer: PNG,
        mime: 'image/png',
      })
    ).toEqual({ ok: true });
    expect(logWarn).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      f.prisma,
      expect.objectContaining({ action: 'company_branding_uploaded' })
    );
  });

  it('компании нет — not_found (файл в S3 не льётся)', async () => {
    const f = fake({ company: null });
    expect(
      await uploadCompanyBrandingAsset(f.prisma, adminSession(), 'co-x', 'logo', {
        buffer: PNG,
        mime: 'image/png',
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('deleteCompanyBrandingAsset', () => {
  it('слота нет — not_found', async () => {
    const f = fake({ deleteAsset: null });
    expect(await deleteCompanyBrandingAsset(f.prisma, adminSession(), 'co-1', 'logo')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(f.assetDelete).not.toHaveBeenCalled();
  });

  it('happy-path: удаляет строку, объект в S3 и пишет аудит', async () => {
    const f = fake({ deleteAsset: { id: 'cba-1', path: 'company/co-1/branding/stamp-1.png' } });
    expect(await deleteCompanyBrandingAsset(f.prisma, leaderSession('co-1'), 'co-1', 'stamp')).toEqual(
      { ok: true }
    );
    expect(f.assetDelete).toHaveBeenCalledWith({ where: { id: 'cba-1' } });
    expect(remove).toHaveBeenCalledWith(['company/co-1/branding/stamp-1.png']);
    expect(recordAudit).toHaveBeenCalledWith(f.prisma, {
      userId: 'l1',
      action: 'company_branding_removed',
      entity: 'company',
      entityId: 'co-1',
      after: { slot: 'stamp' },
    });
  });
});

/**
 * Ревью PR-3: граница компании проверялась пробой лишь у одного мутатора из
 * четырёх — мутация «убрать сравнение companyId» переживала три четверти
 * поверхности. Здесь ВСЕ входы разом: руководитель чужой компании не должен
 * ни читать, ни писать, и до базы/хранилища дело не доходит.
 */
describe('граница компании руководителя — на каждом входе', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

  it('налоги, нумерация, загрузка, удаление и список — forbidden для чужой компании', async () => {
    const f = fake({ assets: [] });
    const foreign = leaderSession('co-OTHER');

    expect(
      await setCompanyTaxSettings(f.prisma, foreign, 'co-1', {
        defaultVatRate: null,
        pricesIncludeVat: true,
      })
    ).toEqual({ ok: false, error: 'forbidden' });

    expect(
      await setCompanyDocumentNumbering(f.prisma, foreign, 'co-1', {
        prefixes: {},
        resetYearly: false,
      })
    ).toEqual({ ok: false, error: 'forbidden' });

    expect(
      await uploadCompanyBrandingAsset(f.prisma, foreign, 'co-1', 'logo', {
        buffer: Buffer.from(svg),
        mime: 'image/svg+xml',
      })
    ).toEqual({ ok: false, error: 'forbidden' });

    expect(await deleteCompanyBrandingAsset(f.prisma, foreign, 'co-1', 'logo')).toEqual({
      ok: false,
      error: 'forbidden',
    });

    expect(await listCompanyBranding(f.prisma, foreign, 'co-1')).toEqual({
      ok: false,
      error: 'forbidden',
    });

    // Ни одного обращения к базе и хранилищу: отказ до всякой работы.
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(f.assetFindMany).not.toHaveBeenCalled();
  });

  it('своя компания руководителю открыта — иначе тест выше проходил бы всегда', async () => {
    const f = fake({ assets: [] });
    const own = leaderSession('co-1');
    const res = await listCompanyBranding(f.prisma, own, 'co-1');
    expect(res.ok).toBe(true);
    expect(f.assetFindMany).toHaveBeenCalled();
  });
});

describe('listCompanyBranding — предпросмотр только для clean', () => {
  const assets = [
    { slot: 'logo', path: 'p-clean', mime: 'image/png', scanStatus: 'clean' },
    { slot: 'signature', path: 'p-pending', mime: 'image/svg+xml', scanStatus: 'pending' },
    { slot: 'stamp', path: 'p-infected', mime: 'image/png', scanStatus: 'infected' },
  ];

  it('чужой роли список не отдаётся', async () => {
    const f = fake({ assets });
    expect(await listCompanyBranding(f.prisma, managerSession(), 'co-1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(f.assetFindMany).not.toHaveBeenCalled();
  });

  it('presigned зовётся ТОЛЬКО для clean; pending/infected без previewUrl', async () => {
    const f = fake({ assets });
    const res = await listCompanyBranding(f.prisma, leaderSession('co-1'), 'co-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    // `attachment` — вторая линия против SVG-скриптов (ревью PR-3): прямая
    // навигация скачает файл, `<img>` заголовок игнорирует.
    expect(createSignedUrl).toHaveBeenCalledWith('p-clean', 600, { download: 'logo.png' });
    expect(res.slots).toEqual([
      {
        slot: 'logo',
        label: 'Логотип',
        scanStatus: 'clean',
        previewUrl: 'https://signed.example/u',
        mime: 'image/png',
      },
      {
        slot: 'signature',
        label: 'Подпись',
        scanStatus: 'pending',
        previewUrl: null,
        mime: 'image/svg+xml',
      },
    ]);
    // Спека §3.2: заражённый слот очищается при чтении — в выдаче его нет.
    expect(res.slots.some((x) => x.slot === 'stamp')).toBe(false);
  });

  it('сбой подписи не роняет страницу настроек: previewUrl null, результат ok', async () => {
    const f = fake({ assets: [assets[0]] });
    createSignedUrl.mockRejectedValueOnce(new Error('sign failed'));
    const res = await listCompanyBranding(f.prisma, adminSession(), 'co-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.slots).toEqual([
      expect.objectContaining({ slot: 'logo', scanStatus: 'clean', previewUrl: null }),
    ]);
    expect(logWarn).toHaveBeenCalled();
  });

  it('пустой слот в списке не появляется', async () => {
    const f = fake({ assets: [] });
    const res = await listCompanyBranding(f.prisma, adminSession(), 'co-1');
    expect(res).toEqual({ ok: true, slots: [] });
  });
});
