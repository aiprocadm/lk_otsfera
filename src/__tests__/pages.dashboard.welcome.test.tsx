// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

/**
 * Этап 4 (ФТ-10.4): одноразовый welcome-блок на дашбордах организации и
 * партнёра — рендерится ТОЛЬКО пока welcomeSeenAt === null; после скрытия
 * (не-null) блока нет. Состав карточек собирает welcomeActionsFor по флагам.
 */

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

// Зритель блока приезжает из сервиса welcome; форма запроса к БД пиннится в
// services.welcome.viewer.test.ts (аудит A1).
const { getWelcomeViewer } = vi.hoisted(() => ({ getWelcomeViewer: vi.fn() }));
vi.mock('@/lib/services/welcome/viewer', () => ({ getWelcomeViewer }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { requirePartner, requireSession } = vi.hoisted(() => ({
  requirePartner: vi.fn(),
  requireSession: vi.fn(),
}));
// requireSession нужен транзитивно: WelcomeCard → dismissWelcomeAction → requireRole.
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner, requireSession }));

// WelcomeCard — client component c useRouter.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const org = vi.hoisted(() => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn(),
  recentEnrollments: vi.fn(),
  expiringCertificates: vi.fn(),
}));
vi.mock('@/lib/services/organization/dashboard', () => org);

const partner = vi.hoisted(() => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn(),
  recentEnrollments: vi.fn(),
  expiringCertificates: vi.fn(),
}));
vi.mock('@/lib/services/partner/dashboard', () => partner);

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

import OrganizationDashboardPage from '@/app/organization/dashboard/page';
import PartnerDashboard from '@/app/partner/dashboard/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const ORG_CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};
const PARTNER_SESSION = {
  sub: 'p1',
  role: 'partner' as const,
  partnerId: 'pt-1',
  assignedOrgIds: ['org-9'],
};

beforeEach(() => {
  vi.resetAllMocks();

  isFeatureEnabled.mockReturnValue(false);

  getOrgPageContext.mockResolvedValue(ORG_CTX);
  org.kpis.mockResolvedValue({ activeOrders: 3, totalStudents: 10, outstandingDebt: '0' });
  org.attention.mockResolvedValue({ items: [] });
  org.recentEvents.mockResolvedValue([]);
  org.recentEnrollments.mockResolvedValue([]);
  org.expiringCertificates.mockResolvedValue(0);

  requirePartner.mockResolvedValue(PARTNER_SESSION);
  partner.kpis.mockResolvedValue({
    openOrders: 5,
    outstanding: '1000.00',
    commissionThisMonth: '300.00',
  });
  partner.attention.mockResolvedValue({ stuckOrders: [], overdueOrders: [] });
  partner.recentEvents.mockResolvedValue([]);
  partner.recentEnrollments.mockResolvedValue([]);
  partner.expiringCertificates.mockResolvedValue(0);
});

describe('OrganizationDashboardPage — welcome-блок', () => {
  it('welcomeSeenAt null → блок «Добро пожаловать» с именем и карточками', async () => {
    getWelcomeViewer.mockResolvedValue({ name: 'Иван', welcomeSeenAt: null });

    const { container } = await renderServerComponent(
      OrganizationDashboardPage({ searchParams: Promise.resolve({}) })
    );

    expect(getWelcomeViewer).toHaveBeenCalledWith(expect.anything(), ORG_CTX.session);
    expect(container.textContent).toContain('Добро пожаловать, Иван!');
    // Флаги off → «Документы» + фолбэки, ссылки ведут в кабинет организации.
    expect(container.textContent).toContain('Документы');
    expect(container.querySelector('a[href="/organization/documents"]')).toBeTruthy();
    expect(container.textContent).toContain('Скрыть');
  });

  it('welcomeSeenAt не-null → блока нет, остальной дашборд живёт', async () => {
    getWelcomeViewer.mockResolvedValue({ name: 'Иван', welcomeSeenAt: new Date('2026-01-01') });

    const { container } = await renderServerComponent(
      OrganizationDashboardPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).not.toContain('Добро пожаловать');
    expect(container.textContent).toContain('Главная');
  });
});

describe('PartnerDashboard — welcome-блок', () => {
  it('welcomeSeenAt null → блок «Добро пожаловать» с карточками партнёрского кабинета', async () => {
    getWelcomeViewer.mockResolvedValue({ name: 'Пётр', welcomeSeenAt: null });

    const { container } = await renderServerComponent(PartnerDashboard());

    expect(getWelcomeViewer).toHaveBeenCalledWith(expect.anything(), PARTNER_SESSION);
    expect(container.textContent).toContain('Добро пожаловать, Пётр!');
    expect(container.querySelector('a[href="/partner/documents"]')).toBeTruthy();
    expect(container.textContent).toContain('Скрыть');
  });

  it('welcomeSeenAt не-null → блока нет', async () => {
    getWelcomeViewer.mockResolvedValue({ name: 'Пётр', welcomeSeenAt: new Date('2026-01-01') });

    const { container } = await renderServerComponent(PartnerDashboard());

    expect(container.textContent).not.toContain('Добро пожаловать');
    expect(container.textContent).toContain('Кабинет партнёра');
  });
});
