import { notFound } from 'next/navigation';
import React, { type ReactNode } from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { hasAnySettingsAccess } from '@/lib/auth/settingsAccess';
import { LogoutButton } from '@/components/ui';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AppShell } from '@/components/shell/app-shell';
import { Sidebar } from '@/components/shell/sidebar';
import { MobileNav } from '@/components/shell/mobile-nav';
import { mobileTabsFor } from '@/lib/navigation/mobileTabs';
import { CommandPalette } from '@/components/shell/command-palette';
import { CabinetSwitcher } from '@/components/shell/cabinet-switcher';

export default async function LeaderLayout({ children }: { children: ReactNode }) {
  // Третья точка гейтинга (после middleware и nav): прямой заход при выключенном флаге -> 404.
  if (!isFeatureEnabled('leader_cabinet')) notFound();
  const session = await requireManagerLeader();
  // Без opts: leader-меню не фильтруется по суб-роли (внутрь пускает layout-гард).
  const items = navItemsFor('leader').filter(
    // ТЗ 2026-08-04 §5.2: нет доступа ни к одному разделу — нет и пункта.
    (item) => item.href !== '/leader/settings' || hasAnySettingsAccess(session, 'leader')
  );
  const userEmail = session.email ?? null;

  return (
    <AppShell
      sidebar={
        <Sidebar
          items={items}
          title="Руководитель"
          subtitle="Промтехносфера"
          testIdPrefix="leader"
        />
      }
      mobileNav={
        <MobileNav
          tabs={mobileTabsFor('leader', items)}
          panel={
            <Sidebar
              items={items}
              title="Руководитель"
              subtitle="Промтехносфера"
              testIdPrefix="leader"
              variant="panel"
            />
          }
        />
      }
      headerLeft={
        <>
          {/* `У-111`: смена кабинета — одним переключателем в шапке, а не
              пунктом меню, спрятанным среди разделов работы. */}
          <CabinetSwitcher current="leader" />
          {userEmail ? <span className="ml-3 text-gray-500">· {userEmail}</span> : null}
        </>
      }
      palette={
        // teamModeOverride — то же исключение, что у страницы /leader/search:
        // руководитель смотрит на всю компанию мимо тумблера видимости команды.
        <CommandPalette
          sections={items}
          searchEnabled
          searchHref="/leader/search"
          teamModeOverride
        />
      }
      headerRight={
        <>
          {/* role="manager" намеренно: notifications-scope и deep-link'и
              руководителя — менеджерские (лидер-веток там нет; см.
              src/lib/services/notifications/scope.ts, notifications/href.ts). */}
          <NotificationBell role="manager" />
          <LogoutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
