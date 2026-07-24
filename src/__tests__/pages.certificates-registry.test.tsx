// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Этап 3 PR-1 (ФТ-6.1/6.2): страницы реестров удостоверений организации и
 * партнёра — флаг off → notFound; успех → сервис зовётся с распарсенными
 * фильтрами в границах скоупа; неизвестный статус игнорируется.
 */

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

const { trainingDirectionFindMany, organizationFindMany } = vi.hoisted(() => ({
  trainingDirectionFindMany: vi.fn(),
  organizationFindMany: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    trainingDirection: { findMany: trainingDirectionFindMany },
    organization: { findMany: organizationFindMany }
  }
}));

const { listCertificates } = vi.hoisted(() => ({ listCertificates: vi.fn() }));
vi.mock('@/lib/services/training/certificates', () => ({
  listCertificates,
  EXPIRING_WITHIN_DAYS: 60
}));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-app-shell' }, props.activeOrgName, props.children)
}));

import OrganizationCertificatesPage from '@/app/organization/certificates/page';
import PartnerCertificatesPage from '@/app/partner/certificates/page';

const ORG_CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const
};
const PARTNER_ADMIN = { sub: 'p1', role: 'partner' as const, partnerId: 'pt-1', partnerRole: 'admin' as const };
const PARTNER_MANAGER = {
  sub: 'p2',
  role: 'partner' as const,
  partnerId: 'pt-1',
  partnerRole: 'manager' as const,
  assignedOrgIds: ['org-9']
};

const CERT = {
  id: 'c1',
  number: 'УД-1',
  issuedAt: new Date('2026-01-01'),
  validUntil: null,
  documentId: null,
  student: { id: 's1', name: 'Иванов Иван' },
  direction: { id: 'd1', name: 'Охрана труда' },
  organization: { id: 'org-1', name: 'ООО Ромашка' }
};

const props = (sp: Record<string, string> = {}) => ({ searchParams: Promise.resolve(sp) });

beforeEach(() => {
  vi.resetAllMocks();
  nav.notFound.mockImplementation(() => {
    throw new Error('NOT_FOUND');
  });
  trainingDirectionFindMany.mockResolvedValue([{ id: 'd1', name: 'Охрана труда' }]);
  organizationFindMany.mockResolvedValue([{ id: 'org-9', name: 'ООО Девятка' }]);
  listCertificates.mockResolvedValue({ ok: true, certificates: [CERT], total: 1 });
});

describe('OrganizationCertificatesPage', () => {
  it('флаг off → notFound, контекст не запрашивается', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(OrganizationCertificatesPage(props()))).rejects.toThrow('NOT_FOUND');
    expect(isFeatureEnabled).toHaveBeenCalledWith('certificates_registry');
    expect(getOrgPageContext).not.toHaveBeenCalled();
  });

  it('успех: сервис зовётся с активной организацией и распарсенными фильтрами', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);

    const { container } = await renderServerComponent(
      OrganizationCertificatesPage(props({ direction: 'd1', status: 'expiring', search: 'Иван', take: '10', skip: '20', org: 'org-1' }))
    );

    expect(listCertificates).toHaveBeenCalledWith(expect.anything(), ORG_CTX.session, {
      organizationId: 'org-1',
      directionId: 'd1',
      status: 'expiring',
      search: 'Иван',
      take: 10,
      skip: 20
    });
    expect(container.textContent).toContain('Удостоверения');
    expect(container.textContent).toContain('Иванов Иван');
    expect(container.textContent).toContain('ООО Ромашка');
  });

  it('неизвестный status и кривые take/skip → безопасные значения по умолчанию', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);

    await renderServerComponent(OrganizationCertificatesPage(props({ status: 'bogus', take: 'x', skip: '-5' })));

    expect(listCertificates).toHaveBeenCalledWith(
      expect.anything(),
      ORG_CTX.session,
      expect.objectContaining({ status: undefined, take: 50, skip: 0 })
    );
  });
});

describe('PartnerCertificatesPage', () => {
  it('флаг off → notFound, requirePartner не вызывается', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(PartnerCertificatesPage(props()))).rejects.toThrow('NOT_FOUND');
    expect(requirePartner).not.toHaveBeenCalled();
  });

  it('успех (partner-admin): селект организаций по partnerId без сужения; фильтр организации уходит в сервис', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requirePartner.mockResolvedValue(PARTNER_ADMIN);

    const { container } = await renderServerComponent(
      PartnerCertificatesPage(props({ organization: 'org-9', status: 'expired' }))
    );

    expect(organizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerId: 'pt-1' } })
    );
    expect(listCertificates).toHaveBeenCalledWith(
      expect.anything(),
      PARTNER_ADMIN,
      expect.objectContaining({ organizationId: 'org-9', status: 'expired', take: 50, skip: 0 })
    );
    expect(container.textContent).toContain('по вашим организациям');
  });

  it('partner-manager: селект организаций сужен до assignedOrgIds', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requirePartner.mockResolvedValue(PARTNER_MANAGER);

    await renderServerComponent(PartnerCertificatesPage(props()));

    expect(organizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerId: 'pt-1', id: { in: ['org-9'] } } })
    );
  });

  it('partner-manager без assignedOrgIds → пустое сужение (?? [])', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requirePartner.mockResolvedValue({ ...PARTNER_MANAGER, assignedOrgIds: undefined });

    await renderServerComponent(PartnerCertificatesPage(props()));

    expect(organizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerId: 'pt-1', id: { in: [] } } })
    );
  });
});
