import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { StaffBackupCodesSection } from '@/components/settings/staff-backup-codes-section';
import { SecurityCard } from '@/components/settings/security-card';

export const metadata: Metadata = { title: 'Личная безопасность · Настройки' };

/**
 * Личная безопасность сотрудника: коды восстановления 2FA (под флагом
 * staff_2fa) и активные сессии. Переехало с общей страницы настроек в хаб.
 */
export default async function LeaderPersonalSecurityPage() {
  await requireSettingsSection('security.personal', 'leader');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#111111]">Личная безопасность</h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">Ваш пароль и вход по одноразовому коду</p>
      {isFeatureEnabled('staff_2fa') ? <StaffBackupCodesSection /> : null}
      <SecurityCard />
    </div>
  );
}
