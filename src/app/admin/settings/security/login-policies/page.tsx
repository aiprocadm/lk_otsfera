import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { getSettingsView } from '@/lib/config/integrationSettings';
import { PageHeader } from '@/components/ui/page-header';
import { LoginPoliciesForm } from '@/components/settings/login-policies-form';
import { saveLoginPoliciesAction } from '@/server-actions/admin/loginPolicies';
import { LOGIN_POLICY_FIELDS } from '@/lib/auth/loginPolicyFields';

export const metadata: Metadata = { title: 'Политики входа · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Безопасность → Политики входа» (`У-129`). Раздел платформенный: вход один
 * на всю систему, компанийского уровня у него нет.
 */
export default async function AdminLoginPoliciesPage() {
  await requireSettingsSection('security.loginPolicies', 'admin');

  const view = await getSettingsView(
    prisma,
    LOGIN_POLICY_FIELDS.map((f) => f.key)
  ).catch(() => []);

  const values: Record<string, string> = {};
  for (const f of LOGIN_POLICY_FIELDS) {
    values[f.field] = view.find((r) => r.key === f.key)?.value ?? '';
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Политики входа"
        subtitle="Сколько живёт код из письма, сколько попыток даётся и как долго действуют ссылки приглашения и сброса пароля."
      />
      <LoginPoliciesForm
        fields={LOGIN_POLICY_FIELDS.map((f) => ({
          field: f.field,
          label: f.label,
          hint: f.hint,
          min: f.min,
          max: f.max,
        }))}
        values={values}
        action={saveLoginPoliciesAction}
      />
    </div>
  );
}
