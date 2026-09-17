import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSession, getPartnerMaterialForDownload, createSignedUrl, logError } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPartnerMaterialForDownload: vi.fn(),
  createSignedUrl: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ createSignedUrl }) }));
vi.mock('@/lib/services/partnerMaterials/partner', () => ({ getPartnerMaterialForDownload }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: vi.fn(), info: vi.fn() } }));

import { POST } from '@/app/api/partner/materials/[id]/download/route';

/** Скачивание материала партнёром (`У-237`): только роль партнёра, presigned на 10 минут, право и аудит — в сервисе. */
const partner = { sub: 'u1', role: 'partner', partnerId: 'p1' } as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = {} as Request;

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(partner);
  getPartnerMaterialForDownload.mockResolvedValue({
    ok: true,
    path: 'company/c1/partner-materials/x.pdf',
    fileName: 'прайс.pdf',
    mimeType: 'application/pdf',
  });
  createSignedUrl.mockResolvedValue('https://s3/signed');
});

describe('POST /api/partner/materials/[id]/download', () => {
  it('без сессии — 401; не партнёр или партнёр без partnerId — 403; сервис не спрашивается', async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await POST(req, ctx('m1'))).status).toBe(401);
    getSession.mockResolvedValueOnce({ sub: 'm', role: 'manager' });
    expect((await POST(req, ctx('m1'))).status).toBe(403);
    getSession.mockResolvedValueOnce({ sub: 'p', role: 'partner', partnerId: null });
    expect((await POST(req, ctx('m1'))).status).toBe(403);
    expect(getPartnerMaterialForDownload).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('вне скоупа — 404, материал-ссылка — 409; ссылка не выдаётся', async () => {
    getPartnerMaterialForDownload.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    expect((await POST(req, ctx('zz'))).status).toBe(404);
    getPartnerMaterialForDownload.mockResolvedValueOnce({ ok: false, error: 'no_file' });
    expect((await POST(req, ctx('m2'))).status).toBe(409);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('успех: подписанная ссылка на 600 с с именем файла', async () => {
    const res = await POST(req, ctx('m1'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ downloadUrl: 'https://s3/signed' });
    expect(getPartnerMaterialForDownload).toHaveBeenCalledWith({}, partner, 'm1');
    expect(createSignedUrl).toHaveBeenCalledWith('company/c1/partner-materials/x.pdf', 600, {
      download: 'прайс.pdf',
    });
  });

  it('хранилище не выдало ссылку — 502 и запись в лог', async () => {
    createSignedUrl.mockRejectedValueOnce(new Error('bucket gone'));
    const res = await POST(req, ctx('m1'));
    expect(res.status).toBe(502);
    expect(logError).toHaveBeenCalledWith(
      '[partner/materials] signed url failed',
      expect.objectContaining({ materialId: 'm1', error: 'bucket gone' })
    );
  });
});
