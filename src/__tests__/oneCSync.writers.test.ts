import { describe, it, expect, vi, beforeEach } from 'vitest';
const { resolveOrganizationRef } = vi.hoisted(() => ({ resolveOrganizationRef: vi.fn() }));
const { notifyOrgUsers, notifyManagers } = vi.hoisted(() => ({ notifyOrgUsers: vi.fn(), notifyManagers: vi.fn() }));
const { fetchAndStore1CDocument } = vi.hoisted(() => ({ fetchAndStore1CDocument: vi.fn() }));
const { getQueue } = vi.hoisted(() => ({ getQueue: vi.fn() }));
vi.mock('@/lib/services/oneCSync/resolve-org', () => ({ resolveOrganizationRef }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers, notifyManagers }));
vi.mock('@/lib/services/oneCSync/document-fetch', () => ({ fetchAndStore1CDocument }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { upsertOrderRecord, upsertPaymentRecord, upsertOrgRecord, upsertDocumentRecord } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';

const baseDto = {
  externalId: 'O1', orderNumber: 'O1', title: 'Order 1', organizationExternalId: 'E-ORG',
  totalAmount: 100, paidAmount: 100, vatIncluded: true,
  executionStatus: 'pending', financialStatus: 'paid', productMix: [], updatedAt: '2026-04-01T00:00:00Z',
} as any;

function db() {
  return { order: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() } } as any;
}
beforeEach(() => {
  resolveOrganizationRef.mockReset(); notifyOrgUsers.mockReset(); notifyManagers.mockReset();
  fetchAndStore1CDocument.mockReset(); fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/uuid-file.pdf');
  getQueue.mockReset(); getQueue.mockReturnValue({ add: vi.fn() });
});

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

describe('upsertOrgRecord', () => {
  const orgDto = { externalId:'ORG-1', name:'Acme', inn:'77', kpp:'01', partnerExternalId:'acme-partner', updatedAt:'2026-04-01T00:00:00Z' } as any;
  function odb(over = {}) {
    return {
      partner: { findUnique: vi.fn().mockResolvedValue({ id:'p1' }) },
      organization: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      $transaction: vi.fn(async (cb:any) => cb({ company:{ create: vi.fn().mockResolvedValue({ id:'co1' }) }, organization:{ create: vi.fn() } })),
      ...over,
    } as any;
  }
  it('creates company+org for a new org with a resolvable partner (live)', async () => {
    const d = odb(); const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode:'live', notify:false });
    expect(d.$transaction).toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
  it('skips when partner not found', async () => {
    const d = odb({ partner:{ findUnique: vi.fn().mockResolvedValue(null) } }); const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode:'live', notify:false });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason:'partner_not_found' });
    expect(d.$transaction).not.toHaveBeenCalled();
  });
  it('updates existing org (live), shadow writes nothing', async () => {
    const d = odb({ organization:{ findUnique: vi.fn().mockResolvedValue({ id:'o1', companyId:'co1' }), update: vi.fn() } });
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode:'live', notify:false });
    expect(d.organization.update).toHaveBeenCalled(); expect(sum.updated).toBe(1);
    const d2 = odb({ organization:{ findUnique: vi.fn().mockResolvedValue({ id:'o1', companyId:'co1' }), update: vi.fn() } });
    const sum2 = emptySummary();
    await upsertOrgRecord(d2, orgDto, sum2, { mode:'shadow', notify:false });
    expect(d2.organization.update).not.toHaveBeenCalled(); expect(sum2.updated).toBe(1);
  });
});

