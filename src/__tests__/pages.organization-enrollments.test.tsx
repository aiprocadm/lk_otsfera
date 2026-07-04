// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
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

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listEnrollmentRequests } = vi.hoisted(() => ({ listEnrollmentRequests: vi.fn() }));
vi.mock('@/lib/services/enrollments/list', () => ({ listEnrollmentRequests }));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-app-shell' }, props.activeOrgName, props.children)
}));

import OrganizationEnrollmentsPage from '@/app/organization/enrollments/page';

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
    expect(listEnrollmentRequests).toHaveBeenCalledWith({}, CTX.session, {});
    expect(container.textContent).toContain('Заявки на обучение');
    expect(container.textContent).toContain('ООО Ромашка');
  });
});
