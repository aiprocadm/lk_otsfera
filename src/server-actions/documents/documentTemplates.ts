'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import { resetCompanyTemplate, saveCompanyTemplate } from '@/lib/services/documents/templates';

/**
 * Этап 6 (`У-160`) — серверные действия раздела «Шаблоны документов».
 *
 * Адаптер тонкий: форма входа здесь, границы компании — в сервисе.
 * `companyId` приходит из формы намеренно (администратор правит выбранную
 * компанию), и именно поэтому сервис его СРАВНИВАЕТ, а не подставляет: у
 * руководителя чужой id = отказ, а не тихая правка своей компании.
 *
 * **Право раздела проверяется здесь, а не только страницей.** Профиль доступа
 * может отнять у руководителя раздел «Шаблоны документов»: страница тогда
 * уводит его на `/forbidden`, но серверное действие вызывается и в обход
 * страницы. Без этой проверки урезанный профиль обходился бы прямым вызовом —
 * ровно тот случай, против которого написан §4 (защита на каждом слое, а не
 * на одном). Кабинет присылает страница: он определяет, какой набор прав
 * проверять, и подделать его нельзя — гард сверяет кабинет с ролью сессии.
 */

export type SaveTemplateResult = Awaited<ReturnType<typeof saveCompanyTemplate>>;
export type ResetTemplateResult = Awaited<ReturnType<typeof resetCompanyTemplate>>;

function field(fd: FormData, name: string): string {
  const value = fd.get(name);
  return typeof value === 'string' ? value : '';
}

export async function saveDocumentTemplateAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<SaveTemplateResult> {
  const session = await requireSettingsSection('catalogs.documentTemplates', cabinet);
  const res = await saveCompanyTemplate(prisma, session, {
    companyId: field(fd, 'companyId'),
    slot: field(fd, 'slot'),
    body: field(fd, 'body'),
  });
  if (res.ok) revalidatePath(`/${cabinet}/settings/catalogs/document-templates`);
  return res;
}

export async function resetDocumentTemplateAction(
  cabinet: SettingsCabinet,
  fd: FormData
): Promise<ResetTemplateResult> {
  const session = await requireSettingsSection('catalogs.documentTemplates', cabinet);
  const res = await resetCompanyTemplate(prisma, session, {
    companyId: field(fd, 'companyId'),
    slot: field(fd, 'slot'),
  });
  if (res.ok) revalidatePath(`/${cabinet}/settings/catalogs/document-templates`);
  return res;
}
