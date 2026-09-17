import { it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { recordNotification, deliverNotificationToUser, warn } = vi.hoisted(() => ({
  recordNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/notifications/core', () => ({ recordNotification, deliverNotificationToUser }));
vi.mock('@/lib/logging', () => ({ log: { warn, info: vi.fn(), error: vi.fn() } }));

import { notifyNoteMention } from '@/lib/notifications/noteMention';

/**
 * Единый продьюсер `note_mention` (этап 1 ТЗ 12.09.2026, спека §3.6): заметка
 * по сделке и по организации шлют один тип, различая объект в `meta.entity`.
 * С этапа 5 PR-3 (`У-232`) адреса кабинета в строке нет: ссылку строит
 * таблица маршрутов от роли получателя по `entity` + id из `meta`, поэтому
 * администратор и руководитель получают одно и то же `meta`. Ключ дедупа —
 * заметка. Сбой доставки не бросает — заметка уже сохранена.
 */
const userFindMany = vi.fn();
const prisma = { user: { findMany: userFindMany } } as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  recordNotification.mockImplementation(async (_db: unknown, input: { userId: string }) => ({
    row: { id: `n-${input.userId}` },
    deduped: false,
  }));
  deliverNotificationToUser.mockResolvedValue({});
});

const base = { noteId: 'note1', body: 'Текст @Иван' };

it('пустой список упомянутых — ничего не делает и не ходит в базу', async () => {
  const n = await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: [],
    entity: 'deal',
    entityId: 'o1',
  });
  expect(n).toBe(0);
  expect(userFindMany).not.toHaveBeenCalled();
  expect(recordNotification).not.toHaveBeenCalled();
});

it('заметка по сделке: тип note_mention, meta с orderId и entity, ключ дедупа — заметка, dedupKey = id строки', async () => {
  userFindMany.mockResolvedValue([{ id: 'u2' }]);
  const n = await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: ['u2'],
    entity: 'deal',
    entityId: 'o1',
  });
  expect(n).toBe(1);
  // Роль получателя больше не нужна: ссылку считает доставка по своей таблице.
  expect(userFindMany).toHaveBeenCalledWith({
    where: { id: { in: ['u2'] } },
    select: { id: true },
  });
  expect(recordNotification).toHaveBeenCalledWith(prisma, {
    userId: 'u2',
    type: 'note_mention',
    title: 'Вас упомянули в заметке по заказу',
    body: 'Текст @Иван',
    meta: { entity: 'deal', orderId: 'o1', noteId: 'note1' },
    entityId: 'note1',
  });
  expect(deliverNotificationToUser).toHaveBeenCalledWith({
    userId: 'u2',
    title: 'Вас упомянули в заметке по заказу',
    body: 'Текст @Иван',
    type: 'note_mention',
    meta: { entity: 'deal', orderId: 'o1', noteId: 'note1' },
    dedupKey: 'n-u2',
  });
  expect(deliverNotificationToUser.mock.calls[0]![0]).not.toHaveProperty('url');
});

it('заметка по организации: meta с organizationId; администратору и руководителю — одно и то же meta без url', async () => {
  userFindMany.mockResolvedValue([{ id: 'a1' }, { id: 'u3' }]);
  const n = await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: ['a1', 'u3'],
    entity: 'organization',
    entityId: 'org1',
  });
  expect(n).toBe(2);
  expect(recordNotification).toHaveBeenCalledWith(
    prisma,
    expect.objectContaining({
      userId: 'a1',
      title: 'Вас упомянули в заметке по организации',
      meta: { entity: 'organization', organizationId: 'org1', noteId: 'note1' },
      entityId: 'note1',
    })
  );
  const adminDelivery = deliverNotificationToUser.mock.calls.find((c) => c[0].userId === 'a1')![0];
  const leaderDelivery = deliverNotificationToUser.mock.calls.find((c) => c[0].userId === 'u3')![0];
  expect(adminDelivery).not.toHaveProperty('url');
  expect(leaderDelivery).not.toHaveProperty('url');
  expect(adminDelivery.meta).toEqual(leaderDelivery.meta);
  expect(leaderDelivery.meta).toEqual({
    entity: 'organization',
    organizationId: 'org1',
    noteId: 'note1',
  });
});

it('заметка в диалоге и в задаче: meta с dialogId / taskId', async () => {
  userFindMany.mockResolvedValue([{ id: 'u2' }]);
  await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: ['u2'],
    entity: 'dialog',
    entityId: 'd1',
  });
  expect(recordNotification.mock.calls[0]![1].meta).toEqual({
    entity: 'dialog',
    dialogId: 'd1',
    noteId: 'note1',
  });
  await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: ['u2'],
    entity: 'task',
    entityId: 't1',
  });
  expect(recordNotification.mock.calls[1]![1].meta).toEqual({
    entity: 'task',
    taskId: 't1',
    noteId: 'note1',
  });
});

it('повтор за час (deduped: true) — строка «×N», доставка не зовётся, оповещённый засчитан', async () => {
  userFindMany.mockResolvedValue([{ id: 'u2' }]);
  recordNotification.mockResolvedValue({ row: { id: 'n-u2' }, deduped: true });
  const n = await notifyNoteMention(prisma, {
    ...base,
    mentionedUserIds: ['u2'],
    entity: 'deal',
    entityId: 'o1',
  });
  expect(n).toBe(1);
  expect(recordNotification).toHaveBeenCalledTimes(1);
  expect(deliverNotificationToUser).not.toHaveBeenCalled();
});

it('тело обрезается до 200 символов в выдержке', async () => {
  userFindMany.mockResolvedValue([{ id: 'u2' }]);
  const long = 'x'.repeat(500);
  await notifyNoteMention(prisma, {
    ...base,
    body: long,
    mentionedUserIds: ['u2'],
    entity: 'deal',
    entityId: 'o1',
  });
  expect(recordNotification.mock.calls[0]![1].body).toHaveLength(200);
});

it('сбой доставки не бросает: предупреждение в лог, возвращает число успешно оповещённых', async () => {
  userFindMany.mockResolvedValue([{ id: 'u2' }, { id: 'u3' }]);
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
