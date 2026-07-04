// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listEnrollmentRequests } = vi.hoisted(() => ({ listEnrollmentRequests: vi.fn() }));
vi.mock('@/lib/services/enrollments/list', () => ({ listEnrollmentRequests }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/enrollment/enrollment-queue', () => ({
  EnrollmentQueue: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'enrollment-queue' }, JSON.stringify(props.rows))
}));

import LeaderEnrollmentsPage from '@/app/leader/enrollments/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'leader' as const, companyId: 'c1' };

describe('LeaderEnrollmentsPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    isFeatureEnabled.mockReset();
    listEnrollmentRequests.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when the enrollment_requests flag is disabled (before auth check)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(LeaderEnrollmentsPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('enrollment_requests');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('renders the enrollment queue when the flag is enabled', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listEnrollmentRequests.mockResolvedValue({ rows: [{ id: 'e1' }], nextCursor: null });

    const { container } = await renderServerComponent(LeaderEnrollmentsPage());

    expect(listEnrollmentRequests).toHaveBeenCalledWith({}, SESSION, {});
    expect(container.textContent).toContain('Заявки на обучение');
  });
});
