import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Notification } from '@prisma/client';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/notifications/channels/deliver', () => ({ deliverToRecipient: vi.fn() }));
vi.mock('@/lib/notifications/channels/dispatch', () => ({ dispatchToRecipient: vi.fn() }));

import {
  recordNotification,
  NOTIFICATION_DEDUP_WINDOW_MS,
  type NotificationDb,
} from '@/lib/notifications/core';

/**
 * СТРАЖ `У-231` (решение `Р-Э5-5`): пять одинаковых событий за час — одна
 * строка «×5», а не пять; типы «каждое сообщение важно» (`noDedup`) — пять
 * строк; через 61 минуту — новая строка; без `entityId` — дедупа нет.
 *
 * База — маленькая копия в памяти с честной логикой окна: страж проверяет
 * правило, а не то, какими словами оно записано в запросе.
 *
 * Мутация (проверено 17.09.2026): снять окно (`since` → эпоха) → падает
 * «через 61 минуту новая строка»; убрать исключение `noDedup` → падает
 * «сообщения не схлопываются»; убрать `entityId` из условия → падает
 * «разные объекты — разные строки».
 */

type Row = Notification;

function fakeDb() {
  const rows: Row[] = [];
  let seq = 0;
  const db = {
    notification: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          userId: string;
          type: string;
          entityId: string;
          OR: Array<{ lastOccurredAt?: { gte: Date } | null; createdAt?: { gte: Date } }>;
        };
        const since =
          w.OR[0]?.lastOccurredAt && 'gte' in w.OR[0].lastOccurredAt
            ? w.OR[0].lastOccurredAt.gte
            : new Date(0);
        const found = [...rows]
          .reverse()
          .find(
            (r) =>
              r.userId === w.userId &&
              r.type === w.type &&
              r.entityId === w.entityId &&
              (r.lastOccurredAt ?? r.createdAt).getTime() >= since.getTime()
          );
        return found ? { id: found.id } : null;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.find((x) => x.id === args.where.id)!;
        const d = args.data as {
          dedupCount: { increment: number };
          lastOccurredAt: Date;
          isRead: boolean;
          title: string;
          body: string;
        };
        r.dedupCount += d.dedupCount.increment;
        r.lastOccurredAt = d.lastOccurredAt;
        r.isRead = d.isRead;
        r.title = d.title;
        r.body = d.body;
        return r;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const d = args.data as Partial<Row>;
        const row = {
          id: `n${++seq}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          isRead: false,
          dedupCount: 1,
          organizationId: null,
          partnerId: null,
          meta: null,
          ...d,
        } as Row;
        rows.push(row);
        return row;
      }),
    },
  };
  return { db: db as unknown as NotificationDb, rows };
}

const base = { userId: 'u1', type: 'task_assigned', title: 'Задача', body: 'Назначена' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('страж: дедупликация уведомлений (У-231)', () => {
  it('пять событий об одном объекте за час — одна строка ×5, повторы помечены', async () => {
    const { db, rows } = fakeDb();
    const results = [];
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(5 * 60 * 1000);
      results.push(await recordNotification(db, { ...base, entityId: 't1', title: `Задача ${i}` }));
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupCount).toBe(5);
    expect(results.map((r) => r.deduped)).toEqual([false, true, true, true, true]);
    // Тексты свежие, строка снова непрочитана.
    expect(rows[0]!.title).toBe('Задача 4');
    expect(rows[0]!.isRead).toBe(false);
  });

  it('повтор снова делает строку непрочитанной', async () => {
    const { db, rows } = fakeDb();
    await recordNotification(db, { ...base, entityId: 't1' });
    rows[0]!.isRead = true;
    const second = await recordNotification(db, { ...base, entityId: 't1' });
    expect(second.deduped).toBe(true);
    expect(rows[0]!.isRead).toBe(false);
  });

  it('сообщения (noDedup) не схлопываются — каждое своей строкой', async () => {
    const { db, rows } = fakeDb();
    for (let i = 0; i < 5; i++) {
      await recordNotification(db, { ...base, type: 'messenger_message', entityId: 'd1' });
    }
    expect(rows).toHaveLength(5);
    expect(db.notification.findFirst).not.toHaveBeenCalled();
  });

  it('через 61 минуту — новая строка, а не «×2»', async () => {
    const { db, rows } = fakeDb();
    await recordNotification(db, { ...base, entityId: 't1' });
    vi.advanceTimersByTime(NOTIFICATION_DEDUP_WINDOW_MS + 60 * 1000);
    const late = await recordNotification(db, { ...base, entityId: 't1' });
    expect(late.deduped).toBe(false);
    expect(rows).toHaveLength(2);
  });

  it('внутри окна, но после старого повтора — всё ещё «×N» (окно от последнего повтора)', async () => {
    const { db, rows } = fakeDb();
    await recordNotification(db, { ...base, entityId: 't1' });
    vi.advanceTimersByTime(50 * 60 * 1000);
    await recordNotification(db, { ...base, entityId: 't1' });
    vi.advanceTimersByTime(50 * 60 * 1000);
    const third = await recordNotification(db, { ...base, entityId: 't1' });
    expect(third.deduped).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupCount).toBe(3);
  });

  it('разные объекты — разные строки', async () => {
    const { db, rows } = fakeDb();
    await recordNotification(db, { ...base, entityId: 't1' });
    await recordNotification(db, { ...base, entityId: 't2' });
    expect(rows).toHaveLength(2);
  });

  it('разные получатели — разные строки', async () => {
    const { db, rows } = fakeDb();
    await recordNotification(db, { ...base, entityId: 't1' });
    await recordNotification(db, { ...base, userId: 'u2', entityId: 't1' });
    expect(rows).toHaveLength(2);
  });

  it('без entityId дедупа нет — честно, а не «угадали по meta»', async () => {
    const { db, rows } = fakeDb();
    await recordNotification(db, { ...base, meta: { taskId: 't1' } });
    await recordNotification(db, { ...base, meta: { taskId: 't1' } });
    expect(rows).toHaveLength(2);
    expect(db.notification.findFirst).not.toHaveBeenCalled();
  });

  it('новая строка несёт entityId и lastOccurredAt = момент создания', async () => {
    const { db, rows } = fakeDb();
    await recordNotification(db, { ...base, entityId: 't1', organizationId: 'o1' });
    expect(rows[0]).toMatchObject({
      entityId: 't1',
      organizationId: 'o1',
      partnerId: null,
      lastOccurredAt: new Date('2026-09-17T10:00:00Z'),
    });
  });
});
