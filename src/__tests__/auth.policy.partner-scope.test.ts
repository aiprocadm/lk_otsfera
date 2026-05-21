import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn() }
  }
}));

import { prisma } from '@/lib/db/prisma';
import {
  canPartnerAccessOrg,
  partnerOrgScopeFilter,
  isPartnerAdmin
} from '@/lib/auth/policy';
import type { SessionPayload } from '@/lib/auth/jwt';

const partnerAdminSession: SessionPayload = {
  sub: 'u1', role: 'partner', partnerId: 'p1',
  partnerRole: 'admin', assignedOrgIds: []
};

const partnerManagerScopedSession: SessionPayload = {
  sub: 'u2', role: 'partner', partnerId: 'p1',
  partnerRole: 'manager', assignedOrgIds: ['orgA', 'orgB']
};

const partnerManagerEmptyScopeSession: SessionPayload = {
  sub: 'u3', role: 'partner', partnerId: 'p1',
  partnerRole: 'manager', assignedOrgIds: []
};

describe('isPartnerAdmin', () => {
  it('returns true only for partner role with partnerRole=admin', () => {
    expect(isPartnerAdmin(partnerAdminSession)).toBe(true);
    expect(isPartnerAdmin(partnerManagerScopedSession)).toBe(false);
    expect(isPartnerAdmin({ ...partnerAdminSession, role: 'admin' })).toBe(false);
    expect(isPartnerAdmin({ ...partnerAdminSession, partnerRole: undefined })).toBe(false);
  });
});

describe('canPartnerAccessOrg', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns true for admin partner if org belongs to partner', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgZ', partnerId: 'p1'
    } as any);

    expect(await canPartnerAccessOrg(partnerAdminSession, 'orgZ')).toBe(true);
  });

  it('returns false for partner if org belongs to different partner', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgZ', partnerId: 'OTHER'
    } as any);

    expect(await canPartnerAccessOrg(partnerAdminSession, 'orgZ')).toBe(false);
  });

  it('returns true for scoped manager if orgId in assignedOrgIds', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgA', partnerId: 'p1'
    } as any);

    expect(await canPartnerAccessOrg(partnerManagerScopedSession, 'orgA')).toBe(true);
  });

  it('returns false for scoped manager if orgId not in assignedOrgIds (even own partner)', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgC', partnerId: 'p1'
    } as any);

    expect(await canPartnerAccessOrg(partnerManagerScopedSession, 'orgC')).toBe(false);
  });

  it('returns true for manager with empty assignedOrgIds (= all in partner)', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: 'orgX', partnerId: 'p1'
    } as any);

    expect(await canPartnerAccessOrg(partnerManagerEmptyScopeSession, 'orgX')).toBe(true);
  });

  it('returns false if org not found', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);

    expect(await canPartnerAccessOrg(partnerAdminSession, 'missing')).toBe(false);
  });
});

describe('partnerOrgScopeFilter', () => {
  it('returns { partnerId } only for admin/empty scope', () => {
    expect(partnerOrgScopeFilter(partnerAdminSession)).toEqual({ partnerId: 'p1' });
    expect(partnerOrgScopeFilter(partnerManagerEmptyScopeSession)).toEqual({ partnerId: 'p1' });
  });

  it('returns { partnerId, id: { in } } for scoped manager', () => {
    expect(partnerOrgScopeFilter(partnerManagerScopedSession)).toEqual({
      partnerId: 'p1',
      id: { in: ['orgA', 'orgB'] }
    });
  });

  it('returns impossible filter if no partnerId on session', () => {
    expect(partnerOrgScopeFilter({ sub: 'x', role: 'partner' } as SessionPayload)).toEqual({
      id: { in: [] }
    });
  });
});
