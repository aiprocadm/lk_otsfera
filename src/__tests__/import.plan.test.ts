import { describe, it, expect } from 'vitest';
import { planImport } from '@/lib/services/import/plan-import';

const lookups = {
  orgIdByInn: new Map([['7700', 'org-1']]),       // existing org
  partnerIdByInn: new Map([['5500', 'partner-1']]),
};

describe('planImport', () => {
  it('manager: existing in-scope org updates, out-of-scope org skipped', () => {
    const plan = planImport(
      { orgs: [{ name: 'A', inn: '7700', partnerInn: null }, { name: 'B', inn: '9900', partnerInn: null }], orders: [], payments: [] },
      lookups,
      { unscoped: false, mayCreateOrgs: false, allowedOrgIds: ['org-1'] }
    );
    expect(plan.counts.orgsUpdated).toBe(1);
    expect(plan.skipped.orgs).toHaveLength(1); // '9900' new → manager may not create
    expect(plan.skipped.orgs[0].reason).toMatch(/руководител|зоны/i);
  });

  it('payment for unknown org is skipped', () => {
    const plan = planImport(
      { orgs: [], orders: [], payments: [{ externalId: 'PP-1', orgInn: '0000', amount: 1, paidAt: '2026-01-01', method: null, isRefund: false, note: null }] },
      lookups,
      { unscoped: true, mayCreateOrgs: true }
    );
    expect(plan.counts.paymentsUpserted).toBe(0);
    expect(plan.skipped.payments).toHaveLength(1);
  });

  // ── Extra invariant tests ────────────────────────────────────────────────

  it('plain manager cannot write to org outside allowedOrgIds (existing org)', () => {
    // org-1 is known but NOT in allowedOrgIds for this session
    const plan = planImport(
      { orgs: [{ name: 'A', inn: '7700', partnerInn: null }], orders: [], payments: [] },
      lookups,
      { unscoped: false, mayCreateOrgs: false, allowedOrgIds: [] }
    );
    expect(plan.counts.orgsUpdated).toBe(0);
    expect(plan.skipped.orgs).toHaveLength(1);
    expect(plan.skipped.orgs[0].reason).toMatch(/зоны/i);
  });

  it('plain manager cannot trigger order write for out-of-scope org', () => {
    const plan = planImport(
      {
        orgs: [],
        orders: [{ externalId: 'O-1', orderNumber: null, orgInn: '7700', totalAmount: 100, paidAmount: 0 }],
        payments: [],
      },
      lookups,
      { unscoped: false, mayCreateOrgs: false, allowedOrgIds: [] } // org-1 NOT allowed
    );
    expect(plan.counts.ordersUpserted).toBe(0);
    expect(plan.skipped.orders).toHaveLength(1);
    expect(plan.skipped.orders[0].reason).toMatch(/зоны/i);
  });

  it('plain manager cannot trigger payment write for out-of-scope org', () => {
    const plan = planImport(
      {
        orgs: [],
        orders: [],
        payments: [{ externalId: 'P-1', orgInn: '7700', amount: 50, paidAt: '2026-01-01', method: null, isRefund: false, note: null }],
      },
      lookups,
      { unscoped: false, mayCreateOrgs: false, allowedOrgIds: [] } // org-1 NOT allowed
    );
    expect(plan.counts.paymentsUpserted).toBe(0);
    expect(plan.skipped.payments).toHaveLength(1);
    expect(plan.skipped.payments[0].reason).toMatch(/зоны/i);
  });

  it('leader/admin: new org created in-file → orders for that org succeed in same import', () => {
    // inn '8800' is not in orgIdByInn (new org)
    const plan = planImport(
      {
        orgs: [{ name: 'New', inn: '8800', partnerInn: null }],
        orders: [{ externalId: 'O-2', orderNumber: null, orgInn: '8800', totalAmount: 200, paidAmount: 0 }],
        payments: [{ externalId: 'P-2', orgInn: '8800', amount: 10, paidAt: '2026-01-02', method: null, isRefund: false, note: null }],
      },
      lookups,
      { unscoped: true, mayCreateOrgs: true }
    );
    expect(plan.counts.orgsCreated).toBe(1);
    expect(plan.counts.ordersUpserted).toBe(1);
    expect(plan.counts.paymentsUpserted).toBe(1);
    expect(plan.skipped.orders).toHaveLength(0);
    expect(plan.skipped.payments).toHaveLength(0);
  });

  it('standalone org (no partnerInn) counts toward orgsStandalone', () => {
    const plan = planImport(
      { orgs: [{ name: 'A', inn: '7700', partnerInn: null }], orders: [], payments: [] },
      lookups,
      { unscoped: true, mayCreateOrgs: true }
    );
    expect(plan.counts.orgsStandalone).toBe(1);
  });

  it('org with matched partnerInn does NOT count toward orgsStandalone', () => {
    const plan = planImport(
      { orgs: [{ name: 'A', inn: '7700', partnerInn: '5500' }], orders: [], payments: [] },
      lookups,
      { unscoped: true, mayCreateOrgs: true }
    );
    expect(plan.counts.orgsStandalone).toBe(0);
  });

  it('unscoped: all rows accepted when org exists', () => {
    const plan = planImport(
      {
        orgs: [{ name: 'A', inn: '7700', partnerInn: null }],
        orders: [{ externalId: 'O-3', orderNumber: null, orgInn: '7700', totalAmount: 100, paidAmount: 0 }],
        payments: [{ externalId: 'P-3', orgInn: '7700', amount: 20, paidAt: '2026-01-01', method: null, isRefund: false, note: null }],
      },
      lookups,
      { unscoped: true, mayCreateOrgs: true }
    );
    expect(plan.counts.orgsUpdated).toBe(1);
    expect(plan.counts.ordersUpserted).toBe(1);
    expect(plan.counts.paymentsUpserted).toBe(1);
    expect(plan.skipped.orgs).toHaveLength(0);
    expect(plan.skipped.orders).toHaveLength(0);
    expect(plan.skipped.payments).toHaveLength(0);
  });
});
