import React, { type ReactNode } from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { hasAnySettingsAccess } from '@/lib/auth/settingsAccess';
import { LogoutButton } from '@/components/ui';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AppShell } from '@/components/shell/app-shell';
import { Sidebar } from '@/components/shell/sidebar';
import { MobileNav } from '@/components/shell/mobile-nav';
import { mobileTabsFor } from '@/lib/navigation/mobileTabs';
import { CommandPalette } from '@/components/shell/command-palette';

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
      mobileNav={
        <MobileNav
          tabs={mobileTabsFor('admin', items)}
          panel={<Sidebar items={items} title="Админ" testIdPrefix="admin" variant="panel" />}
        />
      }
      headerLeft={
        <>
          {/* `У-112`: раньше в шапке был голый e-mail — единственный кабинет,
              который не говорил, где ты находишься (§15, «где я»). */}
          <span className="font-medium text-[#111111]">Кабинет администратора</span>
          {session.email ? <span className="ml-3 text-gray-500">· {session.email}</span> : null}
        </>
      }
      palette={<CommandPalette sections={items} searchEnabled searchHref="/admin/search" />}
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
