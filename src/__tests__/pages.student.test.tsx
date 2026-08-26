// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

// AppShell/OrgAppShell are async server components with their own dedicated
// unit tests (components.dashboard-app-shell.test.tsx /
// components.org-app-shell.test.tsx). StudentPage returns `<AppShell>{...}</AppShell>`
// WITHOUT awaiting AppShell itself (React resolves nested async server
// components during rendering, not at call time) — jsdom +
// @testing-library/react cannot resolve that nested async component ("Only
// Server Components can be async" / suspended-outside-act errors). Mocking
// AppShell/OrgAppShell as plain sync page-level deps sidesteps that and
// keeps this test focused on StudentPage's own branching (which shell +
// which props), matching how their internals are already covered elsewhere.
vi.mock('@/components/dashboard/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'app-shell' }, children),
}));
vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: {
    userEmail?: string | null;
    activeOrgName: string;
    children: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      `${props.activeOrgName} / ${props.userEmail ?? ''}`,
      props.children
    ),
}));

import StudentPage from '@/app/student/page';

describe('StudentPage', () => {
  beforeEach(() => {
    getSession.mockReset();
    getOrgPageContext.mockReset();
  });

  it('renders the generic AppShell with the student CONTENT for a student session', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'student', name: 'Иван Студентов' });

    const { container } = await renderServerComponent(
      StudentPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.querySelector('[data-testid="app-shell"]')).toBeTruthy();
    expect(container.textContent).toContain('Кабинет слушателя');
    expect(container.textContent).toContain('Перейти к обучению');
    expect(getOrgPageContext).not.toHaveBeenCalled();
  });

  it('renders the OrgAppShell (org-native chrome) for an organization session', async () => {
    getSession.mockResolvedValue({ sub: 'u2', role: 'organization', name: 'Орг Юзер' });
    getOrgPageContext.mockResolvedValue({
      session: { sub: 'u2', role: 'organization', email: 'org@example.com' },
      activeOrgId: 'org-1',
      activeOrgName: 'ООО Ромашка',
      memberships: [],
      viewerRole: 'admin',
    });

    const { container } = await renderServerComponent(
      StudentPage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );

    expect(getOrgPageContext).toHaveBeenCalledWith({ org: 'org-1' });
    expect(container.querySelector('[data-testid="org-app-shell"]')).toBeTruthy();
    expect(container.textContent).toContain('ООО Ромашка');
    // `У-115`: подпись шапки — «<Кабинет> · <организация>»; почта из неё ушла,
    // потому что кабинет важнее адреса почты (одна строка на все кабинеты).
    expect(container.textContent).not.toContain('org@example.com');
    expect(container.textContent).toContain('Кабинет слушателя');
  });

  it('falls through to the generic AppShell branch for any non-organization role (e.g. manager)', async () => {
    getSession.mockResolvedValue({ sub: 'u3', role: 'manager', name: 'M' });

    const { container } = await renderServerComponent(
      StudentPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.querySelector('[data-testid="app-shell"]')).toBeTruthy();
    expect(getOrgPageContext).not.toHaveBeenCalled();
  });
});
