'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { recordAudit } from '@/lib/auth/audit';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import {
  createAutomationRule,
  updateAutomationRule,
  toggleAutomationRule,
  deleteAutomationRule,
  type AutomationRuleInput,
  type AutomationRuleError,
} from '@/lib/services/automation/rules';

/**
 * Правка правил автоматизации (`У-222`).
 *
 * **Область действия определяет роль, а не форма.** Руководитель правит правила
 * своей компании — идентификатор берётся из сессии. Администратор работает со
 * всеми компаниями и потому выбирает компанию явно, но выбранное значение
 * проверяется по базе: строка из формы сама по себе ничего не открывает.
 *
 * Отличие от правил уведомлений (`У-127`): там `companyId = null` означает
 * «правило платформы». Здесь платформенных правил НЕТ — робот, создающий задачи
 * сразу во всех компаниях, это не функция, а происшествие. Поэтому у
 * администратора без выбранной компании действие отвечает `company_required`,
 * а не «правлю платформу».
 */

export type AutomationActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: AutomationRuleError | 'company_required' | 'builtin'; unknown?: string[] };

const SECTION = 'catalogs.automation' as const;

function pathFor(cabinet: SettingsCabinet): string {
  return `/${cabinet}/settings/processes/automation`;
}

/**
 * Чьи правила правим.
 *
 * Руководитель без компании не правит ничего: пустая область означала бы
 * «правлю чужое», то есть тихое повышение прав.
 */
async function scopeOf(
  cabinet: SettingsCabinet,
  session: { companyId?: string | null },
  companyIdFromForm: string | null
): Promise<{ ok: true; companyId: string } | { ok: false }> {
  if (cabinet === 'leader') {
    const companyId = session.companyId ?? null;
    return companyId ? { ok: true, companyId } : { ok: false };
  }
  // admin: компания приходит из формы, но существование проверяет база.
  if (!companyIdFromForm) return { ok: false };
  const company = await prisma.company.findUnique({
    where: { id: companyIdFromForm },
    select: { id: true },
  });
  return company ? { ok: true, companyId: company.id } : { ok: false };
}

export async function createAutomationRuleAction(
  cabinet: SettingsCabinet,
  companyId: string | null,
  input: AutomationRuleInput
): Promise<AutomationActionResult> {
  const session = await requireSettingsSection(SECTION, cabinet);
  const scope = await scopeOf(cabinet, session, companyId);
  if (!scope.ok) return { ok: false, error: 'company_required' };

  const res = await createAutomationRule(prisma, {
    companyId: scope.companyId,
    authorId: session.sub,
    input,
  });
  if (!res.ok) return res;

  await recordAudit(prisma, {
    action: 'automation_rule_created',
    entity: 'automation_rule',
    entityId: res.id,
    userId: session.sub,
    after: { name: input.name, trigger: input.trigger, companyId: scope.companyId },
  });
  revalidatePath(pathFor(cabinet));
  return { ok: true, id: res.id };
}

export async function updateAutomationRuleAction(
  cabinet: SettingsCabinet,
  companyId: string | null,
  ruleId: string,
  input: AutomationRuleInput
): Promise<AutomationActionResult> {
  const session = await requireSettingsSection(SECTION, cabinet);
  const scope = await scopeOf(cabinet, session, companyId);
  if (!scope.ok) return { ok: false, error: 'company_required' };

  const res = await updateAutomationRule(prisma, {
    companyId: scope.companyId,
    authorId: session.sub,
    ruleId,
    input,
  });
  if (!res.ok) return res;

  await recordAudit(prisma, {
    action: 'automation_rule_updated',
    entity: 'automation_rule',
    entityId: ruleId,
    userId: session.sub,
    after: { name: input.name, trigger: input.trigger },
  });
  revalidatePath(pathFor(cabinet));
  return { ok: true, id: ruleId };
}

export async function toggleAutomationRuleAction(
  cabinet: SettingsCabinet,
  companyId: string | null,
  ruleId: string,
  isActive: boolean
): Promise<AutomationActionResult> {
  const session = await requireSettingsSection(SECTION, cabinet);
  const scope = await scopeOf(cabinet, session, companyId);
  if (!scope.ok) return { ok: false, error: 'company_required' };

  const res = await toggleAutomationRule(prisma, {
    companyId: scope.companyId,
    authorId: session.sub,
    ruleId,
    isActive,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // Включение и выключение робота — событие для расследования: по журналу
  // видно, с какого момента правило начало ставить задачи.
  await recordAudit(prisma, {
    action: isActive ? 'automation_rule_enabled' : 'automation_rule_disabled',
    entity: 'automation_rule',
    entityId: ruleId,
    userId: session.sub,
    after: { isActive },
  });
  revalidatePath(pathFor(cabinet));
  return { ok: true, id: ruleId };
}

export async function deleteAutomationRuleAction(
  cabinet: SettingsCabinet,
  companyId: string | null,
  ruleId: string
): Promise<AutomationActionResult> {
  const session = await requireSettingsSection(SECTION, cabinet);
  const scope = await scopeOf(cabinet, session, companyId);
  if (!scope.ok) return { ok: false, error: 'company_required' };

  const res = await deleteAutomationRule(prisma, { companyId: scope.companyId, ruleId });
  if (!res.ok) return { ok: false, error: res.error };

  await recordAudit(prisma, {
    action: 'automation_rule_deleted',
    entity: 'automation_rule',
    entityId: ruleId,
    userId: session.sub,
  });
  revalidatePath(pathFor(cabinet));
  return { ok: true, id: ruleId };
}
