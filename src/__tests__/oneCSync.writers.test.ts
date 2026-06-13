import { describe, it, expect, vi, beforeEach } from 'vitest';
const { resolveOrganizationRef } = vi.hoisted(() => ({ resolveOrganizationRef: vi.fn() }));
const { notifyOrgUsers, notifyManagers } = vi.hoisted(() => ({ notifyOrgUsers: vi.fn(), notifyManagers: vi.fn() }));
vi.mock('@/lib/services/oneCSync/resolve-org', () => ({ resolveOrganizationRef }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers, notifyManagers }));

import { upsertOrderRecord, upsertPaymentRecord } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';

const baseDto = {
  externalId: 'O1', orderNumber: 'O1', title: 'Order 1', organizationExternalId: 'E-ORG',
  totalAmount: 100, paidAmount: 100, vatIncluded: true,
  executionStatus: 'pending', financialStatus: 'paid', productMix: [], updatedAt: '2026-04-01T00:00:00Z',
} as any;

function db() {
  return { order: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() } } as any;
}
beforeEach(() => { resolveOrganizationRef.mockReset(); notifyOrgUsers.mockReset(); notifyManagers.mockReset(); });

describe('upsertOrderRecord', () => {
  it('creates a new order with financialStatus/partnerId/companyId in live mode', async () => {
    resolveOrganizationRef.mockResolvedValue({ id: 'o', companyId: 'c', partnerId: 'p', externalId: 'E-ORG' });
    const d = db(); const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: true });
    expect(d.order.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      externalId: 'O1', financialStatus: 'paid', executionStatus: 'pending', partnerId: 'p', companyId: 'c', organizationId: 'o' }) });
    expect(sum.created).toBe(1);
  });
  it('shadow mode counts but does not write', async () => {
    resolveOrganizationRef.mockResolvedValue({ id: 'o', companyId: 'c', partnerId: null, externalId: 'E-ORG' });
    const d = db(); const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'shadow', notify: true });
    expect(d.order.create).not.toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
  it('skips out-of-scope org for scoped manager', async () => {
    resolveOrganizationRef.mockResolvedValue({ id: 'o', companyId: 'c', partnerId: null, externalId: 'E-ORG' });
    const d = db(); const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: false, scope: { unscoped: false, mayCreateOrgs: false, allowedOrgIds: ['other'] } });
    expect(d.order.create).not.toHaveBeenCalled();
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'out_of_scope' });
  });
  it('skips when org not found', async () => {
    resolveOrganizationRef.mockResolvedValue(null);
    const d = db(); const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: true });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'organization_not_found' });
  });
  it('resolves org by INN when organizationExternalId is absent', async () => {
    resolveOrganizationRef.mockResolvedValue({ id:'o', companyId:'c', partnerId:null, externalId:'X' });
    const d = db(); const sum = emptySummary();
    const innDto = { externalId:'O-INN', title:'t', organizationInn:'7700', totalAmount:100, paidAmount:100, vatIncluded:true, executionStatus:'pending', financialStatus:'paid', productMix:[], updatedAt:'2026-04-01T00:00:00Z' } as any;
    await upsertOrderRecord(d, innDto, sum, { mode:'live', notify:false });
    expect(resolveOrganizationRef).toHaveBeenCalledWith(d, expect.objectContaining({ inn:'7700' }));
    expect(sum.created).toBe(1);
  });
  it('notify=false suppresses status-change notification on update', async () => {
    resolveOrganizationRef.mockResolvedValue({ id: 'o', companyId: 'c', partnerId: null, externalId: 'E-ORG' });
    const d = db();
    d.order.findUnique.mockResolvedValue({ id: 'ex', organizationId: 'o', financialStatus: 'billed', orderNumber: 'O1', title: 'Order 1' });
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: false });
    expect(d.order.update).toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(sum.updated).toBe(1);
  });
});

describe('upsertPaymentRecord', () => {
  const payOrderDto = { externalId:'P1', orderExternalId:'O1', amount:50, paidAt:'2026-04-01T00:00:00Z', isRefund:false, updatedAt:'2026-04-01T00:00:00Z' } as any;
  const payOrgDto = { externalId:'P2', organizationExternalId:'E-ORG', amount:50, paidAt:'2026-04-01T00:00:00Z', isRefund:false, updatedAt:'2026-04-01T00:00:00Z' } as any;
  function pdb() { return { order:{ findUnique: vi.fn() }, payment:{ findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() } } as any; }

  it('links payment to order when orderExternalId present', async () => {
    const d = pdb(); d.order.findUnique.mockResolvedValue({ id:'ord', organizationId:'o', orderNumber:'O1', title:'t' });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode:'live', notify:false });
    expect(d.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ externalId:'P1', orderId:'ord', organizationId:'o' }) });
    expect(sum.created).toBe(1);
  });
  it('writes org-level payment when only organizationExternalId present', async () => {
    const d = pdb(); resolveOrganizationRef.mockResolvedValue({ id:'o', companyId:'c', partnerId:null, externalId:'E-ORG' });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrgDto, sum, { mode:'live', notify:false });
    expect(d.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ externalId:'P2', orderId:null, organizationId:'o' }) });
    expect(sum.created).toBe(1);
  });
  it('skips when order not found', async () => {
    const d = pdb(); d.order.findUnique.mockResolvedValue(null);
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode:'live', notify:false });
    expect(sum.skipped).toBe(1); expect(sum.skips[0]).toMatchObject({ reason:'order_not_found' });
  });
});
