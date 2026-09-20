// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Ссылка «все уведомления» в шапке кабинетов заказчика и партнёра.
 *
 * Колокольчик есть всегда, а ссылка на **центр уведомлений** — только когда
 * он включён. Иначе кнопка вела бы на экран, которого нет: человек нажимает и
 * попадает в «страница не найдена». Ветку «выключен» легко не заметить,
 * потому что по умолчанию центр включён.
 */
const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  navItemsFor: vi.fn(),
  mobileTabsFor: vi.fn(),
  getSession: vi.fn(),
  isManagerLeader: vi.fn(),
}));

vi.mock('@/lib/featureFlags', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
  notFoundIfDisabled: vi.fn(),
}));
vi.mock('@/lib/navigation/cabinet', () => ({ navItemsFor: mocks.navItemsFor }));
vi.mock('@/lib/navigation/mobileTabs', () => ({ mobileTabsFor: mocks.mobileTabsFor }));
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/auth/managerPolicy', () => ({ isManagerLeader: mocks.isManagerLeader }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/organization/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

// Колокольчик подменён заглушкой, которая печатает полученный адрес: именно
// его и решает оболочка.
vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: (props: { role: string; allHref: string | null }) => (
    <span data-testid="bell" data-all-href={String(props.allHref)} />
  ),
}));
vi.mock('@/components/ui', () => ({ LogoutButton: () => <button type="button">Выйти</button> }));
vi.mock('@/components/organization/org-sidebar', () => ({ OrgSidebar: () => <nav /> }));
vi.mock('@/components/shell/sidebar', () => ({ Sidebar: () => <nav /> }));
vi.mock('@/components/shell/mobile-nav', () => ({ MobileNav: () => <nav /> }));
vi.mock('@/components/shell/command-palette', () => ({ CommandPalette: () => <div /> }));
vi.mock('@/components/support/ask-question-button', () => ({
  AskQuestionButton: () => <button type="button">Задать вопрос</button>,
}));

import { OrgAppShell } from '@/components/organization/org-app-shell';
import { AppShell } from '@/components/dashboard/app-shell';

const session = (role: string) =>
  ({ sub: 'u1', role, email: 'x@x.ru', name: 'Пётр', companyId: 'c1' }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.navItemsFor.mockReturnValue([{ href: '/organization/dashboard', label: 'Главная' }]);
  mocks.mobileTabsFor.mockReturnValue([]);
  mocks.isManagerLeader.mockReturnValue(false);
});

describe('Кабинет заказчика', () => {
  const shell = () =>
    render(
      <OrgAppShell
        activeOrgName="ООО «Ромашка»"
        memberships={[]}
        activeOrgId="o1"
        viewerRole="admin"
      >
        <div>содержимое</div>
      </OrgAppShell>
    );

  it('центр уведомлений включён — ссылка на него есть', () => {
    mocks.isFeatureEnabled.mockReturnValue(true);

    shell();

    expect(screen.getByTestId('bell').dataset.allHref).toBe('/organization/notifications');
  });

  it('центр выключен — ссылки нет, кнопка не ведёт в никуда', () => {
    mocks.isFeatureEnabled.mockReturnValue(false);

    shell();

    expect(screen.getByTestId('bell').dataset.allHref).toBe('null');
  });
});

describe('Кабинет партнёра', () => {
  const shell = async (role = 'partner') => {
    mocks.getSession.mockResolvedValue(session(role));
    return renderServerComponent(
      AppShell({ children: <div>содержимое</div> }) as unknown as Promise<React.ReactNode>
    );
  };

  it('центр уведомлений включён — ссылка на него есть', async () => {
    mocks.isFeatureEnabled.mockReturnValue(true);

    await shell();

    expect(screen.getByTestId('bell').dataset.allHref).toBe('/partner/notifications');
  });

  it('центр выключен — ссылки нет', async () => {
    mocks.isFeatureEnabled.mockReturnValue(false);

    await shell();

    expect(screen.getByTestId('bell').dataset.allHref).toBe('null');
  });

  it('у слушателя колокольчика нет вовсе — у него нет и своих уведомлений', async () => {
    mocks.isFeatureEnabled.mockReturnValue(true);

    await shell('student');

    expect(screen.queryByTestId('bell')).toBeNull();
  });
});
