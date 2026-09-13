import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Пакеты миграции из Битрикс24 · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Пакеты» (этап 2 ТЗ 12.09.2026, `У-198`): история пакетов миграции. В PR-1
 * пакетов ещё нет — экран объясняет, что делать дальше (§15: пустой экран с
 * кнопкой). Форма «Новый пакет» и таблица истории приходят PR-3 и PR-5.
 */
export default async function AdminBitrixHistoryPage() {
  await requireSettingsSection('integrations.bitrix', 'admin');
  return (
    <div className="space-y-4">
      <PageHeader
        title="Пакеты миграции"
        subtitle="Каждый перенос из Битрикс24 — отдельный пакет: предпросмотр, применение, отчёт сверки и откат."
      />
      <EmptyState
        icon="🚚"
        message="Пакетов миграции ещё не было. Сначала подключите портал и проверьте связь — форма первого пакета появится здесь."
        action={
          <Link
            href="/admin/settings/integrations/bitrix"
            className="inline-flex items-center rounded-lg bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#EA580C]"
          >
            К подключению
          </Link>
        }
      />
    </div>
  );
}
