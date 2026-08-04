import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { FeatureFlagsMatrix } from '@/components/admin/feature-flags-matrix';

export const metadata: Metadata = { title: 'Флаги функциональности · Настройки' };

/** Read-only матрица feature-флагов (ФТ-14.6). Переехала с /admin/settings в хаб. */
export default async function AdminFeatureFlagsPage() {
  await requireSettingsSection('system.featureFlags', 'admin');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#111111]">Флаги функциональности</h1>
      <FeatureFlagsMatrix />
    </div>
  );
}
