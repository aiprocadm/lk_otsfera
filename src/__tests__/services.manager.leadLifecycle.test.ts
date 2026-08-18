import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const { notifyPartnerUsers } = vi.hoisted(() => ({ notifyPartnerUsers: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications/partner', () => ({ notifyPartnerUsers }));

import {
  assignLead,
  setLeadStatus,
  promoteLead,
  rejectLead,
} from '@/lib/services/manager/leadLifecycle';

type LeadRow = Record<string, unknown>;

function db(lead: LeadRow | null, over: Record<string, unknown> = {}) {
  return {
    lead: {
      findUnique: vi.fn().mockResolvedValue(lead),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...lead,
        ...data,
      })),
    },
    organization: { findUnique: vi.fn().mockResolvedValue({ companyId: 'co1' }) },
    // B1: assign-to-other валидирует кандидата; по умолчанию — активный менеджер
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'manager', isActive: true }) },
    order: { create: vi.fn().mockResolvedValue({ id: 'ord-new' }) },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        order: { create: vi.fn().mockResolvedValue({ id: 'ord-new' }) },
        lead: {
          update: vi
            .fn()
            .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
              ...lead,
              ...data,
            })),
        },
        // §10 ТЗ v0.5 (PR-3): заявка спрашивает начальный статус у справочника
        orderStatusDefinition: { findFirst: vi.fn().mockResolvedValue({ id: 'oss_draft' }) },
      })
    ),
    ...over,
  } as never;
}

beforeEach(() => {
  recordAudit.mockReset();
  notifyPartnerUsers.mockReset();
});

