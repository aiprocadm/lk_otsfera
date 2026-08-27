/**
 * POST /api/company/branding (`У-138`) — файловый роут загрузки
 * логотипа/подписи/печати (§11 CLAUDE.md: файлы только API-роутом).
 * Тонкий роут: право раздела `catalogs.requisites` (default-deny профиль
 * режет и загрузку), 413 на файле больше 1 МБ ДО сервиса, маппинг
 * стабильных кодов сервиса в HTTP-статусы.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSession, canAccessSettingsSection, uploadCompanyBrandingAsset } = vi.hoisted(() => ({
  getSession: vi.fn(),
  canAccessSettingsSection: vi.fn(),
  uploadCompanyBrandingAsset: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/auth/settingsAccess', () => ({ canAccessSettingsSection }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/admin/companyBranding', async (orig) => {
  const actual = await orig<typeof import('@/lib/services/admin/companyBranding')>();
  return { ...actual, uploadCompanyBrandingAsset };
});

import { POST } from '@/app/api/company/branding/route';
import { BRANDING_MAX_BYTES } from '@/lib/services/admin/companyBranding';

const admin = { sub: 'a1', role: 'admin', companyId: null } as never;
const leader = { sub: 'l1', role: 'leader', companyId: 'co-1' } as never;

/**
 * Map-based двойник FormData: роут читает форму только через get/forEach
 * (formFields + readFile c detect:'duck'), а настоящий FormData Node может
 * пере-оборачивать File и терять подменённый size.
 */
function makeForm(entries: Record<string, unknown>): FormData {
  const map = new Map(Object.entries(entries));
  return {
    get: (k: string) => map.get(k) ?? null,
    forEach: (cb: (v: unknown, k: string) => void) => map.forEach((v, k) => cb(v, k)),
  } as unknown as FormData;
}

function makeReq(form: FormData | null): Request {
  return {
    formData: () => (form ? Promise.resolve(form) : Promise.reject(new Error('bad multipart'))),
  } as unknown as Request;
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

function pngFile(): File {
  return new File([PNG_BYTES], 'logo.png', { type: 'image/png' });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(admin);
  canAccessSettingsSection.mockReturnValue(true);
  uploadCompanyBrandingAsset.mockResolvedValue({ ok: true });
});

describe('POST /api/company/branding', () => {
  it('без сессии — 401, ни право, ни сервис не спрашиваются', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(makeReq(makeForm({ companyId: 'co-1', slot: 'logo', file: pngFile() })));
    expect(res.status).toBe(401);
    expect(canAccessSettingsSection).not.toHaveBeenCalled();
    expect(uploadCompanyBrandingAsset).not.toHaveBeenCalled();
  });

  it('нет права раздела (default-deny профиль) — 403, сервис не вызван', async () => {
    getSession.mockResolvedValue(leader);
    canAccessSettingsSection.mockReturnValue(false);
    const res = await POST(makeReq(makeForm({ companyId: 'co-1', slot: 'logo', file: pngFile() })));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
    expect(canAccessSettingsSection).toHaveBeenCalledWith(
      leader,
      expect.objectContaining({ id: 'catalogs.requisites' })
    );
    expect(uploadCompanyBrandingAsset).not.toHaveBeenCalled();
  });

  it('кривое (не multipart) тело — 400 invalid_request', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(uploadCompanyBrandingAsset).not.toHaveBeenCalled();
  });

  it('без companyId — 400', async () => {
    const res = await POST(makeReq(makeForm({ slot: 'logo', file: pngFile() })));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(uploadCompanyBrandingAsset).not.toHaveBeenCalled();
  });

  it('без файла (или файл нулевого размера) — 400', async () => {
    const noFile = await POST(makeReq(makeForm({ companyId: 'co-1', slot: 'logo' })));
    expect(noFile.status).toBe(400);

    const empty = pngFile();
    Object.defineProperty(empty, 'size', { value: 0 });
    const emptyFile = await POST(makeReq(makeForm({ companyId: 'co-1', slot: 'logo', file: empty })));
    expect(emptyFile.status).toBe(400);
    expect(uploadCompanyBrandingAsset).not.toHaveBeenCalled();
  });

  it('файл больше 1 МБ — 413 ДО сервиса', async () => {
    const big = pngFile();
    Object.defineProperty(big, 'size', { value: BRANDING_MAX_BYTES + 1 });
    const res = await POST(makeReq(makeForm({ companyId: 'co-1', slot: 'logo', file: big })));
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({ error: 'too_large' });
    expect(uploadCompanyBrandingAsset).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 403, { error: 'forbidden' }],
    ['not_found', 404, { error: 'not_found' }],
    ['storage', 502, { error: 'storage' }],
  ] as const)('код сервиса %s → HTTP %i', async (error, status, body) => {
    uploadCompanyBrandingAsset.mockResolvedValue({ ok: false, error });
    const res = await POST(makeReq(makeForm({ companyId: 'co-1', slot: 'logo', file: pngFile() })));
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual(body);
  });

  it('validation сервиса → 400 вместе с русскими messages', async () => {
    uploadCompanyBrandingAsset.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['SVG со скриптами не принимается.'],
    });
    const res = await POST(makeReq(makeForm({ companyId: 'co-1', slot: 'stamp', file: pngFile() })));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'validation',
      messages: ['SVG со скриптами не принимается.'],
    });
  });

  it('happy-path: 200, в сервис уезжают companyId, слот, буфер и MIME', async () => {
    const res = await POST(
      makeReq(makeForm({ companyId: 'co-1', slot: 'signature', file: pngFile() }))
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(uploadCompanyBrandingAsset).toHaveBeenCalledTimes(1);
    const [prismaArg, sessionArg, companyId, slot, file] =
      uploadCompanyBrandingAsset.mock.calls[0];
    expect(prismaArg).toEqual({});
    expect(sessionArg).toBe(admin);
    expect(companyId).toBe('co-1');
    expect(slot).toBe('signature');
    expect(file.mime).toBe('image/png');
    expect(Buffer.isBuffer(file.buffer)).toBe(true);
    expect(file.buffer.equals(Buffer.from(PNG_BYTES))).toBe(true);
  });
});
