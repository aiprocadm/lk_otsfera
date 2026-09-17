import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit, getSession, createSignedUrl } = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  getSession: vi.fn(),
  createSignedUrl: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ createSignedUrl }) }));
vi.mock('@/lib/logging', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const { getPartnerMaterialForDownloadMock } = vi.hoisted(() => ({
  getPartnerMaterialForDownloadMock: vi.fn(),
}));
vi.mock('@/lib/services/partnerMaterials/partner', async (orig) => {
  const actual = await orig<typeof import('@/lib/services/partnerMaterials/partner')>();
  return { ...actual, getPartnerMaterialForDownload: getPartnerMaterialForDownloadMock };
});

import type * as partnerService from '@/lib/services/partnerMaterials/partner';
import { POST } from '@/app/api/partner/materials/[id]/download/route';

/**
 * СТРАЖ `У-237`: каждое скачивание материала партнёром пишется в аудит
 * («кто, что»), а подписанная ссылка выдаётся только после положительного
 * ответа сервиса — то есть только для видимого материала с `clean`-файлом.
 *
 * Мутация (проверено): убрать `recordAudit` из `getPartnerMaterialForDownload`
 * → «скачивание пишется в аудит»; заставить роут выдавать ссылку при
 * `not_found` → «ссылка только после ok».
 */
const PARTNER = {
  sub: 'u1',
  role: 'partner',
  partnerId: 'p1',
  assignedOrgIds: [],
} as unknown as SessionPayload;

// Настоящая реализация сервиса — мок выше подменяет только то, что читает роут.
const realDownload = (
  vi.importActual('@/lib/services/partnerMaterials/partner') as Promise<typeof partnerService>
).then((m) => m.getPartnerMaterialForDownload);

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(PARTNER);
  createSignedUrl.mockResolvedValue('https://s3/x');
});

describe('страж: скачивание материала — с аудитом и только clean (У-237)', () => {
  it('скачивание пишется в аудит: кто, какой материал, какой файл', async () => {
    const download = await realDownload;
    const prisma = {
      organization: { findMany: vi.fn(async () => [{ companyId: 'c1' }]) },
      partnerMaterial: {
        findFirst: vi.fn(async () => ({
          id: 'm1',
          externalUrl: null,
          files: [{ id: 'f1', path: 'p', fileName: 'x.pdf', mimeType: 'application/pdf' }],
        })),
      },
    } as unknown as PrismaClient;
    const r = await download(prisma, PARTNER, 'm1');
    expect(r.ok).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'partner_material_downloaded',
        entity: 'partner_material',
        entityId: 'm1',
        userId: 'u1',
        after: expect.objectContaining({ fileId: 'f1' }),
      })
    );
  });

  it('невидимый материал — без аудита и без файла', async () => {
    const download = await realDownload;
    const prisma = {
      organization: { findMany: vi.fn(async () => [{ companyId: 'c1' }]) },
      partnerMaterial: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    expect(await download(prisma, PARTNER, 'm1')).toEqual({ ok: false, error: 'not_found' });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('роут выдаёт подписанную ссылку только после ok сервиса', async () => {
    const ctx = { params: Promise.resolve({ id: 'm1' }) };
    getPartnerMaterialForDownloadMock.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    const denied = await POST({} as Request, ctx);
    expect(denied.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();

    getPartnerMaterialForDownloadMock.mockResolvedValueOnce({
      ok: true,
      path: 'p',
      fileName: 'x.pdf',
      mimeType: 'application/pdf',
    });
    const ok = await POST({} as Request, ctx);
    expect(ok.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });
});
