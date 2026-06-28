/**
 * Unit tests for the company-wide (teamMode) branches in src/lib/auth/requireRole.ts
 *
 * Covers:
 *  - requireManagerForOrg: teamMode=true, org same company → OK
 *  - requireManagerForOrg: teamMode=true, org not found → redirect
 *  - requireManagerForOrg: teamMode=true, org different company → redirect
 *  - requireManagerForOrg: teamMode=true, session.companyId missing → redirect
 *  - requireManagerForOrder: teamMode=true, same company → OK
 *  - requireManagerForOrder: teamMode=true, different company → notFound
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  getSession,
  redirect,
  notFound,
  orderFindUnique,
  orgFindUnique,
  companyFindUnique,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  orderFindUnique: vi.fn(),
  orgFindUnique: vi.fn(),
  companyFindUnique: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({ redirect, notFound }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique },
    organization: { findUnique: orgFindUnique },
    company: { findUnique: companyFindUnique },
    comment: { count: vi.fn().mockResolvedValue(0) },
  },
}));

import { requireManagerForOrg, requireManagerForOrder } from '@/lib/auth/requireRole';
import type { SessionPayload } from '@/lib/auth/jwt';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMPANY_WIDE_MANAGER: SessionPayload = {
  sub: 'mgr-cw',
  role: 'manager',
  managedOrgIds: [],
  companyId: 'co-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  redirect.mockImplementation((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  });
  notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  // Default: company-wide mode ON for COMPANY_WIDE_MANAGER
  companyFindUnique.mockResolvedValue({ managerTeamVisibility: true });
});

// ---------------------------------------------------------------------------
// requireManagerForOrg — teamMode ON
// ---------------------------------------------------------------------------

describe('requireManagerForOrg — teamMode ON', () => {
  it('returns session when org is in same company (teamMode=true)', async () => {
    getSession.mockResolvedValue(COMPANY_WIDE_MANAGER);
    orgFindUnique.mockResolvedValue({ companyId: 'co-1' });

    const result = await requireManagerForOrg('org-same');
    expect(result).toEqual(COMPANY_WIDE_MANAGER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /manager/dashboard when org not found (teamMode=true)', async () => {
    getSession.mockResolvedValue(COMPANY_WIDE_MANAGER);
    orgFindUnique.mockResolvedValue(null);

    await expect(requireManagerForOrg('org-missing')).rejects.toThrow(
      'NEXT_REDIRECT:/manager/dashboard'
    );
  });

  it('redirects to /manager/dashboard when org belongs to different company (teamMode=true)', async () => {
    getSession.mockResolvedValue(COMPANY_WIDE_MANAGER);
    orgFindUnique.mockResolvedValue({ companyId: 'co-other' });

    await expect(requireManagerForOrg('org-foreign')).rejects.toThrow(
      'NEXT_REDIRECT:/manager/dashboard'
    );
  });

  it('redirects to /manager/dashboard when session has no companyId (teamMode=true)', async () => {
    const sessNoCompany: SessionPayload = {
      sub: 'mgr-nc',
      role: 'manager',
      managedOrgIds: [],
      // companyId intentionally missing
    };
    getSession.mockResolvedValue(sessNoCompany);
    orgFindUnique.mockResolvedValue({ companyId: 'co-1' });

    await expect(requireManagerForOrg('org-any')).rejects.toThrow(
      'NEXT_REDIRECT:/manager/dashboard'
    );
  });
});

// ---------------------------------------------------------------------------
// requireManagerForOrder — teamMode ON
// ---------------------------------------------------------------------------

describe('requireManagerForOrder — teamMode ON', () => {
  it('returns {session, order} when order is in same company (teamMode=true)', async () => {
    getSession.mockResolvedValue(COMPANY_WIDE_MANAGER);
    orderFindUnique.mockResolvedValue({
      id: 'ord-cw',
      managerId: 'someone-else',
      organizationId: 'org-X',
      companyId: 'co-1',
    });

    const result = await requireManagerForOrder('ord-cw');
    expect(result.order.id).toBe('ord-cw');
    expect(result.session).toEqual(COMPANY_WIDE_MANAGER);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('calls notFound() when order is in different company (teamMode=true)', async () => {
    getSession.mockResolvedValue(COMPANY_WIDE_MANAGER);
    orderFindUnique.mockResolvedValue({
      id: 'ord-foreign',
      managerId: 'someone-else',
      organizationId: 'org-X',
      companyId: 'co-other',
    });

    await expect(requireManagerForOrder('ord-foreign')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
