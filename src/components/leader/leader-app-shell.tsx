import React, { type ReactNode } from 'react';
import type { SessionPayload } from '@/lib/auth/jwt';
import { LogoutButton } from '@/components/ui';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { hasAnySettingsAccess } from '@/lib/auth/settingsAccess';
import { LeaderSidebar } from './leader-sidebar';

export function LeaderAppShell(props: { session: SessionPayload; children: ReactNode }) {
  const userEmail = props.session.email ?? null;
  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Без opts: leader-меню не фильтруется по суб-роли (внутрь пускает layout-гард). */}
      <LeaderSidebar
        items={navItemsFor('leader').filter(
          // ТЗ 2026-08-04 §5.2: нет доступа ни к одному разделу — нет и пункта.
          (item) =>
            item.href !== '/leader/settings' || hasAnySettingsAccess(props.session, 'leader')
        )}
      />
      <div className="flex-1 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-700 truncate">
            <span className="font-medium text-[#111111]">Кабинет руководителя</span>
            {userEmail ? <span className="ml-3 text-gray-500">· {userEmail}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            {/* role='manager': leader — это manager с managerRole=leader,
                notifications-scope у него менеджерский
                (см. src/lib/services/notifications/scope.ts). */}
            <NotificationBell role="manager" />
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 px-6 py-6">
          <div className="max-w-[1280px] mx-auto">{props.children}</div>
        </main>
      </div>
    </div>
  );
}