describe('upsertDocumentRecord', () => {
  const docDto = { externalId:'D-1', orderExternalId:'O-1', type:'contract', name:'Договор', mimeType:'application/pdf', size:10, downloadUrl:'https://1c/d1', updatedAt:'2026-04-01T00:00:00Z' } as any;
  function ddb(over = {}) {
    return {
      order: { findUnique: vi.fn().mockResolvedValue({ id:'ord1', organizationId:'o1', orderNumber:'O-1', title:'t' }) },
      document: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
      ...over,
    } as any;
  }
  it('creates a document for a found order and notifies when notify:true', async () => {
    const d = ddb(); const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:true });
    expect(d.document.create).toHaveBeenCalledWith({ data: expect.objectContaining({ externalId:'D-1', orderId:'ord1', counterpartyType:'organization', counterpartyId:'o1', direction:'incoming', generatedBy:'system' }) });
    expect(notifyOrgUsers).toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
  // DOC-03: the 1C file is fetched and stored in Supabase; path is a storage key,
  // never the external URL (download routes assume a bucket key).
  it('fetches+stores the 1C file and writes a storage key as path (DOC-03)', async () => {
    fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/uuid-Договор.pdf');
    const d = ddb(); const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:false });
    expect(fetchAndStore1CDocument).toHaveBeenCalledWith(expect.objectContaining({ url:'https://1c/d1', orderId:'ord1' }));
    const data = d.document.create.mock.calls[0][0].data;
    expect(data.path).toBe('orders/ord1/1c/uuid-Договор.pdf');
    expect(data.path).not.toContain('https://');
    expect(data.scanStatus).toBe('pending');
  });
  it('enqueues a ClamAV scan for the stored 1C document', async () => {
    const prev = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://test'; // enqueue is gated on Redis presence
    try {
      const addMock = vi.fn();
      getQueue.mockReturnValue({ add: addMock });
      const d = ddb({ document:{ findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id:'doc9' }), update: vi.fn() } });
      await upsertDocumentRecord(d, docDto, emptySummary(), { mode:'live', notify:false });
      expect(getQueue).toHaveBeenCalledWith('docs.scanDocument');
      expect(addMock).toHaveBeenCalledWith('scan', expect.objectContaining({ kind:'document', id:'doc9' }));
    } finally {
      if (prev === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prev;
    }
  });
  it('skips with document_fetch_failed when the 1C file cannot be stored', async () => {
    fetchAndStore1CDocument.mockResolvedValue(null);
    const d = ddb(); const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:true });
    expect(d.document.create).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(sum.skipped).toBe(1); expect(sum.skips[0]).toMatchObject({ reason:'document_fetch_failed' });
  });
  it('shadow mode does not fetch or write but counts created', async () => {
    const d = ddb(); const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode:'shadow', notify:false });
    expect(fetchAndStore1CDocument).not.toHaveBeenCalled();
    expect(d.document.create).not.toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
  it('update path: metadata only, keeps existing stored path, no re-fetch', async () => {
    const d = ddb({ document:{ findUnique: vi.fn().mockResolvedValue({ id:'ex' }), create: vi.fn(), update: vi.fn() } });
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:false });
    expect(fetchAndStore1CDocument).not.toHaveBeenCalled();
    const updateData = d.document.update.mock.calls[0][0].data;
    expect('path' in updateData).toBe(false);
    expect(sum.updated).toBe(1);
  });
  it('skips when order not found', async () => {
    const d = ddb({ order:{ findUnique: vi.fn().mockResolvedValue(null) } }); const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:true });
    expect(sum.skipped).toBe(1); expect(sum.skips[0]).toMatchObject({ reason:'order_not_found' });
  });
  it('notify:false suppresses document_published', async () => {
    const d = ddb(); const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:false });
    expect(notifyOrgUsers).not.toHaveBeenCalled(); expect(sum.created).toBe(1);
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

  it('skips order-linked payment that is out_of_scope', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({ id:'ord', organizationId:'o', orderNumber:'O1', title:'t' });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode:'live', notify:false, scope: { unscoped:false, mayCreateOrgs:false, allowedOrgIds:['other'] } });
    expect(sum.skipped).toBe(1); expect(sum.skips[0]).toMatchObject({ reason:'out_of_scope' });
  });

  it('skips when org not found in org-level path', async () => {
    const d = pdb(); resolveOrganizationRef.mockResolvedValue(null);
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrgDto, sum, { mode:'live', notify:false });
    expect(sum.skipped).toBe(1); expect(sum.skips[0]).toMatchObject({ reason:'organization_not_found' });
  });

  it('skips org-level payment that is out_of_scope', async () => {
    const d = pdb();
    resolveOrganizationRef.mockResolvedValue({ id:'o-other', companyId:'c', partnerId:null, externalId:'E-ORG' });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrgDto, sum, { mode:'live', notify:false, scope: { unscoped:false, mayCreateOrgs:false, allowedOrgIds:['different'] } });
    expect(sum.skipped).toBe(1); expect(sum.skips[0]).toMatchObject({ reason:'out_of_scope' });
  });

  it('skips when organizationId ends up null (payment without order or org)', async () => {
    // Path: orderExternalId absent, org found but resolves null organizationId
    // We test via the explicit null check at line 85 — org with id null is unreachable
    // via current TS, but we trigger it via the org-path where org.id is ''
    const payNullOrgDto = { externalId:'P-NULL', organizationInn:'00', amount:1, paidAt:'2026-04-01T00:00:00Z', isRefund:false, updatedAt:'2026-04-01T00:00:00Z' } as any;
    const d = pdb();
    // resolveOrg returns an org with a falsy id — triggers organizationId === null path
    resolveOrganizationRef.mockResolvedValue({ id:'', companyId:'c', partnerId:null, externalId:null });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payNullOrgDto, sum, { mode:'live', notify:false });
    // '' is falsy: organizationId = '' → but the guard is (!organizationId) which is true for ''
    // So it skips with organization_not_found
    expect(sum.skipped).toBe(1); expect(sum.skips[0]).toMatchObject({ reason:'organization_not_found' });
  });

  it('updates existing payment (live)', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({ id:'ord', organizationId:'o', orderNumber:'O1', title:'t' });
    d.payment.findUnique.mockResolvedValue({ id:'pay-existing' });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode:'live', notify:false });
    expect(d.payment.update).toHaveBeenCalled(); expect(sum.updated).toBe(1);
  });

  it('shadow mode: counts created but does not write', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({ id:'ord', organizationId:'o', orderNumber:'O1', title:'t' });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode:'shadow', notify:false });
    expect(d.payment.create).not.toHaveBeenCalled(); expect(sum.created).toBe(1);
  });

  it('notifies org users and managers on new order-linked non-refund payment', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({ id:'ord', organizationId:'o', orderNumber:'O1', title:'t' });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode:'live', notify:true });
    expect(notifyOrgUsers).toHaveBeenCalledWith(d, expect.objectContaining({ type:'payment_received' }));
    expect(notifyManagers).toHaveBeenCalledWith(d, expect.objectContaining({ type:'order_marked_paid_by_1c' }));
  });

  it('swallows errors from notifyOrgUsers and notifyManagers (graceful degrade)', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({ id:'ord', organizationId:'o', orderNumber:'O1', title:'t' });
    notifyOrgUsers.mockRejectedValue(new Error('notify error'));
    notifyManagers.mockRejectedValue(new Error('mgr notify error'));
    const sum = emptySummary();
    // Should NOT throw
    await expect(upsertPaymentRecord(d, payOrderDto, sum, { mode:'live', notify:true })).resolves.not.toThrow();
    expect(sum.created).toBe(1);
  });

  it('does NOT notify when payment is a refund', async () => {
    const refundDto = { externalId:'PR1', orderExternalId:'O1', amount:50, paidAt:'2026-04-01T00:00:00Z', isRefund:true, updatedAt:'2026-04-01T00:00:00Z' } as any;
    const d = pdb();
    d.order.findUnique.mockResolvedValue({ id:'ord', organizationId:'o', orderNumber:'O1', title:'t' });
    const sum = emptySummary();
    await upsertPaymentRecord(d, refundDto, sum, { mode:'live', notify:true });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it('bump callback is called on existing payment update', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({ id:'ord', organizationId:'o', orderNumber:'O1', title:'t' });
    d.payment.findUnique.mockResolvedValue({ id:'pay-ex' });
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode:'live', notify:false, bump });
    expect(bump).toHaveBeenCalledWith(payOrderDto.updatedAt);
    expect(sum.updated).toBe(1);
  });

  it('bump callback is called on new payment creation', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({ id:'ord', organizationId:'o', orderNumber:'O1', title:'t' });
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode:'live', notify:false, bump });
    expect(bump).toHaveBeenCalledWith(payOrderDto.updatedAt);
    expect(sum.created).toBe(1);
  });
});

