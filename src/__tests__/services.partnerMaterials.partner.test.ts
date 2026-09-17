import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  getPartnerMaterialForDownload,
  listPartnerMaterials,
  partnerMaterialCompanyIds,
  partnerMaterialsWhere,
} from '@/lib/services/partnerMaterials/partner';

/** Материалы для партнёров — сторона читателя (`У-237`, `Р-Э6-3`). */

const PARTNER = {
  sub: 'u1',
  role: 'partner',
  partnerId: 'p1',
  assignedOrgIds: [],
} as unknown as SessionPayload;
const MANAGER = {
  sub: 'u2',
  role: 'partner',
  partnerId: 'p1',
  partnerRole: 'manager',
  assignedOrgIds: ['o1'],
} as unknown as SessionPayload;

function db() {
  const prisma = {
    organization: {
      findMany: vi.fn(async () => [
        { companyId: 'c1' },
        { companyId: 'c1' },
        { companyId: 'c2' },
        { companyId: null },
      ]),
    },
    partnerMaterial: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma as any };
}

beforeEach(() => vi.clearAllMocks());

describe('partnerMaterialCompanyIds', () => {
  it('без партнёра — пусто; иначе компании организаций партнёра, без повторов и без null', async () => {
    const { prisma, raw } = db();
    expect(
      await partnerMaterialCompanyIds(prisma, { sub: 'x', role: 'partner' } as SessionPayload)
    ).toEqual([]);
    expect(raw.organization.findMany).not.toHaveBeenCalled();
    expect(await partnerMaterialCompanyIds(prisma, PARTNER)).toEqual(['c1', 'c2']);
    expect(raw.organization.findMany.mock.calls[0][0].where).toEqual({
      partnerId: 'p1',
      companyId: { not: null },
    });
  });

  it('пользователь партнёра с назначенными организациями — только их компании', async () => {
    const { prisma, raw } = db();
    await partnerMaterialCompanyIds(prisma, MANAGER);
    expect(raw.organization.findMany.mock.calls[0][0].where).toEqual({
      partnerId: 'p1',
      companyId: { not: null },
      id: { in: ['o1'] },
    });
  });
});

describe('partnerMaterialsWhere / listPartnerMaterials', () => {
  it('фильтр видимости: компании, активен, опубликован, файл clean или ссылка', () => {
    expect(partnerMaterialsWhere(['c1'])).toEqual({
      companyId: { in: ['c1'] },
      isActive: true,
      publishedAt: { not: null },
      OR: [
        { externalUrl: { not: null } },
        { files: { some: { supersededAt: null, scanStatus: 'clean' } } },
      ],
    });
  });

  it('нет компаний — пусто без запроса; поиск — отдельным AND; строки с издателем и «Новое»', async () => {
    const { prisma, raw } = db();
    raw.organization.findMany.mockResolvedValueOnce([]);
    expect(await listPartnerMaterials(prisma, PARTNER)).toEqual([]);
    expect(raw.partnerMaterial.findMany).not.toHaveBeenCalled();

    const now = new Date('2026-09-17T12:00:00Z');
    raw.partnerMaterial.findMany.mockResolvedValue([
      {
        id: 'm1',
        title: 'Прайс',
        description: null,
        category: 'price_list',
        companyId: 'c1',
        externalUrl: null,
        publishedAt: new Date('2026-09-16T00:00:00Z'),
        updatedAt: new Date('2026-09-16T00:00:00Z'),
        company: { name: 'УЦ' },
        files: [{ fileName: 'p.pdf', mimeType: 'application/pdf', size: 10 }],
      },
      {
        id: 'm2',
        title: 'Ссылка',
        description: 'd',
        category: 'other',
        companyId: 'c2',
        externalUrl: 'https://x',
        publishedAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-02T00:00:00Z'),
        company: { name: 'Другой УЦ' },
        files: [],
      },
    ]);
    const rows = await listPartnerMaterials(prisma, PARTNER, { q: '  прайс ', now });
    const args = raw.partnerMaterial.findMany.mock.calls[0][0];
    expect(args.where.companyId).toEqual({ in: ['c1', 'c2'] });
    expect(args.where.AND[0].OR[0]).toEqual({ title: { contains: 'прайс', mode: 'insensitive' } });
    expect(args.take).toBe(200);
    expect(rows[0]).toMatchObject({
      id: 'm1',
      companyName: 'УЦ',
      isNew: true,
      file: { fileName: 'p.pdf' },
    });
    expect(rows[1]).toMatchObject({
      id: 'm2',
      companyName: 'Другой УЦ',
      isNew: false,
      file: null,
      externalUrl: 'https://x',
    });

    await listPartnerMaterials(prisma, PARTNER);
    expect(raw.partnerMaterial.findMany.mock.calls[1][0].where.AND).toBeUndefined();
  });
});

describe('getPartnerMaterialForDownload', () => {
  it('вне скоупа — not_found без аудита; материал-ссылка — no_file', async () => {
    const { prisma, raw } = db();
    expect(await getPartnerMaterialForDownload(prisma, PARTNER, 'zz')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(raw.partnerMaterial.findFirst.mock.calls[0][0].where.AND[0]).toEqual({ id: 'zz' });
    expect(raw.partnerMaterial.findFirst.mock.calls[0][0].where.AND[1]).toMatchObject({
      isActive: true,
    });
    raw.partnerMaterial.findFirst.mockResolvedValue({
      id: 'm2',
      externalUrl: 'https://x',
      files: [],
    });
    expect(await getPartnerMaterialForDownload(prisma, PARTNER, 'm2')).toEqual({
      ok: false,
      error: 'no_file',
    });
    expect(recordAudit).not.toHaveBeenCalled();
    raw.organization.findMany.mockResolvedValueOnce([]);
    expect(await getPartnerMaterialForDownload(prisma, PARTNER, 'm1')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('успех: путь, имя и аудит «кто скачал»', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.findFirst.mockResolvedValue({
      id: 'm1',
      externalUrl: null,
      files: [
        {
          id: 'f1',
          path: 'company/c1/partner-materials/x.pdf',
          fileName: 'прайс.pdf',
          mimeType: 'application/pdf',
        },
      ],
    });
    expect(await getPartnerMaterialForDownload(prisma, MANAGER, 'm1')).toEqual({
      ok: true,
      path: 'company/c1/partner-materials/x.pdf',
      fileName: 'прайс.pdf',
      mimeType: 'application/pdf',
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'u2',
      action: 'partner_material_downloaded',
      entity: 'partner_material',
      entityId: 'm1',
      after: { partnerId: 'p1', fileId: 'f1', fileName: 'прайс.pdf' },
    });
  });
});
