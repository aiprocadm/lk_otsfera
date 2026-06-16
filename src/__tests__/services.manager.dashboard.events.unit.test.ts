/**
 * Unit tests for src/lib/services/manager/dashboard/events.ts
 * Covers: teamModeOverride, payment with/without order, audit filter by scope,
 * comment without author, empty auditEntityIds path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managerOrderScope, managerOrgScope } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  managerOrderScope: vi.fn().mockReturnValue({}),
  managerOrgScope: vi.fn().mockReturnValue({})
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managerOrderScope,
  managerOrgScope
}));

import { recentEvents } from '@/lib/services/manager/dashboard/events';

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managerOrderScope.mockReturnValue({});
  managerOrgScope.mockReturnValue({});
});
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1'
};

function emptyPrisma(overrides: Record<string, unknown> = {}) {
  return {
    document: { findMany: vi.fn().mockResolvedValue([]) },
    payment: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    comment: { findMany: vi.fn().mockResolvedValue([]) },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides
  } as never;
}

describe('recentEvents', () => {
  it('returns empty array when all sources are empty', async () => {
    const result = await recentEvents(emptyPrisma(), SESSION);
    expect(result).toEqual([]);
  });

  it('uses teamModeOverride=true without calling getCompanyTeamVisibility', async () => {
    await recentEvents(emptyPrisma(), SESSION, 15, true);
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(managerOrderScope).toHaveBeenCalledWith(SESSION, true);
    expect(managerOrgScope).toHaveBeenCalledWith(SESSION, true);
  });

  it('calls getCompanyTeamVisibility when teamModeOverride is not provided', async () => {
    await recentEvents(emptyPrisma(), SESSION);
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(expect.anything(), 'co-1');
  });

  it('maps document to document_created event with order orderNumber', async () => {
    const documents = [{
      id: 'doc-1',
      name: 'договор.pdf',
      createdAt: new Date('2026-06-10T10:00:00Z'),
      orderId: 'ord-1',
      order: { orderNumber: 'O-100' }
    }];
    const p = emptyPrisma({ document: { findMany: vi.fn().mockResolvedValue(documents) } });
    const result = await recentEvents(p, SESSION);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('document_created');
    expect(result[0]!.text).toContain('O-100');
    expect(result[0]!.href).toBe('/manager/orders/ord-1');
  });

  it('maps document without orderNumber to documents page href', async () => {
    const documents = [{
      id: 'doc-2',
      name: 'файл.pdf',
      createdAt: new Date('2026-06-10T10:00:00Z'),
      orderId: null,
      order: null
    }];
    const p = emptyPrisma({ document: { findMany: vi.fn().mockResolvedValue(documents) } });
    const result = await recentEvents(p, SESSION);
    expect(result[0]!.href).toBe('/manager/documents');
  });

  it('maps payment WITH order to order-linked event', async () => {
    const payments = [{
      id: 'pay-1',
      amount: 10000,
      paidAt: new Date('2026-06-10T09:00:00Z'),
      orderId: 'ord-1',
      order: { orderNumber: 'O-100' },
      organization: { id: 'org-1', name: 'Org One' }
    }];
    const p = emptyPrisma({ payment: { findMany: vi.fn().mockResolvedValue(payments) } });
    const result = await recentEvents(p, SESSION);
    expect(result[0]!.kind).toBe('payment_received');
    expect(result[0]!.text).toContain('O-100');
    expect(result[0]!.href).toBe('/manager/orders/ord-1');
  });

  it('maps payment WITHOUT order to org-level event with dashboard href', async () => {
    const payments = [{
      id: 'pay-2',
      amount: 5000,
      paidAt: new Date('2026-06-10T08:00:00Z'),
      orderId: null,
      order: null,
      organization: { id: 'org-1', name: 'Org One' }
    }];
    const p = emptyPrisma({ payment: { findMany: vi.fn().mockResolvedValue(payments) } });
    const result = await recentEvents(p, SESSION);
    expect(result[0]!.kind).toBe('payment_received');
    expect(result[0]!.text).toContain('Org One');
    expect(result[0]!.href).toBe('/manager/dashboard');
  });

  it('skips auditLog secondary query when no audit entries returned', async () => {
    const orderFindMany = vi.fn().mockResolvedValue([]);
    const p = emptyPrisma({ order: { findMany: orderFindMany } });
    await recentEvents(p, SESSION);
    // order.findMany is NOT called because auditEntityIds is empty
    expect(orderFindMany).not.toHaveBeenCalled();
  });

  it('filters audit entries to scoped orders only', async () => {
    const audits = [
      { id: 'a1', action: 'order_status_changed', entityId: 'ord-in', createdAt: new Date('2026-06-10T11:00:00Z'), meta: { after: { executionStatus: 'in_progress' } } },
      { id: 'a2', action: 'order_status_changed', entityId: 'ord-out', createdAt: new Date('2026-06-10T10:00:00Z'), meta: null }
    ];
    const scopedOrders = [{ id: 'ord-in', orderNumber: 'O-IN' }];
    const p = emptyPrisma({
      auditLog: { findMany: vi.fn().mockResolvedValue(audits) },
      order: { findMany: vi.fn().mockResolvedValue(scopedOrders) }
    });
    const result = await recentEvents(p, SESSION);
    const kinds = result.map((e) => e.kind);
    expect(kinds).toContain('order_status_changed');
    // The out-of-scope audit entry should be filtered
    const orderEventIds = result.filter((e) => e.kind === 'order_status_changed').map((e) => e.id);
    expect(orderEventIds).toEqual(['audit-a1']);
  });

  it('maps comment_posted audit action to text mentioning order number', async () => {
    const audits = [
      { id: 'a1', action: 'comment_posted', entityId: 'ord-1', createdAt: new Date('2026-06-10'), meta: null }
    ];
    const p = emptyPrisma({
      auditLog: { findMany: vi.fn().mockResolvedValue(audits) },
      order: { findMany: vi.fn().mockResolvedValue([{ id: 'ord-1', orderNumber: 'O-42' }]) }
    });
    const result = await recentEvents(p, SESSION);
    expect(result[0]!.kind).toBe('comment_posted');
    expect(result[0]!.text).toContain('O-42');
  });

  it('audit entry without meta still renders (afterStatus=undefined → —)', async () => {
    const audits = [
      { id: 'a1', action: 'order_status_changed', entityId: 'ord-1', createdAt: new Date('2026-06-10'), meta: null }
    ];
    const p = emptyPrisma({
      auditLog: { findMany: vi.fn().mockResolvedValue(audits) },
      order: { findMany: vi.fn().mockResolvedValue([{ id: 'ord-1', orderNumber: null }]) }
    });
    const result = await recentEvents(p, SESSION);
    expect(result[0]!.text).toContain('→ —');
  });

  it('maps comment with author to "Name: body" text', async () => {
    const comments = [{
      id: 'c-1',
      createdAt: new Date('2026-06-10T12:00:00Z'),
      body: 'Привет!',
      orderId: 'ord-1',
      author: { name: 'Петров' },
      order: { orderNumber: 'O-99' }
    }];
    const p = emptyPrisma({ comment: { findMany: vi.fn().mockResolvedValue(comments) } });
    const result = await recentEvents(p, SESSION);
    expect(result[0]!.kind).toBe('comment');
    expect(result[0]!.text).toBe('Петров: Привет!');
    expect(result[0]!.href).toBe('/manager/orders/ord-1');
  });

  it('maps comment without author to "Аноним: body"', async () => {
    const comments = [{
      id: 'c-2',
      createdAt: new Date('2026-06-10T12:00:00Z'),
      body: 'Анонимный комментарий',
      orderId: 'ord-1',
      author: null,
      order: { orderNumber: 'O-99' }
    }];
    const p = emptyPrisma({ comment: { findMany: vi.fn().mockResolvedValue(comments) } });
    const result = await recentEvents(p, SESSION);
    expect(result[0]!.text).toBe('Аноним: Анонимный комментарий');
  });

  it('payment with order but null orderNumber falls back to orderId', async () => {
    const payments = [{
      id: 'pay-3',
      amount: 7500,
      paidAt: new Date('2026-06-10T07:00:00Z'),
      orderId: 'ord-fallback',
      order: { orderNumber: null },  // null → fallback to orderId
      organization: { id: 'org-1', name: 'Org One' }
    }];
    const p = emptyPrisma({ payment: { findMany: vi.fn().mockResolvedValue(payments) } });
    const result = await recentEvents(p, SESSION);
    expect(result[0]!.text).toContain('ord-fallback');
    expect(result[0]!.href).toBe('/manager/orders/ord-fallback');
  });

  it('comment_posted audit: info.orderNumber null → falls back to entityId', async () => {
    const audits = [
      { id: 'a1', action: 'comment_posted', entityId: 'ord-fb', createdAt: new Date('2026-06-10'), meta: null }
    ];
    const p = emptyPrisma({
      auditLog: { findMany: vi.fn().mockResolvedValue(audits) },
      order: { findMany: vi.fn().mockResolvedValue([{ id: 'ord-fb', orderNumber: null }]) }
    });
    const result = await recentEvents(p, SESSION);
    expect(result[0]!.text).toContain('ord-fb');
  });

  it('sorts events by timestamp desc and slices to `take`', async () => {
    const comments = [
      { id: 'c-early', createdAt: new Date('2026-06-01'), body: 'A', orderId: 'o1', author: { name: 'X' }, order: { orderNumber: 'O1' } },
      { id: 'c-late', createdAt: new Date('2026-06-10'), body: 'B', orderId: 'o1', author: { name: 'Y' }, order: { orderNumber: 'O1' } },
      { id: 'c-mid', createdAt: new Date('2026-06-05'), body: 'C', orderId: 'o1', author: { name: 'Z' }, order: { orderNumber: 'O1' } }
    ];
    const p = emptyPrisma({ comment: { findMany: vi.fn().mockResolvedValue(comments) } });
    const result = await recentEvents(p, SESSION, 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('comment-c-late');
    expect(result[1]!.id).toBe('comment-c-mid');
  });
});