describe('upsertOrderRecord — additional branch coverage', () => {
  const baseDto = {
    externalId:'O-EXTRA', orderNumber:'O-EXTRA', title:'T', organizationExternalId:'E-ORG',
    totalAmount:100, paidAmount:0, vatIncluded:true, executionStatus:'pending', financialStatus:'billed',
    productMix:[], updatedAt:'2026-04-01T00:00:00Z',
  } as any;

  beforeEach(() => {
    resolveOrganizationRef.mockReset(); notifyOrgUsers.mockReset();
  });

  it('bump callback is called on create', async () => {
    resolveOrganizationRef.mockResolvedValue({ id:'o', companyId:'c', partnerId:null, externalId:'E-ORG' });
    const d = { order:{ findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() } } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertOrderRecord(d, baseDto, sum, { mode:'live', notify:false, bump });
    expect(bump).toHaveBeenCalledWith(baseDto.updatedAt);
  });

  it('bump callback is called on update', async () => {
    resolveOrganizationRef.mockResolvedValue({ id:'o', companyId:'c', partnerId:null, externalId:'E-ORG' });
    const d = { order:{ findUnique: vi.fn().mockResolvedValue({ id:'ex', organizationId:'o', financialStatus:'billed', orderNumber:'O-EXTRA', title:'T' }), create: vi.fn(), update: vi.fn() } } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertOrderRecord(d, baseDto, sum, { mode:'live', notify:false, bump });
    expect(bump).toHaveBeenCalledWith(baseDto.updatedAt);
  });

  it('sets organizationId on update when existing.organizationId is null', async () => {
    resolveOrganizationRef.mockResolvedValue({ id:'o-new', companyId:'c', partnerId:null, externalId:'E-ORG' });
    const d = { order:{ findUnique: vi.fn().mockResolvedValue({ id:'ex', organizationId:null, financialStatus:'billed', orderNumber:'O-EXTRA', title:'T' }), create: vi.fn(), update: vi.fn() } } as any;
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode:'live', notify:false });
    const updateData = d.order.update.mock.calls[0][0].data;
    expect(updateData.organizationId).toBe('o-new');
  });

  it('uses org.id as targetOrgId when existing.organizationId is null (for notify)', async () => {
    resolveOrganizationRef.mockResolvedValue({ id:'o-new', companyId:'c', partnerId:null, externalId:'E-ORG' });
    const changedDto = { ...baseDto, financialStatus:'paid' } as any;
    const d = { order:{ findUnique: vi.fn().mockResolvedValue({ id:'ex', organizationId:null, financialStatus:'billed', orderNumber:'O-EXTRA', title:'T' }), create: vi.fn(), update: vi.fn() } } as any;
    const sum = emptySummary();
    await upsertOrderRecord(d, changedDto, sum, { mode:'live', notify:true });
    expect(notifyOrgUsers).toHaveBeenCalledWith(d, expect.objectContaining({ organizationId:'o-new' }));
  });

  it('swallows notifyOrgUsers error on status change (graceful degrade)', async () => {
    resolveOrganizationRef.mockResolvedValue({ id:'o', companyId:'c', partnerId:null, externalId:'E-ORG' });
    const changedDto = { ...baseDto, financialStatus:'paid' } as any;
    const d = { order:{ findUnique: vi.fn().mockResolvedValue({ id:'ex', organizationId:'o', financialStatus:'billed', orderNumber:'O-EXTRA', title:'T' }), create: vi.fn(), update: vi.fn() } } as any;
    notifyOrgUsers.mockRejectedValue(new Error('notify boom'));
    const sum = emptySummary();
    await expect(upsertOrderRecord(d, changedDto, sum, { mode:'live', notify:true })).resolves.not.toThrow();
    expect(sum.updated).toBe(1);
  });

  it('does NOT notify when financial status is unchanged', async () => {
    resolveOrganizationRef.mockResolvedValue({ id:'o', companyId:'c', partnerId:null, externalId:'E-ORG' });
    // same financialStatus as dto ('billed')
    const d = { order:{ findUnique: vi.fn().mockResolvedValue({ id:'ex', organizationId:'o', financialStatus:'billed', orderNumber:'O-EXTRA', title:'T' }), create: vi.fn(), update: vi.fn() } } as any;
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode:'live', notify:true });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('skips when org.companyId is null', async () => {
    resolveOrganizationRef.mockResolvedValue({ id:'o', companyId:null, partnerId:null, externalId:'E-ORG' });
    const d = { order:{ findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() } } as any;
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode:'live', notify:false });
    expect(sum.skipped).toBe(1); expect(sum.skips[0]).toMatchObject({ reason:'organization_not_found' });
  });
});

