// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartnerAdmin } = vi.hoisted(() => ({ requirePartnerAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartnerAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { canPartnerAccessOrg } = vi.hoisted(() => ({ canPartnerAccessOrg: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ canPartnerAccessOrg }));

const { getOrgCard } = vi.hoisted(() => ({ getOrgCard: vi.fn() }));
vi.mock('@/lib/services/partner/orgCard', () => ({ getOrgCard }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

import OrgSettingsPage from '@/app/partner/portfolio/[orgId]/settings/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', partnerRole: 'admin' as const };

const BASE_CARD = {
  id: 'org-1',
  name: 'ООО Ромашка',
  inn: '123456',
  kpp: null,
  legalName: null,
  assignedManagerUserId: null,
  partnerCommissionRate: '0.1000',
  partnerCommissionRateNote: 'Индивидуальная ставка',
  kpi: { ordersCount: 3, debt: '1000.00' }
};

describe('OrgSettingsPage', () => {
  beforeEach(() => {
    requirePartnerAdmin.mockReset();
    canPartnerAccessOrg.mockReset();
    getOrgCard.mockReset();
    nav.notFound.mockClear();
    nav.redirect.mockClear();
  });

  it('redirects to /forbidden when canPartnerAccessOrg denies access', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(false);

    await expect(
      renderServerComponent(
        OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) })
      )
    ).rejects.toThrow('REDIRECT:/forbidden');

    expect(getOrgCard).not.toHaveBeenCalled();
  });

  it('calls notFound() when getOrgCard returns null', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) })
      )
    ).rejects.toThrow('NOT_FOUND');
  });

  it('renders the org card header and the rate override form with the current rate/note', async () => {
    requirePartnerAdmin.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);

    const { container } = await renderServerComponent(
      OrgSettingsPage({ params: Promise.resolve({ orgId: 'org-1' }) })
    );

    expect(canPartnerAccessOrg).toHaveBeenCalledWith(SESSION, 'org-1');
    expect(getOrgCard).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: 'org-1', partnerId: 'p1' }
    );
    expect(container.textContent).toContain('ООО Ромашка');
  });
});
