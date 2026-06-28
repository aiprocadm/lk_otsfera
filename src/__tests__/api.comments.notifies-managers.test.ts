import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task 28 — verifies that the org branch of POST /api/comments fires
// `notifyManagers({ type: 'comment_from_org' })` exactly once after the
// comment row is created, with the payload shape that `notifyManagers`
// expects ({ orgName, commentExcerpt }) and the `orderId` from the order.
//
// We mock `notifyManagers` so we never touch the email transport — the
// recipient resolver lives behind it and has its own live-PG coverage in
// `notifications.notifyManagers.test.ts`.

const {
  getSession,
  orderFindUnique,
  commentCreate,
  auditCreate,
  notifyManagers,
  notifyMessageCreated,
  notifyOrgUsers,
  triggerNotificationEmail,
  triggerNotificationTelegram,
  getPrimaryOrganizationId
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  orderFindUnique: vi.fn(),
  commentCreate: vi.fn(),
  auditCreate: vi.fn(),
  notifyManagers: vi.fn(),
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
    comment: { create: commentCreate },
    auditLog: { create: auditCreate }
  }
}));
vi.mock('@/lib/notifications', () => ({
  notifyManagers,
  notifyMessageCreated,
  notifyOrgUsers,
  triggerNotificationEmail,
  triggerNotificationTelegram,
}));
vi.mock('@/lib/auth/organization', () => ({
  getPrimaryOrganizationId
}));

import { POST as commentsPost } from '@/app/api/comments/route';

function orgSession(orgIds: string[] = ['org-a']) {
  return {
    sub: 'u-org-1',
    role: 'organization',
    email: 'org@t.local',
    organizationMemberships: orgIds.map((id) => ({
      organizationId: id,
      roleInOrg: 'member',
      isActive: true
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

describe('POST /api/comments — org branch fires notifyManagers (comment_from_org)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commentCreate.mockResolvedValue({
      id: 'c1',
      orderId: 'ord-1',
      body: 'hello from org',
      createdAt: new Date(),
      authorId: 'u-org-1'
    });
    notifyManagers.mockResolvedValue({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1
    });
  });

  it('notifyManagers called once with correct payload when manager is assigned', async () => {
    getSession.mockResolvedValue(orgSession(['org-a']));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      organization: { name: 'Acme Corp' }
    });

    const res = await commentsPost(commentReq('ord-1', 'Please ship faster'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalledTimes(1);
    expect(notifyManagers).toHaveBeenCalledTimes(1);
    expect(notifyManagers).toHaveBeenCalledWith(
      expect.anything(),
      {
        orderId: 'ord-1',
        type: 'comment_from_org',
        payload: {
          orgName: 'Acme Corp',
          commentExcerpt: 'Please ship faster'
        }
      }
    );
    // Org branch must NOT touch partner-side helpers.
    expect(notifyMessageCreated).not.toHaveBeenCalled();
    expect(triggerNotificationEmail).not.toHaveBeenCalled();
  });

  it('still calls notifyManagers when no manager is in scope (resolver returns empty)', async () => {
    // Real notifyManagers returns { recipientsNotified: 0 } for an order with
    // no per-order/per-org/historical manager; the route call site can't see
    // that distinction — it just fires the helper. We assert the call still
    // happens and the comment is still 201.
    notifyManagers.mockResolvedValueOnce({
      recipientsNotified: 0,
      emailsSent: 0,
      emailsSkipped: 0
    });
    getSession.mockResolvedValue(orgSession(['org-a']));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      organization: { name: 'Acme Corp' }
    });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalledTimes(1);
    expect(notifyManagers).toHaveBeenCalledTimes(1);
  });

  it('notify-failure does NOT roll back the comment (best-effort)', async () => {
    notifyManagers.mockRejectedValueOnce(new Error('email transport down'));
    getSession.mockResolvedValue(orgSession(['org-a']));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      organization: { name: 'Acme Corp' }
    });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(commentCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalled();
  });

  it('truncates commentExcerpt to 200 chars', async () => {
    getSession.mockResolvedValue(orgSession(['org-a']));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      organization: { name: 'Acme Corp' }
    });

    const longBody = 'a'.repeat(500);
    const res = await commentsPost(commentReq('ord-1', longBody));
    expect(res.status).toBe(201);

    const callArg = notifyManagers.mock.calls[0]?.[1] as
      | { payload: { commentExcerpt: string } }
      | undefined;
    expect(callArg?.payload.commentExcerpt).toHaveLength(200);
  });

  it('falls back to empty orgName when organization relation is missing', async () => {
    // Defensive: if the order.organization include returns nothing (e.g. a
    // historical orphan), we still want the call to fire with a safe string.
    getSession.mockResolvedValue(orgSession(['org-a']));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      organization: null
    });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(201);
    expect(notifyManagers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'comment_from_org',
        payload: expect.objectContaining({ orgName: '' })
      })
    );
  });

  it('does NOT call notifyManagers when 403 forbidden (foreign org)', async () => {
    getSession.mockResolvedValue(orgSession(['org-a']));
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-b',
      organization: { name: 'Other Co' }
    });

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(403);
    expect(commentCreate).not.toHaveBeenCalled();
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it('does NOT call notifyManagers when 404 (order missing)', async () => {
    getSession.mockResolvedValue(orgSession(['org-a']));
    orderFindUnique.mockResolvedValue(null);

    const res = await commentsPost(commentReq('ord-1'));
    expect(res.status).toBe(404);
    expect(notifyManagers).not.toHaveBeenCalled();
  });
});
