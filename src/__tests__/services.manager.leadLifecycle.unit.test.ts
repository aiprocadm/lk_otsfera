/**
 * Unit tests for src/lib/services/manager/leadLifecycle.ts
 * Covers gaps not in the existing services.manager.leadLifecycle.test.ts:
 * - assignLead: rejected lead (same path as promoted_to_order guard)
 * - promoteLead: org with companyId=null
 * - rejectLead: empty reason defaults to 'Отклонён менеджером'
 * - notifyPartnerLeadStatus: swallows errors (best-effort)
 * - loadLead: returns not_found Result when lead is null
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const { notifyPartnerUsers } = vi.hoisted(() => ({ notifyPartnerUsers: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications/partner', () => ({ notifyPartnerUsers }));

import { assignLead, setLeadStatus, promoteLead, rejectLead } from '@/lib/services/manager/leadLifecycle';

type LeadRow = Record<string, unknown>;

function db(lead: LeadRow | null, txOver: Record<string, unknown> = {}) {
  return {
    lead: {
      findUnique: vi.fn().mockResolvedValue(lead),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...lead, ...data }))
    },
    organization: { findUnique: vi.fn().mockResolvedValue({ companyId: 'co1' }) },
    // B1: assign-to-other валидирует кандидата; по умолчанию — активный менеджер
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'manager', isActive: true }) },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
      order: { create: vi.fn().mockResolvedValue({ id: 'ord-new' }) },
      lead: { update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...lead, ...data })),
      },
      ...txOver
    }))
  } as never;
}

beforeEach(() => {
  recordAudit.mockReset();
  notifyPartnerUsers.mockReset();
});

describe('loadLead — not_found branch', () => {
  it('returns not_found when lead does not exist', async () => {
    const d = db(null);
    expect(await assignLead(d, { leadId: 'nonexistent', managerId: 'm1' })).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('assignLead — additional branches', () => {
  it('rejects assigning a rejected lead (mirrors promoted guard)', async () => {
    const d = db({ id: 'L1', status: 'rejected', partnerId: 'p1', organizationId: 'o1' });
    expect(await assignLead(d, { leadId: 'L1', managerId: 'm1' })).toEqual({ ok: false, error: 'lifecycle_violation' });
  });

  it('does NOT notify partner when status does not change (already in_review)', async () => {
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1', clientCompanyName: 'Acme', subject: 'S' });
    await assignLead(d, { leadId: 'L1', managerId: 'm1', assignToUserId: 'm2' });
    expect(notifyPartnerUsers).not.toHaveBeenCalled();
  });

  it('партнёра НЕ уведомляет (when status changes from new to in_review) — §7 ТЗ', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1', clientCompanyName: 'Acme', subject: 'S' });
    await assignLead(d, { leadId: 'L1', managerId: 'm1' });
    // Этап 10 (§7 ТЗ): лиды — внутренний процесс, партнёра о них не уведомляем.
    expect(notifyPartnerUsers).not.toHaveBeenCalled();
  });
});

describe('setLeadStatus — additional branches', () => {
  it('ALLOWED_STATUS returns [] for unknown status (qualified → unknown lead status)', async () => {
    // If lead.status is unknown (e.g., 'promoted_to_order' or any string not in ALLOWED_STATUS),
    // `allowed` is [] and any target fails
    const d = db({ id: 'L1', status: 'promoted_to_order', partnerId: 'p1', organizationId: 'o1' });
    expect(await setLeadStatus(d, { leadId: 'L1', managerId: 'm1', status: 'in_review' })).toEqual({ ok: false, error: 'lifecycle_violation' });
  });

  it('notifyPartnerLeadStatus swallows errors (best-effort) — Error instance', async () => {
    notifyPartnerUsers.mockRejectedValueOnce(new Error('email down'));
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1', clientCompanyName: 'Acme', subject: 'S' });
    // should not throw even though notify fails
    const r = await setLeadStatus(d, { leadId: 'L1', managerId: 'm1', status: 'qualified' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.lead.status).toBe('qualified');
  });

  it('notifyPartnerLeadStatus swallows non-Error throws (String(err) branch)', async () => {
    // Throw a non-Error value to exercise the String(err) branch
    notifyPartnerUsers.mockRejectedValueOnce('network gone');
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1', clientCompanyName: 'Acme', subject: 'S' });
    const r = await setLeadStatus(d, { leadId: 'L1', managerId: 'm1', status: 'qualified' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.lead.status).toBe('qualified');
  });
});

describe('promoteLead — additional branches', () => {
  it('throws when org has no companyId (org returns companyId=null)', async () => {
    const lead = { id: 'L1', status: 'qualified', partnerId: 'p1', organizationId: 'o1', subject: 'S', estimatedAmount: null, promotedOrderId: null };
    const d = db(lead);
    // Override organization findUnique to return null companyId
    ((d as any).organization.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ companyId: null });
    expect(await promoteLead(d, { leadId: 'L1', managerId: 'm1' })).toEqual({ ok: false, error: 'lifecycle_violation' });
  });

  it('throws when org itself not found (findUnique returns null)', async () => {
    const lead = { id: 'L1', status: 'qualified', partnerId: 'p1', organizationId: 'o1', subject: 'S', estimatedAmount: null, promotedOrderId: null };
    const d = db(lead);
    ((d as any).organization.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await promoteLead(d, { leadId: 'L1', managerId: 'm1' })).toEqual({ ok: false, error: 'lifecycle_violation' });
  });

  it('throws for rejected lead', async () => {
    const d = db({ id: 'L1', status: 'rejected', partnerId: 'p1', organizationId: 'o1', promotedOrderId: null });
    expect(await promoteLead(d, { leadId: 'L1', managerId: 'm1' })).toEqual({ ok: false, error: 'lifecycle_violation' });
  });

  it('uses estimatedAmount=0 when null (totalAmount fallback)', async () => {
    const lead = { id: 'L1', status: 'qualified', partnerId: 'p1', organizationId: 'o1', subject: 'S', estimatedAmount: null, promotedOrderId: null };
    const orderCreate = vi.fn().mockResolvedValue({ id: 'ord-new' });
    const leadUpdate = vi.fn().mockResolvedValue({ ...lead, status: 'promoted_to_order', promotedOrderId: 'ord-new' });
    const d = db(lead, {
      order: { create: orderCreate },
      lead: { update: leadUpdate }
    });
    await promoteLead(d, { leadId: 'L1', managerId: 'm1' });
    expect(orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalAmount: 0 })
    });
  });

  it('партнёра НЕ уведомляет (on successful promotion) — §7 ТЗ', async () => {
    const lead = { id: 'L1', status: 'qualified', partnerId: 'p1', organizationId: 'o1', subject: 'S', estimatedAmount: null, promotedOrderId: null, clientCompanyName: 'A' };
    const orderCreate = vi.fn().mockResolvedValue({ id: 'ord-new' });
    const leadUpdate = vi.fn().mockResolvedValue({ ...lead, status: 'promoted_to_order', promotedOrderId: 'ord-new' });
    const d = db(lead, { order: { create: orderCreate }, lead: { update: leadUpdate } });
    await promoteLead(d, { leadId: 'L1', managerId: 'm1' });
    expect(notifyPartnerUsers).not.toHaveBeenCalled();
  });
});

describe('rejectLead — additional branches', () => {
  it('uses default reason when empty string passed', async () => {
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1', clientCompanyName: 'A', subject: 'S' });
    const r = await rejectLead(d, { leadId: 'L1', managerId: 'm1', reason: '' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.lead.rejectedReason).toBe('Отклонён менеджером');
  });

  it('uses default reason when whitespace-only string passed', async () => {
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1', clientCompanyName: 'A', subject: 'S' });
    const r = await rejectLead(d, { leadId: 'L1', managerId: 'm1', reason: '   ' });
    if (!r.ok) throw new Error('expected ok');
    // trim() of whitespace is empty, which is falsy, so default is used
    expect(r.lead.rejectedReason).toBe('Отклонён менеджером');
  });

  it('партнёра НЕ уведомляет (on rejection) — §7 ТЗ', async () => {
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1', clientCompanyName: 'A', subject: 'S' });
    await rejectLead(d, { leadId: 'L1', managerId: 'm1', reason: 'not suitable' });
    expect(notifyPartnerUsers).not.toHaveBeenCalled();
  });
});
