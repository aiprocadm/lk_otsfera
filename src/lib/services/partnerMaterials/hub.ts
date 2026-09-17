import type { PartnerMaterialCategory, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { getObjectStorage } from '@/lib/storage';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';
import { guardCompany } from '@/lib/services/admin/companyBranding';
import { notifyPartnerMaterialPublished } from '@/lib/notifications/partnerMaterials';
import {
  isValidExternalUrl,
  materialStoragePath,
  validateMaterialFile,
  type MaterialFileInput,
} from './shared';

/**
 * Материалы для партнёров — сторона издателя (`У-237`, `Р-Э6-3`): хаб
 * «Конфигурация процессов → Материалы для партнёров» у администратора и
 * руководителя. Граница компании — `guardCompany` (админ — любая,
 * руководитель — своя), как у оформления документов.
 *
 * Файл живёт в своей таблице версий, а не в `Document`: документ — это бумага
 * по клиенту, и попал бы в «Общие документы» сотрудников и в потоки клиентских
 * документов. Замена файла — новая версия, прежняя скрывается (`supersededAt`),
 * не удаляется. Публикация — только когда действующий файл `clean`.
 */
type HubMaterialFile = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  scanStatus: string;
  scanReason: string | null;
};

type HubMaterialDownload = { userName: string; at: Date };

export type HubMaterialRow = {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  description: string | null;
  category: PartnerMaterialCategory;
  externalUrl: string | null;
  isActive: boolean;
  publishedAt: Date | null;
  sortOrder: number;
  updatedAt: Date;
  updatedByName: string;
  file: HubMaterialFile | null;
  downloadsCount: number;
  /** Последние скачивания — «кто скачал» в хабе. */
  downloads: HubMaterialDownload[];
};

type Forbidden = { ok: false; error: 'forbidden' };
type NotFound = { ok: false; error: 'not_found' };
type Validation = { ok: false; error: 'validation'; messages: string[] };
type FileError = { ok: false; error: 'too_large' | 'invalid_mime' | 'storage' };

type MaterialInput = {
  title: string;
  description?: string | null | undefined;
  category: PartnerMaterialCategory;
  externalUrl?: string | null | undefined;
  sortOrder?: number | undefined;
};

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const DOWNLOADS_SHOWN = 10;

function validateInput(input: MaterialInput): string[] {
  const messages: string[] = [];
  const title = input.title.trim();
  if (title.length === 0) messages.push('Название обязательно.');
  if (title.length > TITLE_MAX) messages.push(`Название длиннее ${TITLE_MAX} символов.`);
  if ((input.description ?? '').length > DESCRIPTION_MAX) {
    messages.push(`Описание длиннее ${DESCRIPTION_MAX} символов.`);
  }
  if (input.externalUrl && !isValidExternalUrl(input.externalUrl)) {
    messages.push('Ссылка должна начинаться с http:// или https://.');
  }
  return messages;
}

const FILE_SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  size: true,
  scanStatus: true,
  scanReason: true,
} as const;

/** Материалы компании для хаба, с действующим файлом и последними скачиваниями. */
export async function listHubMaterials(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string
): Promise<{ ok: true; rows: HubMaterialRow[] } | Forbidden> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;

  const materials = await prisma.partnerMaterial.findMany({
    where: { companyId },
    orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      companyId: true,
      title: true,
      description: true,
      category: true,
      externalUrl: true,
      isActive: true,
      publishedAt: true,
      sortOrder: true,
      updatedAt: true,
      company: { select: { name: true } },
      updatedBy: { select: { name: true } },
      files: { where: { supersededAt: null }, take: 1, select: FILE_SELECT },
    },
  });
  if (materials.length === 0) return { ok: true, rows: [] };

  // «Кто скачал» — из журнала аудита: скачивание пишет `partner_material_downloaded`
  // по id материала; отдельной таблицы не заводим.
  const ids = materials.map((m) => m.id);
  const [counts, recent] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ['entityId'],
      where: { action: 'partner_material_downloaded', entityId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.auditLog.findMany({
      where: { action: 'partner_material_downloaded', entityId: { in: ids } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ids.length * DOWNLOADS_SHOWN,
      select: { entityId: true, createdAt: true, user: { select: { name: true } } },
    }),
  ]);
  const countById = new Map(counts.map((c) => [c.entityId, c._count._all]));
  const downloadsById = new Map<string, HubMaterialDownload[]>();
  for (const r of recent) {
    const list = downloadsById.get(r.entityId) ?? [];
    if (list.length >= DOWNLOADS_SHOWN) continue;
    list.push({ userName: r.user.name, at: r.createdAt });
    downloadsById.set(r.entityId, list);
  }

  return {
    ok: true,
    rows: materials.map((m) => ({
      id: m.id,
      companyId: m.companyId,
      companyName: m.company.name,
      title: m.title,
      description: m.description,
      category: m.category,
      externalUrl: m.externalUrl,
      isActive: m.isActive,
      publishedAt: m.publishedAt,
      sortOrder: m.sortOrder,
      updatedAt: m.updatedAt,
      updatedByName: m.updatedBy.name,
      file: m.files[0] ?? null,
      downloadsCount: countById.get(m.id) ?? 0,
      downloads: downloadsById.get(m.id) ?? [],
    })),
  };
}

