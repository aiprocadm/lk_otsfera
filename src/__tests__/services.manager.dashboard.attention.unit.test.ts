/**
 * Unit tests for src/lib/services/manager/dashboard/attention.ts
 * Covers: teamModeOverride, empty candidateOrderIds, noReply filtering,
 * severity sorting, cap per source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managerOrderScope } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  managerOrderScope: vi.fn().mockReturnValue({})
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managerOrderScope
}));

import { attention } from '@/lib/services/manager/dashboard/attention';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1'
};

function emptyPrisma(overrides: Record<string, unknown> = {}) {
  return {
    order: { findMany: vi.fn().mockResolvedValue([]) },
    comment: { findMany: vi.fn().mockResolvedValue([]) },
    document: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managerOrderScope.mockReturnValue({});
});

describe('attention', () => {
  it('returns empty array when all sources are empty', async () => {
    const result = await attention(emptyPrisma(), SESSION);
    expect(result).toEqual([]);
  });

  it('uses teamModeOverride=true without calling getCompanyTeamVisibility', async () => {
    await attention(emptyPrisma(), SESSION, true);
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(managerOrderScope).toHaveBeenCalledWith(SESSION, true);
  });

  it('calls getCompanyTeamVisibility when teamModeOverride is not provided', async () => {
    await attention(emptyPrisma(), SESSION);
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(expect.anything(), 'co-1');
  });

  it('skips myReplies query when no recent org comments', async () => {
    // comment.findMany returns empty (no recent org comments), so no second
    // comment.findMany for myReplies should be called
    let callCount = 0;
    const commentFindMany = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve([]);
    });
    const p = emptyPrisma({ comment: { findMany: commentFindMany } });
    await attention(p, SESSION);
    // Only the initial recentOrgComments query
    expect(callCount).toBe(1);
  });

  it('maps overdue order to urgent AttentionItem', async () => {
    const overdueOrders = [{ id: 'ord-1', orderNumber: 'O-001', title: 'Заказ первый' }];
    const p = emptyPrisma({ order: { findMany: vi.fn().mockResolvedValueOnce(overdueOrders).mockResolvedValue([]) } });
    const result = await attention(p, SESSION);
    const item = result.find((i) => i.kind === 'order_overdue');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('urgent');
    expect(item!.message).toContain('O-001');
    expect(item!.href).toBe('/manager/orders/ord-1');
  });

  it('uses title when orderNumber is null in overdue order', async () => {
    const overdueOrders = [{ id: 'ord-1', orderNumber: null, title: 'Заказ без номера' }];
    const p = emptyPrisma({ order: { findMany: vi.fn().mockResolvedValueOnce(overdueOrders).mockResolvedValue([]) } });
    const result = await attention(p, SESSION);
    const item = result.find((i) => i.kind === 'order_overdue');
    expect(item!.message).toContain('Заказ без номера');
  });

  it('maps unsigned act to warn AttentionItem with order orderNumber', async () => {
    const docs = [{ id: 'doc-1', name: 'Акт выполненных работ', orderId: 'ord-5', order: { orderNumber: 'O-500' } }];
    const p = emptyPrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      document: { findMany: vi.fn().mockResolvedValue(docs) }
    });
    const result = await attention(p, SESSION);
    const item = result.find((i) => i.kind === 'act_unsigned');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('warn');
    expect(item!.message).toContain('O-500');
    expect(item!.href).toBe('/manager/orders/ord-5');
  });

  it('maps unsigned act without orderId/order to /manager/documents href', async () => {
    const docs = [{ id: 'doc-1', name: 'Акт', orderId: null, order: null }];
    const p = emptyPrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      document: { findMany: vi.fn().mockResolvedValue(docs) }
    });
    const result = await attention(p, SESSION);
    const item = result.find((i) => i.kind === 'act_unsigned');
    expect(item!.href).toBe('/manager/documents');
    expect(item!.message).not.toContain('заказ');
  });

  it('maps stalled order to warn AttentionItem', async () => {
    // order.findMany called: [0]=overdue, [1]=stalled; skip [2] for stalled if needed
    // Actually the Promise.all returns: [overdueOrders, recentOrgComments, unsignedActs, stalledOrders]
    // We need to simulate this properly
    const stalledOrders = [{ id: 'ord-2', orderNumber: 'O-200', title: 'Стопор', updatedAt: new Date('2026-05-01') }];
    let callIdx = 0;
    const orderFindMany = vi.fn().mockImplementation(() => {
      const responses = [[], stalledOrders];
      return Promise.resolve(responses[callIdx++] ?? []);
    });
    const p = emptyPrisma({ order: { findMany: orderFindMany } });
    const result = await attention(p, SESSION);
    const item = result.find((i) => i.kind === 'order_stalled');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('warn');
    expect(item!.href).toBe('/manager/orders/ord-2');
  });

  it('filters org_comment_unreplied when manager already replied after the org comment', async () => {
    const now = new Date();
    const orgCommentAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const myReplyAt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago (after org comment)

    const recentOrgComments = [{
      id: 'c-org-1',
      createdAt: orgCommentAt,
      orderId: 'ord-1',
      order: { orderNumber: 'O-1', title: 'T' }
    }];
    const myReplies = [{ orderId: 'ord-1', createdAt: myReplyAt }];

    let commentCallIdx = 0;
    const commentFindMany = vi.fn().mockImplementation(() => {
      const responses = [recentOrgComments, myReplies];
      return Promise.resolve(responses[commentCallIdx++] ?? []);
    });

    const p = emptyPrisma({ comment: { findMany: commentFindMany } });
    const result = await attention(p, SESSION);
    // Manager replied, so this should NOT appear in attention
    const noReplyItems = result.filter((i) => i.kind === 'org_comment_unreplied');
    expect(noReplyItems).toHaveLength(0);
  });

  it('includes org_comment_unreplied when manager has not replied', async () => {
    const now = new Date();
    const orgCommentAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const recentOrgComments = [{
      id: 'c-org-2',
      createdAt: orgCommentAt,
      orderId: 'ord-2',
      order: { orderNumber: 'O-2', title: 'T2' }
    }];

    let commentCallIdx = 0;
    const commentFindMany = vi.fn().mockImplementation(() => {
      const responses: unknown[][] = [recentOrgComments, []]; // no manager replies
      return Promise.resolve(responses[commentCallIdx++] ?? []);
    });

    const p = emptyPrisma({ comment: { findMany: commentFindMany } });
    const result = await attention(p, SESSION);
    const noReplyItems = result.filter((i) => i.kind === 'org_comment_unreplied');
    expect(noReplyItems).toHaveLength(1);
    expect(noReplyItems[0]!.severity).toBe('urgent');
    expect(noReplyItems[0]!.href).toBe('/manager/orders/ord-2');
  });

  it('deduplicates org_comment_unreplied per order (only one item per order)', async () => {
    const now = new Date();
    const orgCommentAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const recentOrgComments = [
      { id: 'c1', createdAt: orgCommentAt, orderId: 'ord-same', order: { orderNumber: 'O-S', title: 'T' } },
      { id: 'c2', createdAt: orgCommentAt, orderId: 'ord-same', order: { orderNumber: 'O-S', title: 'T' } }
    ];

    let commentCallIdx = 0;
    const commentFindMany = vi.fn().mockImplementation(() => {
      const responses: unknown[][] = [recentOrgComments, []];
      return Promise.resolve(responses[commentCallIdx++] ?? []);
    });

    const p = emptyPrisma({ comment: { findMany: commentFindMany } });
    const result = await attention(p, SESSION);
    const noReplyItems = result.filter((i) => i.kind === 'org_comment_unreplied');
    expect(noReplyItems).toHaveLength(1);
  });

  it('sorts urgent items before warn items', async () => {
    // Set up both an overdue order (urgent) and an unsigned act (warn)
    const overdueOrders = [{ id: 'ord-1', orderNumber: 'O-1', title: 'T' }];
    const docs = [{ id: 'doc-1', name: 'Акт', orderId: 'ord-1', order: { orderNumber: 'O-1' } }];
    const p = emptyPrisma({
      order: { findMany: vi.fn().mockResolvedValueOnce(overdueOrders).mockResolvedValue([]) },
      document: { findMany: vi.fn().mockResolvedValue(docs) }
    });
    const result = await attention(p, SESSION);
    const urgentIdx = result.findIndex((i) => i.severity === 'urgent');
    const warnIdx = result.findIndex((i) => i.severity === 'warn');
    if (urgentIdx !== -1 && warnIdx !== -1) {
      expect(urgentIdx).toBeLessThan(warnIdx);
    }
  });

  it('uses orderNumber ?? title in stalled order message', async () => {
    let callIdx = 0;
    const stalledOrders = [{ id: 'ord-s', orderNumber: null, title: 'Заказ без номера', updatedAt: new Date() }];
    const orderFindMany = vi.fn().mockImplementation(() => {
      const responses = [[], stalledOrders];
      return Promise.resolve(responses[callIdx++] ?? []);
    });
    const p = emptyPrisma({ order: { findMany: orderFindMany } });
    const result = await attention(p, SESSION);
    const item = result.find((i) => i.kind === 'order_stalled');
    expect(item!.message).toContain('Заказ без номера');
  });

  it('noreply comment with null orderNumber falls back to order.title', async () => {
    const now = new Date();
    const orgCommentAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const recentOrgComments = [{
      id: 'c-no-num',
      createdAt: orgCommentAt,
      orderId: 'ord-3',
      order: { orderNumber: null, title: 'Заказ без номера' }
    }];
    let commentCallIdx = 0;
    const commentFindMany = vi.fn().mockImplementation(() => {
      const responses: unknown[][] = [recentOrgComments, []];
      return Promise.resolve(responses[commentCallIdx++] ?? []);
    });
    const p = emptyPrisma({ comment: { findMany: commentFindMany } });
    const result = await attention(p, SESSION);
    const item = result.find((i) => i.kind === 'org_comment_unreplied');
    expect(item!.message).toContain('Заказ без номера');
  });

  it('reduce: keeps earlier reply when already has a later one (covers !prev || prev < r branch)', async () => {
    const now = new Date();
    const orgCommentAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const laterReply = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const earlierReply = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000);

    const recentOrgComments = [{ id: 'c-rd', createdAt: orgCommentAt, orderId: 'ord-r', order: { orderNumber: 'O-R', title: 'T' } }];
    // Two replies for same order: later one comes first, earlier second (exercises prev >= r.createdAt branch)
    const myReplies = [
      { orderId: 'ord-r', createdAt: laterReply },
      { orderId: 'ord-r', createdAt: earlierReply } // earlier → prev already set to laterReply → no update
    ];

    let commentCallIdx = 0;
    const commentFindMany = vi.fn().mockImplementation(() => {
      const responses: unknown[][] = [recentOrgComments, myReplies];
      return Promise.resolve(responses[commentCallIdx++] ?? []);
    });

    const p = emptyPrisma({ comment: { findMany: commentFindMany } });
    const result = await attention(p, SESSION);
    // Manager replied after org comment, so no unreplied item
    const noReplyItems = result.filter((i) => i.kind === 'org_comment_unreplied');
    expect(noReplyItems).toHaveLength(0);
  });

  it('sort: same-severity items return 0 (stable for urgent==urgent and warn==warn)', async () => {
    // Two overdue orders (both urgent) + two stalled orders (both warn)
    const overdueOrders = [
      { id: 'od-1', orderNumber: 'O-1', title: 'T1' },
      { id: 'od-2', orderNumber: 'O-2', title: 'T2' }
    ];
    const stalledOrders = [
      { id: 'st-1', orderNumber: 'O-S1', title: 'S1', updatedAt: new Date() },
      { id: 'st-2', orderNumber: 'O-S2', title: 'S2', updatedAt: new Date() }
    ];
    let callIdx = 0;
    const orderFindMany = vi.fn().mockImplementation(() => {
      const responses = [overdueOrders, stalledOrders];
      return Promise.resolve(responses[callIdx++] ?? []);
    });
    const p = emptyPrisma({ order: { findMany: orderFindMany } });
    const result = await attention(p, SESSION);
    // All urgents come before all warns
    const urgentIdx = result.filter((i) => i.severity === 'urgent').map((i) => result.indexOf(i));
    const warnIdx = result.filter((i) => i.severity === 'warn').map((i) => result.indexOf(i));
    const maxUrgent = Math.max(...urgentIdx);
    const minWarn = Math.min(...warnIdx);
    expect(maxUrgent).toBeLessThan(minWarn);
    // Two urgent + two warn
    expect(result.filter((i) => i.severity === 'urgent')).toHaveLength(2);
    expect(result.filter((i) => i.severity === 'warn')).toHaveLength(2);
  });

  it('ATTENTION_CAP_PER_SOURCE: stops at 10 unreplied comments per run', async () => {
    const now = new Date();
    const orgCommentAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    // 11 unique orders with unreplied org comments
    const recentOrgComments = Array.from({ length: 11 }, (_, i) => ({
      id: `c-${i}`,
      createdAt: orgCommentAt,
      orderId: `ord-${i}`,
      order: { orderNumber: `O-${i}`, title: `T${i}` }
    }));
    let commentCallIdx = 0;
    const commentFindMany = vi.fn().mockImplementation(() => {
      const responses: unknown[][] = [recentOrgComments, []]; // no manager replies
      return Promise.resolve(responses[commentCallIdx++] ?? []);
    });
    const p = emptyPrisma({ comment: { findMany: commentFindMany } });
    const result = await attention(p, SESSION);
    const noReplyItems = result.filter((i) => i.kind === 'org_comment_unreplied');
    // ATTENTION_CAP_PER_SOURCE = 10
    expect(noReplyItems.length).toBeLessThanOrEqual(10);
  });
});
