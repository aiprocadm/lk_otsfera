'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { saveSettings, type SaveEntry, type SettingKey } from '@/lib/config/integrationSettings';
import { resetIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Политики входа (`У-129`).
 *
 * Срок жизни кода из письма, число попыток, лимиты входа и сроки ссылок были
 * константами в коде и переменными сервера: чтобы дать людям больше минуты на
 * ввод кода, требовалась выкладка.
 *
 * Раздел **платформенный** — вход один на всю систему, компанийского уровня у
 * него нет.
 */

export type LoginPoliciesResult =
  { ok: true } | { ok: false; error: 'value_out_of_range' | 'secrets_key_missing' | 'validation' };

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

/**
 * Границы. Смысл не в «красивых числах», а в том, что за ними вход ломается:
 * ноль попыток — никто не войдёт, сутки на ввод кода из письма — код перестаёт
 * быть одноразовым по смыслу.
 */
export const LOGIN_POLICY_FIELDS: Array<{
  field: string;
  key: SettingKey;
  label: string;
  hint: string;
  min: number;
  max: number;
}> = [
  {
    field: 'login_twoFactorCodeTtlMinutes',
    key: 'login.twoFactorCodeTtlMinutes',
    label: 'Код из письма живёт, минут',
    hint: 'по умолчанию 10',
    min: 1,
    max: 60,
  },
  {
    field: 'login_twoFactorMaxAttempts',
    key: 'login.twoFactorMaxAttempts',
    label: 'Попыток ввести код',
    hint: 'по умолчанию 5',
    min: 1,
    max: 20,
  },
  {
    field: 'login_backupCodesCount',
    key: 'login.backupCodesCount',
    label: 'Резервных кодов выдаётся',
    hint: 'по умолчанию 10',
    min: 4,
    max: 30,
  },
  {
    field: 'login_rateLimitMax',
    key: 'login.rateLimitMax',
    label: 'Попыток входа за окно',
    hint: 'по умолчанию 10',
    min: 3,
    max: 100,
  },
  {
    field: 'login_rateLimitWindowMs',
    key: 'login.rateLimitWindowMs',
    label: 'Окно подсчёта попыток, мс',
    hint: 'по умолчанию 60000',
    min: 10_000,
    max: 3_600_000,
  },
  {
    field: 'login_inviteTtlDays',
    key: 'login.inviteTtlDays',
    label: 'Приглашение действует, дней',
    hint: 'по умолчанию 7',
    min: 1,
    max: 90,
  },
  {
    field: 'login_resetTtlHours',
    key: 'login.resetTtlHours',
    label: 'Ссылка сброса пароля живёт, часов',
    hint: 'по умолчанию 2',
    min: 1,
    max: 72,
  },
];

export async function saveLoginPoliciesAction(fd: FormData): Promise<LoginPoliciesResult> {
  const session = await requireSettingsSection('security.loginPolicies', 'admin');

  const entries: SaveEntry[] = [];
  for (const f of LOGIN_POLICY_FIELDS) {
    const raw = readField(fd, f.field).trim();
    if (raw === '') {
      // Пусто — «вернуть значение сервера или стандартное».
      entries.push({ key: f.key, clear: true });
      continue;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < f.min || parsed > f.max) {
      return { ok: false, error: 'value_out_of_range' };
    }
    entries.push({ key: f.key, value: String(parsed) });
  }

  const res = await saveSettings(prisma, session.sub, entries);
  if (!res.ok) return res;

  resetIntegrationSettingsCache();
  await recordAudit(prisma, {
    action: 'login_policies_changed',
    entity: 'login_policies',
    entityId: 'platform',
    userId: session.sub,
  });
  revalidatePath('/admin/settings/security/login-policies');
  return { ok: true };
}
