import React, { type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { hasAnySettingsAccess, visibleSettingsSections } from '@/lib/auth/settingsAccess';
import { SettingsShell } from '@/components/settings/settings-shell';

/**
 * Хаб «Настройки» админа (ТЗ 2026-08-04). Layout держит два инварианта:
 * доступ хотя бы к одному разделу (иначе 403) и одинаковую боковую карту на
 * всех подстраницах. Право на КОНКРЕТНЫЙ раздел проверяет сама страница через
 * `requireSettingsSection` — layout не знает, какой адрес открыт.
 */
export default async function AdminSettingsLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  if (!hasAnySettingsAccess(session, 'admin')) redirect('/forbidden');
  return (
    <SettingsShell cabinet="admin" sections={visibleSettingsSections(session, 'admin')}>
      {children}
    </SettingsShell>
  );
}
