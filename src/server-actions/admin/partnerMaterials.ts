'use server';

import { revalidatePath } from 'next/cache';
import { str } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import {
  publishMaterial,
  unpublishMaterial,
  updateMaterial,
} from '@/lib/services/partnerMaterials/hub';
import { parseMaterialCategory } from '@/lib/services/partnerMaterials/categories';

/**
 * `У-237` — действия хаба «Материалы для партнёров»: правка, публикация,
 * снятие. Гард раздела в каждом действии, граница компании — в сервисе.
 * Загрузка и замена файла — НЕ здесь: файлы идут API-роутами
 * `/api/partner-materials` (§11 CLAUDE.md — bodySizeLimit server actions).
 */
export type PartnerMaterialActionResult =
  | { ok: true }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'validation' | 'not_ready' | 'infected';
      messages?: string[];
    };

function revalidate() {
  revalidatePath('/admin/settings/processes/partner-materials');
  revalidatePath('/leader/settings/processes/partner-materials');
}

export async function updatePartnerMaterialAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<PartnerMaterialActionResult> {
  const session = await requireSettingsSection('catalogs.partnerMaterials', cabinet);
  const id = str(fd, 'id');
  const category = parseMaterialCategory(str(fd, 'category'));
  if (!id || !category) {
    return { ok: false, error: 'validation', messages: ['Не хватает данных формы.'] };
  }
  const sortRaw = str(fd, 'sortOrder');
  const sortOrder = sortRaw === '' ? undefined : Number(sortRaw);
  const res = await updateMaterial(prisma, session, id, {
    title: str(fd, 'title'),
    description: str(fd, 'description'),
    category,
    externalUrl: str(fd, 'externalUrl'),
    ...(sortOrder !== undefined && Number.isFinite(sortOrder) ? { sortOrder } : {}),
  });
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function publishPartnerMaterialAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<PartnerMaterialActionResult> {
  const session = await requireSettingsSection('catalogs.partnerMaterials', cabinet);
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation', messages: ['Не хватает данных формы.'] };
  const res = await publishMaterial(prisma, session, id);
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function unpublishPartnerMaterialAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<PartnerMaterialActionResult> {
  const session = await requireSettingsSection('catalogs.partnerMaterials', cabinet);
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation', messages: ['Не хватает данных формы.'] };
  const res = await unpublishMaterial(prisma, session, id);
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}
