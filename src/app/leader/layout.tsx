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
      headerLeft={
        <>
          <span className="font-medium text-[#111111]">Кабинет руководителя</span>
          {userEmail ? <span className="ml-3 text-gray-500">· {userEmail}</span> : null}
        </>
      }
      headerRight={
        <>
          {/* role='manager': leader — это manager с managerRole=leader,
              notifications-scope у него менеджерский
              (см. src/lib/services/notifications/scope.ts). */}
          <NotificationBell role="manager" />
          <LogoutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
