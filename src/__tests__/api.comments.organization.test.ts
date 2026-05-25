import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSession,
  orderFindUnique,
  commentCreate,
  auditCreate,
  notifyMessageCreated,
  triggerNotificationEmail,
  getPrimaryOrganizationId
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  orderFindUnique: vi.fn(),
  commentCreate: vi.fn(),
  auditCreate: vi.fn(),
  notifyMessageCreated: vi.fn(),
  triggerNotificationEmail: vi.fn(),
  getPrimaryOrganizationId: vi.fn()
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique },
    comment: { create: commentCreate },
    auditLog: { create: auditCreate }
  }
}));
vi.mock('@/lib/notifications', () => ({
  notifyMessageCreated,
  triggerNotificationEmail
}));
vi.mock('@/lib/auth/organization', () => ({
  getPrimaryOrganizationId
}));

import { POST as commentsPost } from '@/app/api/comments/route';

function orgSession(orgIds: { id: string; isActive?: boolean }[]) {
  return {
    sub: 'u-org-1',
    role: 'organization',
    email: 'org@t.local',
    organizationMemberships: orgIds.map((o) => ({
      organizationId: o.id,
      roleInOrg: 'member',
      isActive: o.isActive !== false
    }))
  };
}

function commentReq(orderId: string, body = 'hello from org'): Request {
  return new Request('https://app.local/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId, body })
  });
}

describe('POST /api/comments — organization role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commentCreate.mockResolvedValue({
      id: 'c1',
      orderId: 'ord-1',
      body: 'hello from org',
      createdAt: new Date(),
      authorId: 'u-org-1'
    });
  });

  it('creates comment for own-org order (201)', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-a' });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalledWith({
      data: { orderId: 'ord-1', body: 'hello from org', authorId: 'u-org-1' }
    });
    expect(auditCreate).toHaveBeenCalled();
    // Org branch does NOT touch the partner-side notification helpers.
    expect(notifyMessageCreated).not.toHaveBeenCalled();
    expect(triggerNotificationEmail).not.toHaveBeenCalled();
  });

  it('rejects with 403 when org-user posts to foreign-org order', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-b' });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(403);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('rejects with 403 when order has no organizationId (legacy/orphan)', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: null });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(403);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('rejects with 403 when org-user has only deactivated memberships', async () => {
    getSession.mockResolvedValue(
      orgSession([{ id: 'org-a', isActive: false }])
    );
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-a' });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when order does not exist', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    orderFindUnique.mockResolvedValue(null);

    const res = await commentsPost(commentReq('cuid-fake'));
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid payload (empty body)', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    const res = await commentsPost(
      new Request('https://app.local/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: 'ord-1', body: '' })
      })
    );
    expect(res.status).toBe(400);
  });

  it('multi-org user can post to any of their orgs', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }, { id: 'org-b' }]));
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-b' });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
  });
});

describe('POST /api/comments — partner/admin flow unchanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrimaryOrganizationId.mockResolvedValue('org-x');
    commentCreate.mockResolvedValue({
      id: 'c1',
      orderId: 'ord-1',
      body: 'partner comment',
      createdAt: new Date(),
      authorId: 'u-partner'
    });
  });

  it('admin still goes through the legacy notification path', async () => {
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin' });
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      companyId: 'c1',
      organizationId: 'org-x'
    });

    const res = await commentsPost(commentReq('ord-1', 'partner comment'));
    expect(res.status).toBe(200);
    expect(notifyMessageCreated).toHaveBeenCalled();
    expect(triggerNotificationEmail).toHaveBeenCalled();
  });
});
