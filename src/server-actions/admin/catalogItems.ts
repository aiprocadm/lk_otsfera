'use server';

import { revalidatePath } from 'next/cache';
import type { CatalogUnit } from '@prisma/client';
import { str } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import {
  CATALOG_UNIT_LABELS,
  createCatalogItem,
  setCatalogItemActive,
  updateCatalogItem,
  type CatalogItemInput,
} from '@/lib/services/admin/catalogItems';

/**
 * Этап 5 (`У-136`) — server-actions каталога услуг. Тонкие адаптеры §3.
 *
 * Гард — `requireSettingsSection('catalogs.priceList', cabinet)` в КАЖДОМ
 * действии (канон соседей по хабу: правила уведомлений, тексты писем):
 * профиль доступа с размеченными `settings.*`-кодами режет и мутации, а не
 * только карточку хаба — скрытая карточка это внешний вид, а не защита
 * (§2b). Границу компании руководителя дополнительно держит сервис.
 */

export type CatalogActionResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' | 'duplicate_code' | 'validation'; messages?: string[] };

function revalidate() {
  revalidatePath('/admin/settings');
  revalidatePath('/leader/settings');
}

function inputFrom(fd: FormData): CatalogItemInput {
  const unitRaw = str(fd, 'unit');
  const unit = (
    Object.keys(CATALOG_UNIT_LABELS).includes(unitRaw) ? unitRaw : 'person'
  ) as CatalogUnit;
  const vatRaw = str(fd, 'vatRate');
  return {
    name: str(fd, 'name'),
    code: str(fd, 'code'),
    unit,
    price: str(fd, 'price'),
    // 'none' из селекта = «не облагается» → null.
    vatRate: vatRaw === 'none' || vatRaw === '' ? null : vatRaw,
    vatIncluded: str(fd, 'vatIncluded') === 'on',
    directionId: str(fd, 'directionId') || null,
    description: str(fd, 'description') || null,
    sortOrder: Number(str(fd, 'sortOrder') || '0'),
  };
}

export async function createCatalogItemAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<CatalogActionResult> {
  const session = await requireSettingsSection('catalogs.priceList', cabinet);
  const companyId = str(fd, 'companyId');
  if (!companyId) return { ok: false, error: 'validation', messages: ['Не выбрана компания'] };
  const res = await createCatalogItem(prisma, session, companyId, inputFrom(fd));
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function updateCatalogItemAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<CatalogActionResult> {
  const session = await requireSettingsSection('catalogs.priceList', cabinet);
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation', messages: ['Нет идентификатора услуги'] };
  const res = await updateCatalogItem(prisma, session, id, inputFrom(fd));
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function setCatalogItemActiveAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<CatalogActionResult> {
  const session = await requireSettingsSection('catalogs.priceList', cabinet);
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation', messages: ['Нет идентификатора услуги'] };
  const res = await setCatalogItemActive(prisma, session, id, str(fd, 'active') === '1');
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}