describe('upsertDocumentRecord — additional branch coverage', () => {
  const docDto = { externalId:'D-EX', orderExternalId:'O-1', type:'contract', name:'Договор', mimeType:'application/pdf', size:10, downloadUrl:'https://1c/d1', updatedAt:'2026-04-01T00:00:00Z' } as any;

  beforeEach(() => {
    fetchAndStore1CDocument.mockReset();
    fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/uuid-file.pdf');
    notifyOrgUsers.mockReset();
    getQueue.mockReset(); getQueue.mockReturnValue({ add: vi.fn() });
  });

  it('does NOT notify when organizationId is null on new document', async () => {
    const d = {
      order: { findUnique: vi.fn().mockResolvedValue({ id:'ord1', organizationId:null, orderNumber:'O-1', title:'t' }) },
      document: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id:'doc1' }), update: vi.fn() },
    } as any;
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:true });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });

  it('swallows document scan enqueue error (graceful degrade)', async () => {
    const prevRedis = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://test';
    try {
      getQueue.mockReturnValue({ add: vi.fn().mockRejectedValue(new Error('redis down')) });
      const d = {
        order: { findUnique: vi.fn().mockResolvedValue({ id:'ord1', organizationId:'o1', orderNumber:'O-1', title:'t' }) },
        document: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id:'doc9' }), update: vi.fn() },
      } as any;
      const sum = emptySummary();
      await expect(upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:false })).resolves.not.toThrow();
      expect(sum.created).toBe(1);
    } finally {
      if (prevRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prevRedis;
    }
  });

  it('swallows notifyOrgUsers error for document_published (graceful degrade)', async () => {
    notifyOrgUsers.mockRejectedValue(new Error('notify boom'));
    const d = {
      order: { findUnique: vi.fn().mockResolvedValue({ id:'ord1', organizationId:'o1', orderNumber:'O-1', title:'t' }) },
      document: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id:'doc9' }), update: vi.fn() },
    } as any;
    const sum = emptySummary();
    await expect(upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:true })).resolves.not.toThrow();
    expect(sum.created).toBe(1);
  });

  it('document update in shadow mode counts updated but does not write', async () => {
    const d = {
      order: { findUnique: vi.fn().mockResolvedValue({ id:'ord1', organizationId:'o1', orderNumber:'O-1', title:'t' }) },
      document: { findUnique: vi.fn().mockResolvedValue({ id:'ex-doc' }), create: vi.fn(), update: vi.fn() },
    } as any;
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode:'shadow', notify:false });
    expect(d.document.update).not.toHaveBeenCalled(); expect(sum.updated).toBe(1);
  });

  it('bump is called on document update', async () => {
    const d = {
      order: { findUnique: vi.fn().mockResolvedValue({ id:'ord1', organizationId:'o1', orderNumber:'O-1', title:'t' }) },
      document: { findUnique: vi.fn().mockResolvedValue({ id:'ex-doc' }), create: vi.fn(), update: vi.fn() },
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:false, bump });
    expect(bump).toHaveBeenCalledWith(docDto.updatedAt);
    expect(sum.updated).toBe(1);
  });

  it('bump is called on document create', async () => {
    fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/uuid-file.pdf');
    const d = {
      order: { findUnique: vi.fn().mockResolvedValue({ id:'ord1', organizationId:'o1', orderNumber:'O-1', title:'t' }) },
      document: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id:'new-doc' }), update: vi.fn() },
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertDocumentRecord(d, docDto, sum, { mode:'live', notify:false, bump });
    expect(bump).toHaveBeenCalledWith(docDto.updatedAt);
    expect(sum.created).toBe(1);
  });
});

