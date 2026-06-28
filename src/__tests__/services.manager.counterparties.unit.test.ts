/**
 * Unit tests for src/lib/services/manager/counterparties.ts
 * Covers: companyId=null early return, teamMode=ON vs OFF scope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managedOrgIds } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  managedOrgIds: vi.fn()
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managedOrgIds
}));

import { listManagerCounterparties } from '@/lib/services/manager/counterparties';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1'
};

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managedOrgIds.mockReturnValue(['org-1']);
});

describe('listManagerCounterparties', () => {
  it('returns empty result when session.companyId is null', async () => {
    const nullSession = { ...SESSION, companyId: null };
    const p = {
      organization: { findMany: vi.fn() },
      partner: { findMany: vi.fn() },
      company: { findUnique: vi.fn() }
    } as never;
    const result = await listManagerCounterparties(p, nullSession as never);
    expect(result).toEqual({ organizations: [], partners: [] });
    // Should not even call getCompanyTeamVisibility
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
  });

  it('teamMode=OFF: queries orgs by managedOrgIds', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    managedOrgIds.mockReturnValue(['org-1', 'org-2']);
    const orgFindMany = vi.fn().mockResolvedValue([{ id: 'org-1', name: 'Org 1' }]);
    const partnerFindMany = vi.fn().mockResolvedValue([]);
    const p = {
      organization: { findMany: orgFindMany },
      partner: { findMany: partnerFindMany },
      company: { findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: false }) }
    } as never;
    const result = await listManagerCounterparties(p, SESSION);
    expect(orgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['org-1', 'org-2'] } } })
    );
    expect(result.organizations).toEqual([{ id: 'org-1', name: 'Org 1' }]);
  });

  it('teamMode=ON: queries orgs by companyId', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const orgFindMany = vi.fn().mockResolvedValue([{ id: 'org-1', name: 'Org 1' }, { id: 'org-2', name: 'Org 2' }]);
    const partnerFindMany = vi.fn().mockResolvedValue([]);
    const p = {
      organization: { findMany: orgFindMany },
      partner: { findMany: partnerFindMany },
      company: { findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: true }) }
    } as never;
    const result = await listManagerCounterparties(p, SESSION);
    expect(orgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1' } })
    );
    expect(result.organizations).toHaveLength(2);
  });

  it('maps partner rows to {id, name} and filters by company union', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    const partnerFindMany = vi.fn().mockResolvedValue([
      { id: 'p-1', name: 'Partner A' },
      { id: 'p-2', name: 'Partner B' }
    ]);
    const p = {
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      partner: { findMany: partnerFindMany },
      company: { findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: false }) }
    } as never;
    const result = await listManagerCounterparties(p, SESSION);
    expect(result.partners).toEqual([
      { id: 'p-1', name: 'Partner A' },
      { id: 'p-2', name: 'Partner B' }
    ]);
    // Verify the OR filter includes companyId
    expect(partnerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          OR: expect.arrayContaining([{ organizations: { some: { companyId: 'co-1' } } }])
        })
      })
    );
  });

  it('returns empty partners list when no matching partners', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    const p = {
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      partner: { findMany: vi.fn().mockResolvedValue([]) },
      company: { findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: false }) }
    } as never;
    const result = await listManagerCounterparties(p, SESSION);
    expect(result).toEqual({ organizations: [], partners: [] });
  });
});
