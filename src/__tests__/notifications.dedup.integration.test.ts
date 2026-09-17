import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { recordNotification, NOTIFICATION_DEDUP_WINDOW_MS } from '@/lib/notifications/core';

/**
 * Дедупликация уведомлений на живой базе (`У-231`, `Р-Э5-5`): окно 60 минут
 * считается по настоящим `createdAt`/`lastOccurredAt`, а не по моку — здесь
 * проверяется, что условие `OR` в запросе и индекс
 * `[userId, type, entityId, createdAt]` действительно находят кандидата.
 */

const prisma = new PrismaClient();
const STAMP = Date.now();
let userId = '';

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email: `dedup-${STAMP}@t.local`, name: 'Дедуп', role: 'manager' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

const base = { type: 'task_assigned', title: 'Задача', body: 'Назначена' };

describe('recordNotification — живая база', () => {
  it('пять событий за час — одна строка «×5», снова непрочитанная, с последним текстом', async () => {
    const entityId = `t-${STAMP}-a`;
    for (let i = 0; i < 5; i++) {
      const res = await recordNotification(prisma, {
        ...base,
        userId,
        entityId,
        title: `Задача ${i}`,
      });
      expect(res.deduped).toBe(i > 0);
      if (i === 2)
        await prisma.notification.update({ where: { id: res.row.id }, data: { isRead: true } });
    }
    const rows = await prisma.notification.findMany({ where: { userId, entityId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dedupCount: 5, isRead: false, title: 'Задача 4' });
    expect(rows[0]!.lastOccurredAt!.getTime()).toBeGreaterThanOrEqual(rows[0]!.createdAt.getTime());
  });

  it('повтор старше окна — новая строка', async () => {
    const entityId = `t-${STAMP}-b`;
    const first = await recordNotification(prisma, { ...base, userId, entityId });
    const old = new Date(Date.now() - NOTIFICATION_DEDUP_WINDOW_MS - 5 * 60 * 1000);
    await prisma.notification.update({
      where: { id: first.row.id },
      data: { createdAt: old, lastOccurredAt: old },
    });
    const second = await recordNotification(prisma, { ...base, userId, entityId });
    expect(second.deduped).toBe(false);
    expect(await prisma.notification.count({ where: { userId, entityId } })).toBe(2);
  });

  it('строка до миграции (lastOccurredAt = null) — окно считается по createdAt', async () => {
    const entityId = `t-${STAMP}-c`;
    const first = await recordNotification(prisma, { ...base, userId, entityId });
    await prisma.notification.update({
      where: { id: first.row.id },
      data: { lastOccurredAt: null },
    });
    const second = await recordNotification(prisma, { ...base, userId, entityId });
    expect(second.deduped).toBe(true);
    expect(await prisma.notification.count({ where: { userId, entityId } })).toBe(1);
  });

  it('messenger_message не схлопывается', async () => {
    const entityId = `d-${STAMP}`;
    await recordNotification(prisma, { ...base, type: 'messenger_message', userId, entityId });
    await recordNotification(prisma, { ...base, type: 'messenger_message', userId, entityId });
    expect(await prisma.notification.count({ where: { userId, entityId } })).toBe(2);
  });
});
