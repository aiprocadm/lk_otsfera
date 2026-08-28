'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { saveSettings, type SaveEntry } from '@/lib/config/integrationSettings';
import { LOGIN_POLICY_FIELDS } from '@/lib/auth/loginPolicyFields';
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
