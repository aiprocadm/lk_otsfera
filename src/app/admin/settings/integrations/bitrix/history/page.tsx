import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { getSettingValues } from '@/lib/config/integrationSettings';
import { listBitrixHistory } from '@/lib/services/bitrix/history';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { BitrixBatchStarter } from '@/components/bitrix/batch-starter';
import { BatchList } from '@/components/bitrix/batch-list';
import { EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Пакеты миграции из Битрикс24 · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Пакеты» (этап 2 ТЗ 12.09.2026, `У-193`, `У-198`): отсюда запускается перенос.
 *
 * Порядок на экране повторяет порядок действий: загрузить выгрузки (если
 * переносим из файлов) → собрать пакет → посмотреть, что получится. Пока
 * пакетов нет, вместо пустой таблицы — объяснение, что нажать (§15).
 */
export default async function AdminBitrixHistoryPage() {
  const session = await requireSettingsSection('integrations.bitrix', 'admin');
  const [batches, managers, connection] = await Promise.all([
    listBitrixHistory(prisma, session),
    session.companyId ? listCompanyManagers(prisma, session.companyId) : Promise.resolve([]),
    getSettingValues(prisma, ['bitrix.webhookUrl']),
  ]);

  const rows = batches.ok ? batches.batches : [];
  const managerOptions = managers
    .filter((m) => m.isActive)
    .map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Пакеты миграции"
        subtitle="Каждый перенос из Битрикс24 — отдельный пакет: предпросмотр, применение, отчёт сверки и откат."
      />
      <BitrixBatchStarter
        managers={managerOptions}
        hasConnection={Boolean(connection['bitrix.webhookUrl'])}
      />
      {rows.length > 0 ? (
        <BatchList batches={rows} />
      ) : (
        <EmptyState
          icon="🚚"
          message="Пакетов миграции ещё не было. Подключите портал или загрузите выгрузки выше, а затем посчитайте предпросмотр — он покажет, что перенесётся."
          action={
            <Link
              href="/admin/settings/integrations/bitrix"
              className="inline-flex items-center rounded-lg bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#EA580C]"
            >
              К подключению
            </Link>
          }
        />
      )}
    </div>
  );
}
