import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { OneCNavigator } from '@/components/settings/one-c-navigator';

import { PageHeader } from '@/components/ui/page-header';
export const metadata: Metadata = { title: 'Обмен с 1С · Настройки' };

/**
 * Вход в «Обмен с 1С» (`У-47`, этап 7): вместо молчаливого редиректа на форму
 * загрузки — навигатор задачи. Гард — как у всех разделов хаба (§2b): право
 * проверяется на КАЖДЫЙ запрос, а не только скрытием карточки.
 */
export default async function AdminOneCIndexPage() {
  await requireSettingsSection('integrations.oneC', 'admin');
  return (
    <div className="space-y-4">
      <div>
        <PageHeader
          title="Обмен с 1С"
          subtitle="Загрузка файлов из 1С и постоянный обмен по сети — в одном месте."
        />
      </div>
      <OneCNavigator cabinet="admin" />
    </div>
  );
}
