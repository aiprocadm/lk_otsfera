import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Аудит A1: доменный слой POST /api/comments (`postOrderComment`). Проверяет
 * коды результата и скоуп по ролям на уровне сервиса — те же инварианты, что
 * раньше проверялись через роут (api.comments.*.test.ts), но без HTTP.
 */

const {
  canReadOrder,
  notifyManagers,
  notifyOrgUsers,
  notifyMessageCreated,
  deliver,
  getPrimaryOrg,
} = vi.hoisted(() => ({
  canReadOrder: vi.fn(),
  notifyManagers: vi.fn(),
  notifyOrgUsers: vi.fn(),
  notifyMessageCreated: vi.fn(),
  deliver: vi.fn(),
  getPrimaryOrg: vi.fn(),
}));

vi.mock('@/lib/auth/policy', () => ({ canReadOrder }));
vi.mock('@/lib/notifications', () => ({
  notifyManagers,
  notifyOrgUsers,
  notifyMessageCreated,
  deliverNotificationToUser: deliver,
}));
vi.mock('@/lib/auth/organization', () => ({ getPrimaryOrganizationId: getPrimaryOrg }));

import { postOrderComment } from '@/lib/services/comments/post';

function prismaMock(over: Record<string, unknown> = {}) {
  return {
    order: { findUnique: vi.fn().mockResolvedValue(null) },
    comment: {
      create: vi.fn().mockResolvedValue({ id: 'c1', orderId: 'ord-1', body: 'hi' }),
      count: vi.fn().mockResolvedValue(0),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    company: { findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: false }) },
    ...over,
  };
}

const args = { orderId: 'ord-1', body: 'hi' };
const orgSession = {
  sub: 'u-org',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'org-a', roleInOrg: 'member', isActive: true }],
} as never;
const mgrSession = {
  sub: 'm1',
  role: 'manager',
  companyId: 'cmp-1',
  managedOrgIds: ['org-a'],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  notifyManagers.mockResolvedValue({});
  notifyOrgUsers.mockResolvedValue({});
  notifyMessageCreated.mockResolvedValue({ id: 'n1' });
  deliver.mockResolvedValue({});
  getPrimaryOrg.mockResolvedValue('org-a');
  canReadOrder.mockResolvedValue(true);
});

describe('postOrderComment — organization', () => {
  it('создаёт комментарий в своей организации (viewer=organization)', async () => {
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      organization: { name: 'Acme' },
    });

    const res = await postOrderComment(prisma as never, orgSession, args);

    expect(res).toMatchObject({ ok: true, viewer: 'organization' });
    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: { orderId: 'ord-1', body: 'hi', authorId: 'u-org' },
    });
    expect(notifyManagers).toHaveBeenCalledTimes(1);
  });

  it('чужая организация → access_denied, комментарий не пишется', async () => {
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({ id: 'ord-1', organizationId: 'org-b' });

    const res = await postOrderComment(prisma as never, orgSession, args);

    expect(res).toEqual({ ok: false, error: 'access_denied' });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('нет заказа → not_found', async () => {
    const res = await postOrderComment(prismaMock() as never, orgSession, args);
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('postOrderComment — manager (three-way scope)', () => {
  it('свой заказ по managerId: count не запрашивается, viewer=manager', async () => {
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'm1',
      organizationId: 'org-x',
      companyId: 'cmp-1',
      orderNumber: 'ORD-1',
      title: 'T',
    });

    const res = await postOrderComment(prisma as never, mgrSession, args);

    expect(res).toMatchObject({ ok: true, viewer: 'manager' });
    expect(prisma.comment.count).not.toHaveBeenCalled();
    expect(notifyOrgUsers).toHaveBeenCalledTimes(1);
  });

  it('исторический доступ: считает свои комментарии и пускает', async () => {
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'other',
      organizationId: 'org-foreign',
      companyId: 'cmp-1',
      orderNumber: 'ORD-1',
      title: 'T',
    });
    prisma.comment.count.mockResolvedValue(2);

    const res = await postOrderComment(prisma as never, mgrSession, args);

    expect(res).toMatchObject({ ok: true });
    expect(prisma.comment.count).toHaveBeenCalledWith({
      where: { orderId: 'ord-1', authorId: 'm1' },
    });
  });

  it('чужой заказ без истории → access_denied', async () => {
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'other',
      organizationId: 'org-foreign',
      companyId: 'cmp-1',
      orderNumber: 'ORD-1',
      title: 'T',
    });

    const res = await postOrderComment(prisma as never, mgrSession, args);
    expect(res).toEqual({ ok: false, error: 'access_denied' });
  });

  it('заказ без организации → уведомление клиенту не шлётся', async () => {
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'm1',
      organizationId: null,
      companyId: 'cmp-1',
      orderNumber: 'ORD-1',
      title: 'T',
    });

    const res = await postOrderComment(prisma as never, mgrSession, args);
    expect(res).toMatchObject({ ok: true });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });
});

describe('postOrderComment — partner / общая ветка', () => {
  const partner = { sub: 'p-u', role: 'partner', partnerId: 'p1' } as never;

  it('партнёр пишет только в свой заказ (viewer=legacy)', async () => {
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({ id: 'ord-1', companyId: 'c1', partnerId: 'p1' });

    const res = await postOrderComment(prisma as never, partner, args);

    expect(res).toMatchObject({ ok: true, viewer: 'legacy' });
    // Партнёрская ветка не спрашивает общий предикат — она строже него.
    expect(canReadOrder).not.toHaveBeenCalled();
  });

  it('заказ соседнего партнёра той же компании → access_denied', async () => {
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({ id: 'ord-1', companyId: 'c1', partnerId: 'pX' });

    const res = await postOrderComment(prisma as never, partner, args);
    expect(res).toEqual({ ok: false, error: 'access_denied' });
  });

  it('прочие роли: отказ canReadOrder → forbidden (отдельный код от access_denied)', async () => {
    canReadOrder.mockResolvedValue(false);
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({ id: 'ord-1', companyId: 'c1' });

    const res = await postOrderComment(prisma as never, { sub: 'a', role: 'admin' } as never, args);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('сбой рассылки не откатывает комментарий (best-effort)', async () => {
    notifyMessageCreated.mockRejectedValue(new Error('transport down'));
    const prisma = prismaMock();
    prisma.order.findUnique.mockResolvedValue({ id: 'ord-1', companyId: 'c1' });

    const res = await postOrderComment(prisma as never, { sub: 'a', role: 'admin' } as never, args);
    expect(res).toMatchObject({ ok: true, viewer: 'legacy' });
    expect(prisma.comment.create).toHaveBeenCalled();
  });
});
