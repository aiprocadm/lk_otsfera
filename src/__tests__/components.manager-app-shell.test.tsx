import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/manager/dashboard',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: (props: { role: string }) =>
    React.createElement(
      'span',
      { 'data-testid': 'notification-bell', 'data-role': props.role },
      '🔔'
    ),
}));

import { ManagerAppShell } from '@/components/manager/manager-app-shell';
import type { SessionPayload } from '@/lib/auth/jwt';

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, FEATURE_MANAGER_CABINET: '1' };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeSession(overrides: Partial<SessionPayload>): SessionPayload {
  return {
    userId: 'u1',
    role: 'manager',
    email: 'ivan@example.com',
    ...overrides,
  } as SessionPayload;
}

// React.createElement's overloads require `children` up front when a
// component's props type declares it non-optional (ManagerAppShell's props
// require `children: ReactNode`). Folding it into the props object sidesteps
// that without resorting to JSX (banned in this project's test files —
// classic runtime). Mirrors the `renderDialog` helper in
// components.ui-dialog.test.tsx.
function renderShell(session: SessionPayload, children: React.ReactNode) {
  const props: { session: SessionPayload; children: React.ReactNode } = { session, children };
  return React.createElement(ManagerAppShell, props);
}

describe('ManagerAppShell', () => {
  it('renders the shell heading, sidebar, and children', () => {
    const html = renderToString(
      renderShell(makeSession({}), React.createElement('p', null, 'контент'))
    );
    expect(html).toContain('Кабинет менеджера');
    expect(html).toContain('контент');
    expect(html).toContain('Выйти');
  });

  it('renders NotificationBell with role="manager" in the header', () => {
    const html = renderToString(renderShell(makeSession({}), 'x'));
    expect(html).toContain('data-role="manager"');
  });

  it('shows the user email in the header when present', () => {
    const html = renderToString(renderShell(makeSession({ email: 'ivan@example.com' }), 'x'));
    expect(html).toContain('ivan@example.com');
  });

  it('omits the email span when session.email is undefined', () => {
    const html = renderToString(renderShell(makeSession({ email: undefined }), 'x'));
    expect(html).not.toContain('ivan@example.com');
  });

  it('leader session includes the "Команда" nav item (isManagerLeader true)', () => {
    const html = renderToString(
      renderShell(makeSession({ role: 'manager', managerRole: 'leader' }), 'x')
    );
    expect(html).toContain('Команда');
  });

  it('plain manager session omits "Команда"', () => {
    const html = renderToString(
      renderShell(makeSession({ role: 'manager', managerRole: undefined }), 'x')
    );
    expect(html).not.toContain('Команда');
  });
});