describe('upsertOrgRecord — additional branch coverage', () => {
  const orgDto = { externalId:'ORG-X', name:'ООО Тест', inn:'77', kpp:'01', partnerExternalId:null, updatedAt:'2026-04-01T00:00:00Z' } as any;

  it('skips with no_partner_external_id when partnerExternalId is null', async () => {
    const d = {
      partner: { findUnique: vi.fn() },
      organization: { findUnique: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(),
    } as any;
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode:'live', notify:false });
    expect(sum.skipped).toBe(1); expect(sum.skips[0]).toMatchObject({ reason:'no_partner_external_id' });
    expect(d.partner.findUnique).not.toHaveBeenCalled();
  });

  it('shadow mode: skips $transaction and counts created', async () => {
    const orgDtoWithPartner = { ...orgDto, partnerExternalId:'p-slug' } as any;
    const d = {
      partner: { findUnique: vi.fn().mockResolvedValue({ id:'p1' }) },
      organization: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      $transaction: vi.fn(),
    } as any;
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDtoWithPartner, sum, { mode:'shadow', notify:false });
    expect(d.$transaction).not.toHaveBeenCalled(); expect(sum.created).toBe(1);
  });

  it('bump callback is called on existing org update', async () => {
    const orgDtoWithPartner = { ...orgDto, partnerExternalId:'p-slug' } as any;
    const d = {
      partner: { findUnique: vi.fn().mockResolvedValue({ id:'p1' }) },
      organization: { findUnique: vi.fn().mockResolvedValue({ id:'o1', companyId:'co1' }), update: vi.fn() },
      $transaction: vi.fn(),
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertOrgRecord(d, orgDtoWithPartner, sum, { mode:'live', notify:false, bump });
    expect(bump).toHaveBeenCalledWith(orgDtoWithPartner.updatedAt);
    expect(sum.updated).toBe(1);
  });

  it('bump is called on org create', async () => {
    const orgDtoWithPartner = { ...orgDto, partnerExternalId:'p-slug' } as any;
    const d = {
      partner: { findUnique: vi.fn().mockResolvedValue({ id:'p1' }) },
      organization: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      $transaction: vi.fn(async (cb: any) => cb({ company:{ create: vi.fn().mockResolvedValue({ id:'co1' }) }, organization:{ create: vi.fn() } })),
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertOrgRecord(d, orgDtoWithPartner, sum, { mode:'live', notify:false, bump });
    expect(bump).toHaveBeenCalledWith(orgDtoWithPartner.updatedAt);
  });
});
