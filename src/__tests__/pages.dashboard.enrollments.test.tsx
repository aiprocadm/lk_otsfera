// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

/**
 * PR-2 (ФТ-2.4): карточка «Заявки на обучение» на дашбордах организации и
 * партнёра — рендерится и данные запрашиваются ТОЛЬКО при включённом флаге
 * enrollment_requests (при off — recentEnrollments даже не вызывается).
 */

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

// Этап 4 (ФТ-10.4): дашборды читают welcomeSeenAt зрителя; не-null → welcome-блок
// скрыт и не мешает сценариям этого файла.
const { userFindUnique } = vi.hoisted(() => ({ userFindUnique: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: userFindUnique } } }));

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

const org = vi.hoisted(() => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn(),
  recentEnrollments: vi.fn(),
  expiringCertificates: vi.fn()
}));
vi.mock('@/lib/services/organization/dashboard', () => org);

const partner = vi.hoisted(() => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn(),
  recentEnrollments: vi.fn(),
  expiringCertificates: vi.fn()
}));
vi.mock('@/lib/services/partner/dashboard', () => partner);

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-app-shell' }, props.activeOrgName, props.children)
}));

import OrganizationDashboardPage from '@/app/organization/dashboard/page';
import PartnerDashboard from '@/app/partner/dashboard/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const ORG_CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const
};
const PARTNER_SESSION = { sub: 'p1', role: 'partner' as const, partnerId: 'pt-1', assignedOrgIds: ['org-9'] };
const PARTNER_SCOPE = { partnerId: 'pt-1', scopeOrgIds: ['org-9'] };

beforeEach(() => {
  vi.resetAllMocks();

  userFindUnique.mockResolvedValue({ name: 'Иван', welcomeSeenAt: new Date('2026-01-01') });
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
    commissionThisMonth: '300.00'
  });
  partner.attention.mockResolvedValue({ stuckOrders: [], overdueOrders: [], });
  partner.recentEvents.mockResolvedValue([]);
  partner.recentEnrollments.mockResolvedValue([]);
  partner.expiringCertificates.mockResolvedValue(0);
});

describe('OrganizationDashboardPage — карточка заявок', () => {
  it('флаг on → заголовок «Заявки на обучение» и вызов recentEnrollments по активной организации', async () => {
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(
      OrganizationDashboardPage({ searchParams: Promise.resolve({}) })
    );

    expect(isFeatureEnabled).toHaveBeenCalledWith('enrollment_requests');
    expect(org.recentEnrollments).toHaveBeenCalledWith(expect.anything(), 'org-1');
    expect(container.textContent).toContain('Заявки на обучение');
  });

  it('флаг off → карточки нет и recentEnrollments не вызывается', async () => {
    isFeatureEnabled.mockReturnValue(false);

    const { container } = await renderServerComponent(
      OrganizationDashboardPage({ searchParams: Promise.resolve({}) })
    );

    expect(org.recentEnrollments).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Заявки на обучение');
    // Остальной дашборд живёт как раньше.
    expect(container.textContent).toContain('Главная');
    expect(org.kpis).toHaveBeenCalledWith(expect.anything(), 'org-1');
  });
});

describe('PartnerDashboard — карточка заявок', () => {
  it('флаг on → заголовок «Заявки на обучение» и вызов recentEnrollments со скоупом партнёра', async () => {
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(PartnerDashboard());

    expect(partner.recentEnrollments).toHaveBeenCalledWith(expect.anything(), PARTNER_SCOPE);
    expect(container.textContent).toContain('Заявки на обучение');
  });

  it('флаг off → карточки нет и recentEnrollments не вызывается', async () => {
    isFeatureEnabled.mockReturnValue(false);

    const { container } = await renderServerComponent(PartnerDashboard());

    expect(partner.recentEnrollments).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Заявки на обучение');
    expect(container.textContent).toContain('Кабинет партнёра');
    expect(partner.recentEvents).toHaveBeenCalledWith(expect.anything(), PARTNER_SCOPE, 10);
  });
});
