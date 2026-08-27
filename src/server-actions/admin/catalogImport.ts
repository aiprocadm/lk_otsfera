'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import { IMPORT_MAX_FILE_MB } from '@/lib/config/import-limits';
import { listAllDirectionOptions } from '@/lib/services/training/directions';
import {
  importCatalogItems,
  parseCatalogWorkbook,
  previewCatalogImport,
  type CatalogImportRow,
} from '@/lib/services/admin/catalogExcel';

/**
 * `У-137` — server-actions двухшагового импорта каталога. Гард раздела в
 * каждом действии (урок PR-1: `requireSession`-only пропускал default-deny
 * профиль). Разобранные строки едут клиенту и возвращаются на шаге 2 —
 * файл не перечитывается, подтверждается ровно то, что человек видел
 * (эталон — импорт сотрудников).
 */

export type CatalogPreviewResult =
  | {
      ok: true;
      rows: CatalogImportRow[];
      willCreate: number;
      willUpdate: number;
      errors: string[];
    }
  | { ok: false; errors: string[] };

export async function previewCatalogImportAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<CatalogPreviewResult> {
  const session = await requireSettingsSection('catalogs.priceList', cabinet);

  const companyId = String(fd.get('companyId') ?? '');
  const file = fd.get('file');
  if (!companyId || !(file instanceof File)) {
    return { ok: false, errors: ['Выберите файл и компанию.'] };
  }
  if (file.size > IMPORT_MAX_FILE_MB * 1024 * 1024) {
    return { ok: false, errors: [`Файл больше ${IMPORT_MAX_FILE_MB} МБ — разбейте на части.`] };
  }

  // Все направления, включая неактивные, — иначе round-trip выгрузки с
  // деактивированным направлением падал бы ошибкой строки.
  const directions = await listAllDirectionOptions(prisma);
  const parsed = await parseCatalogWorkbook(await file.arrayBuffer(), directions);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const res = await previewCatalogImport(prisma, session, { companyId, rows: parsed.rows });
  if (!res.ok) return { ok: false, errors: ['Нет прав изменять каталог этой компании.'] };

  return {
    ok: true,
    rows: parsed.rows,
    willCreate: res.preview.toCreate.length,
    willUpdate: res.preview.toUpdate.length,
    errors: [...parsed.errors, ...res.preview.errors],
  };
}

export async function commitCatalogImportAction(
  cabinet: SettingsCabinet,
  companyId: string,
  rows: CatalogImportRow[]
): Promise<{ ok: true; created: number; updated: number } | { ok: false; error: string }> {
  const session = await requireSettingsSection('catalogs.priceList', cabinet);

  const res = await importCatalogItems(prisma, session, { companyId, rows });
  if (!res.ok) return { ok: false, error: 'Нет прав изменять каталог этой компании.' };

  revalidatePath('/admin/settings');
  revalidatePath('/leader/settings');
  return res;
}
