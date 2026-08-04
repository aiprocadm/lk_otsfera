import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Аудит A1: чтение/отметка уведомлений (`listNotifications`,
 * `countUnreadNotifications`, `markNotificationsRead`) — вынесено из роутов
 * /api/notifications и /api/notifications/unread. Скоуп строит общий
 * buildNotificationScopeWhere; здесь он замокан — проверяется, что скоуп
 * реально накладывается на запрос (иначе пометить можно было бы чужое).
 */

const { buildScope } = vi.hoisted(() => ({ buildScope: vi.fn() }));
vi.mock('@/lib/services/notifications/scope', () => ({
  buildNotificationScopeWhere: buildScope,
}));

import {
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
} from '@/lib/services/notifications/inbox';

const SCOPE = { OR: [{ userId: 'u1' }] };
const session = { sub: 'u1', role: 'partner', partnerId: 'p1' } as never;

function db() {
  return {
    notification: {
      findMany: vi.fn().mockResolvedValue([{ id: 'n1' }]),
      count: vi.fn().mockResolvedValue(7),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  buildScope.mockResolvedValue(SCOPE);
});

describe('listNotifications', () => {
  it('отдаёт последние 50 в скоупе сессии', async () => {
    const prisma = db();
    const res = await listNotifications(prisma as never, session);

    expect(res).toEqual({ ok: true, notifications: [{ id: 'n1' }] });
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: SCOPE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });
});

describe('countUnreadNotifications', () => {
  it('считает только непрочитанные поверх скоупа', async () => {
    const prisma = db();
    const res = await countUnreadNotifications(prisma as never, session);

    expect(res).toEqual({ ok: true, count: 7 });
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { AND: [SCOPE, { isRead: false }] },
    });
  });
});

describe('markNotificationsRead', () => {
  it('одиночный id: фильтр по id И скоуп (чужое пометить нельзя)', async () => {
    const prisma = db();
    const res = await markNotificationsRead(prisma as never, session, { id: 'n1', isRead: true });

    expect(res).toEqual({ ok: true, updated: { count: 2 } });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { AND: [{ id: 'n1' }, SCOPE] },
      data: { isRead: true },
    });
    expect(buildScope).toHaveBeenCalledWith(prisma, session, { candidateIds: ['n1'] });
  });

  it('пачка ids: фильтр in + скоуп, isRead:false проходит как есть', async () => {
    const prisma = db();
    await markNotificationsRead(prisma as never, session, { ids: ['n1', 'n2'], isRead: false });

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { AND: [{ id: { in: ['n1', 'n2'] } }, SCOPE] },
      data: { isRead: false },
    });
    expect(buildScope).toHaveBeenCalledWith(prisma, session, { candidateIds: ['n1', 'n2'] });
  });
});
