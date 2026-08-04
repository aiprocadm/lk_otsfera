import React from 'react';
import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/requireRole';
import { visibleSettingsSections } from '@/lib/auth/settingsAccess';
import { SettingsHubCards } from '@/components/settings/settings-hub-cards';

export const metadata: Metadata = { title: 'Настройки' };

/**
 * Корень хаба: карточки разделов по четырём группам + поиск (ТЗ §3, §4.4).
 * Прежнее содержимое этой страницы (личные каналы, реквизиты, флаги, 2FA)
 * разъехалось по подразделам — см. спеку §3.4.
 */
export default async function AdminSettingsPage() {
  const session = await requireAdmin();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#111111]">Настройки</h1>
      <SettingsHubCards cabinet="admin" sections={visibleSettingsSections(session, 'admin')} />
    </div>
  );
}
