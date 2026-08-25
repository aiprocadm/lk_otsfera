import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { OneCNavigator } from '@/components/settings/one-c-navigator';

export const metadata: Metadata = { title: 'Обмен с 1С · Настройки' };

/**
 * Вход в «Обмен с 1С» у руководителя (`У-118`). Раньше корень молча
 * перебрасывал на форму загрузки Excel — человек оказывался в форме, не поняв,
 * туда ли пришёл. Теперь, как у админа (`У-47`), сначала спрашиваем, что он
 * хочет сделать. Гард — как у всех разделов хаба (§2b), на каждый запрос.
 */
export default async function LeaderOneCIndexPage() {
  await requireSettingsSection('integrations.oneC', 'leader');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-[#111111]">Обмен с 1С</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Загрузка файлов из 1С и постоянный обмен по сети — в одном месте.
        </p>
      </div>
      <OneCNavigator cabinet="leader" />
    </div>
  );
}
