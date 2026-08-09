import React, { type ReactNode } from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { hasAnySettingsAccess } from '@/lib/auth/settingsAccess';
import { LogoutButton } from '@/components/ui';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AppShell } from '@/components/shell/app-shell';
import { Sidebar } from '@/components/shell/sidebar';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  // ТЗ 2026-08-04 §5.2: нет доступа ни к одному разделу — пункта «Настройки»
  // в меню нет вовсе (ссылка без серверной проверки — не защита, но и рисовать
  // заведомо запретную дверь незачем).
  const items = navItemsFor('admin').filter(
    (item) => item.href !== '/admin/settings' || hasAnySettingsAccess(session, 'admin')
  );

  return (
    <AppShell
      sidebar={<Sidebar items={items} title="Админ" testIdPrefix="admin" />}
      headerLeft={session.email}
      headerRight={
        <>
          <NotificationBell role="admin" />
          <LogoutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
