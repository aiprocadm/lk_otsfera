// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { canPartnerAccessOrg, isPartnerAdmin } = vi.hoisted(() => ({
  canPartnerAccessOrg: vi.fn(),
  isPartnerAdmin: vi.fn()
}));
vi.mock('@/lib/auth/policy', () => ({ canPartnerAccessOrg, isPartnerAdmin }));

const { getOrgCard } = vi.hoisted(() => ({ getOrgCard: vi.fn() }));
vi.mock('@/lib/services/partner/orgCard', () => ({ getOrgCard }));

const { getOrgDocuments } = vi.hoisted(() => ({ getOrgDocuments: vi.fn() }));
vi.mock('@/lib/services/partner/orgDocuments', () => ({ getOrgDocuments }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  })
}));
vi.mock('next/navigation', () => nav);

import OrgDocumentsPage from '@/app/partner/portfolio/[orgId]/documents/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

const BASE_CARD = {
  id: 'org-1',
  name: 'ООО Ромашка',
  inn: '123456',
  kpp: null,
  legalName: null,
  assignedManagerUserId: null,
  partnerCommissionRate: null,
  partnerCommissionRateNote: null,
  kpi: { ordersCount: 3, debt: '1000.00' }
};

describe('OrgDocumentsPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    canPartnerAccessOrg.mockReset();
    isPartnerAdmin.mockReset();
    getOrgCard.mockReset();
    getOrgDocuments.mockReset();
    nav.notFound.mockClear();
    nav.redirect.mockClear();
  });

  it('redirects to /forbidden when canPartnerAccessOrg denies access', async () => {
    requirePartner.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(false);

    await expect(
      renderServerComponent(
        OrgDocumentsPage({
          params: Promise.resolve({ orgId: 'org-1' }),
          searchParams: Promise.resolve({})
        })
      )
    ).rejects.toThrow('REDIRECT:/forbidden');

    expect(getOrgCard).not.toHaveBeenCalled();
  });

  it('calls notFound() when getOrgCard returns null', async () => {
    requirePartner.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        OrgDocumentsPage({
          params: Promise.resolve({ orgId: 'org-1' }),
          searchParams: Promise.resolve({})
        })
      )
    ).rejects.toThrow('NOT_FOUND');

    expect(getOrgDocuments).not.toHaveBeenCalled();
  });

  it('passes undefined type filter for unrecognized values and renders no TypeFilter when total is 0', async () => {
    requirePartner.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);
    getOrgDocuments.mockResolvedValue({ rows: [], countsByType: {}, total: 0 });
    isPartnerAdmin.mockReturnValue(false);

    const { container } = await renderServerComponent(
      OrgDocumentsPage({
        params: Promise.resolve({ orgId: 'org-1' }),
        searchParams: Promise.resolve({ type: 'bogus' })
      })
    );

    expect(getOrgDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-1', partnerId: 'p1', type: undefined })
    );
    expect(container.querySelector('nav.flex.flex-wrap')).toBeNull();
  });

  it('parses a valid type filter and renders the TypeFilter chips when total > 0', async () => {
    requirePartner.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);
    getOrgDocuments.mockResolvedValue({
      rows: [],
      // 'invoice: undefined' exercises the `?? 0` fallback in the `present` filter
      // without being chip-rendered (present filters it out).
      countsByType: { contract: 2, invoice: undefined },
      total: 2
    });
    isPartnerAdmin.mockReturnValue(true);

    const { container } = await renderServerComponent(
      OrgDocumentsPage({
        params: Promise.resolve({ orgId: 'org-1' }),
        searchParams: Promise.resolve({ type: 'contract' })
      })
    );

    expect(getOrgDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'contract' })
    );
    expect(container.querySelector('nav.flex.flex-wrap')).not.toBeNull();
    expect(container.textContent).toContain('Договоры');
    expect(container.textContent).not.toContain('Счета');
  });
});
