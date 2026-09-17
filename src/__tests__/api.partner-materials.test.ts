import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSession, canAccessSettingsSection, createMaterial, replaceMaterialFile } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    canAccessSettingsSection: vi.fn(),
    createMaterial: vi.fn(),
    replaceMaterialFile: vi.fn(),
  })
);
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/auth/settingsAccess', () => ({ canAccessSettingsSection }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/partnerMaterials/hub', () => ({ createMaterial, replaceMaterialFile }));

import { POST as CREATE } from '@/app/api/partner-materials/route';
import { POST as REPLACE } from '@/app/api/partner-materials/[id]/file/route';

/**
 * Файловые роуты хаба «Материалы для партнёров» (`У-237`, §11 CLAUDE.md):
 * право раздела `catalogs.partnerMaterials`, разбор формы, маппинг кодов.
 */
const admin = { sub: 'a1', role: 'admin', companyId: null } as never;

/** Map-двойник FormData: роут читает форму через get/forEach (formFields + readFile duck). */
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
const PDF_BYTES = new TextEncoder().encode('%PDF-1.4 test');
function pdfFile(): File {
  return new File([PDF_BYTES], 'прайс.pdf', { type: 'application/pdf' });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const FIELDS = {
  companyId: 'c1',
  title: 'Прайс',
  description: 'осень',
  category: 'price_list',
  externalUrl: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(admin);
  canAccessSettingsSection.mockReturnValue(true);
  createMaterial.mockResolvedValue({ ok: true, id: 'm1' });
  replaceMaterialFile.mockResolvedValue({ ok: true, fileId: 'f2' });
});

describe('POST /api/partner-materials', () => {
  it('без сессии — 401; без права раздела — 403; сервис не вызван', async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await CREATE(makeReq(makeForm(FIELDS)))).status).toBe(401);
    canAccessSettingsSection.mockReturnValueOnce(false);
    const res = await CREATE(makeReq(makeForm(FIELDS)));
    expect(res.status).toBe(403);
    expect(canAccessSettingsSection).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ id: 'catalogs.partnerMaterials' })
    );
    expect(createMaterial).not.toHaveBeenCalled();
  });

  it('кривое тело, без компании или с неизвестной категорией — 400 invalid_request', async () => {
    expect((await CREATE(makeReq(null))).status).toBe(400);
    expect((await CREATE(makeReq(makeForm({ ...FIELDS, companyId: '' })))).status).toBe(400);
    expect((await CREATE(makeReq(makeForm({ ...FIELDS, category: 'weird' })))).status).toBe(400);
    expect(createMaterial).not.toHaveBeenCalled();
  });

  it('файл и поля уходят в сервис; ссылка без файла — файл null', async () => {
    const res = await CREATE(makeReq(makeForm({ ...FIELDS, file: pdfFile() })));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, id: 'm1' });
    expect(createMaterial).toHaveBeenCalledWith(
      {},
      admin,
      'c1',
      { title: 'Прайс', description: 'осень', category: 'price_list', externalUrl: '' },
      expect.objectContaining({
        name: 'прайс.pdf',
        mimeType: 'application/pdf',
        size: PDF_BYTES.length,
      })
    );
    await CREATE(makeReq(makeForm({ ...FIELDS, externalUrl: 'https://x' })));
    expect(createMaterial.mock.calls[1][4]).toBeNull();
    expect(createMaterial.mock.calls[1][3].externalUrl).toBe('https://x');
  });

  it('коды сервиса → статусы: validation 400 с текстами, too_large 413, invalid_mime 415, storage 502, forbidden 403, not_found 404', async () => {
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ ok: false, error: 'validation', messages: ['Название обязательно.'] }, 400],
      [{ ok: false, error: 'too_large' }, 413],
      [{ ok: false, error: 'invalid_mime' }, 415],
      [{ ok: false, error: 'storage' }, 502],
      [{ ok: false, error: 'forbidden' }, 403],
      [{ ok: false, error: 'not_found' }, 404],
    ];
    for (const [result, status] of cases) {
      createMaterial.mockResolvedValueOnce(result);
      const res = await CREATE(makeReq(makeForm({ ...FIELDS, file: pdfFile() })));
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.error).toBe(result.error);
      if (result.error === 'validation') expect(body.messages).toEqual(['Название обязательно.']);
    }
  });
});

describe('POST /api/partner-materials/[id]/file', () => {
  it('гарды и отсутствие файла', async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await REPLACE(makeReq(makeForm({ file: pdfFile() })), ctx('m1'))).status).toBe(401);
    canAccessSettingsSection.mockReturnValueOnce(false);
    expect((await REPLACE(makeReq(makeForm({ file: pdfFile() })), ctx('m1'))).status).toBe(403);
    expect((await REPLACE(makeReq(null), ctx('m1'))).status).toBe(400);
    expect((await REPLACE(makeReq(makeForm({})), ctx('m1'))).status).toBe(400);
    expect(replaceMaterialFile).not.toHaveBeenCalled();
  });

  it('успех и маппинг кодов', async () => {
    const res = await REPLACE(makeReq(makeForm({ file: pdfFile() })), ctx('m1'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, fileId: 'f2' });
    expect(replaceMaterialFile).toHaveBeenCalledWith(
      {},
      admin,
      'm1',
      expect.objectContaining({ name: 'прайс.pdf', mimeType: 'application/pdf' })
    );
    replaceMaterialFile.mockResolvedValueOnce({
      ok: false,
      error: 'validation',
      messages: ['Это материал-ссылка: файла у него нет.'],
    });
    const bad = await REPLACE(makeReq(makeForm({ file: pdfFile() })), ctx('m1'));
    expect(bad.status).toBe(400);
    await expect(bad.json()).resolves.toEqual({
      error: 'validation',
      messages: ['Это материал-ссылка: файла у него нет.'],
    });
    replaceMaterialFile.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    expect((await REPLACE(makeReq(makeForm({ file: pdfFile() })), ctx('zz'))).status).toBe(404);
  });
});
