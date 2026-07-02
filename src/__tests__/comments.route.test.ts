import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  requireOrderAccess,
  findOrder,
  createComment,
  notifyMessageCreated,
  deliverNotificationToUser,
  getPrimaryOrganizationId
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireOrderAccess: vi.fn(),
  findOrder: vi.fn(),
  createComment: vi.fn(),
  notifyMessageCreated: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  getPrimaryOrganizationId: vi.fn()
}));

vi.mock('@/lib/auth/guard', () => ({
  requireSession,
  requireOrderAccess,
  forbiddenResponse: (m: string) => Response.json({ message: m }, { status: 403 })
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: findOrder },
    comment: { create: createComment }
  }
}));
vi.mock('@/lib/notifications', () => ({ notifyMessageCreated, deliverNotificationToUser }));
vi.mock('@/lib/auth/organization', () => ({ getPrimaryOrganizationId }));

import { POST } from '@/app/api/comments/route';

const makeRequest = (body: object) =>
  new Request('https://app.local/api/comments', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  });

describe('POST /api/comments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: { sub: 'u1', partnerId: 'p1' } });
    findOrder.mockResolvedValue({ id: 'ord1', companyId: 'c1' });
    requireOrderAccess.mockResolvedValue({ ok: true });
    createComment.mockResolvedValue({ id: 'cm1', orderId: 'ord1', body: 'hello', authorId: 'u1' });
    getPrimaryOrganizationId.mockResolvedValue('org1');
    notifyMessageCreated.mockResolvedValue({ id: 'notif-1' });
    deliverNotificationToUser.mockResolvedValue({});
  });

  it('returns 401 when session is missing', async () => {
    requireSession.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await POST(makeRequest({ orderId: 'ord1', body: 'hello' }));
    expect(res.status).toBe(401);
    expect(createComment).not.toHaveBeenCalled();
  });

  it('returns 404 when order does not exist', async () => {
    findOrder.mockResolvedValue(null);
    const res = await POST(makeRequest({ orderId: 'nonexistent', body: 'hello' }));
    expect(res.status).toBe(404);
    expect(createComment).not.toHaveBeenCalled();
  });

  it('returns 403 when user has no access to the order', async () => {
    requireOrderAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 })
    });
    const res = await POST(makeRequest({ orderId: 'ord1', body: 'hello' }));
    expect(res.status).toBe(403);
    expect(createComment).not.toHaveBeenCalled();
  });

  it('creates comment and returns 200 for authorized user', async () => {
    const res = await POST(makeRequest({ orderId: 'ord1', body: 'hello' }));
    expect(res.status).toBe(200);
    expect(createComment).toHaveBeenCalledWith({
      data: { orderId: 'ord1', body: 'hello', authorId: 'u1' }
    });
    const json = await res.json();
    expect(json).toMatchObject({ id: 'cm1', orderId: 'ord1' });
  });

  it('sends notification after comment creation', async () => {
    await POST(makeRequest({ orderId: 'ord1', body: 'test message' }));
    expect(notifyMessageCreated).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', organizationId: 'org1' })
    );
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'message_created' })
    );
  });

  it('still returns the comment when notification fan-out fails (best-effort)', async () => {
    notifyMessageCreated.mockRejectedValue(new Error('notify transport down'));
    const res = await POST(makeRequest({ orderId: 'ord1', body: 'hello' }));
    expect(res.status).toBe(200);
    expect(createComment).toHaveBeenCalled();
  });

  it('partner can comment only on own orders (partnerId pin)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: { sub: 'u1', role: 'partner', partnerId: 'p1' } });
    findOrder.mockResolvedValue({ id: 'ord1', companyId: 'c1', partnerId: 'p1' });
    const res = await POST(makeRequest({ orderId: 'ord1', body: 'hello' }));
    expect(res.status).toBe(200);
    expect(requireOrderAccess).not.toHaveBeenCalled();
  });

  it("partner cannot comment on a sibling partner's order in the same company", async () => {
    requireSession.mockResolvedValue({ ok: true, value: { sub: 'u1', role: 'partner', partnerId: 'p1' } });
    findOrder.mockResolvedValue({ id: 'ord1', companyId: 'c1', partnerId: 'pX' });
    const res = await POST(makeRequest({ orderId: 'ord1', body: 'hello' }));
    expect(res.status).toBe(403);
    expect(createComment).not.toHaveBeenCalled();
  });
});
