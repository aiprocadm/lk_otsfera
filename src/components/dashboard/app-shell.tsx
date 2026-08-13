import React from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { isManagerLeader } from '@/lib/auth/managerPolicy';
import { LogoutButton } from '@/components/ui';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AskQuestionButton } from '@/components/support/ask-question-button';
import { AppShell as CabinetShell } from '@/components/shell/app-shell';
import { Sidebar } from '@/components/shell/sidebar';
import { MobileNav } from '@/components/shell/mobile-nav';
import { mobileTabsFor } from '@/lib/navigation/mobileTabs';

/**
 * Кабинеты партнёра и слушателя (`/partner/*` и shared-entry `/student`).
 *
 * Этап 2 (`У-10`…`У-12`): собственного каркаса больше нет — это тонкий
 * переходник к общему `components/shell/app-shell`. Он же чинит три расхождения,
 * которые жили только здесь: серая точка вместо значка, ширина `w-56` вместо
 * `w-60` и отсутствие подсветки активного пункта.
 *
 * Тёмная шапка сохранена (решение заказчика 09.08.2026) — `theme='dark'`.
 */
const roleLabel: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  partner: 'Партнёр',
  organization: 'Организация',
  student: 'Студент',
};

const cabinetTitle: Record<string, string> = {
  partner: 'Партнёр',
  student: 'Слушатель',
};

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const items = navItemsFor(session.role, { isManagerLeader: isManagerLeader(session) });

  return (
    <CabinetShell
      theme="dark"
      sidebar={
        <Sidebar
          items={items}
          title={cabinetTitle[session.role] ?? roleLabel[session.role] ?? session.role}
          subtitle="Промтехносфера"
          testIdPrefix={session.role}
        />
      }
      mobileNav={
        <MobileNav
          theme="dark"
          tabs={mobileTabsFor(session.role, items)}
          panel={
            <Sidebar
              items={items}
              title={cabinetTitle[session.role] ?? roleLabel[session.role] ?? session.role}
              subtitle="Промтехносфера"
              testIdPrefix={session.role}
              variant="panel"
            />
          }
        />
      }
      headerLeft={
        <>
          <span className="font-medium text-white">{roleLabel[session.role] ?? session.role}</span>
          {session.name ? <span className="ml-3 text-gray-400">· {session.name}</span> : null}
        </>
      }
      headerRight={
        <>
          {/* У слушателя нет notifications-скоупа (NotificationRole) —
              колокольчик только партнёру. Тёмная шапка → нейтральная подложка. */}
          {session.role === 'partner' ? (
            <NotificationBell role="partner" buttonClassName="hover:bg-white/10" />
          ) : null}
          {/* Этап 9 (ФТ-11.1): «Задать вопрос» — только клиентским ролям кабинета. */}
          {session.role === 'partner' && isFeatureEnabled('cabinet_questions') ? (
            <AskQuestionButton />
          ) : null}
          <LogoutButton className="text-xs text-gray-400 hover:text-[#F97316] transition-colors px-2 py-1 border border-gray-700 rounded hover:border-[#F97316] disabled:opacity-60" />
        </>
      }
    >
      {children}
    </CabinetShell>
  );
}
