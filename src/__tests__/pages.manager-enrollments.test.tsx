// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerEnrollmentsPage from '@/app/manager/enrollments/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { trainingDirectionFindMany } = vi.hoisted(() => ({
  trainingDirectionFindMany: vi.fn().mockResolvedValue([{ id: 'd1', name: 'Охрана труда' }]),
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { trainingDirection: { findMany: trainingDirectionFindMany } },
}));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listEnrollmentRequests } = vi.hoisted(() => ({ listEnrollmentRequests: vi.fn() }));
vi.mock('@/lib/services/enrollments/list', () => ({ listEnrollmentRequests }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/enrollment/enrollment-queue', () => ({
  EnrollmentQueue: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'enrollment-queue' }, JSON.stringify(props.rows)),
}));

vi.mock('@/components/enrollment/enrollment-wizard', () => ({
  EnrollmentWizard: () => React.createElement('div', { 'data-testid': 'enrollment-form' }),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  managerRole: 'member' as const,
  companyId: 'c1',
};

describe('ManagerEnrollmentsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    isFeatureEnabled.mockReset();
    listEnrollmentRequests.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when the enrollment_requests flag is disabled (before auth check)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(ManagerEnrollmentsPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('enrollment_requests');
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('renders the enrollment queue + request form when the flag is enabled', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listEnrollmentRequests.mockResolvedValue({ rows: [{ id: 'e1' }], nextCursor: null });

    const { container } = await renderServerComponent(ManagerEnrollmentsPage());

    expect(listEnrollmentRequests).toHaveBeenCalledWith(expect.anything(), SESSION, {});
    expect(container.textContent).toContain('Заявки на обучение');
    expect(container.querySelector('[data-testid="enrollment-form"]')).not.toBeNull();
  });
});
