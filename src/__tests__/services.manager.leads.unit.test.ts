/**
 * Unit tests for src/lib/services/manager/leads.ts
 * Covers getManagerLead (not in existing unit test) and additional
 * listManagerLeads branches (with cursor, estimatedAmount, organization).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { listManagerLeads, getManagerLead } from '@/lib/services/manager/leads';
import { Decimal } from '@prisma/client/runtime/library';

const SESSION = { sub: 'mgr-1', role: 'manager' as const, companyId: 'co-1' };

beforeEach(() => {
  recordPiiAccess.mockClear();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function leadRow(
  id: string,
  over: Record<string, unknown> = {}
) {
  return {
    id,
    clientCompanyName: 'Acme Corp',
    clientInn: null,
    subject: 'Обучение',
    status: 'new',
    estimatedAmount: null,
    organization: null,
    partner: { name: 'Partner A' },
    assignedManagerId: null,
    assignedManager: null,
    promotedOrderId: null,
    createdAt: new Date('2026-06-01'),
    ...over
  };
}

// ─── listManagerLeads ──────────────────────────────────────────────────────────

describe('listManagerLeads', () => {
  it('returns page without nextCursor when rows <= take', async () => {
    const rows = [leadRow('L1'), leadRow('L2')];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, { take: 20 });
    expect(r.rows).toHaveLength(2);
    expect(r.nextCursor).toBeNull();
  });

  it('maps estimatedAmount Decimal to toFixed(2) string', async () => {
    const rows = [leadRow('L1', { estimatedAmount: new Decimal('12345.678') })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.estimatedAmount).toBe('12345.68');
  });

  it('keeps estimatedAmount null when not set', async () => {
    const rows = [leadRow('L1', { estimatedAmount: null })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.estimatedAmount).toBeNull();
  });

  it('maps organization id/name when present', async () => {
    const rows = [
      leadRow('L1', { organization: { id: 'o1', name: 'Org One' } })
    ];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.organizationId).toBe('o1');
    expect(r.rows[0]!.organizationName).toBe('Org One');
  });

  it('maps organizationId/organizationName to null when organization is null', async () => {
    const rows = [leadRow('L1', { organization: null })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.organizationId).toBeNull();
    expect(r.rows[0]!.organizationName).toBeNull();
  });

  it('maps assignedManagerName to null when assignedManager is null', async () => {
    const rows = [leadRow('L1', { assignedManager: null })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.assignedManagerName).toBeNull();
  });

  it('maps assignedManagerName from nested object', async () => {
    const rows = [leadRow('L1', { assignedManager: { name: 'Ivanov' }, assignedManagerId: 'mgr-1' })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.assignedManagerName).toBe('Ivanov');
  });

  it('passes cursor to findMany when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { lead: { findMany } } as never;
    await listManagerLeads(db, { cursor: 'cursor-id-1' });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: 'cursor-id-1' });
    expect(call.skip).toBe(1);
  });

  it('does not pass cursor when not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { lead: { findMany } } as never;
    await listManagerLeads(db, {});
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toBeUndefined();
    expect(call.skip).toBeUndefined();
  });

  it('uses default take=20 when not specified', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { lead: { findMany } } as never;
    await listManagerLeads(db, {});
    const call = findMany.mock.calls[0][0];
    expect(call.take).toBe(21); // take+1 for "has more" detection
  });
});

// ─── getManagerLead ────────────────────────────────────────────────────────────

describe('getManagerLead', () => {
  function fullRow(over: Record<string, unknown> = {}) {
    return {
      id: 'L1',
      clientCompanyName: 'Acme',
      clientInn: '7701000001',
      subject: 'Обучение сотрудников',
      status: 'in_review',
      estimatedAmount: null,
      organization: null,
      partner: { name: 'Partner B' },
      assignedManagerId: 'mgr-1',
      assignedManager: { name: 'Иванов' },
      promotedOrderId: null,
      createdAt: new Date('2026-06-01'),
      clientContactName: 'Контактное лицо',
      clientContactPhone: '+7 999 000 0000',
      clientContactEmail: 'contact@acme.ru',
      productType: ['training'],
      notes: 'Приоритет высокий',
      rejectedReason: null,
      createdByUser: { name: 'Admin' },
      updatedAt: new Date('2026-06-05'),
      externalIdInOneC: null,
      pushedToOneCAt: null,
      ...over
    };
  }

  it('returns null when lead is not found', async () => {
    const db = {
      lead: { findUnique: vi.fn().mockResolvedValue(null) }
    } as never;
    const result = await getManagerLead(db, SESSION, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns the full detail payload when lead is found', async () => {
    const db = {
      lead: { findUnique: vi.fn().mockResolvedValue(fullRow()) }
    } as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('L1');
    expect(result!.clientContactName).toBe('Контактное лицо');
    expect(result!.clientContactPhone).toBe('+7 999 000 0000');
    expect(result!.clientContactEmail).toBe('contact@acme.ru');
    expect(result!.productType).toEqual(['training']);
    expect(result!.notes).toBe('Приоритет высокий');
    expect(result!.rejectedReason).toBeNull();
    expect(result!.createdByUserName).toBe('Admin');
    expect(result!.partnerName).toBe('Partner B');
    expect(result!.assignedManagerName).toBe('Иванов');
    expect(result!.externalIdInOneC).toBeNull();
    expect(result!.pushedToOneCAt).toBeNull();
  });

  it('прокидывает externalIdInOneC/pushedToOneCAt (B3: строка «1С» на странице лида)', async () => {
    const pushedAt = new Date('2026-06-05T10:00:00Z');
    const db = {
      lead: {
        findUnique: vi
          .fn()
          .mockResolvedValue(fullRow({ externalIdInOneC: 'EXT-77', pushedToOneCAt: pushedAt }))
      }
    } as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.externalIdInOneC).toBe('EXT-77');
    expect(result!.pushedToOneCAt).toEqual(pushedAt);
  });

  it('maps estimatedAmount Decimal to string when present', async () => {
    const db = {
      lead: {
        findUnique: vi.fn().mockResolvedValue(
          fullRow({ estimatedAmount: new Decimal('5000.00') })
        )
      }
    } as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.estimatedAmount).toBe('5000.00');
  });

  it('maps estimatedAmount to null when absent', async () => {
    const db = {
      lead: {
        findUnique: vi.fn().mockResolvedValue(fullRow({ estimatedAmount: null }))
      }
    } as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.estimatedAmount).toBeNull();
  });

  it('maps organization id/name when present', async () => {
    const db = {
      lead: {
        findUnique: vi.fn().mockResolvedValue(
          fullRow({ organization: { id: 'o1', name: 'Org One' } })
        )
      }
    } as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.organizationId).toBe('o1');
    expect(result!.organizationName).toBe('Org One');
  });

  it('maps organizationId/organizationName to null when organization is null', async () => {
    const db = {
      lead: {
        findUnique: vi.fn().mockResolvedValue(fullRow({ organization: null }))
      }
    } as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.organizationId).toBeNull();
    expect(result!.organizationName).toBeNull();
  });

  it('maps assignedManagerName to null when assignedManager is null', async () => {
    const db = {
      lead: {
        findUnique: vi.fn().mockResolvedValue(
          fullRow({ assignedManager: null })
        )
      }
    } as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.assignedManagerName).toBeNull();
  });

  it('журналирует выдачу контактных ПДн (view)', async () => {
    const db = {
      lead: { findUnique: vi.fn().mockResolvedValue(fullRow()) }
    } as never;
    await getManagerLead(db, SESSION, 'L1');
    expect(recordPiiAccess).toHaveBeenCalledWith(db, {
      session: SESSION,
      context: 'manager_lead_view',
      subjectIds: ['L1']
    });
  });

  it('null-ветка: журнал не пишется', async () => {
    const db = { lead: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    await getManagerLead(db, SESSION, 'nope');
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
});
