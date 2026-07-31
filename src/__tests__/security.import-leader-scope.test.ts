import { describe, it, expect, vi } from 'vitest';
import { importScope } from '@/lib/services/oneCSync/scope';
import { orgInScope } from '@/lib/services/oneCSync/writers';
import {
  searchResolveOrgs,
  listResolveOrders,
} from '@/lib/services/import/oneCAccountCard/resolve-picker';
import type { SessionPayload } from '@/lib/auth/jwt';

// Regression for the C8 broken-tenant-isolation finding: a manager-leader
// (role='manager' + managerRole='leader') must be bounded to their OWN company
// for the 1C account-card payment import, exactly like every other manager
// primitive (managerPolicy.companyWideOrderFilter / isLeaderSameCompany /
// managerOrgScope). Only admin is cross-company unscoped (Model A). The prior
// bug lumped leader into the admin `unscoped` bucket, letting a Company-A leader
// inject a Payment attributed to a Company-B org (public INN) and enumerate
// Company-B's orgs via the resolve pickers.
const leaderA = {
  sub: 'L',
  role: 'manager',
  managerRole: 'leader',
  companyId: 'companyA',
  managedOrgIds: [],
} as unknown as SessionPayload;
const adminA = { sub: 'a', role: 'admin', companyId: 'companyA' } as unknown as SessionPayload;

describe('C8: manager-leader 1C payment-import scope is company-bounded, not global', () => {
  it('a leader does NOT receive the admin-global scope', () => {
    expect(importScope(leaderA)).not.toEqual(importScope(adminA));
  });

  it('orgInScope denies a leader a target org in ANOTHER company', () => {
    expect(orgInScope(importScope(leaderA), { id: 'orgB', companyId: 'companyB' })).toBe(false);
  });

  it('orgInScope allows a leader a target org in their OWN company', () => {
    expect(orgInScope(importScope(leaderA), { id: 'orgA', companyId: 'companyA' })).toBe(true);
  });

  it('admin (Model A) stays unrestricted across companies', () => {
    expect(orgInScope(importScope(adminA), { id: 'orgB', companyId: 'companyB' })).toBe(true);
  });

  it('searchResolveOrgs constrains a leader to their own company (no cross-company disclosure)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { organization: { findMany } } as never;
    await searchResolveOrgs(prisma, leaderA, {});
    const where = findMany.mock.calls[0][0].where;
    expect(where).not.toEqual({}); // never an all-companies query
    expect(JSON.stringify(where)).toContain('companyA');
  });

  it('listResolveOrders constrains a leader to their own company', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { findMany } } as never;
    await listResolveOrders(prisma, leaderA, { organizationId: 'orgX' });
    const where = findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('companyA');
  });
});
