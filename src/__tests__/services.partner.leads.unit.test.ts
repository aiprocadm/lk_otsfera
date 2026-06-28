/**
 * Unit tests for src/lib/services/partner/leads.ts
 * Covers branches missed by the integration test (lives in PG mode).
 */
import { describe, it, expect, vi } from 'vitest';
import { listLeads, getLead, createLead, withdrawLead } from '@/lib/services/partner/leads';

function dec(n: number) {
  return { toFixed: (d: number) => n.toFixed(d), toString: () => String(n) };
}

function makeListPrisma(leads: object[] = [], total = 0, counts: { status: string; _count: { _all: number } }[] = []) {
  return {
    lead: {
      findMany: vi.fn().mockResolvedValue(leads),
      count: vi.fn().mockResolvedValue(total),
      groupBy: vi.fn().mockResolvedValue(counts)
    }
  } as any;
}

describe('listLeads — unit', () => {
  it('fills missing statuses with zero in countsByStatus', async () => {
    const prisma = makeListPrisma([], 0, [
      { status: 'new', _count: { _all: 2 } }
    ]);
    const result = await listLeads(prisma, { partnerId: 'p1', take: 10, skip: 0 });
    expect(result.countsByStatus.new).toBe(2);
    expect(result.countsByStatus.rejected).toBe(0);
    expect(result.countsByStatus.promoted_to_order).toBe(0);
  });

  it('applies status filter when provided', async () => {
    const prisma = makeListPrisma([], 0, []);
    await listLeads(prisma, { partnerId: 'p1', status: 'qualified', take: 10, skip: 0 });
    const where = prisma.lead.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('qualified');
  });

  it('applies search OR filter when provided', async () => {
    const prisma = makeListPrisma([], 0, []);
    await listLeads(prisma, { partnerId: 'p1', search: 'тест', take: 10, skip: 0 });
    const where = prisma.lead.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeDefined();
    expect(where.OR).toHaveLength(4);
  });

  it('applies scopeOrgIds filter when provided', async () => {
    const prisma = makeListPrisma([], 0, []);
    await listLeads(prisma, { partnerId: 'p1', scopeOrgIds: ['org1'], take: 10, skip: 0 });
    const where = prisma.lead.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: ['org1'] });
  });

  it('maps row with estimatedAmount null to null string', async () => {
    const prisma = makeListPrisma([{
      id: 'l1', clientCompanyName: 'X', clientInn: null,
      clientContactName: 'Y', subject: 'Z', status: 'new',
      estimatedAmount: null, productType: [], promotedOrderId: null,
      createdAt: new Date(), updatedAt: new Date(),
      organization: null
    }], 1, []);
    const result = await listLeads(prisma, { partnerId: 'p1', take: 10, skip: 0 });
    expect(result.rows[0].estimatedAmount).toBeNull();
    expect(result.rows[0].organizationId).toBeNull();
    expect(result.rows[0].organizationName).toBeNull();
  });

  it('maps row with organization populated', async () => {
    const prisma = makeListPrisma([{
      id: 'l2', clientCompanyName: 'Org Inc', clientInn: '7700',
      clientContactName: 'A', subject: 'B', status: 'in_review',
      estimatedAmount: dec(50000), productType: [], promotedOrderId: null,
      createdAt: new Date(), updatedAt: new Date(),
      organization: { id: 'org1', name: 'ООО Тест' }
    }], 1, []);
    const result = await listLeads(prisma, { partnerId: 'p1', take: 10, skip: 0 });
    expect(result.rows[0].estimatedAmount).toBe('50000.00');
    expect(result.rows[0].organizationId).toBe('org1');
    expect(result.rows[0].organizationName).toBe('ООО Тест');
  });
});

describe('getLead — unit', () => {
  it('returns null when lead not found', async () => {
    const prisma = {
      lead: { findFirst: vi.fn().mockResolvedValue(null) }
    } as any;
    const result = await getLead(prisma, { leadId: 'x', partnerId: 'p1' });
    expect(result).toBeNull();
  });

  it('returns full detail with assignedManagerName null when no manager', async () => {
    const prisma = {
      lead: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'l1', clientCompanyName: 'X', clientInn: null,
          clientContactName: 'Y', clientContactPhone: null, clientContactEmail: null,
          subject: 'Z', status: 'new',
          estimatedAmount: null, productType: [], promotedOrderId: null,
          notes: null, rejectedReason: null,
          createdAt: new Date(), updatedAt: new Date(),
          organization: null,
          createdByUser: { name: 'Создатель Иванов' },
          assignedManager: null
        })
      }
    } as any;
    const result = await getLead(prisma, { leadId: 'l1', partnerId: 'p1' });
    expect(result).not.toBeNull();
    expect(result!.createdByUserName).toBe('Создатель Иванов');
    expect(result!.assignedManagerName).toBeNull();
    expect(result!.estimatedAmount).toBeNull();
  });

  it('returns assignedManagerName when manager is present', async () => {
    const prisma = {
      lead: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'l2', clientCompanyName: 'A', clientInn: null,
          clientContactName: 'B', clientContactPhone: '+7', clientContactEmail: 'a@b.c',
          subject: 'S', status: 'qualified',
          estimatedAmount: dec(100000), productType: ['IT'], promotedOrderId: null,
          notes: 'Some note', rejectedReason: null,
          createdAt: new Date(), updatedAt: new Date(),
          organization: { id: 'org1', name: 'ООО' },
          createdByUser: { name: 'Creator' },
          assignedManager: { name: 'Manager Petrov' }
        })
      }
    } as any;
    const result = await getLead(prisma, { leadId: 'l2', partnerId: 'p1' });
    expect(result!.assignedManagerName).toBe('Manager Petrov');
    expect(result!.estimatedAmount).toBe('100000.00');
    expect(result!.organizationId).toBe('org1');
  });

  it('passes scopeOrgIds OR filter when provided', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { lead: { findFirst } } as any;
    await getLead(prisma, { leadId: 'l1', partnerId: 'p1', scopeOrgIds: ['org1'] });
    const where = findFirst.mock.calls[0][0].where;
    expect(where.OR).toBeDefined();
    expect(where.OR).toHaveLength(2);
  });
});

