// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

// Справочники (организации партнёра + направления) уехали в сервисы; форма
// запросов и граница портфеля пиннятся в services.partner.orgOptions.test.ts и
// services.training.directionOptions.test.ts (аудит A1).
const { listPartnerOrgOptions, listDirectionOptions } = vi.hoisted(() => ({
  listPartnerOrgOptions: vi.fn(),
  listDirectionOptions: vi.fn().mockResolvedValue([{ id: 'd1', name: 'Охрана труда' }]),
}));
vi.mock('@/lib/services/partner/orgOptions', () => ({ listPartnerOrgOptions }));
vi.mock('@/lib/services/training/directions', () => ({ listDirectionOptions }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import React from 'react';
vi.mock('@/components/enrollment/enrollment-wizard', () => ({
  EnrollmentWizard: () => React.createElement('div', { 'data-testid': 'enrollment-wizard' }),
}));

const { listEnrollmentRequests } = vi.hoisted(() => ({ listEnrollmentRequests: vi.fn() }));
vi.mock('@/lib/services/enrollments/list', () => ({ listEnrollmentRequests }));

import PartnerEnrollmentsPage from '@/app/partner/enrollments/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: [] };

describe('PartnerEnrollmentsPage', () => {
  beforeEach(() => {
    isFeatureEnabled.mockReset();
    nav.notFound.mockClear();
    requirePartner.mockReset();
    listPartnerOrgOptions.mockReset();
    listEnrollmentRequests.mockReset();
  });

  it('calls notFound() when the enrollment_requests flag is disabled (defense-in-depth)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(PartnerEnrollmentsPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('enrollment_requests');
    expect(requirePartner).not.toHaveBeenCalled();
  });

  it('renders the request form and list, scoping organizations to the partner', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requirePartner.mockResolvedValue(SESSION);
    listEnrollmentRequests.mockResolvedValue({
      rows: [
        {
          id: 'e1',
          directionName: 'Охрана труда',
          studentCount: 1,
          firstStudentName: 'Иванов И.И.',
          items: [],
          status: 'pending' as const,
          organizationId: null,
          organizationName: null,
          partnerName: null,
          submitterRole: 'partner',
          submittedByName: 'Партнёр П.',
          rejectedReason: null,
          note: null,
          createdAt: new Date('2024-01-01'),
          reviewedAt: null,
        },
      ],
      nextCursor: null,
    });
    listPartnerOrgOptions.mockResolvedValue([{ id: 'org-1', name: 'ООО Ромашка' }]);

    const { container } = await renderServerComponent(PartnerEnrollmentsPage());

    expect(listEnrollmentRequests).toHaveBeenCalledWith(expect.anything(), SESSION, {});
    expect(listPartnerOrgOptions).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1' });
    expect(container.textContent).toContain('Заявки на обучение');
  });
});
