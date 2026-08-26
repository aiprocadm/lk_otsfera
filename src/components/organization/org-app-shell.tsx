import React, { type ReactNode } from 'react';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { LogoutButton } from '@/components/ui';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AskQuestionButton } from '@/components/support/ask-question-button';
import { AppShell } from '@/components/shell/app-shell';
import { MobileNav } from '@/components/shell/mobile-nav';
import { mobileTabsFor } from '@/lib/navigation/mobileTabs';
import { CommandPalette } from '@/components/shell/command-palette';
import { CabinetHeaderTitle } from '@/components/shell/cabinet-header-title';
import { OrgSidebar, type OrgSidebarMembership } from './org-sidebar';

/**
 * Кабинет заказчика. Этап 2 (`У-11`): своего каркаса больше нет — переходник к
 * общему `components/shell/app-shell`.
 *
 * Компонент оставлен (а не растворён в layout), потому что у org-кабинета нет
 * общего layout-шелла: активная организация резолвится из `searchParams`, а они
 * в layout недоступны (ограничение App Router), поэтому **каждая из 17 страниц
 * оборачивает себя сама**.
 */
export function OrgAppShell(props: {
  activeOrgName: string;
  memberships: OrgSidebarMembership[];
  activeOrgId: string;
  viewerRole: 'admin' | 'leader' | 'member';
  children: ReactNode;
}) {
  const items = navItemsFor('organization');
  // Как и у нижней панели: при нескольких организациях ссылка обязана нести
  // `?org=`, иначе переход молча уведёт в другую организацию.
  const paletteSections =
    props.memberships.length > 1
      ? items.map((i) => ({ href: `${i.href}?org=${props.activeOrgId}`, label: i.label }))
      : items;

  return (
    <AppShell
      sidebar={
        <OrgSidebar
          items={items}
          memberships={props.memberships}
          activeOrgId={props.activeOrgId}
          viewerRole={props.viewerRole}
        />
      }
      mobileNav={
        <MobileNav
          tabs={mobileTabsFor('organization', items)}
          {...(props.memberships.length > 1 ? { tabQuery: `org=${props.activeOrgId}` } : {})}
          panel={
            <OrgSidebar
              items={items}
              memberships={props.memberships}
              activeOrgId={props.activeOrgId}
              viewerRole={props.viewerRole}
              variant="panel"
            />
          }
        />
      }
      headerLeft={<CabinetHeaderTitle role="organization" subject={props.activeOrgName} />}
      palette={<CommandPalette sections={paletteSections} />}
      headerRight={
        <>
          {/* Этап 9 (ФТ-11.1): «Задать вопрос» — светлая шапка org-кабинета. */}
          {isFeatureEnabled('cabinet_questions') ? (
            <AskQuestionButton className="text-xs text-gray-600 hover:text-[#EA580C] transition-colors px-2 py-1 border border-gray-200 rounded hover:border-[#F97316]" />
          ) : null}
          <NotificationBell role="organization" />
          <LogoutButton />
        </>
      }
    >
      {props.children}
    </AppShell>
  );
}
