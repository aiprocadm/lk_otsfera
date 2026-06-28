import { describe, it, expect } from 'vitest';
import {
  organizationChannelWhere,
  partnerChannelWhere,
  documentInChannel,
  orderBoundWhere, orderLessWhere, managerOrderLessWhere,
  canManagerUploadOrderLess, canReadOrderLessDocument
} from '@/lib/auth/documentChannelPolicy';

describe('documentChannelPolicy', () => {
  it('organizationChannelWhere pins the org channel and hides infected', () => {
    expect(organizationChannelWhere('org-1')).toEqual({
      counterpartyType: 'organization',
      counterpartyId: 'org-1',
      scanStatus: { not: 'infected' }
    });
  });

  it('partnerChannelWhere pins the partner channel and hides infected', () => {
    expect(partnerChannelWhere('p-1')).toEqual({
      counterpartyType: 'partner',
      counterpartyId: 'p-1',
      scanStatus: { not: 'infected' }
    });
  });

  it('documentInChannel matches type + id', () => {
    const doc = { counterpartyType: 'partner' as const, counterpartyId: 'p-1' };
    expect(documentInChannel(doc, { type: 'partner', id: 'p-1' })).toBe(true);
    expect(documentInChannel(doc, { type: 'partner', id: 'p-2' })).toBe(false);
    expect(documentInChannel(doc, { type: 'organization', id: 'p-1' })).toBe(false);
  });
});

describe('order-less axis', () => {
  it('orderBoundWhere matches docs with an order', () => {
    expect(orderBoundWhere()).toEqual({ orderId: { not: null } });
  });
  it('orderLessWhere matches docs without an order', () => {
    expect(orderLessWhere()).toEqual({ orderId: null });
  });
  it('managerOrderLessWhere pins company + hides infected', () => {
    expect(managerOrderLessWhere('co-1')).toEqual({
      orderId: null, companyId: 'co-1', scanStatus: { not: 'infected' }
    });
  });
});

describe('canManagerUploadOrderLess', () => {
  const scope = { managedOrgIds: ['o1'], partnerIds: ['p1'] };
  it('allows org channel in managed orgs', () => {
    expect(canManagerUploadOrderLess({ type: 'organization', id: 'o1' }, scope)).toBe(true);
  });
  it('rejects org channel outside managed orgs', () => {
    expect(canManagerUploadOrderLess({ type: 'organization', id: 'oX' }, scope)).toBe(false);
  });
  it('allows partner channel in scope', () => {
    expect(canManagerUploadOrderLess({ type: 'partner', id: 'p1' }, scope)).toBe(true);
  });
  it('rejects partner channel outside scope', () => {
    expect(canManagerUploadOrderLess({ type: 'partner', id: 'pX' }, scope)).toBe(false);
  });
});

describe('canReadOrderLessDocument', () => {
  const doc = { counterpartyType: 'partner' as const, counterpartyId: 'p1', companyId: 'co-1' };
  it('admin reads anything', () => {
    expect(canReadOrderLessDocument({ role: 'admin' }, doc)).toBe(true);
  });
  it('manager reads only same-company', () => {
    expect(canReadOrderLessDocument({ role: 'manager', companyId: 'co-1' }, doc)).toBe(true);
    expect(canReadOrderLessDocument({ role: 'manager', companyId: 'co-2' }, doc)).toBe(false);
  });
  it('partner reads only its partner channel', () => {
    expect(canReadOrderLessDocument({ role: 'partner', partnerId: 'p1' }, doc)).toBe(true);
    expect(canReadOrderLessDocument({ role: 'partner', partnerId: 'pX' }, doc)).toBe(false);
  });
  it('organization reads only its org channel', () => {
    const orgDoc = { counterpartyType: 'organization' as const, counterpartyId: 'o1', companyId: 'co-1' };
    expect(canReadOrderLessDocument({ role: 'organization', organizationId: 'o1' }, orgDoc)).toBe(true);
    expect(canReadOrderLessDocument({ role: 'organization', organizationId: 'oX' }, orgDoc)).toBe(false);
  });
  it('manager denied when doc has no company', () => {
    expect(canReadOrderLessDocument({ role: 'manager', companyId: 'co-1' }, { ...doc, companyId: null })).toBe(false);
  });
  it('unknown/student role returns false', () => {
    expect(canReadOrderLessDocument({ role: 'student' }, doc)).toBe(false);
    expect(canReadOrderLessDocument({ role: 'unknown-role' }, doc)).toBe(false);
  });
});