async function storeFile(
  companyId: string,
  file: MaterialFileInput
): Promise<{ ok: true; path: string } | FileError> {
  const valid = validateMaterialFile(file);
  if (!valid.ok) return valid;
  const path = materialStoragePath(companyId, file.name);
  try {
    await getObjectStorage().upload(path, file.buffer, { contentType: file.mimeType });
  } catch (e) {
    log.error('[partnerMaterials] upload failed', {
      companyId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: 'storage' };
  }
  return { ok: true, path };
}

/** Best-effort антивирус — как у документов: сбой очереди оставляет `pending`. */
async function enqueueScan(fileId: string): Promise<void> {
  try {
    const payload: ScanDocumentPayload = { kind: 'partner_material', id: fileId };
    await getQueue('docs.scanDocument').add('scan', payload);
  } catch (err) {
    log.warn('[partnerMaterials] enqueue scan failed', {
      fileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Новый материал — черновик: файл уходит на проверку, публикует человек
 * отдельной кнопкой, когда файл `clean` (или материал — ссылка).
 * Ровно одно из двух: файл или ссылка.
 */
export async function createMaterial(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string,
  input: MaterialInput,
  file: MaterialFileInput | null
): Promise<{ ok: true; id: string } | Forbidden | NotFound | Validation | FileError> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;
  const messages = validateInput(input);
  const url = input.externalUrl?.trim() || null;
  if (!file && !url) messages.push('Приложите файл или укажите ссылку.');
  if (file && url) messages.push('Либо файл, либо ссылка — не оба сразу.');
  if (messages.length) return { ok: false, error: 'validation', messages };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!company) return { ok: false, error: 'not_found' };

  let stored: { ok: true; path: string } | null = null;
  if (file) {
    const res = await storeFile(companyId, file);
    if (!res.ok) return res;
    stored = res;
  }

  const material = await prisma.partnerMaterial.create({
    data: {
      companyId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      externalUrl: url,
      sortOrder: input.sortOrder ?? 0,
      updatedById: session.sub,
      ...(file && stored
        ? {
            files: {
              create: {
                path: stored.path,
                fileName: file.name,
                mimeType: file.mimeType,
                size: file.size,
                uploadedById: session.sub,
              },
            },
          }
        : {}),
    },
    select: { id: true, files: { select: { id: true } } },
  });
  const fileRow = material.files[0];
  if (fileRow) await enqueueScan(fileRow.id);

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'partner_material_created',
    entity: 'partner_material',
    entityId: material.id,
    after: {
      companyId,
      title: input.title.trim(),
      category: input.category,
      externalUrl: url,
      fileName: file?.name ?? null,
    },
  });
  return { ok: true, id: material.id };
}

async function loadOwned(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<
  | {
      ok: true;
      material: {
        id: string;
        companyId: string;
        title: string;
        isActive: boolean;
        publishedAt: Date | null;
        externalUrl: string | null;
        file: { id: string; path: string; scanStatus: string } | null;
      };
    }
  | Forbidden
  | NotFound
> {
  const m = await prisma.partnerMaterial.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      title: true,
      isActive: true,
      publishedAt: true,
      externalUrl: true,
      files: {
        where: { supersededAt: null },
        take: 1,
        select: { id: true, path: true, scanStatus: true },
      },
    },
  });
  if (!m) return { ok: false, error: 'not_found' };
  const denied = guardCompany(session, m.companyId);
  if (denied) return denied;
  return { ok: true, material: { ...m, file: m.files[0] ?? null } };
}

