// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Этап 3 PR-1 (ФТ-6.4): KPI-карточка «Истекают удостоверения» на дашбордах
 * организации и партнёра — только при флаге certificates_registry (off →
 * счётчик даже не считается).
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

const ORG_CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const
};
const PARTNER_SESSION = { sub: 'p1', role: 'partner' as const, partnerId: 'pt-1', assignedOrgIds: ['org-9'] };

// Флаг-роутер: certificates on/off, enrollment всегда off (карточка заявок
// покрыта своим тестом; здесь изолируем ветку удостоверений).
function flags(certificatesOn: boolean) {
  isFeatureEnabled.mockImplementation((flag: string) => flag === 'certificates_registry' && certificatesOn);
}

beforeEach(() => {
  vi.resetAllMocks();

  userFindUnique.mockResolvedValue({ name: 'Иван', welcomeSeenAt: new Date('2026-01-01') });
  getOrgPageContext.mockResolvedValue(ORG_CTX);
  org.kpis.mockResolvedValue({ activeOrders: 1, outstandingAmount: '0', studentsCount: 2, recentDocumentsCount: 3 });
  org.attention.mockResolvedValue({ items: [] });
  org.recentEvents.mockResolvedValue([]);
  org.expiringCertificates.mockResolvedValue(4);

  requirePartner.mockResolvedValue(PARTNER_SESSION);
  partner.kpis.mockResolvedValue({ openOrders: 1, outstanding: '0', commissionThisMonth: '0' });
  partner.attention.mockResolvedValue({ stuckOrders: [], overdueOrders: [], });
  partner.recentEvents.mockResolvedValue([]);
  partner.expiringCertificates.mockResolvedValue(6);
});

describe('OrganizationDashboardPage — KPI удостоверений', () => {
  it('флаг on → карточка с числом, счётчик по активной организации', async () => {
    flags(true);
    const { container } = await renderServerComponent(
      OrganizationDashboardPage({ searchParams: Promise.resolve({}) })
    );
    expect(org.expiringCertificates).toHaveBeenCalledWith(expect.anything(), 'org-1');
    expect(container.textContent).toContain('Истекают удостоверения');
    expect(container.textContent).toContain('4');
  });

  it('флаг off → карточки нет и счётчик не считается', async () => {
    flags(false);
    const { container } = await renderServerComponent(
      OrganizationDashboardPage({ searchParams: Promise.resolve({}) })
    );
    expect(org.expiringCertificates).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Истекают удостоверения');
  });
});

describe('PartnerDashboard — KPI удостоверений', () => {
  it('флаг on → карточка с числом, счётчик по скоупу партнёра', async () => {
    flags(true);
    const { container } = await renderServerComponent(PartnerDashboard());
    expect(partner.expiringCertificates).toHaveBeenCalledWith(expect.anything(), { partnerId: 'pt-1', scopeOrgIds: ['org-9'] });
    expect(container.textContent).toContain('Истекают удостоверения');
    expect(container.textContent).toContain('6');
  });

  it('флаг off → карточки нет и счётчик не считается', async () => {
    flags(false);
    const { container } = await renderServerComponent(PartnerDashboard());
    expect(partner.expiringCertificates).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Истекают удостоверения');
  });
});
