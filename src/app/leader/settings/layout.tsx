import React, { type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { hasAnySettingsAccess, visibleSettingsSections } from '@/lib/auth/settingsAccess';
import { SettingsShell } from '@/components/settings/settings-shell';

/**
 * Хаб «Настройки» руководителя — зеркало админского (ТЗ 2026-08-04).
 * Руководителя не пускают в `/admin/*` (Model A, CLAUDE.md §4), поэтому доступные
 * ему разделы живут своими адресами поверх тех же компонентов и сервисов.
 */
export default async function LeaderSettingsLayout({ children }: { children: ReactNode }) {
  const session = await requireManagerLeader();
  if (!hasAnySettingsAccess(session, 'leader')) redirect('/forbidden');
  return (
    <SettingsShell cabinet="leader" sections={visibleSettingsSections(session, 'leader')}>
      {children}
    </SettingsShell>
  );
}
