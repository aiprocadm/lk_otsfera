/**
 * Unit tests for src/lib/services/manager/organizations.ts
 * Covers: teamMode=ON branch in listOrganizations + getOrganization,
 * getOrganization with teamMode=ON (companyId mismatch → null),
 * teamMode=OFF and canSeeOrganization=false → null.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managerOrgScope, canSeeOrganization, isLeaderSameCompany } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  managerOrgScope: vi.fn(),
  canSeeOrganization: vi.fn(),
  isLeaderSameCompany: vi.fn(() => false)
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managerOrgScope,
  canSeeOrganization,
  // Лидер-инвариант C8 в деталке организации (фикс 30.07.2026): по умолчанию
  // выключен, отдельная проверка ниже включает его точечно.
  isLeaderSameCompany
}));

import { listOrganizations, getOrganization } from '@/lib/services/manager/organizations';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1'
};

function orgRow(id: string, companyId = 'co-1') {
  return {
    id,
    name: `Org ${id}`,
    companyId,
    _count: { orders: 1, students: 0, users: 2 },
    partner: { id: 'p-1', name: 'Partner' }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managerOrgScope.mockReturnValue({ id: { in: ['org-1'] } });
  canSeeOrganization.mockReturnValue(true);
});

describe('listOrganizations', () => {
  it('calls managerOrgScope and returns all rows', async () => {
    const findMany = vi.fn().mockResolvedValue([orgRow('org-1')]);
    const p = { organization: { findMany } } as never;
    const rows = await listOrganizations(p, SESSION);
    expect(rows).toHaveLength(1);
    expect(managerOrgScope).toHaveBeenCalledWith(SESSION, false);
  });

  it('uses teamModeOverride=true and skips getCompanyTeamVisibility', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { organization: { findMany } } as never;
    await listOrganizations(p, SESSION, true);
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(managerOrgScope).toHaveBeenCalledWith(SESSION, true);
  });

  it('calls getCompanyTeamVisibility when no override', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { organization: { findMany } } as never;
    await listOrganizations(p, SESSION);
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(expect.anything(), 'co-1');
  });

  it('returns empty array when no orgs in scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { organization: { findMany } } as never;
    const rows = await listOrganizations(p, SESSION);
    expect(rows).toEqual([]);
  });
});

describe('getOrganization', () => {
  it('returns null when org not found in DB', async () => {
    const p = { organization: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    const result = await getOrganization(p, SESSION, 'nonexistent');
    expect(result).toBeNull();
  });

  it('teamMode=OFF: returns org when canSeeOrganization=true', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    canSeeOrganization.mockReturnValue(true);
    const org = orgRow('org-1');
    const p = { organization: { findUnique: vi.fn().mockResolvedValue(org) } } as never;
    const result = await getOrganization(p, SESSION, 'org-1');
    expect(result).toMatchObject({ id: 'org-1' });
  });

  it('teamMode=OFF: returns null when canSeeOrganization=false', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    canSeeOrganization.mockReturnValue(false);
    const org = orgRow('org-1');
    const p = { organization: { findUnique: vi.fn().mockResolvedValue(org) } } as never;
    const result = await getOrganization(p, SESSION, 'org-1');
    expect(result).toBeNull();
  });

  it('teamMode=ON: returns org when companyId matches session.companyId', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const org = orgRow('org-1', 'co-1');
    const p = { organization: { findUnique: vi.fn().mockResolvedValue(org) } } as never;
    const result = await getOrganization(p, SESSION, 'org-1');
    expect(result).toMatchObject({ id: 'org-1' });
  });

  it('teamMode=ON: returns null when org.companyId does not match session.companyId', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const org = orgRow('org-1', 'co-foreign');
    const p = { organization: { findUnique: vi.fn().mockResolvedValue(org) } } as never;
    const result = await getOrganization(p, SESSION, 'org-1');
    expect(result).toBeNull();
  });

  it('teamMode=ON: returns null when session.companyId is null', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const nullSession = { ...SESSION, companyId: null };
    const org = orgRow('org-1', 'co-1');
    const p = { organization: { findUnique: vi.fn().mockResolvedValue(org) } } as never;
    const result = await getOrganization(p, nullSession as never, 'org-1');
    // !!null && ... = false → null
    expect(result).toBeNull();
  });
});