/** Правка описания: название, описание, категория, порядок, ссылка (у материала-ссылки). */
export async function updateMaterial(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  input: MaterialInput
): Promise<{ ok: true } | Forbidden | NotFound | Validation> {
  const owned = await loadOwned(prisma, session, id);
  if (!owned.ok) return owned;
  const messages = validateInput(input);
  const url = input.externalUrl?.trim() || null;
  // Ссылка есть только у материала без файла; у файлового её не завести.
  if (owned.material.file && url) messages.push('У материала с файлом ссылки не бывает.');
  if (!owned.material.file && !url) messages.push('У материала без файла ссылка обязательна.');
  if (messages.length) return { ok: false, error: 'validation', messages };

  await prisma.partnerMaterial.update({
    where: { id },
    data: {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      externalUrl: url,
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedById: session.sub,
    },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'partner_material_updated',
    entity: 'partner_material',
    entityId: id,
    before: { title: owned.material.title },
    after: { title: input.title.trim(), category: input.category, externalUrl: url },
  });
  return { ok: true };
}

/** Замена файла: новая версия на проверку, прежняя скрывается (история), не удаляется. */
export async function replaceMaterialFile(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  file: MaterialFileInput
): Promise<{ ok: true; fileId: string } | Forbidden | NotFound | Validation | FileError> {
  const owned = await loadOwned(prisma, session, id);
  if (!owned.ok) return owned;
  if (owned.material.externalUrl) {
    return { ok: false, error: 'validation', messages: ['Это материал-ссылка: файла у него нет.'] };
  }
  const stored = await storeFile(owned.material.companyId, file);
  if (!stored.ok) return stored;

  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    await tx.partnerMaterialFile.updateMany({
      where: { materialId: id, supersededAt: null },
      data: { supersededAt: now },
    });
    const row = await tx.partnerMaterialFile.create({
      data: {
        materialId: id,
        path: stored.path,
        fileName: file.name,
        mimeType: file.mimeType,
        size: file.size,
        uploadedById: session.sub,
      },
      select: { id: true },
    });
    await tx.partnerMaterial.update({ where: { id }, data: { updatedById: session.sub } });
    return row;
  });
  await enqueueScan(created.id);
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'partner_material_file_replaced',
    entity: 'partner_material',
    entityId: id,
    before: { fileId: owned.material.file?.id ?? null },
    after: { fileId: created.id, fileName: file.name, size: file.size },
  });
  return { ok: true, fileId: created.id };
}

/**
 * Публикация: материал становится видим партнёрам. Только при `clean`-файле
 * (или у материала-ссылки); `pending` — «ещё проверяется», `infected` —
 * отказ. Первая публикация рассылает уведомление партнёрам-читателям.
 */
export async function publishMaterial(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true } | Forbidden | NotFound | { ok: false; error: 'not_ready' | 'infected' }> {
  const owned = await loadOwned(prisma, session, id);
  if (!owned.ok) return owned;
  const { material } = owned;
  if (!material.externalUrl) {
    if (!material.file || material.file.scanStatus === 'pending') {
      return { ok: false, error: 'not_ready' };
    }
    if (material.file.scanStatus !== 'clean') return { ok: false, error: 'infected' };
  }
  const first = material.publishedAt === null;
  await prisma.partnerMaterial.update({
    where: { id },
    data: {
      isActive: true,
      ...(first ? { publishedAt: new Date() } : {}),
      updatedById: session.sub,
    },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'partner_material_published',
    entity: 'partner_material',
    entityId: id,
    after: { title: material.title, firstPublication: first },
  });
  // Уведомление — следствие публикации, не её условие: сбой рассылки не откатывает.
  if (first) {
    try {
      await notifyPartnerMaterialPublished(prisma, id);
    } catch (err) {
      log.warn('[partnerMaterials] publish notify failed', {
        materialId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ok: true };
}

/** Снятие с публикации: у партнёра материал исчезает, история и файлы остаются. */
export async function unpublishMaterial(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true } | Forbidden | NotFound> {
  const owned = await loadOwned(prisma, session, id);
  if (!owned.ok) return owned;
  await prisma.partnerMaterial.update({
    where: { id },
    data: { isActive: false, updatedById: session.sub },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'partner_material_unpublished',
    entity: 'partner_material',
    entityId: id,
    after: { title: owned.material.title },
  });
  return { ok: true };
}
