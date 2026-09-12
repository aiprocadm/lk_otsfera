import { it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { createNotification, deliverNotificationToUser, warn } = vi.hoisted(() => ({
  createNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/notifications/core', () => ({ createNotification, deliverNotificationToUser }));
vi.mock('@/lib/logging', () => ({ log: { warn, info: vi.fn(), error: vi.fn() } }));

import { notifyNoteMention } from '@/lib/notifications/noteMention';

/**
 * Единый продьюсер `note_mention` (этап 1 ТЗ 12.09.2026, спека §3.6): заметка
 * по сделке и по организации шлют один тип, различая объект в `meta.entity`;
 * администратор получает уведомление без ссылки (у него нет /manager);
 * сбой доставки не бросает — заметка уже сохранена.
 */
const userFindMany = vi.fn();
const prisma = { user: { findMany: userFindMany } } as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  createNotification.mockImplementation(async (input: { userId: string }) => ({
    id: `n-${input.userId}`,
  }));
  deliverNotificationToUser.mockResolvedValue({});
});

const base = { noteId: 'note1', body: 'Текст @Иван', managerPath: '/manager/orders/o1' };

it('пустой список упомянутых — ничего не делает и не ходит в базу', async () => {
  const n = await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: [],
    entity: 'deal',
    entityId: 'o1',
  });
  expect(n).toBe(0);
  expect(userFindMany).not.toHaveBeenCalled();
  expect(createNotification).not.toHaveBeenCalled();
});

it('заметка по сделке: тип note_mention, meta с orderId и entity, ссылка менеджеру, dedupKey = id строки', async () => {
  userFindMany.mockResolvedValue([{ id: 'u2', role: 'manager' }]);
  const n = await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: ['u2'],
    entity: 'deal',
    entityId: 'o1',
  });
  expect(n).toBe(1);
  expect(userFindMany).toHaveBeenCalledWith({
    where: { id: { in: ['u2'] } },
    select: { id: true, role: true },
  });
  expect(createNotification).toHaveBeenCalledWith({
    userId: 'u2',
    type: 'note_mention',
    title: 'Вас упомянули в заметке по заказу',
    body: 'Текст @Иван',
    meta: { entity: 'deal', orderId: 'o1', noteId: 'note1' },
  });
  expect(deliverNotificationToUser).toHaveBeenCalledWith({
    userId: 'u2',
    title: 'Вас упомянули в заметке по заказу',
    body: 'Текст @Иван',
    type: 'note_mention',
    url: '/manager/orders/o1',
    dedupKey: 'n-u2',
  });
});

it('заметка по организации: meta с organizationId; администратор — без url', async () => {
  userFindMany.mockResolvedValue([
    { id: 'a1', role: 'admin' },
    { id: 'u3', role: 'leader' },
  ]);
  const n = await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: ['a1', 'u3'],
    entity: 'organization',
    entityId: 'org1',
    managerPath: '/manager/organizations/org1?tab=notes',
  });
  expect(n).toBe(2);
  expect(createNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'a1',
      title: 'Вас упомянули в заметке по организации',
      meta: { entity: 'organization', organizationId: 'org1', noteId: 'note1' },
    })
  );
  const adminDelivery = deliverNotificationToUser.mock.calls.find((c) => c[0].userId === 'a1')![0];
  expect(adminDelivery).not.toHaveProperty('url');
  const leaderDelivery = deliverNotificationToUser.mock.calls.find((c) => c[0].userId === 'u3')![0];
  expect(leaderDelivery.url).toBe('/manager/organizations/org1?tab=notes');
});

it('тело обрезается до 200 символов в выдержке', async () => {
  userFindMany.mockResolvedValue([{ id: 'u2', role: 'manager' }]);
  const long = 'x'.repeat(500);
  await notifyNoteMention(prisma, {
    ...base,
    body: long,
    mentionedUserIds: ['u2'],
    entity: 'deal',
    entityId: 'o1',
  });
  expect(createNotification.mock.calls[0]![0].body).toHaveLength(200);
});

it('сбой доставки не бросает: предупреждение в лог, возвращает число успешно оповещённых', async () => {
  userFindMany.mockResolvedValue([
    { id: 'u2', role: 'manager' },
    { id: 'u3', role: 'manager' },
  ]);
  deliverNotificationToUser.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('smtp down'));
  const n = await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: ['u2', 'u3'],
    entity: 'deal',
    entityId: 'o1',
  });
  expect(n).toBe(1);
  expect(warn).toHaveBeenCalledWith(
    '[notifications/noteMention] mention notify failed',
    expect.objectContaining({ noteId: 'note1', entity: 'deal', error: 'smtp down' })
  );
});

it('не-Error отказ логируется строкой', async () => {
  userFindMany.mockRejectedValue('boom');
  const n = await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: ['u2'],
    entity: 'deal',
    entityId: 'o1',
  });
  expect(n).toBe(0);
  expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error: 'boom' }));
});
