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
import { CommandPalette } from '@/components/shell/command-palette';
import { CabinetHeaderTitle } from '@/components/shell/cabinet-header-title';

/**
 * Кабинеты партнёра и слушателя (`/partner/*` и shared-entry `/student`).
 *
 * Этап 2 (`У-10`…`У-12`): собственного каркаса больше нет — это тонкий
 * переходник к общему `components/shell/app-shell`. Он же чинит три расхождения,
 * которые жили только здесь: серая точка вместо значка, ширина `w-56` вместо
 * `w-60` и отсутствие подсветки активного пункта.
 *
 * `У-115`: шапка стала **светлой**, как у остальных пяти кабинетов. Тёмная
 * была решением заказчика от 09.08.2026, но действующее ТЗ требует одинаковой
 * шапки у заказчика и партнёра, а тёмной оставался только этот каркас — то
 * есть выравнивать нужно было именно его (`CLAUDE.md` §14: при конфликте
 * исторического решения и действующего ТЗ побеждает ТЗ). Кабинет слушателя
 * делит этот же каркас и светлеет вместе с ним — это и требовалось: он был
 * единственным тёмным экраном во всей системе.
 */
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
      sidebar={
        <Sidebar
          items={items}
          title={cabinetTitle[session.role] ?? session.role}
          subtitle="Промтехносфера"
          testIdPrefix={session.role}
        />
      }
      mobileNav={
        <MobileNav
          tabs={mobileTabsFor(session.role, items)}
          panel={
            <Sidebar
              items={items}
              title={cabinetTitle[session.role] ?? session.role}
              subtitle="Промтехносфера"
              testIdPrefix={session.role}
              variant="panel"
            />
          }
        />
      }
      headerLeft={<CabinetHeaderTitle role={session.role} subject={session.name ?? null} />}
      palette={<CommandPalette sections={items} />}
      headerRight={
        <>
          {/* Этап 9 (ФТ-11.1): «Задать вопрос» — только клиентским ролям кабинета.
              `У-175`: порядок как у заказчика — вопрос → колокольчик → выход. */}
          {session.role === 'partner' && isFeatureEnabled('cabinet_questions') ? (
            <AskQuestionButton />
          ) : null}
          {/* У слушателя нет notifications-скоупа (NotificationRole) —
              колокольчик только партнёру. */}
          {session.role === 'partner' ? <NotificationBell role="partner" /> : null}
          <LogoutButton />
        </>
      }
    >
      {children}
    </CabinetShell>
  );
}
