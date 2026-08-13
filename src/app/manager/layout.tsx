import React, { type ReactNode } from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { isManagerLeader } from '@/lib/auth/managerPolicy';
import { LogoutButton } from '@/components/ui';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AppShell } from '@/components/shell/app-shell';
import { Sidebar } from '@/components/shell/sidebar';
import { MobileNav } from '@/components/shell/mobile-nav';
import { mobileTabsFor } from '@/lib/navigation/mobileTabs';
import { CommandPalette } from '@/components/shell/command-palette';

export default async function ManagerLayout({ children }: { children: ReactNode }) {
  const session = await requireManager();
  const items = navItemsFor('manager', { isManagerLeader: isManagerLeader(session) });
  const userEmail = session.email ?? null;

  return (
    <AppShell
      sidebar={
        <Sidebar items={items} title="Менеджер" subtitle="Промтехносфера" testIdPrefix="manager" />
      }
      mobileNav={
        <MobileNav
          tabs={mobileTabsFor('manager', items)}
          panel={
            <Sidebar
              items={items}
              title="Менеджер"
              subtitle="Промтехносфера"
              testIdPrefix="manager"
              variant="panel"
            />
          }
        />
      }
      headerLeft={
        <>
          <span className="font-medium text-[#111111]">Кабинет менеджера</span>
          {userEmail ? <span className="ml-3 text-gray-500">· {userEmail}</span> : null}
        </>
      }
      palette={<CommandPalette sections={items} searchEnabled searchHref="/manager/search" />}
      headerRight={
        <>
          <NotificationBell role="manager" />
          <LogoutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
