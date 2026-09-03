'use server';

import { revalidatePath } from 'next/cache';
import { str, type ActionResult } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import { updateOneCDocumentPushRule } from '@/lib/services/admin/oneCDocumentPushRule';

/**
 * `У-169` (этап 8) — server-action правила выгрузки документов в 1С. Гард
 * раздела здесь (урок PR-1/PR-2 этапа 5), граница компании — в сервисе.
 * Экран один у администратора и руководителя (правило зеркала) — кабинет
 * приходит параметром, как у соседних действий налогов и нумерации.
 */

export type OneCDocumentPushRuleActionResult = ActionResult<
  'forbidden' | 'not_found' | 'invalid_mode' | 'invalid_types' | 'validation'
>;

export async function setOneCDocumentPushRuleAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<OneCDocumentPushRuleActionResult> {
  const session = await requireSettingsSection('catalogs.requisites', cabinet);
  const companyId = str(fd, 'companyId');
  if (!companyId) return { ok: false, error: 'validation' };
  const res = await updateOneCDocumentPushRule(prisma, session, companyId, {
    mode: str(fd, 'mode'),
    types: fd.getAll('types').filter((v): v is string => typeof v === 'string'),
  });
  if (!res.ok) return res;
  revalidatePath('/admin/settings');
  revalidatePath('/leader/settings');
  return { ok: true };
}
