import type { Metadata } from 'next';
import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { visibleSettingsSections } from '@/lib/auth/settingsAccess';
import { SettingsHubCards } from '@/components/settings/settings-hub-cards';

export const metadata: Metadata = { title: 'Настройки' };

/** Корень хаба настроек руководителя: карточки доступных ему разделов. */
export default async function LeaderSettingsPage() {
  const session = await requireManagerLeader();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#111111]">Настройки</h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">Служебные разделы вашей команды и компании</p>
      <SettingsHubCards cabinet="leader" sections={visibleSettingsSections(session, 'leader')} />
    </div>
  );
}
