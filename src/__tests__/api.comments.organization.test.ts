import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSession,
  orderFindUnique,
  commentCreate,
  auditCreate,
  notifyManagers,
  notifyMessageCreated,
  deliverNotificationToUser,
  getPrimaryOrganizationId,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  orderFindUnique: vi.fn(),
  commentCreate: vi.fn(),
  auditCreate: vi.fn(),
  notifyManagers: vi.fn(),
  notifyMessageCreated: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  getPrimaryOrganizationId: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique },
    comment: { create: commentCreate },
    auditLog: { create: auditCreate },
  },
}));
vi.mock('@/lib/notifications', () => ({
  notifyManagers,
  notifyMessageCreated,
  deliverNotificationToUser,
}));
vi.mock('@/lib/auth/organization', () => ({
  getPrimaryOrganizationId,
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
      isActive: o.isActive !== false,
    })),
  };
}

function commentReq(orderId: string, body = 'hello from org'): Request {
  return new Request('https://app.local/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId, body }),
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
      authorId: 'u-org-1',
    });
    notifyManagers.mockResolvedValue({
      recipientsNotified: 0,
      emailsSent: 0,
      emailsSkipped: 0,
    });
  });

  it('creates comment for own-org order (201)', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-a' });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalledWith({
      data: { orderId: 'ord-1', body: 'hello from org', authorId: 'u-org-1' },
    });
    expect(auditCreate).toHaveBeenCalled();
    // Org branch does NOT touch the partner-side notification helpers.
    expect(notifyMessageCreated).not.toHaveBeenCalled();
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
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
    getSession.mockResolvedValue(orgSession([{ id: 'org-a', isActive: false }]));
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
        body: JSON.stringify({ orderId: 'ord-1', body: '' }),
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
    // notifyMessageCreated возвращает созданную Notification-строку; её id идёт
    // в deliverNotificationToUser как dedupKey (D5).
    notifyMessageCreated.mockResolvedValue({ id: 'notif-1' });
    deliverNotificationToUser.mockResolvedValue({});
    commentCreate.mockResolvedValue({
      id: 'c1',
      orderId: 'ord-1',
      body: 'partner comment',
      createdAt: new Date(),
      authorId: 'u-partner',
    });
  });

  it('admin still goes through the legacy notification path', async () => {
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin' });
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      companyId: 'c1',
      organizationId: 'org-x',
    });

    const res = await commentsPost(commentReq('ord-1', 'partner comment'));
    expect(res.status).toBe(200);
    expect(notifyMessageCreated).toHaveBeenCalled();
    expect(deliverNotificationToUser).toHaveBeenCalled();
  });

  it('401 when unauthenticated (getSession returns null → requireSession returns !ok)', async () => {
    getSession.mockResolvedValue(null);
    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(401);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('404 when order does not exist in the generic (admin) path', async () => {
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin' });
    orderFindUnique.mockResolvedValue(null);
    const res = await commentsPost(commentReq('ord-missing'));
    expect(res.status).toBe(404);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('still returns 200 when notification fan-out throws (best-effort)', async () => {
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin' });
    orderFindUnique.mockResolvedValue({ id: 'ord-1', companyId: 'c1', organizationId: 'org-x' });
    notifyMessageCreated.mockRejectedValueOnce(new Error('transport down'));

    const res = await commentsPost(commentReq('ord-1', 'hi'));
    expect(res.status).toBe(200);
    expect(commentCreate).toHaveBeenCalled();
  });

  it('still returns 200 when fan-out throws a non-Error string — covers String(err) in partner/admin branch', async () => {
    // Throwing a non-Error value in the try block covers String(err) branch at line 198
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin' });
    orderFindUnique.mockResolvedValue({ id: 'ord-1', companyId: 'c1', organizationId: 'org-x' });
    notifyMessageCreated.mockRejectedValueOnce('plain string fan-out error');

    const res = await commentsPost(commentReq('ord-1', 'hi'));
    expect(res.status).toBe(200);
    expect(commentCreate).toHaveBeenCalled();
  });
});

describe('POST /api/comments — non-Error throw in notifyManagers catch (org branch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commentCreate.mockResolvedValue({
      id: 'c1',
      orderId: 'ord-1',
      body: 'hi',
      createdAt: new Date(),
      authorId: 'u-org-1',
    });
    notifyManagers.mockResolvedValue({
      recipientsNotified: 0,
      emailsSent: 0,
      emailsSkipped: 0,
    });
  });

  it('still returns 201 when notifyManagers throws a non-Error string — covers String(err) in org branch', async () => {
    getSession.mockResolvedValue(orgSession([{ id: 'org-a' }]));
    orderFindUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-a' });
    // Throw a plain string (not an Error) to hit the String(err) branch
    notifyManagers.mockRejectedValueOnce('network timeout string');

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalled();
  });
});

describe('POST /api/comments — parse & partner-role branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrimaryOrganizationId.mockResolvedValue(null);
    commentCreate.mockResolvedValue({
      id: 'c1',
      orderId: 'ord-1',
      body: 'hi',
      createdAt: new Date(),
      authorId: 'u-partner',
    });
  });

  it('400 when request body is invalid JSON', async () => {
    getSession.mockResolvedValue({ sub: 'u-partner', role: 'partner', partnerId: 'p1' });
    const badReq = new Request('https://app.local/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'NOT JSON',
    });
    const res = await commentsPost(badReq);
    expect(res.status).toBe(400);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('403 when partner session has no partnerId', async () => {
    // Partner session without partnerId: the route checks !s.partnerId → 403
    getSession.mockResolvedValue({ sub: 'u-p', role: 'partner' });
    orderFindUnique.mockResolvedValue({ id: 'ord-1', partnerId: 'p1' });
    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(403);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('403 when partner session partnerId does not match order.partnerId', async () => {
    getSession.mockResolvedValue({ sub: 'u-p', role: 'partner', partnerId: 'p-other' });
    orderFindUnique.mockResolvedValue({ id: 'ord-1', partnerId: 'p1' });
    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(403);
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it('201 when partner session partnerId matches order.partnerId', async () => {
    getSession.mockResolvedValue({ sub: 'u-p', role: 'partner', partnerId: 'p1' });
    orderFindUnique.mockResolvedValue({ id: 'ord-1', partnerId: 'p1' });
    notifyMessageCreated.mockResolvedValue(undefined);
    deliverNotificationToUser.mockResolvedValue({});
    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(200);
    expect(commentCreate).toHaveBeenCalled();
  });
});
