import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const { notifyPartnerUsers } = vi.hoisted(() => ({ notifyPartnerUsers: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications/partner', () => ({ notifyPartnerUsers }));

import { assignLead, setLeadStatus, promoteLead, rejectLead } from '@/lib/services/manager/leadLifecycle';

type LeadRow = Record<string, unknown>;

function db(lead: LeadRow | null, over: Record<string, unknown> = {}) {
  return {
    lead: {
      findUnique: vi.fn().mockResolvedValue(lead),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...lead, ...data }))
    },
    organization: { findUnique: vi.fn().mockResolvedValue({ companyId: 'co1' }) },
    order: { create: vi.fn().mockResolvedValue({ id: 'ord-new' }) },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
      order: { create: vi.fn().mockResolvedValue({ id: 'ord-new' }) },
      lead: { update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...lead, ...data })) }
    })),
    ...over
  } as never;
}

beforeEach(() => { recordAudit.mockReset(); notifyPartnerUsers.mockReset(); });

describe('assignLead', () => {
  it('claims a new lead to the manager and advances new → in_review', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    const r = await assignLead(d, { leadId: 'L1', managerId: 'm1' });
    expect(r.assignedManagerId).toBe('m1');
    expect(r.status).toBe('in_review');
    expect(recordAudit).toHaveBeenCalled();
  });
  it('keeps status when already in_review', async () => {
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1' });
    const r = await assignLead(d, { leadId: 'L1', managerId: 'm1', assignToUserId: 'm2' });
    expect(r.assignedManagerId).toBe('m2');
    expect(r.status).toBe('in_review');
  });
  it('rejects assigning a promoted lead', async () => {
    const d = db({ id: 'L1', status: 'promoted_to_order', partnerId: 'p1', organizationId: 'o1' });
    await expect(assignLead(d, { leadId: 'L1', managerId: 'm1' })).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });
});

describe('setLeadStatus', () => {
  it('allows in_review → qualified and notifies the partner (S5)', async () => {
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1', clientCompanyName: 'Acme', subject: 'S' });
    const r = await setLeadStatus(d, { leadId: 'L1', managerId: 'm1', status: 'qualified' });
    expect(r.status).toBe('qualified');
    expect(notifyPartnerUsers).toHaveBeenCalledWith(d, expect.objectContaining({ partnerId: 'p1', type: 'lead_status_changed' }));
  });
  it('forbids new → qualified (must go through in_review)', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    await expect(setLeadStatus(d, { leadId: 'L1', managerId: 'm1', status: 'qualified' })).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });
  it('forbids reaching promoted_to_order via setLeadStatus', async () => {
    const d = db({ id: 'L1', status: 'qualified', partnerId: 'p1', organizationId: 'o1' });
    await expect(setLeadStatus(d, { leadId: 'L1', managerId: 'm1', status: 'promoted_to_order' })).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });
});

describe('promoteLead', () => {
  it('creates a local order from the lead and links it', async () => {
    const lead = { id: 'L1', status: 'qualified', partnerId: 'p1', organizationId: 'o1', subject: 'Обучение', estimatedAmount: 5000, promotedOrderId: null };
    const orderCreate = vi.fn().mockResolvedValue({ id: 'ord-new' });
    const leadUpdate = vi.fn().mockResolvedValue({ ...lead, status: 'promoted_to_order', promotedOrderId: 'ord-new' });
    const d = db(lead, {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({ order: { create: orderCreate }, lead: { update: leadUpdate } }))
    });
    const r = await promoteLead(d, { leadId: 'L1', managerId: 'm1' });
    expect(orderCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      title: 'Обучение', companyId: 'co1', organizationId: 'o1', partnerId: 'p1', managerId: 'm1', executionStatus: 'pending', financialStatus: 'not_billed'
    }) });
    // local order: externalId is NOT set (stays null → 1C sync won't touch it)
    expect('externalId' in orderCreate.mock.calls[0][0].data).toBe(false);
    expect(leadUpdate).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { status: 'promoted_to_order', promotedOrderId: 'ord-new' } });
    expect(r.order.id).toBe('ord-new');
  });
  it('rejects an already-promoted lead', async () => {
    const d = db({ id: 'L1', status: 'promoted_to_order', partnerId: 'p1', organizationId: 'o1', promotedOrderId: 'x' });
    await expect(promoteLead(d, { leadId: 'L1', managerId: 'm1' })).rejects.toThrow(/already promoted/);
  });
  it('blocks promotion of an org-less lead', async () => {
    const d = db({ id: 'L1', status: 'qualified', partnerId: 'p1', organizationId: null, subject: 's', estimatedAmount: null, promotedOrderId: null });
    await expect(promoteLead(d, { leadId: 'L1', managerId: 'm1' })).rejects.toThrow(/no organization/);
  });
});

describe('rejectLead', () => {
  it('rejects a lead with a reason', async () => {
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1' });
    const r = await rejectLead(d, { leadId: 'L1', managerId: 'm1', reason: 'нерелевантно' });
    expect(r.status).toBe('rejected');
    expect(r.rejectedReason).toBe('нерелевантно');
  });
  it('cannot reject a promoted lead', async () => {
    const d = db({ id: 'L1', status: 'promoted_to_order', partnerId: 'p1', organizationId: 'o1' });
    await expect(rejectLead(d, { leadId: 'L1', managerId: 'm1', reason: 'x' })).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });
});