describe('assignLead', () => {
  it('claims a new lead to the manager and advances new → in_review', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    const r = await assignLead(d, { leadId: 'L1', managerId: 'm1' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.lead.assignedManagerId).toBe('m1');
    expect(r.lead.status).toBe('in_review');
    expect(recordAudit).toHaveBeenCalled();
  });
  it('keeps status when already in_review', async () => {
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1' });
    const r = await assignLead(d, { leadId: 'L1', managerId: 'm1', assignToUserId: 'm2' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.lead.assignedManagerId).toBe('m2');
    expect(r.lead.status).toBe('in_review');
  });
  it('rejects assigning a promoted lead', async () => {
    const d = db({ id: 'L1', status: 'promoted_to_order', partnerId: 'p1', organizationId: 'o1' });
    expect(await assignLead(d, { leadId: 'L1', managerId: 'm1' })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
  });
  it('returns not_found for a missing lead', async () => {
    const d = db(null);
    expect(await assignLead(d, { leadId: 'L1', managerId: 'm1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
  it('B1: rejects handover to a nonexistent user → invalid_manager, no update', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    (d as any).user.findUnique.mockResolvedValue(null);
    expect(await assignLead(d, { leadId: 'L1', managerId: 'm1', assignToUserId: 'ghost' })).toEqual(
      { ok: false, error: 'invalid_manager' }
    );
    expect((d as any).lead.update).not.toHaveBeenCalled();
  });
  it('B1: rejects handover to a non-manager role → invalid_manager', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    (d as any).user.findUnique.mockResolvedValue({ role: 'partner', isActive: true });
    expect(await assignLead(d, { leadId: 'L1', managerId: 'm1', assignToUserId: 'u2' })).toEqual({
      ok: false,
      error: 'invalid_manager',
    });
  });
  it('B1: rejects handover to an inactive manager → invalid_manager', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    (d as any).user.findUnique.mockResolvedValue({ role: 'manager', isActive: false });
    expect(await assignLead(d, { leadId: 'L1', managerId: 'm1', assignToUserId: 'u2' })).toEqual({
      ok: false,
      error: 'invalid_manager',
    });
  });
  it('кандидат с ролью leader валиден (контур Р-Л-4, ТЗ 2026-08-17)', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    (d as any).user.findUnique.mockResolvedValue({ role: 'leader', isActive: true });
    const r = await assignLead(d, { leadId: 'L1', managerId: 'm1', assignToUserId: 'ldr-1' });
    expect(r.ok).toBe(true);
  });
  it('B1: self-assign skips candidate lookup entirely (behaviour unchanged)', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    const r = await assignLead(d, { leadId: 'L1', managerId: 'm1' });
    if (!r.ok) throw new Error('expected ok');
    expect((d as any).user.findUnique).not.toHaveBeenCalled();
  });
  it('B1: explicit assignToUserId equal to self skips candidate lookup', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    const r = await assignLead(d, { leadId: 'L1', managerId: 'm1', assignToUserId: 'm1' });
    if (!r.ok) throw new Error('expected ok');
    expect((d as any).user.findUnique).not.toHaveBeenCalled();
  });
});

describe('setLeadStatus', () => {
  it('allows in_review → qualified и НЕ уведомляет партнёра (§7 ТЗ, этап 10)', async () => {
    const d = db({
      id: 'L1',
      status: 'in_review',
      partnerId: 'p1',
      organizationId: 'o1',
      clientCompanyName: 'Acme',
      subject: 'S',
    });
    const r = await setLeadStatus(d, { leadId: 'L1', managerId: 'm1', status: 'qualified' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.lead.status).toBe('qualified');
    expect(notifyPartnerUsers).not.toHaveBeenCalled();
  });
  it('forbids new → qualified (must go through in_review)', async () => {
    const d = db({ id: 'L1', status: 'new', partnerId: 'p1', organizationId: 'o1' });
    expect(await setLeadStatus(d, { leadId: 'L1', managerId: 'm1', status: 'qualified' })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
  });
  it('forbids reaching promoted_to_order via setLeadStatus', async () => {
    const d = db({ id: 'L1', status: 'qualified', partnerId: 'p1', organizationId: 'o1' });
    expect(
      await setLeadStatus(d, { leadId: 'L1', managerId: 'm1', status: 'promoted_to_order' })
    ).toEqual({ ok: false, error: 'lifecycle_violation' });
  });
});

describe('promoteLead', () => {
  it('creates a local order from the lead and links it', async () => {
    const lead = {
      id: 'L1',
      status: 'qualified',
      partnerId: 'p1',
      organizationId: 'o1',
      subject: 'Обучение',
      estimatedAmount: 5000,
      promotedOrderId: null,
    };
    const orderCreate = vi.fn().mockResolvedValue({ id: 'ord-new' });
    const leadUpdate = vi
      .fn()
      .mockResolvedValue({ ...lead, status: 'promoted_to_order', promotedOrderId: 'ord-new' });
    const d = db(lead, {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          order: { create: orderCreate },
          lead: { update: leadUpdate },
          // §10 ТЗ v0.5 (PR-3): заявка спрашивает начальный статус у справочника
          orderStatusDefinition: { findFirst: vi.fn().mockResolvedValue({ id: 'oss_draft' }) },
        })
      ),
    });
    const r = await promoteLead(d, { leadId: 'L1', managerId: 'm1' });
    if (!r.ok) throw new Error('expected ok');
    expect(orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Обучение',
        companyId: 'co1',
        organizationId: 'o1',
        partnerId: 'p1',
        managerId: 'm1',
        executionStatus: 'pending',
        financialStatus: 'not_billed',
      }),
    });
    // local order: externalId is NOT set (stays null → 1C sync won't touch it)
    expect('externalId' in orderCreate.mock.calls[0][0].data).toBe(false);
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: 'L1' },
      data: { status: 'promoted_to_order', promotedOrderId: 'ord-new' },
    });
    expect(r.order.id).toBe('ord-new');
  });
  it('rejects an already-promoted lead', async () => {
    const d = db({
      id: 'L1',
      status: 'promoted_to_order',
      partnerId: 'p1',
      organizationId: 'o1',
      promotedOrderId: 'x',
    });
    expect(await promoteLead(d, { leadId: 'L1', managerId: 'm1' })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
  });
  it('blocks promotion of an org-less lead', async () => {
    const d = db({
      id: 'L1',
      status: 'qualified',
      partnerId: 'p1',
      organizationId: null,
      subject: 's',
      estimatedAmount: null,
      promotedOrderId: null,
    });
    expect(await promoteLead(d, { leadId: 'L1', managerId: 'm1' })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
  });
});

describe('rejectLead', () => {
  it('rejects a lead with a reason', async () => {
    const d = db({ id: 'L1', status: 'in_review', partnerId: 'p1', organizationId: 'o1' });
    const r = await rejectLead(d, { leadId: 'L1', managerId: 'm1', reason: 'нерелевантно' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.lead.status).toBe('rejected');
    expect(r.lead.rejectedReason).toBe('нерелевантно');
  });
  it('cannot reject a promoted lead', async () => {
    const d = db({ id: 'L1', status: 'promoted_to_order', partnerId: 'p1', organizationId: 'o1' });
    expect(await rejectLead(d, { leadId: 'L1', managerId: 'm1', reason: 'x' })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
  });
});
