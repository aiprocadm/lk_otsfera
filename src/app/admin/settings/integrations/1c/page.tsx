import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { OneCNavigator } from '@/components/settings/one-c-navigator';

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
        <h1 className="text-2xl font-semibold text-[#111111]">Обмен с 1С</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Загрузка файлов из 1С и постоянный обмен по сети — в одном месте.
        </p>
      </div>
      <OneCNavigator cabinet="admin" />
    </div>
  );
}
