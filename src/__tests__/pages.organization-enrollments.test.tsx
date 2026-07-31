// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrganizationEnrollmentsPage from '@/app/organization/enrollments/page';
import { renderServerComponent } from './helpers/renderServerComponent';

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

const { trainingDirectionFindMany } = vi.hoisted(() => ({
  trainingDirectionFindMany: vi.fn().mockResolvedValue([{ id: 'd1', name: 'Охрана труда' }])
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { trainingDirection: { findMany: trainingDirectionFindMany } }
}));

vi.mock('@/components/enrollment/enrollment-wizard', () => ({
  EnrollmentWizard: () => React.createElement('div', { 'data-testid': 'enrollment-wizard' })
}));

const { listEnrollmentRequests } = vi.hoisted(() => ({ listEnrollmentRequests: vi.fn() }));
vi.mock('@/lib/services/enrollments/list', () => ({ listEnrollmentRequests }));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-app-shell' }, props.activeOrgName, props.children)
}));


const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const
};

describe('OrganizationEnrollmentsPage', () => {
  beforeEach(() => {
    isFeatureEnabled.mockReset();
    nav.notFound.mockClear();
    getOrgPageContext.mockReset();
    listEnrollmentRequests.mockReset();
  });

  it('calls notFound() when the enrollment_requests flag is disabled (defense-in-depth)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(OrganizationEnrollmentsPage())).rejects.toThrow(
      'NOT_FOUND'
    );

    expect(isFeatureEnabled).toHaveBeenCalledWith('enrollment_requests');
    expect(getOrgPageContext).not.toHaveBeenCalled();
  });

  it('renders the enrollment request form + list when the flag is enabled', async () => {
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(CTX);
    listEnrollmentRequests.mockResolvedValue({ rows: [], nextCursor: null });

    const { container } = await renderServerComponent(OrganizationEnrollmentsPage());

    expect(getOrgPageContext).toHaveBeenCalledWith({});
    expect(listEnrollmentRequests).toHaveBeenCalledWith(expect.anything(), CTX.session, {});
    expect(container.textContent).toContain('Заявки на обучение');
    expect(container.textContent).toContain('ООО Ромашка');
    // Мастер смонтирован; направления читаются активные и по sortOrder
    expect(container.querySelector('[data-testid="enrollment-wizard"]')).not.toBeNull();
    expect(trainingDirectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } })
    );
  });
});
