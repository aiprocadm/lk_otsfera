import { describe, it, expect, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    organization: { findFirst: vi.fn(), findMany: vi.fn() },
    document: { findUnique: vi.fn() },
    order: { findUnique: vi.fn() }
  }
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));

import { canReadDocument } from '@/lib/auth/policy';

const partnerSession = { sub: 'pu', role: 'partner', partnerId: 'p1' } as never;
const orgSession = { sub: 'ou', role: 'organization', organizationId: 'org1' } as never;

describe('canReadDocument -- channel isolation', () => {
  it('denies a partner reading an organization-channel document (no order lookup)', async () => {
    const doc = { id: 'd', orderId: 'o', order: { companyId: 'c' }, counterpartyType: 'organization' as const, counterpartyId: 'org1' };
    expect(await canReadDocument(partnerSession, doc)).toBe(false);
    expect(db.organization.findFirst).not.toHaveBeenCalled();
  });

  it('allows a partner reading its own partner-channel document', async () => {
    db.organization.findFirst.mockResolvedValue({ id: 'org1' });
    const doc = { id: 'd', orderId: 'o', order: { companyId: 'c' }, counterpartyType: 'partner' as const, counterpartyId: 'p1' };
    expect(await canReadDocument(partnerSession, doc)).toBe(true);
  });

  it('denies a partner reading another partners document', async () => {
    const doc = { id: 'd', orderId: 'o', order: { companyId: 'c' }, counterpartyType: 'partner' as const, counterpartyId: 'pX' };
    expect(await canReadDocument(partnerSession, doc)).toBe(false);
  });

  it('denies an organization reading a partner-channel document', async () => {
    const doc = { id: 'd', orderId: 'o', order: { companyId: 'c' }, counterpartyType: 'partner' as const, counterpartyId: 'p1' };
    expect(await canReadDocument(orgSession, doc)).toBe(false);
  });

  it('does not restrict admin: admin may read a partner-channel doc', async () => {
    const adminSession = { sub: 'a1', role: 'admin' } as never;
    const doc = { id: 'd', orderId: 'o', order: { companyId: 'c' }, counterpartyType: 'partner' as const, counterpartyId: 'pX' };
    expect(await canReadDocument(adminSession, doc)).toBe(true);
  });
});
