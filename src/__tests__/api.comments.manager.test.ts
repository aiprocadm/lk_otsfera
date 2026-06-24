import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSession,
  orderFindUnique,
  commentCreate,
  commentCount,
  auditCreate,
  notifyMessageCreated,
  notifyOrgUsers,
  triggerNotificationEmail,
  triggerNotificationTelegram,
  getPrimaryOrganizationId
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  orderFindUnique: vi.fn(),
  commentCreate: vi.fn(),
  commentCount: vi.fn(),
  auditCreate: vi.fn(),
  notifyMessageCreated: vi.fn(),
  notifyOrgUsers: vi.fn(),
  triggerNotificationEmail: vi.fn(),
  triggerNotificationTelegram: vi.fn(),
  getPrimaryOrganizationId: vi.fn()
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique },
    comment: { create: commentCreate, count: commentCount },
    auditLog: { create: auditCreate }
  }
}));
vi.mock('@/lib/notifications', () => ({
  notifyMessageCreated,
  notifyOrgUsers,
  triggerNotificationEmail,
  triggerNotificationTelegram,
}));
vi.mock('@/lib/auth/organization', () => ({
  getPrimaryOrganizationId
}));

import { POST as commentsPost } from '@/app/api/comments/route';

function managerSession(opts: { sub?: string; managedOrgIds?: string[] } = {}) {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    email: 'mgr@t.local',
    managedOrgIds: opts.managedOrgIds ?? []
  };
}

function commentReq(orderId: string, body = 'hello from manager'): Request {
  return new Request('https://app.local/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId, body })
  });
}

describe('POST /api/comments — manager role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commentCreate.mockResolvedValue({
      id: 'c1',
      orderId: 'ord-1',
      body: 'hello from manager',
      createdAt: new Date(),
      authorId: 'u-mgr-1'
    });
    commentCount.mockResolvedValue(0);
    notifyOrgUsers.mockResolvedValue({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1
    });
  });

  it('creates comment on per-order assigned order (managerId match) → 201', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: [] }));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: 'org-a',
      orderNumber: 'ORD-001',
      title: 'Test order'
    });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalledWith({
      data: { orderId: 'ord-1', body: 'hello from manager', authorId: 'u-mgr-1' }
    });
    expect(auditCreate).toHaveBeenCalled();
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-a',
        type: 'manager_replied',
        payload: expect.objectContaining({
          orderId: 'ord-1',
          orderNumber: 'ORD-001',
          orderTitle: 'Test order',
          commentExcerpt: 'hello from manager'
        })
      })
    );
    // Manager branch must NOT touch the partner-side notification helpers.
    expect(notifyMessageCreated).not.toHaveBeenCalled();
    expect(triggerNotificationEmail).not.toHaveBeenCalled();
    // Cheap per-order check should short-circuit the comment count query.
    expect(commentCount).not.toHaveBeenCalled();
  });

  it('creates comment on per-org assigned order → 201', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: ['org-a'] }));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'other-mgr',
      organizationId: 'org-a',
      orderNumber: 'ORD-002',
      title: 'Org order'
    });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(notifyOrgUsers).toHaveBeenCalledTimes(1);
    // Per-org check is cheap — comments count should not be queried.
    expect(commentCount).not.toHaveBeenCalled();
  });

  it('creates comment when only historical comments grant access → 201', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: [] }));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'other-mgr',
      organizationId: 'org-foreign',
      orderNumber: 'ORD-003',
      title: 'Historical access'
    });
    commentCount.mockResolvedValue(3);

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCount).toHaveBeenCalledWith({
      where: { orderId: 'ord-1', authorId: 'u-mgr-1' }
    });
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-foreign',
        type: 'manager_replied'
      })
    );
  });

  it('returns 403 when manager has no visibility (foreign order)', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: ['org-a'] }));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'other-mgr',
      organizationId: 'org-foreign',
      orderNumber: 'ORD-004',
      title: 'Foreign'
    });
    commentCount.mockResolvedValue(0);

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(403);
    expect(commentCreate).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('returns 404 when order does not exist', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: ['org-a'] }));
    orderFindUnique.mockResolvedValue(null);

    const res = await commentsPost(commentReq('ord-missing'));
    expect(res.status).toBe(404);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid payload (empty body)', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: ['org-a'] }));

    const res = await commentsPost(
      new Request('https://app.local/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: 'ord-1', body: '' })
      })
    );
    expect(res.status).toBe(400);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid payload (missing orderId)', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: ['org-a'] }));

    const res = await commentsPost(
      new Request('https://app.local/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'hi' })
      })
    );
    expect(res.status).toBe(400);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('truncates commentExcerpt to 200 chars', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: [] }));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: 'org-a',
      orderNumber: 'ORD-005',
      title: 'Long body'
    });

    const longBody = 'a'.repeat(500);
    const res = await commentsPost(commentReq('ord-1', longBody));
    expect(res.status).toBe(201);

    const callArg = notifyOrgUsers.mock.calls[0]?.[1] as
      | { payload: { commentExcerpt: string } }
      | undefined;
    expect(callArg?.payload.commentExcerpt).toHaveLength(200);
  });

  it('skips notifyOrgUsers when order has no organizationId', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: [] }));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: null,
      orderNumber: 'ORD-006',
      title: 'Orphan order'
    });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('still returns 201 when notifyOrgUsers throws (best-effort)', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: ['org-a'] }));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: 'org-a',
      orderNumber: 'ORD-007',
      title: 'Notify boom'
    });
    notifyOrgUsers.mockRejectedValueOnce(new Error('email transport down'));

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalled();
  });

  it('still returns 201 when notifyOrgUsers throws a non-Error string — covers String(err) branch', async () => {
    getSession.mockResolvedValue(managerSession({ managedOrgIds: ['org-a'] }));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: 'org-a',
      orderNumber: 'ORD-008',
      title: 'String throw'
    });
    // Throwing a non-Error value hits the `String(err)` branch in the catch
    notifyOrgUsers.mockRejectedValueOnce('plain string rejection');

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalled();
  });
});
