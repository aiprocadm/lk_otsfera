import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { readSource } from './helpers/source';

vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));

import {
  listPartnerMaterials,
  partnerMaterialCompanyIds,
  partnerMaterialsWhere,
} from '@/lib/services/partnerMaterials/partner';

/**
 * СТРАЖ `У-237` (решение `Р-Э6-3`): партнёр видит материалы только «своих»
 * компаний (у которых есть хотя бы одна его организация); пользователь
 * партнёра с `assignedOrgIds` — только компаний своих организаций;
 * неопубликованные, снятые и непроверенные (`pending`/`infected`) файлы не
 * отдаются ни списком, ни скачиванием — фильтр один на оба пути.
 *
 * Мутация (проверено): убрать `isActive: true` из `partnerMaterialsWhere` →
 * «фильтр видимости»; убрать `scanStatus: 'clean'` → та же проверка; заставить
 * скачивание строить своё `where` без `partnerMaterialsWhere(` → «один фильтр
 * на список и скачивание»; убрать `id: { in: scopeOrgIds }` → «менеджер видит
 * только свои организации».
 */
const SRC = readSource(join(process.cwd(), 'src/lib/services/partnerMaterials/partner.ts'));

function db(orgs: Array<{ companyId: string | null }>) {
  return {
    organization: { findMany: vi.fn(async () => orgs) },
    partnerMaterial: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  } as any;
}

describe('страж: скоуп материалов партнёра (У-237)', () => {
  it('фильтр видимости: компании партнёра, опубликован, активен, файл clean или ссылка', () => {
    const where = partnerMaterialsWhere(['c1', 'c2']);
    expect(where).toMatchObject({
      companyId: { in: ['c1', 'c2'] },
      isActive: true,
      publishedAt: { not: null },
    });
    expect(where.OR).toContainEqual({
      files: { some: { supersededAt: null, scanStatus: 'clean' } },
    });
    expect(where.OR).toContainEqual({ externalUrl: { not: null } });
  });

  it('менеджер партнёра видит только компании назначенных организаций; без партнёра — ничего', async () => {
    const d = db([{ companyId: 'c1' }]);
    const manager = {
      sub: 'u',
      role: 'partner',
      partnerId: 'p1',
      assignedOrgIds: ['o1'],
    } as unknown as SessionPayload;
    await partnerMaterialCompanyIds(d as unknown as PrismaClient, manager);
    expect(d.organization.findMany.mock.calls[0][0].where).toMatchObject({
      partnerId: 'p1',
      id: { in: ['o1'] },
    });
    const nobody = { sub: 'u', role: 'partner', partnerId: null } as unknown as SessionPayload;
    expect(await listPartnerMaterials(d as unknown as PrismaClient, nobody)).toEqual([]);
    expect(d.partnerMaterial.findMany).not.toHaveBeenCalled();
  });

  it('список строит запрос через общий фильтр, а не через свой', async () => {
    const d = db([{ companyId: 'c1' }]);
    const admin = {
      sub: 'u',
      role: 'partner',
      partnerId: 'p1',
      assignedOrgIds: [],
    } as unknown as SessionPayload;
    await listPartnerMaterials(d as unknown as PrismaClient, admin);
    expect(d.partnerMaterial.findMany.mock.calls[0][0].where).toMatchObject(
      partnerMaterialsWhere(['c1'])
    );
  });

  it('один фильтр на список и скачивание (страж по исходнику)', () => {
    const list = SRC.slice(SRC.indexOf('export async function listPartnerMaterials'));
    const download = SRC.slice(SRC.indexOf('export async function getPartnerMaterialForDownload'));
    expect(list).toContain('partnerMaterialsWhere(');
    expect(download).toContain('partnerMaterialsWhere(');
    // Скачивание ищет по id ВНУТРИ скоупа, а не по одному id.
    expect(download).toMatch(/AND:\s*\[\{ id \}, partnerMaterialsWhere\(/);
  });
});
