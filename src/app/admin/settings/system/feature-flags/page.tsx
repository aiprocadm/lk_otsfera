import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { listFeatureFlags } from '@/lib/services/admin/featureFlags';
import { FeatureFlagsMatrix } from '@/components/admin/feature-flags-matrix';

export const metadata: Metadata = { title: 'Флаги функциональности · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * Управление функциями платформы (`У-65`…`У-68`). До этапа 8 экран был
 * read-only: значения жили только в переменных окружения.
 */
export default async function AdminFeatureFlagsPage() {
  const session = await requireSettingsSection('system.featureFlags', 'admin');
  const res = await listFeatureFlags(prisma, session);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Функции платформы</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Что включено в системе и кто это менял — здесь же можно включить или выключить.
        </p>
      </div>
      {res.ok ? (
        <FeatureFlagsMatrix rows={res.rows} />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          Недостаточно прав для просмотра функций платформы.
        </p>
      )}
    </div>
  );
}
