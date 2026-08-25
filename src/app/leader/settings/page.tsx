import type { Metadata } from 'next';
import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { visibleSettingsSections } from '@/lib/auth/settingsAccess';
import { SettingsHubCards } from '@/components/settings/settings-hub-cards';

import { PageHeader } from '@/components/ui/page-header';
export const metadata: Metadata = { title: 'Настройки' };

/** Корень хаба настроек руководителя: карточки доступных ему разделов. */
export default async function LeaderSettingsPage() {
  const session = await requireManagerLeader();
  return (
    <div className="space-y-6">
      <PageHeader title="Настройки" subtitle="Служебные разделы вашей команды и компании" />
      <SettingsHubCards cabinet="leader" sections={visibleSettingsSections(session, 'leader')} />
    </div>
  );
}
