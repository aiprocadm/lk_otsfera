import { describe, it, expect, vi } from 'vitest';
import { listManagerLeads } from '@/lib/services/manager/leads';

function dbWith(rows: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { db: { lead: { findMany } } as never, findMany };
}

function leadRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    clientCompanyName: 'Acme',
    clientInn: null,
    subject: 'S',
    status: 'new',
    estimatedAmount: null,
    organization: null,
    partner: { name: 'P' },
    assignedManagerId: null,
    assignedManager: null,
    promotedOrderId: null,
    createdAt: new Date('2026-06-01'),
    ...over,
  };
}

describe('listManagerLeads (team queue)', () => {
  it('lists all leads with no per-manager scope filter', async () => {
    const { db, findMany } = dbWith([leadRow('L1')]);
    const r = await listManagerLeads(db, {});
    expect(r.rows).toHaveLength(1);
    const where = findMany.mock.calls[0][0].where;
    // team queue: no assignedManagerId / org scoping unless explicitly filtered
    expect(where).toEqual({});
  });

  it('applies status, search and assignedToUserId filters', async () => {
    const { db, findMany } = dbWith([]);
    await listManagerLeads(db, { status: 'qualified', search: 'acme', assignedToUserId: 'm1' });
    const where = findMany.mock.calls[0][0].where;
    // G2: фильтры компонуются через AND (scope-OR и search-OR не затирают друг друга).
    expect(where.AND).toBeTruthy();
    const flat = Object.assign({}, ...where.AND);
    expect(flat.status).toBe('qualified');
    expect(flat.assignedManagerId).toBe('m1');
    expect(flat.OR).toBeTruthy();
  });

  it('paginates with a cursor when more rows than the page size', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => leadRow(`L${i}`));
    const { db } = dbWith(rows);
    const r = await listManagerLeads(db, { take: 20 });
    expect(r.rows).toHaveLength(20);
    expect(r.nextCursor).toBe('L19');
  });
});
