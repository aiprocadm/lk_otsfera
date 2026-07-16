import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

const { navItemsFor } = vi.hoisted(() => ({ navItemsFor: vi.fn() }));
vi.mock('@/lib/navigation/cabinet', () => ({ navItemsFor }));

vi.mock('@/components/ui', () => ({
  LogoutButton: () => React.createElement('button', null, 'Выйти')
}));

vi.mock('@/components/leader/leader-sidebar', () => ({
  LeaderSidebar: (props: { items: Array<{ href: string; label: string }> }) =>
    React.createElement(
      'nav',
      { 'data-testid': 'leader-sidebar' },
      props.items.map((item) => React.createElement('span', { key: item.href }, item.label))
    )
}));

vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: (props: { role: string }) =>
    React.createElement('span', { 'data-testid': 'notification-bell', 'data-role': props.role }, '🔔')
}));

import { LeaderAppShell } from '@/components/leader/leader-app-shell';
import type { SessionPayload } from '@/lib/auth/jwt';

const baseSession: SessionPayload = { sub: 'u1', role: 'manager', managerRole: 'leader' };

// React.createElement's overloads require `children` up front when a
// component's props type declares it non-optional. Folding it into the
// props object sidesteps that without resorting to JSX (banned in this
// project's test files — classic runtime) — see the Dialog exemplar.
function renderShell(props: React.ComponentProps<typeof LeaderAppShell>) {
  return React.createElement(LeaderAppShell, props);
}

describe('LeaderAppShell', () => {
  beforeEach(() => {
    navItemsFor.mockReset();
    navItemsFor.mockReturnValue([{ href: '/leader/dashboard', label: 'Сводка' }]);
  });

  it('renders the leader sidebar via navItemsFor("leader"), header, and children', () => {
    const html = renderToString(
      renderShell({
        session: { ...baseSession, email: 'leader@example.com' },
        children: React.createElement('p', null, 'дочерний контент')
      })
    );

    expect(navItemsFor).toHaveBeenCalledWith('leader');
    expect(html).toContain('Кабинет руководителя');
    expect(html).toContain('leader@example.com');
    expect(html).toContain('дочерний контент');
    expect(html).toContain('Сводка');
  });

  it('renders NotificationBell with role="manager" (leader = manager с той же областью уведомлений)', () => {
    const html = renderToString(renderShell({ session: baseSession, children: 'c' }));
    expect(html).toContain('data-role="manager"');
  });

  it('omits the email span when session.email is null/undefined', () => {
    const html = renderToString(
      renderShell({ session: { ...baseSession, email: undefined }, children: 'c' })
    );

    expect(html).not.toContain('·');
  });
});
