'use server';

import { revalidatePath } from 'next/cache';
import type { CompanyBrandingSlot } from '@prisma/client';
import { str } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import {
  deleteCompanyBrandingAsset,
  setCompanyDocumentNumbering,
  setCompanyTaxSettings,
} from '@/lib/services/admin/companyBranding';

/**
 * `У-138` — server-actions налогов, нумерации и оформления компании.
 * Гард раздела в каждом действии (урок PR-1/PR-2); граница компании — в
 * сервисе. Загрузка изображений — НЕ здесь: файлы идут API-роутом
 * `/api/company/branding` (§11 CLAUDE.md — bodySizeLimit server actions).
 */

export type BrandingActionResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' | 'validation'; messages?: string[] };

function revalidate() {
  revalidatePath('/admin/settings');
  revalidatePath('/leader/settings');
}

export async function setCompanyTaxSettingsAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<BrandingActionResult> {
  const session = await requireSettingsSection('catalogs.requisites', cabinet);
  const companyId = str(fd, 'companyId');
  if (!companyId) return { ok: false, error: 'validation', messages: ['Не выбрана компания'] };
  const vatRaw = str(fd, 'defaultVatRate');
  const res = await setCompanyTaxSettings(prisma, session, companyId, {
    defaultVatRate: vatRaw === 'none' || vatRaw === '' ? null : vatRaw,
    pricesIncludeVat: str(fd, 'pricesIncludeVat') === 'on',
  });
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function setCompanyNumberingAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<BrandingActionResult> {
  const session = await requireSettingsSection('catalogs.requisites', cabinet);
  const companyId = str(fd, 'companyId');
  if (!companyId) return { ok: false, error: 'validation', messages: ['Не выбрана компания'] };
  const res = await setCompanyDocumentNumbering(prisma, session, companyId, {
    prefixes: {
      invoice: str(fd, 'prefixInvoice'),
      act: str(fd, 'prefixAct'),
      contract: str(fd, 'prefixContract'),
      supplementary: str(fd, 'prefixSupplementary'),
    },
    resetYearly: str(fd, 'resetYearly') === 'on',
  });
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function deleteCompanyBrandingAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<BrandingActionResult> {
  const session = await requireSettingsSection('catalogs.requisites', cabinet);
  const companyId = str(fd, 'companyId');
  const slot = str(fd, 'slot');
  if (!companyId || !['logo', 'signature', 'stamp'].includes(slot)) {
    return { ok: false, error: 'validation', messages: ['Не выбраны компания и слот'] };
  }
  const res = await deleteCompanyBrandingAsset(
    prisma,
    session,
    companyId,
    slot as CompanyBrandingSlot
  );
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}
