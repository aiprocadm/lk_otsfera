import { describe, expect, it } from 'vitest';
import { FakeOneCAdapter } from '@/lib/services/oneCSync/adapter-fake';

describe('FakeOneCAdapter', () => {
  it('returns at least 3 organizations', async () => {
    const a = new FakeOneCAdapter();
    const orgs = await a.pullOrganizations({});
    expect(orgs.length).toBeGreaterThanOrEqual(3);
    expect(orgs[0]).toHaveProperty('externalId');
    expect(orgs[0]).toHaveProperty('name');
  });

  it('returns orders linked to organizations', async () => {
    const a = new FakeOneCAdapter();
    const orgs = await a.pullOrganizations({});
    const orders = await a.pullOrders({});
    const orgIds = new Set(orgs.map((o) => o.externalId));
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) {
      expect(orgIds.has(order.organizationExternalId)).toBe(true);
    }
  });

  it('respects cursor.since for incremental sync', async () => {
    const a = new FakeOneCAdapter();
    const all = await a.pullOrders({});
    const recent = await a.pullOrders({ since: '2050-01-01T00:00:00Z' });
    expect(recent.length).toBe(0);
    expect(all.length).toBeGreaterThan(recent.length);
  });

  it('pushLead returns acceptedAt timestamp', async () => {
    const a = new FakeOneCAdapter();
    const result = await a.pushLead({
      cabinetLeadId: 'lead-1',
      clientCompanyName: 'X',
      clientContactName: 'Y',
      subject: 'Z',
      productType: ['training']
    });
    expect(result.acceptedAt).toBeTruthy();
  });
});