describe('createLead — unit', () => {
  it('creates lead without organizationId check when organizationId is absent', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'nl', status: 'new' });
    const prisma = {
      lead: { create },
      organization: { findFirst: vi.fn() }
    } as any;
    const result = await createLead(prisma, {
      partnerId: 'p1', createdByUserId: 'u1',
      clientCompanyName: 'ООО X', clientContactName: 'Y', subject: 'Z'
    });
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.ok && result.lead.status).toBe('new');
  });

  it('trims optional string fields when provided (covers ?.trim() positive branches)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'nl3', status: 'new' });
    const org = { id: 'org1' };
    const prisma = {
      organization: { findFirst: vi.fn().mockResolvedValue(org) },
      lead: { create }
    } as any;
    await createLead(prisma, {
      partnerId: 'p1', createdByUserId: 'u1',
      organizationId: 'org1',
      clientCompanyName: '  ООО X  ', clientContactName: ' Иван ',
      clientInn: '  7700000001  ',
      clientContactPhone: '  +79001234567  ',
      clientContactEmail: '  test@example.com  ',
      subject: '  Обучение  ',
      notes: '  Примечание  ',
      estimatedAmount: 50000,
      productType: ['IT', 'SEC']
    });
    const data = create.mock.calls[0][0].data;
    expect(data.clientInn).toBe('7700000001');
    expect(data.clientContactPhone).toBe('+79001234567');
    expect(data.clientContactEmail).toBe('test@example.com');
    expect(data.notes).toBe('Примечание');
    expect(data.estimatedAmount).toBe(50000);
    expect(data.productType).toEqual(['IT', 'SEC']);
  });

  it('returns org_out_of_scope when organizationId not under partner (mocked)', async () => {
    const prisma = {
      organization: { findFirst: vi.fn().mockResolvedValue(null) },
      lead: { create: vi.fn() }
    } as any;
    const res = await createLead(prisma, {
      partnerId: 'p1', createdByUserId: 'u1',
      organizationId: 'foreign-org',
      clientCompanyName: 'X', clientContactName: 'Y', subject: 'Z'
    });
    expect(res).toEqual({ ok: false, error: 'org_out_of_scope' });
  });

  it('sets estimatedAmount null when not provided', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'nl2', status: 'new' });
    const org = { id: 'org1' };
    const prisma = {
      organization: { findFirst: vi.fn().mockResolvedValue(org) },
      lead: { create }
    } as any;
    await createLead(prisma, {
      partnerId: 'p1', createdByUserId: 'u1',
      organizationId: 'org1',
      clientCompanyName: 'X', clientContactName: 'Y', subject: 'Z'
    });
    const data = create.mock.calls[0][0].data;
    expect(data.estimatedAmount).toBeNull();
    expect(data.productType).toEqual([]);
  });
});

describe('withdrawLead — unit', () => {
  it('returns already_promoted for promoted_to_order status', async () => {
    const prisma = {
      lead: {
        findFirst: vi.fn().mockResolvedValue({ id: 'l1', status: 'promoted_to_order' }),
        update: vi.fn()
      }
    } as any;
    const res = await withdrawLead(prisma, { leadId: 'l1', partnerId: 'p1', reason: 'x' });
    expect(res).toEqual({ ok: false, error: 'already_promoted' });
  });

  it('returns already_rejected for already-rejected lead', async () => {
    const prisma = {
      lead: {
        findFirst: vi.fn().mockResolvedValue({ id: 'l2', status: 'rejected' }),
        update: vi.fn()
      }
    } as any;
    const res = await withdrawLead(prisma, { leadId: 'l2', partnerId: 'p1', reason: 'x' });
    expect(res).toEqual({ ok: false, error: 'already_rejected' });
  });

  it('returns not_found when lead not found', async () => {
    const prisma = {
      lead: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn()
      }
    } as any;
    const res = await withdrawLead(prisma, { leadId: 'missing', partnerId: 'p1', reason: 'x' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('updates lead to rejected status when valid', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'l3', status: 'rejected', rejectedReason: 'Отозван' });
    const prisma = {
      lead: {
        findFirst: vi.fn().mockResolvedValue({ id: 'l3', status: 'new' }),
        update
      }
    } as any;
    const result = await withdrawLead(prisma, { leadId: 'l3', partnerId: 'p1', reason: 'Отозван' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.lead.status).toBe('rejected');
    expect(update.mock.calls[0][0].data.rejectedReason).toBe('Отозван');
  });

  it('uses default reason text when reason is empty', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'l4', status: 'rejected', rejectedReason: 'Отозван партнёром' });
    const prisma = {
      lead: {
        findFirst: vi.fn().mockResolvedValue({ id: 'l4', status: 'in_review' }),
        update
      }
    } as any;
    await withdrawLead(prisma, { leadId: 'l4', partnerId: 'p1', reason: '' });
    expect(update.mock.calls[0][0].data.rejectedReason).toBe('Отозван партнёром');
  });

  it('passes scopeOrgIds OR filter when provided', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { lead: { findFirst, update: vi.fn() } } as any;
    const res = await withdrawLead(prisma, { leadId: 'l1', partnerId: 'p1', scopeOrgIds: ['org1'], reason: 'x' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    const where = findFirst.mock.calls[0][0].where;
    expect(where.OR).toBeDefined();
  });
});
