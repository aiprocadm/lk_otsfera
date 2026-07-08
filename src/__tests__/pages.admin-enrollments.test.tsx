// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

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

vi.mock('@/components/enrollment/enrollment-request-form', () => ({
  EnrollmentRequestForm: () => React.createElement('div', { 'data-testid': 'enrollment-request-form' })
}));

import AdminEnrollmentsPage from '@/app/admin/enrollments/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminEnrollmentsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    isFeatureEnabled.mockReset();
    listEnrollmentRequests.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when enrollment_requests flag is disabled', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(AdminEnrollmentsPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('enrollment_requests');
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('lists enrollment requests when the flag is enabled', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireAdmin.mockResolvedValue(SESSION);
    listEnrollmentRequests.mockResolvedValue({ rows: [{ id: 'e1' }] });

    const { container } = await renderServerComponent(AdminEnrollmentsPage());

    expect(listEnrollmentRequests).toHaveBeenCalledWith({}, SESSION, {});
    expect(container.textContent).toContain('Заявки на обучение');
    expect(container.textContent).toContain('e1');
  });
});
