// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrganizationDashboardPage from '@/app/organization/dashboard/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

// Этап 4 (ФТ-10.4): страница читает зрителя через сервис welcome; welcomeSeenAt
// не-null → блок скрыт, старые сценарии этого файла его не касаются. Форма
// запроса пиннится в services.welcome.viewer.test.ts (аудит A1).
const { getWelcomeViewer } = vi.hoisted(() => ({ getWelcomeViewer: vi.fn() }));
vi.mock('@/lib/services/welcome/viewer', () => ({ getWelcomeViewer }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// Флаги мокаем в off: этот файл пиннит базовый дашборд; карточки за флагами
// (заявки/удостоверения) покрыты в pages.dashboard.enrollments.test.tsx. Без
// мока флаг зависел бы от окружения (.env локально vs его отсутствие в CI).
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { kpis, attention, recentEvents, recentEnrollments, expiringCertificates } = vi.hoisted(
  () => ({
    kpis: vi.fn(),
    attention: vi.fn(),
    recentEvents: vi.fn(),
    recentEnrollments: vi.fn(),
    expiringCertificates: vi.fn(),
  })
);
vi.mock('@/lib/services/organization/dashboard', () => ({
  kpis,
  attention,
  recentEvents,
  recentEnrollments,
  expiringCertificates,
}));

// OrgAppShell renders the sidebar/nav chrome — it is a plain (non-async) function
// component with its own dedicated coverage, so we mock it here to keep this test
// focused on the page's own data-fetch/branching logic.
vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};

describe('OrganizationDashboardPage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    kpis.mockReset();
    attention.mockReset();
    recentEvents.mockReset();
    getWelcomeViewer.mockReset();
    getWelcomeViewer.mockResolvedValue({ name: 'Иван', welcomeSeenAt: new Date('2026-01-01') });
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(false);
  });

  it('resolves org context from searchParams and renders KPI/attention/events sections', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    kpis.mockResolvedValue({ activeOrders: 3, totalStudents: 10, outstandingDebt: '0' });
    attention.mockResolvedValue({ items: [] });
    recentEvents.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      OrganizationDashboardPage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );

    expect(getOrgPageContext).toHaveBeenCalledWith({ org: 'org-1' });
    expect(kpis).toHaveBeenCalledWith(expect.anything(), 'org-1');
    expect(attention).toHaveBeenCalledWith(expect.anything(), 'org-1');
    expect(recentEvents).toHaveBeenCalledWith(expect.anything(), 'org-1');
    expect(getWelcomeViewer).toHaveBeenCalledWith(expect.anything(), CTX.session);
    expect(container.textContent).toContain('Главная');
    expect(container.textContent).toContain('ООО Ромашка');
    // welcomeSeenAt не-null → welcome-блока нет.
    expect(container.textContent).not.toContain('Добро пожаловать');
  });

  it('renders with empty searchParams (no org query param)', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    kpis.mockResolvedValue({});
    attention.mockResolvedValue({ items: [] });
    recentEvents.mockResolvedValue([]);

    await renderServerComponent(OrganizationDashboardPage({ searchParams: Promise.resolve({}) }));

    expect(getOrgPageContext).toHaveBeenCalledWith({});
  });
});
