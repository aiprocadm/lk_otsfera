import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

const { navItemsFor } = vi.hoisted(() => ({ navItemsFor: vi.fn() }));
vi.mock('@/lib/navigation/cabinet', () => ({ navItemsFor }));

// Палитра Ctrl/Cmd+K (У-75) стоит в шапке каркаса и зовёт useRouter.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/organization/dashboard',
}));

vi.mock('@/components/ui', () => ({
  LogoutButton: () => React.createElement('button', null, 'Выйти'),
}));

vi.mock('@/components/organization/org-sidebar', () => ({
  OrgSidebar: (props: { items: Array<{ href: string; label: string }> }) =>
    React.createElement(
      'nav',
      { 'data-testid': 'org-sidebar' },
      props.items.map((item) => React.createElement('span', { key: item.href }, item.label))
    ),
}));

vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: (props: { role: string }) =>
    React.createElement(
      'span',
      { 'data-testid': 'notification-bell', 'data-role': props.role },
      '🔔'
    ),
}));

import { OrgAppShell } from '@/components/organization/org-app-shell';
import type { OrgSidebarMembership } from '@/components/organization/org-sidebar';

const MEMBERSHIPS: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'admin' },
];

// React.createElement's overloads require `children` up front when a
// component's props type declares it non-optional. Folding it into the
// props object sidesteps that without resorting to JSX (banned in this
// project's test files — classic runtime) — see the Dialog exemplar.
function renderShell(props: React.ComponentProps<typeof OrgAppShell>) {
  return React.createElement(OrgAppShell, props);
}

describe('OrgAppShell', () => {
  beforeEach(() => {
    navItemsFor.mockReset();
    navItemsFor.mockReturnValue([{ href: '/organization/dashboard', label: 'Главная' }]);
  });

  it('renders the org sidebar via navItemsFor("organization"), header with org name + email, and children', () => {
    const html = renderToString(
      renderShell({
        userEmail: 'org@example.com',
        activeOrgName: 'ООО Заря',
        memberships: MEMBERSHIPS,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
        children: React.createElement('p', null, 'дочерний контент'),
      })
    );

    expect(navItemsFor).toHaveBeenCalledWith('organization');
    expect(html).toContain('ООО Заря');
    expect(html).toContain('org@example.com');
    expect(html).toContain('дочерний контент');
    expect(html).toContain('Главная');
    expect(html).toContain('data-testid="org-sidebar"');
  });

  it('renders NotificationBell with role="organization" in the header', () => {
    const html = renderToString(
      renderShell({
        userEmail: null,
        activeOrgName: 'ООО Заря',
        memberships: MEMBERSHIPS,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
        children: 'c',
      })
    );
    expect(html).toContain('data-role="organization"');
  });

  it.each([
    ['выключен', undefined, false],
    ['включён', '1', true],
  ])('кнопка «Задать вопрос»: флаг %s → показана=%s', (_label, envValue, expected) => {
    // cabinet_questions — флаг с явным включением (по умолчанию выключен,
    // staged rollout). Шапка обязана оставаться рабочей в обоих состояниях.
    const prev = process.env.FEATURE_CABINET_QUESTIONS;
    if (envValue === undefined) delete process.env.FEATURE_CABINET_QUESTIONS;
    else process.env.FEATURE_CABINET_QUESTIONS = envValue as string;
    try {
      const html = renderToString(
        renderShell({
          userEmail: 'org@example.com',
          activeOrgName: 'ООО Заря',
          memberships: MEMBERSHIPS,
          activeOrgId: 'org-A',
          viewerRole: 'admin',
          children: null,
        })
      );
      expect(html.includes('Задать вопрос')).toBe(expected);
      expect(html).toContain('Выйти');
    } finally {
      if (prev === undefined) delete process.env.FEATURE_CABINET_QUESTIONS;
      else process.env.FEATURE_CABINET_QUESTIONS = prev;
    }
  });

  it('omits the email span when userEmail is null/undefined', () => {
    const html = renderToString(
      renderShell({
        userEmail: null,
        activeOrgName: 'ООО Заря',
        memberships: MEMBERSHIPS,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
        children: 'c',
      })
    );
    expect(html).not.toContain('·');
  });

  it('палитра: одна организация — ссылки разделов остаются короткими (У-75)', () => {
    const html = renderToString(
      renderShell({
        userEmail: null,
        activeOrgName: 'ООО Заря',
        memberships: MEMBERSHIPS,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
        children: 'c',
      })
    );
    expect(html).toContain('data-testid="palette-section-/organization/dashboard"');
    expect(html).not.toContain('org=org-A"');
  });

  it('палитра: несколько организаций — ссылка несёт ?org=, иначе уведёт в чужую (У-75)', () => {
    const html = renderToString(
      renderShell({
        userEmail: null,
        activeOrgName: 'ООО Заря',
        memberships: [
          ...MEMBERSHIPS,
          { organizationId: 'org-B', organizationName: 'ООО Восход', roleInOrg: 'member' },
        ],
        activeOrgId: 'org-A',
        viewerRole: 'admin',
        children: 'c',
      })
    );
    expect(html).toContain('data-testid="palette-section-/organization/dashboard?org=org-A"');
  });
});
