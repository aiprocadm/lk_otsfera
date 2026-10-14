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

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
const { getStudentCabinet } = vi.hoisted(() => ({ getStudentCabinet: vi.fn() }));
vi.mock('@/lib/services/students/cabinet', () => ({ getStudentCabinet }));

import StudentPage from '@/app/student/page';

describe('StudentPage', () => {
  beforeEach(() => {
    getSession.mockReset();
    getOrgPageContext.mockReset();
    getStudentCabinet.mockReset();
    getStudentCabinet.mockResolvedValue({ ok: false, error: 'forbidden' });
  });

  it('этап 2 ТЗ 13.10.2026 (`У-285`): у слушателя на главной — «Мои обучения» с кнопкой площадки у каждого', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });
    getStudentCabinet.mockResolvedValue({
      ok: true,
      cabinet: {
        name: 'Анна',
        organizations: ['ООО Ромашка'],
        certificates: [],
        trainings: [
          {
            id: 't1',
            directionName: 'Охрана труда',
            organizationName: 'ООО Ромашка',
            status: 'approved',
            statusLabel: 'Обучение назначено',
            startsOn: '2026-11-01',
            endsOn: '2026-11-15',
          },
          {
            id: 't2',
            directionName: 'Пожарная безопасность',
            organizationName: 'ООО Ромашка',
            status: 'in_training',
            statusLabel: 'Идёт обучение',
            startsOn: null,
            endsOn: null,
          },
        ],
      },
    });

    const { container } = await renderServerComponent(
      StudentPage({ searchParams: Promise.resolve({}) })
    );

    expect(getStudentCabinet).toHaveBeenCalledWith({}, { sub: 'u1', role: 'student' });
    expect(container.textContent).toContain('Мои обучения');
    expect(container.textContent).toContain('Обучение назначено · с 01.11.2026 по 15.11.2026');
    expect(container.textContent).toContain('Идёт обучение · сроки ещё не назначены');
    const portal = [...container.querySelectorAll('a')].filter(
      (a) => a.textContent === 'Перейти на учебную площадку'
    );
    expect(portal.map((a) => a.getAttribute('href'))).toEqual([
      '/student/redirect',
      '/student/redirect',
    ]);
    // Прежняя кнопка остаётся.
    expect(container.textContent).toContain('Перейти к обучению');
  });

  it('без обучений — объяснение и ссылка в справку, а не пустота', async () => {
    getSession.mockResolvedValue({ sub: 'u1', role: 'student' });
    getStudentCabinet.mockResolvedValue({
      ok: true,
      cabinet: { name: '', organizations: [], trainings: [], certificates: [] },
    });
    const { container } = await renderServerComponent(
      StudentPage({ searchParams: Promise.resolve({}) })
    );
    expect(container.textContent).toContain('Обучений пока нет');
    expect(container.querySelector('a[href="/help"]')).toBeTruthy();
  });

  it('без сессии кабинет не запрашивается', async () => {
    getSession.mockResolvedValue(null);
    const { container } = await renderServerComponent(
      StudentPage({ searchParams: Promise.resolve({}) })
    );
    expect(getStudentCabinet).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Мои обучения');
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
    // Сервис кабинета отказал (не слушатель) — блока «Мои обучения» нет.
    expect(container.textContent).not.toContain('Мои обучения');
  });
});
