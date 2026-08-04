import React, { type ReactNode } from 'react';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { LogoutButton } from '@/components/ui';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AskQuestionButton } from '@/components/support/ask-question-button';
import { OrgSidebar, type OrgSidebarMembership } from './org-sidebar';
import { OrganizationBottomTabBar } from './bottom-tab-bar';

export function OrgAppShell(props: {
  userEmail?: string | null | undefined;
  activeOrgName: string;
  memberships: OrgSidebarMembership[];
  activeOrgId: string;
  viewerRole: 'admin' | 'leader' | 'member';
  children: ReactNode;
}) {
  const items = navItemsFor('organization');

  return (
    <div className="flex min-h-screen bg-gray-50">
      <OrgSidebar
        items={items}
        memberships={props.memberships}
        activeOrgId={props.activeOrgId}
        viewerRole={props.viewerRole}
      />
      <div className="flex-1 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-700 truncate">
            <span className="font-medium text-[#111111]">{props.activeOrgName}</span>
            {props.userEmail ? (
              <span className="ml-3 text-gray-500">· {props.userEmail}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {/* Этап 9 (ФТ-11.1): «Задать вопрос» — светлая шапка org-кабинета. */}
            {isFeatureEnabled('cabinet_questions') ? (
              <AskQuestionButton className="text-xs text-gray-600 hover:text-[#EA580C] transition-colors px-2 py-1 border border-gray-200 rounded hover:border-[#F97316]" />
            ) : null}
            <NotificationBell role="organization" />
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 px-6 py-6">
          {/* Отступ снизу — чтобы нижняя панель не накрывала контент на телефоне. */}
          <div className="max-w-[1280px] mx-auto pb-16 md:pb-0">{props.children}</div>
        </main>
      </div>
      {/* Этап 11 PR-3 (ФТ-15.5): у org-кабинета нет общего layout-shell —
          страницы оборачиваются сами, поэтому панель монтируется здесь. */}
      <OrganizationBottomTabBar />
    </div>
  );
}
