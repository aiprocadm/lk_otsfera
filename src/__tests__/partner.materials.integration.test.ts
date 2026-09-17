import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  getPartnerMaterialForDownload,
  listPartnerMaterials,
} from '@/lib/services/partnerMaterials/partner';

/**
 * Интеграция `У-237` (живой Postgres): две компании-издателя, партнёр с
 * организацией в каждой, пользователь партнёра с назначением на одну
 * организацию. Партнёр-администратор видит материалы обеих компаний,
 * менеджер — только своей; неопубликованные, снятые и непроверенные —
 * никому; скачивание пишет аудит; чужой материал по id — `not_found` (IDOR).
 */
let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string, companyB: string, companyC: string;
let partnerId: string;
let orgA: string, orgB: string;
let adminUser: string, managerUser: string, publisher: string;
let mA1: string, mA2pending: string, mA3off: string, mB1: string, mB2link: string, mC1: string;
const created: string[] = [];

const adminSession = (): SessionPayload =>
  ({ sub: adminUser, role: 'partner', partnerId, assignedOrgIds: [] }) as unknown as SessionPayload;
const managerSession = (): SessionPayload =>
  ({
    sub: managerUser,
    role: 'partner',
    partnerId,
    partnerRole: 'manager',
    assignedOrgIds: [orgA],
  }) as unknown as SessionPayload;

async function material(
  companyId: string,
  title: string,
  opts: { published?: boolean; active?: boolean; scan?: string; link?: string } = {}
) {
  const m = await prisma.partnerMaterial.create({
    data: {
      companyId,
      title,
      category: 'price_list',
      isActive: opts.active ?? true,
      publishedAt: opts.published === false ? null : new Date(),
      updatedById: publisher,
      ...(opts.link ? { externalUrl: opts.link } : {}),
      ...(opts.link
        ? {}
        : {
            files: {
              create: {
                path: `company/${companyId}/partner-materials/${title}-${STAMP}.pdf`,
                fileName: `${title}.pdf`,
                mimeType: 'application/pdf',
                size: 10,
                scanStatus: opts.scan ?? 'clean',
                uploadedById: publisher,
              },
            },
          }),
    },
    select: { id: true },
  });
  created.push(m.id);
  return m.id;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const [a, b, c] = await Promise.all([
    prisma.company.create({ data: { name: `pmA-${STAMP}` } }),
    prisma.company.create({ data: { name: `pmB-${STAMP}` } }),
    prisma.company.create({ data: { name: `pmC-${STAMP}` } }),
  ]);
  companyA = a.id;
  companyB = b.id;
  companyC = c.id;
  const p = await prisma.partner.create({ data: { name: `pmP-${STAMP}` } });
  partnerId = p.id;
  orgA = (
    await prisma.organization.create({
      data: { name: `pmOA-${STAMP}`, companyId: companyA, partnerId },
    })
  ).id;
  orgB = (
    await prisma.organization.create({
      data: { name: `pmOB-${STAMP}`, companyId: companyB, partnerId },
    })
  ).id;
  publisher = (
    await prisma.user.create({
      data: { email: `pm-pub-${STAMP}@x.local`, name: 'Издатель', role: 'admin' },
    })
  ).id;
  adminUser = (
    await prisma.user.create({
      data: { email: `pm-adm-${STAMP}@x.local`, name: 'Партнёр-админ', role: 'partner', partnerId },
    })
  ).id;
  managerUser = (
    await prisma.user.create({
      data: {
        email: `pm-mgr-${STAMP}@x.local`,
        name: 'Партнёр-менеджер',
        role: 'partner',
        partnerId,
      },
    })
  ).id;

  mA1 = await material(companyA, `A1-${STAMP}`);
  mA2pending = await material(companyA, `A2-${STAMP}`, { scan: 'pending' });
  mA3off = await material(companyA, `A3-${STAMP}`, { active: false });
  mB1 = await material(companyB, `B1-${STAMP}`);
  mB2link = await material(companyB, `B2-${STAMP}`, { link: 'https://example.com/b2' });
  mC1 = await material(companyC, `C1-${STAMP}`);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: created } } });
  await prisma.partnerMaterial.deleteMany({ where: { id: { in: created } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUser, managerUser, publisher] } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB, companyC] } } });
  await prisma.$disconnect();
});

describe('материалы для партнёров — скоуп и аудит (У-237)', () => {
  it('партнёр-администратор видит опубликованные clean-материалы обеих своих компаний, с подписью издателя', async () => {
    const rows = await listPartnerMaterials(prisma, adminSession());
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([mA1, mB1, mB2link].sort());
    expect(rows.find((r) => r.id === mA1)?.companyName).toBe(`pmA-${STAMP}`);
    expect(rows.find((r) => r.id === mB2link)?.externalUrl).toBe('https://example.com/b2');
    // Непроверенный, снятый и чужой компании — нет.
    expect(ids).not.toContain(mA2pending);
    expect(ids).not.toContain(mA3off);
    expect(ids).not.toContain(mC1);
  });

  it('менеджер партнёра с назначением на организацию компании A видит только A', async () => {
    const rows = await listPartnerMaterials(prisma, managerSession());
    expect(rows.map((r) => r.id)).toEqual([mA1]);
  });

  it('скачивание пишет аудит «кто, что»; чужой и невидимый материал по id — not_found (IDOR)', async () => {
    const ok = await getPartnerMaterialForDownload(prisma, managerSession(), mA1);
    expect(ok).toMatchObject({ ok: true, fileName: `A1-${STAMP}.pdf` });
    const audit = await prisma.auditLog.findMany({
      where: { action: 'partner_material_downloaded', entityId: mA1 },
      select: { userId: true, meta: true },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.userId).toBe(managerUser);

    expect(await getPartnerMaterialForDownload(prisma, managerSession(), mB1)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await getPartnerMaterialForDownload(prisma, adminSession(), mC1)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await getPartnerMaterialForDownload(prisma, adminSession(), mA2pending)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await getPartnerMaterialForDownload(prisma, adminSession(), mA3off)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await getPartnerMaterialForDownload(prisma, adminSession(), mB2link)).toEqual({
      ok: false,
      error: 'no_file',
    });
    const after = await prisma.auditLog.count({
      where: { action: 'partner_material_downloaded', entityId: { in: created } },
    });
    expect(after).toBe(1);
  });
});
