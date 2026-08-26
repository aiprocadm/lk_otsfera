'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { NOTIFICATION_TYPES } from '@/lib/notifications/registry';
import { isKnownAudience, isRoutableChannel } from '@/lib/notifications/routing';
import { recordAudit } from '@/lib/auth/audit';
import type { SettingsCabinet } from '@/lib/navigation/settings';

/**
 * Правка правил маршрутизации уведомлений (`У-127`).
 *
 * **Область действия определяет роль, а не форма.** Администратор правит
 * платформу (`companyId = null`), руководитель — свою компанию. Компанию берём
 * из сессии: если бы её присылала форма, руководитель одной компании мог бы
 * переписать правила другой.
 */

export type SaveRuleResult = { ok: true } | { ok: false; error: 'validation' | 'company_required' };

export type ResetRulesResult =
  { ok: true; removed: number } | { ok: false; error: 'company_required' };

function pathFor(cabinet: SettingsCabinet): string {
  return `/${cabinet}/settings/catalogs/notification-rules`;
}

/**
 * Область правки: `null` — платформа (админ), иначе своя компания.
 *
 * Руководитель без компании не правит ничего: пустая область означала бы
 * «правлю платформу», то есть тихое повышение прав.
 */
function scopeOf(
  cabinet: SettingsCabinet,
  session: { companyId?: string | null }
): { ok: true; companyId: string | null } | { ok: false } {
  if (cabinet === 'admin') return { ok: true, companyId: null };
  const companyId = session.companyId ?? null;
  if (!companyId) return { ok: false };
  return { ok: true, companyId };
}

export async function saveNotificationRuleAction(
  cabinet: SettingsCabinet,
  eventType: string,
  audience: string,
  channel: string,
  enabled: boolean
): Promise<SaveRuleResult> {
  const session = await requireSettingsSection('catalogs.notificationRules', cabinet);

  // Ключ сверяется с реестром: чужая строка из формы не должна создавать
  // правило о несуществующем событии — оно молча ни на что не влияло бы.
  if (!Object.hasOwn(NOTIFICATION_TYPES, eventType)) return { ok: false, error: 'validation' };
  if (!isKnownAudience(audience)) return { ok: false, error: 'validation' };
  if (!isRoutableChannel(channel)) return { ok: false, error: 'validation' };

  const scope = scopeOf(cabinet, session);
  if (!scope.ok) return { ok: false, error: 'company_required' };

  // «Найти и обновить», а не `upsert` по составному ключу: у платформенных
  // правил `companyId` равен NULL, а в Postgres два NULL не равны — составной
  // уникальный ключ их не различает. Уникальность платформенных правил держит
  // частичный индекс из миграции.
  const existing = await prisma.notificationRule.findFirst({
    where: { companyId: scope.companyId, eventType, audience, channel },
    select: { id: true },
  });
  if (existing) {
    await prisma.notificationRule.update({
      where: { id: existing.id },
      data: { enabled, updatedBy: session.sub },
    });
  } else {
    await prisma.notificationRule.create({
      data: {
        companyId: scope.companyId,
        eventType,
        audience,
        channel,
        enabled,
        updatedBy: session.sub,
      },
    });
  }

  await recordAudit(prisma, {
    action: 'notification_rule_changed',
    entity: 'notification_rule',
    entityId: `${eventType}:${audience}:${channel}`,
    userId: session.sub,
    after: { enabled, companyId: scope.companyId },
  });
  revalidatePath(pathFor(cabinet));
  return { ok: true };
}

/**
 * «Вернуть стандартные» — **удаляет** переопределения своей области, а не
 * записывает в них копию текущего кода. Иначе правила замёрзли бы: реестр в
 * коде менялся бы, а на экране осталась бы копия старого.
 */
export async function resetNotificationRulesAction(
  cabinet: SettingsCabinet
): Promise<ResetRulesResult> {
  const session = await requireSettingsSection('catalogs.notificationRules', cabinet);
  const scope = scopeOf(cabinet, session);
  if (!scope.ok) return { ok: false, error: 'company_required' };

  const res = await prisma.notificationRule.deleteMany({ where: { companyId: scope.companyId } });

  await recordAudit(prisma, {
    action: 'notification_rules_reset',
    entity: 'notification_rule',
    entityId: scope.companyId ?? 'platform',
    userId: session.sub,
    after: { removed: res.count },
  });
  revalidatePath(pathFor(cabinet));
  return { ok: true, removed: res.count };
}
