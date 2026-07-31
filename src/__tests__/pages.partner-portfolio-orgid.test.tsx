// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrgCardPage from '@/app/partner/portfolio/[orgId]/page';
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

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  })
}));
vi.mock('next/navigation', () => nav);

// EmployeesTab / CommentsTab / HistoryTab / CustomerAccessSection are async
// server components with their own dedicated coverage elsewhere (W1 phase);
// mock them at module level per the recipe rather than rendering them live.
vi.mock('@/components/partner/org-employees-tab', () => ({
  EmployeesTab: ({ orgId }: { orgId: string }) =>
    React.createElement('div', { 'data-testid': 'employees-tab' }, `employees:${orgId}`)
}));
vi.mock('@/components/partner/org-comments-tab', () => ({
  CommentsTab: ({ orgId }: { orgId: string }) =>
    React.createElement('div', { 'data-testid': 'comments-tab' }, `comments:${orgId}`)
}));
vi.mock('@/components/partner/org-history-tab', () => ({
  HistoryTab: ({ orgId }: { orgId: string }) =>
    React.createElement('div', { 'data-testid': 'history-tab' }, `history:${orgId}`)
}));
vi.mock('@/components/partner/customer-access-section', () => ({
  CustomerAccessSection: ({ organizationId, canInvite }: { organizationId: string; canInvite: boolean }) =>
    React.createElement('div', { 'data-testid': 'customer-access' }, `access:${organizationId}:${String(canInvite)}`)
}));


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

describe('OrgCardPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    canPartnerAccessOrg.mockReset();
    isPartnerAdmin.mockReset();
    getOrgCard.mockReset();
    nav.notFound.mockClear();
    nav.redirect.mockClear();
  });

  it('redirects to /forbidden when canPartnerAccessOrg denies access', async () => {
    requirePartner.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(false);

    await expect(
      renderServerComponent(
        OrgCardPage({
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
        OrgCardPage({
          params: Promise.resolve({ orgId: 'org-1' }),
          searchParams: Promise.resolve({})
        })
      )
    ).rejects.toThrow('NOT_FOUND');
  });

  it('defaults to the "employees" tab for an unrecognized tab value, and marks canInvite=true for an admin', async () => {
    requirePartner.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);
    isPartnerAdmin.mockReturnValue(true);

    const { container } = await renderServerComponent(
      OrgCardPage({
        params: Promise.resolve({ orgId: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'bogus' })
      })
    );

    expect(container.querySelector('[data-testid="employees-tab"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="comments-tab"]')).toBeNull();
    expect(container.querySelector('[data-testid="history-tab"]')).toBeNull();
    expect(container.textContent).toContain('access:org-1:true');
  });

  it('renders the "comments" tab and marks canInvite=false for a non-admin', async () => {
    requirePartner.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);
    isPartnerAdmin.mockReturnValue(false);

    const { container } = await renderServerComponent(
      OrgCardPage({
        params: Promise.resolve({ orgId: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'comments' })
      })
    );

    expect(container.querySelector('[data-testid="comments-tab"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="employees-tab"]')).toBeNull();
    expect(container.textContent).toContain('access:org-1:false');
  });

  it('renders the "history" tab', async () => {
    requirePartner.mockResolvedValue(SESSION);
    canPartnerAccessOrg.mockResolvedValue(true);
    getOrgCard.mockResolvedValue(BASE_CARD);
    isPartnerAdmin.mockReturnValue(false);

    const { container } = await renderServerComponent(
      OrgCardPage({
        params: Promise.resolve({ orgId: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'history' })
      })
    );

    expect(container.querySelector('[data-testid="history-tab"]')).not.toBeNull();
  });
});
