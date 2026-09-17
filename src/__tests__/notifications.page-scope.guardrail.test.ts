import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { buildNotificationScopeWhere } from '@/lib/services/notifications/scope';
import {
  listNotificationsPage,
  markAllNotificationsRead,
  NOTIFICATIONS_PAGE_SIZE,
} from '@/lib/services/notifications/inbox';

/**
 * СТРАЖ `У-228` (решение `Р-Э5-2`): страница «Уведомления» показывает и
 * помечает только СВОЁ.
 *
 * До этапа администратор получал скоуп `{}` — видел уведомления всех
 * пользователей платформы. Для колокольчика это было незаметно; для страницы с
 * кнопкой «Отметить все прочитанными» это значило «пометить чужое». Пакет §8:
 * «пользователь не видит уведомления других пользователей».
 *
 * Мутация (проверено 17.09.2026): вернуть `return {}` администратору →
 * падают обе проверки скоупа; убрать `scope` из `updateMany` в
 * `markAllNotificationsRead` → падает «отметить все не выходит за скоуп».
 */

const admin = { sub: 'u-admin', role: 'admin' } as SessionPayload;
const student = { sub: 'u-student', role: 'student' } as SessionPayload;
const partner = { sub: 'u-partner', role: 'partner', partnerId: 'p1' } as SessionPayload;

const findMany = vi.fn();
const count = vi.fn();
const updateMany = vi.fn();
const prisma = {
  notification: { findMany, count, updateMany },
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
  updateMany.mockResolvedValue({ count: 0 });
});

describe('страж: администратор видит только своё', () => {
  it('скоуп администратора — его userId, а не «всё»', async () => {
    const where = await buildNotificationScopeWhere(prisma, admin);
    expect(where).toEqual({ userId: 'u-admin' });
    expect(JSON.stringify(where)).not.toBe('{}');
  });

  it('слушатель — только своё, без веток организации и партнёра', async () => {
    expect(await buildNotificationScopeWhere(prisma, student)).toEqual({
      OR: [{ userId: 'u-student' }],
    });
  });
});

describe('страж: страница и «отметить все» не выходят за скоуп', () => {
  it('выборка страницы, счётчики и фильтры стоят ПОВЕРХ скоупа', async () => {
    await listNotificationsPage(prisma, partner, { unread: true, page: 2 });
    const where = findMany.mock.calls[0][0].where;
    // Первый элемент AND — всегда скоуп сессии; фильтры только сужают.
    expect(where.AND[0]).toEqual({ OR: [{ userId: 'u-partner' }, { partnerId: 'p1' }] });
    expect(where.AND).toContainEqual({ isRead: false });
    expect(findMany.mock.calls[0][0].skip).toBe(NOTIFICATIONS_PAGE_SIZE);
    expect(findMany.mock.calls[0][0].take).toBe(NOTIFICATIONS_PAGE_SIZE);
    // Счётчик `total` считается по ТОМУ ЖЕ условию, что и список.
    expect(count.mock.calls[0][0].where).toEqual(where);
  });

  it('чужой для роли тип в фильтре игнорируется, а не даёт чужие строки', async () => {
    const res = await listNotificationsPage(prisma, partner, { type: 'sla_escalation' });
    expect(res.type).toBeNull();
    const where = findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('sla_escalation');
  });

  it('свой тип применяется как фильтр', async () => {
    const res = await listNotificationsPage(prisma, partner, { type: 'document_published' });
    expect(res.type).toBe('document_published');
    expect(findMany.mock.calls[0][0].where.AND).toContainEqual({ type: 'document_published' });
  });

  it('«отметить все» помечает только непрочитанное В СКОУПЕ', async () => {
    await markAllNotificationsRead(prisma, admin);
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { AND: [{ userId: 'u-admin' }, { isRead: false }] },
      data: { isRead: true },
    });
  });

  it('номер страницы меньше единицы становится первой', async () => {
    const res = await listNotificationsPage(prisma, partner, { page: 0 });
    expect(res.page).toBe(1);
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });
});
