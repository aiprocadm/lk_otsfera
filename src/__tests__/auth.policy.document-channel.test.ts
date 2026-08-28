import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

const { db } = vi.hoisted(() => ({
  db: {
    organization: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    document: { findUnique },
    order: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));

import { canReadDocument } from '@/lib/auth/policy';

const partnerSession = { sub: 'pu', role: 'partner', partnerId: 'p1' } as never;
const orgSession = { sub: 'ou', role: 'organization', organizationId: 'org1' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('canReadDocument -- channel isolation', () => {
  it('партнёр НЕ читает документ организации вне своего портфеля', async () => {
    // `У-155` открыл партнёру документы организаций ЕГО портфеля. Организация
    // из чужого портфеля остаётся закрытой, и до гейта заказа дело не доходит.
    db.organization.findUnique.mockResolvedValue({ partnerId: 'p-other' });
    const doc = {
      id: 'd',
      orderId: 'o',
      order: { companyId: 'c' },
      counterpartyType: 'organization' as const,
      counterpartyId: 'org1',
    };
    expect(await canReadDocument(partnerSession, doc)).toBe(false);
    expect(db.organization.findFirst).not.toHaveBeenCalled();
  });

  it('`У-155`: документ организации СВОЕГО портфеля партнёр читает', async () => {
    db.organization.findUnique.mockResolvedValue({ partnerId: 'p1' });
    db.organization.findFirst.mockResolvedValue({ id: 'org1' });
    const doc = {
      id: 'd',
      orderId: 'o',
      order: { companyId: 'c' },
      counterpartyType: 'organization' as const,
      counterpartyId: 'org1',
    };
    expect(await canReadDocument(partnerSession, doc)).toBe(true);
  });

  it('allows a partner reading its own partner-channel document', async () => {
    db.organization.findFirst.mockResolvedValue({ id: 'org1' });
    const doc = {
      id: 'd',
      orderId: 'o',
      order: { companyId: 'c' },
      counterpartyType: 'partner' as const,
      counterpartyId: 'p1',
    };
    expect(await canReadDocument(partnerSession, doc)).toBe(true);
  });

  it('denies a partner reading another partners document', async () => {
    const doc = {
      id: 'd',
      orderId: 'o',
      order: { companyId: 'c' },
      counterpartyType: 'partner' as const,
      counterpartyId: 'pX',
    };
    expect(await canReadDocument(partnerSession, doc)).toBe(false);
  });

  it('denies an organization reading a partner-channel document', async () => {
    const doc = {
      id: 'd',
      orderId: 'o',
      order: { companyId: 'c' },
      counterpartyType: 'partner' as const,
      counterpartyId: 'p1',
    };
    expect(await canReadDocument(orgSession, doc)).toBe(false);
  });

  it('does not restrict admin: admin may read a partner-channel doc', async () => {
    const adminSession = { sub: 'a1', role: 'admin' } as never;
    const doc = {
      id: 'd',
      orderId: 'o',
      order: { companyId: 'c' },
      counterpartyType: 'partner' as const,
      counterpartyId: 'pX',
    };
    expect(await canReadDocument(adminSession, doc)).toBe(true);
  });

  // DOC-01 (T4): an org user must NOT read a sibling org's order-bound document
  // even when both orgs share the same company. The org-channel id must be pinned
  // at the gate, symmetric to the partner branch — canReadOrder() is company-level
  // for orgs and does NOT isolate to a specific organization.
  it('denies an organization reading a sibling org-channel order-bound doc in the same company (DOC-01)', async () => {
    db.organization.findMany.mockResolvedValue([{ id: 'org1' }, { id: 'orgB' }]);
    const doc = {
      id: 'd',
      orderId: 'o',
      order: { companyId: 'c' },
      counterpartyType: 'organization' as const,
      counterpartyId: 'orgB',
    };
    expect(await canReadDocument(orgSession, doc)).toBe(false);
    // Pin short-circuits before the company-level order lookup.
    expect(db.organization.findMany).not.toHaveBeenCalled();
  });

  it('allows an organization reading its own org-channel order-bound doc', async () => {
    db.organization.findMany.mockResolvedValue([{ id: 'org1' }]);
    const doc = {
      id: 'd',
      orderId: 'o',
      order: { companyId: 'c' },
      counterpartyType: 'organization' as const,
      counterpartyId: 'org1',
    };
    expect(await canReadDocument(orgSession, doc)).toBe(true);
  });
});

describe('canReadDocument -- order-less documents', () => {
  it('manager downloads order-less doc only in same company', async () => {
    findUnique.mockResolvedValue({
      id: 'd1',
      orderId: null,
      companyId: 'co-1',
      counterpartyType: 'partner',
      counterpartyId: 'p1',
      order: null,
    });
    expect(
      await canReadDocument({ role: 'manager', companyId: 'co-1' } as never, { id: 'd1' } as never)
    ).toBe(true);
    expect(
      await canReadDocument({ role: 'manager', companyId: 'co-2' } as never, { id: 'd1' } as never)
    ).toBe(false);
  });

  it('partner downloads order-less doc only in its channel', async () => {
    findUnique.mockResolvedValue({
      id: 'd2',
      orderId: null,
      companyId: 'co-1',
      counterpartyType: 'partner',
      counterpartyId: 'p1',
      order: null,
    });
    expect(
      await canReadDocument({ role: 'partner', partnerId: 'p1' } as never, { id: 'd2' } as never)
    ).toBe(true);
    expect(
      await canReadDocument({ role: 'partner', partnerId: 'pX' } as never, { id: 'd2' } as never)
    ).toBe(false);
  });

  it('organization downloads order-less doc only in its channel', async () => {
    findUnique.mockResolvedValue({
      id: 'd3',
      orderId: null,
      companyId: 'co-1',
      counterpartyType: 'organization',
      counterpartyId: 'o1',
      order: null,
    });
    expect(
      await canReadDocument(
        { role: 'organization', organizationId: 'o1' } as never,
        { id: 'd3' } as never
      )
    ).toBe(true);
    expect(
      await canReadDocument(
        { role: 'organization', organizationId: 'oX' } as never,
        { id: 'd3' } as never
      )
    ).toBe(false);
  });

  it('order-less doc passed without companyId triggers re-fetch and uses DB company', async () => {
    findUnique.mockResolvedValue({
      id: 'd9',
      orderId: null,
      companyId: 'co-1',
      counterpartyType: 'partner',
      counterpartyId: 'p1',
      order: null,
    });
    const caller = {
      id: 'd9',
      orderId: null,
      counterpartyType: 'partner',
      counterpartyId: 'p1',
    } as never;
    expect(await canReadDocument({ role: 'manager', companyId: 'co-1' } as never, caller)).toBe(
      true
    );
    expect(findUnique).toHaveBeenCalled();
  });
});
