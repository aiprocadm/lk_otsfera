// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

/**
 * PR-2 (ФТ-2.3): деталка заявки подателя — обе страницы [id]
 * (organization и partner). Ветки: флаг off → notFound; сервис not_found
 * (чужая/несуществующая заявка) → notFound; успех → разметка с направлением.
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

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getEnrollmentRequest } = vi.hoisted(() => ({ getEnrollmentRequest: vi.fn() }));
vi.mock('@/lib/services/enrollments/detail', () => ({ getEnrollmentRequest }));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-app-shell' }, props.activeOrgName, props.children)
}));

// Презентационная деталка покрыта своими W1-тестами; здесь — стаб с
// направлением и backHref, чтобы проверить, что страница прокинула detail.
vi.mock('@/components/enrollment/enrollment-detail-view', () => ({
  EnrollmentDetailView: (props: { detail: { directionName: string }; backHref: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'enrollment-detail-view', 'data-back': props.backHref },
      props.detail.directionName
    )
}));

import OrganizationEnrollmentDetailPage from '@/app/organization/enrollments/[id]/page';
import PartnerEnrollmentDetailPage from '@/app/partner/enrollments/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const ORG_CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const
};
const PARTNER_SESSION = { sub: 'p1', role: 'partner' as const, partnerId: 'pt-1' };
const DETAIL = { id: 'E1', directionName: 'Охрана труда', items: [] };
const props = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  nav.notFound.mockImplementation(() => {
    throw new Error('NOT_FOUND');
  });
});

describe('OrganizationEnrollmentDetailPage', () => {
  it('флаг off → notFound, контекст не запрашивается', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(OrganizationEnrollmentDetailPage(props('E1')))).rejects.toThrow('NOT_FOUND');
    expect(isFeatureEnabled).toHaveBeenCalledWith('enrollment_requests');
    expect(getOrgPageContext).not.toHaveBeenCalled();
  });

  it('сервис not_found (чужая заявка) → notFound', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getEnrollmentRequest.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(renderServerComponent(OrganizationEnrollmentDetailPage(props('чужая')))).rejects.toThrow('NOT_FOUND');
    expect(getEnrollmentRequest).toHaveBeenCalledWith({}, ORG_CTX.session, 'чужая');
  });

  it('успех → разметка содержит направление внутри OrgAppShell, backHref организации', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ORG_CTX);
    getEnrollmentRequest.mockResolvedValue({ ok: true, request: DETAIL });

    const { container } = await renderServerComponent(OrganizationEnrollmentDetailPage(props('E1')));

    expect(container.textContent).toContain('Охрана труда');
    expect(container.textContent).toContain('ООО Ромашка');
    expect(container.querySelector('[data-testid="org-app-shell"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="enrollment-detail-view"]')?.getAttribute('data-back')).toBe(
      '/organization/enrollments'
    );
  });
});

describe('PartnerEnrollmentDetailPage', () => {
  it('флаг off → notFound, requirePartner не вызывается', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(PartnerEnrollmentDetailPage(props('E1')))).rejects.toThrow('NOT_FOUND');
    expect(requirePartner).not.toHaveBeenCalled();
  });

  it('сервис not_found → notFound', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requirePartner.mockResolvedValue(PARTNER_SESSION);
    getEnrollmentRequest.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(renderServerComponent(PartnerEnrollmentDetailPage(props('E404')))).rejects.toThrow('NOT_FOUND');
    expect(getEnrollmentRequest).toHaveBeenCalledWith({}, PARTNER_SESSION, 'E404');
  });

  it('успех → разметка содержит направление, backHref партнёра', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requirePartner.mockResolvedValue(PARTNER_SESSION);
    getEnrollmentRequest.mockResolvedValue({ ok: true, request: DETAIL });

    const { container } = await renderServerComponent(PartnerEnrollmentDetailPage(props('E1')));

    expect(container.textContent).toContain('Охрана труда');
    expect(container.querySelector('[data-testid="enrollment-detail-view"]')?.getAttribute('data-back')).toBe(
      '/partner/enrollments'
    );
  });
});
