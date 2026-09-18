import type { PartnerMaterialCategory, Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { isNewMaterial } from './shared';

/**
 * Материалы для партнёров — сторона читателя (`У-237`, `Р-Э6-3`).
 *
 * Партнёр видит материалы компаний, у которых есть хотя бы одна его
 * организация; пользователь партнёра с `assignedOrgIds` — только компаний
 * своих организаций. Показываются только опубликованные и только с
 * `clean`-файлом (или ссылкой): `pending`/`infected` партнёру не отдаются ни
 * списком, ни скачиванием. Скоуп держит сервис, а не экран (§4).
 */
export type PartnerMaterialRow = {
  id: string;
  title: string;
  description: string | null;
  category: PartnerMaterialCategory;
  companyId: string;
  /** Издатель — подпись на карточке: у партнёра могут быть материалы разных компаний. */
  companyName: string;
  externalUrl: string | null;
  file: { fileName: string; mimeType: string; size: number } | null;
  publishedAt: Date;
  updatedAt: Date;
  isNew: boolean;
};

/** Компании-издатели, чьи материалы партнёр вправе видеть. */
export async function partnerMaterialCompanyIds(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<string[]> {
  if (!session.partnerId) return [];
  const scopeOrgIds = session.assignedOrgIds ?? [];
  const orgs = await prisma.organization.findMany({
    where: {
      partnerId: session.partnerId,
      companyId: { not: null },
      ...(scopeOrgIds.length > 0 ? { id: { in: scopeOrgIds } } : {}),
    },
    select: { companyId: true },
  });
  return Array.from(new Set(orgs.map((o) => o.companyId).filter((c): c is string => c !== null)));
}

/** Единый фильтр видимости — им живут и список, и скачивание. */
export function partnerMaterialsWhere(companyIds: string[]): Prisma.PartnerMaterialWhereInput {
  return {
    companyId: { in: companyIds },
    isActive: true,
    publishedAt: { not: null },
    OR: [
      { externalUrl: { not: null } },
      { files: { some: { supersededAt: null, scanStatus: 'clean' } } },
    ],
  };
}

export async function listPartnerMaterials(
  prisma: PrismaClient,
  session: SessionPayload,
  opts: { q?: string | undefined; now?: Date | undefined } = {}
): Promise<PartnerMaterialRow[]> {
  const companyIds = await partnerMaterialCompanyIds(prisma, session);
  if (companyIds.length === 0) return [];
  const q = opts.q?.trim();
  const rows = await prisma.partnerMaterial.findMany({
    where: {
      ...partnerMaterialsWhere(companyIds),
      ...(q
        ? {
            // `AND` — чтобы поиск не спорил с `OR` видимости.
            AND: [
              {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { description: { contains: q, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' }],
    take: 200,
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      companyId: true,
      externalUrl: true,
      publishedAt: true,
      updatedAt: true,
      company: { select: { name: true } },
      files: {
        where: { supersededAt: null, scanStatus: 'clean' },
        take: 1,
        select: { fileName: true, mimeType: true, size: true },
      },
    },
  });
  const now = opts.now ?? new Date();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    companyId: r.companyId,
    companyName: r.company.name,
    externalUrl: r.externalUrl,
    file: r.files[0] ?? null,
    // `publishedAt` в фильтре `not null` — строка без даты сюда не попадает.
    publishedAt: r.publishedAt ?? r.updatedAt,
    updatedAt: r.updatedAt,
    isNew: isNewMaterial(r.publishedAt, now),
  }));
}

/**
 * Файл к скачиванию: тот же скоуп, что у списка, только `clean`-версия.
 * Каждое скачивание — аудит «кто, что» (`partner_material_downloaded`);
 * подписанную ссылку выдаёт роут, здесь — только право и путь.
 */
export async function getPartnerMaterialForDownload(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<
  | { ok: true; path: string; fileName: string; mimeType: string }
  | { ok: false; error: 'not_found' | 'no_file' }
> {
  const companyIds = await partnerMaterialCompanyIds(prisma, session);
  if (companyIds.length === 0) return { ok: false, error: 'not_found' };
  const m = await prisma.partnerMaterial.findFirst({
    where: { AND: [{ id }, partnerMaterialsWhere(companyIds)] },
    select: {
      id: true,
      externalUrl: true,
      files: {
        where: { supersededAt: null, scanStatus: 'clean' },
        take: 1,
        select: { id: true, path: true, fileName: true, mimeType: true },
      },
    },
  });
  if (!m) return { ok: false, error: 'not_found' };
  const file = m.files[0];
  if (!file) return { ok: false, error: 'no_file' };
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'partner_material_downloaded',
    entity: 'partner_material',
    entityId: m.id,
    after: {
      // Недостижимо: без `partnerId` список компаний пуст и функция вышла выше
      // с `not_found`; `?? null` оставлен как страховка типа.
      /* v8 ignore next */
      partnerId: session.partnerId ?? null,
      fileId: file.id,
      fileName: file.fileName,
    },
  });
  return { ok: true, path: file.path, fileName: file.fileName, mimeType: file.mimeType };
}
