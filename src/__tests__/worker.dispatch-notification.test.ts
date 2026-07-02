/**
 * Integration: worker/processors/dispatch-notification (D5).
 * Живой Postgres (user + SyncLog); транспорты каналов замоканы — в сеть не ходим.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const { isTelegramEnabled, sendTelegramMessage, sendNotificationEmail } = vi.hoisted(() => ({
  isTelegramEnabled: vi.fn(),
  sendTelegramMessage: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));
vi.mock('@/lib/telegram/client', () => ({ isTelegramEnabled, sendTelegramMessage }));
vi.mock('@/lib/email/send', () => ({ sendNotificationEmail }));

import {
  runDispatchNotification,
  reviveChannelPayload,
  dispatchNotificationProcessor,
} from '@/worker/processors/dispatch-notification';
import type { Job } from 'bullmq';
import type { NotificationDispatchPayload } from '@/lib/jobs/types';

const prisma = new PrismaClient();
const ids: Record<string, string> = {};
const STAMP = Date.now();

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `dispatch-notif-${STAMP}@test.ru`,
      name: 'Dispatch Test',
      role: 'organization',
      telegramChatId: `tg-dispatch-${STAMP}`,
    },
  });
  ids.user = user.id;
});

afterAll(async () => {
  await prisma.syncLog.deleteMany({ where: { entity: 'notification', externalId: { startsWith: `job-${STAMP}` } } });
  await prisma.user.delete({ where: { id: ids.user } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  isTelegramEnabled.mockReturnValue(true);
});

function jobData(overrides: Partial<NotificationDispatchPayload> = {}): NotificationDispatchPayload {
  return {
    userId: ids.user,
    channel: 'telegram',
    payload: { type: 'payment_received', title: 'Т', body: 'Б' },
    ...overrides,
  };
}

describe('runDispatchNotification', () => {
  it('доставляет через канал → sent', async () => {
    sendTelegramMessage.mockResolvedValue({ ok: true });
    const result = await runDispatchNotification(prisma, jobData());
    expect(result).toEqual({ status: 'sent' });
    expect(sendTelegramMessage).toHaveBeenCalledWith(`tg-dispatch-${STAMP}`, 'Т\n\nБ');
  });

  it('пользователь не найден → user_not_found, канал не вызывается', async () => {
    const result = await runDispatchNotification(prisma, jobData({ userId: 'missing-user-id' }));
    expect(result).toEqual({ status: 'user_not_found' });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('неизвестный канал → unknown_channel', async () => {
    const result = await runDispatchNotification(
      prisma,
      jobData({ channel: 'pigeon' as NotificationDispatchPayload['channel'] })
    );
    expect(result).toEqual({ status: 'unknown_channel' });
  });

  it('канал стал выключен между enqueue и обработкой → skipped', async () => {
    isTelegramEnabled.mockReturnValue(false);
    const result = await runDispatchNotification(prisma, jobData());
    expect(result).toEqual({ status: 'skipped', reason: 'channel_disabled' });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('failed канала → SyncLog(entity=notification, direction=out) + throw (ретрай BullMQ)', async () => {
    sendTelegramMessage.mockResolvedValue({ ok: false });
    const jobId = `job-${STAMP}-fail`;
    await expect(runDispatchNotification(prisma, jobData(), jobId)).rejects.toThrow(
      'notification channel telegram failed: transport'
    );
    const log = await prisma.syncLog.findFirst({ where: { externalId: jobId } });
    expect(log).toMatchObject({
      entity: 'notification',
      direction: 'out',
      operation: 'channel_telegram',
      status: 'error',
      errorMessage: 'transport',
    });
    expect(log?.payload).toMatchObject({ userId: ids.user, type: 'payment_received' });
  });

  it('брошенное каналом исключение тоже логируется и ретраится', async () => {
    sendTelegramMessage.mockRejectedValue(new Error('tg exploded'));
    const jobId = `job-${STAMP}-throw`;
    await expect(runDispatchNotification(prisma, jobData(), jobId)).rejects.toThrow(
      'notification channel telegram failed: tg exploded'
    );
    const log = await prisma.syncLog.findFirst({ where: { externalId: jobId } });
    expect(log?.errorMessage).toBe('tg exploded');
  });

  it('сбой записи SyncLog не маскирует исходную ошибку канала (best-effort лог)', async () => {
    sendTelegramMessage.mockResolvedValue({ ok: false });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Фейковый db: user есть, но syncLog.create падает.
    const fakeDb = {
      user: {
        findUnique: async () => ({
          id: ids.user,
          email: 'x@test.ru',
          name: 'X',
          telegramChatId: `tg-dispatch-${STAMP}`,
          maxChatId: null,
          whatsappPhone: null,
          notificationChannels: null,
        }),
      },
      syncLog: { create: async () => { throw new Error('log db down'); } },
    } as unknown as PrismaClient;

    await expect(runDispatchNotification(fakeDb, jobData(), 'job-nolog')).rejects.toThrow(
      'notification channel telegram failed: transport'
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[dispatch-notification] SyncLog write failed',
      expect.anything()
    );
    errorSpy.mockRestore();
  });
});

describe('dispatchNotificationProcessor (BullMQ wrapper)', () => {
  it('с инжектированным db делегирует runDispatchNotification', async () => {
    sendTelegramMessage.mockResolvedValue({ ok: true });
    const job = { id: 'wrap-1', data: jobData() } as Job<NotificationDispatchPayload>;
    const result = await dispatchNotificationProcessor(job, prisma);
    expect(result).toEqual({ status: 'sent' });
  });

  it('без db падает обратно на дефолтный prisma-инстанс', async () => {
    sendTelegramMessage.mockResolvedValue({ ok: true });
    const job = { id: 'wrap-2', data: jobData() } as Job<NotificationDispatchPayload>;
    const result = await dispatchNotificationProcessor(job);
    expect(result).toEqual({ status: 'sent' });
  });
});

describe('reviveChannelPayload', () => {
  it('оживляет ISO-строку paidAt в Date (JSON round-trip через Redis)', () => {
    const revived = reviveChannelPayload({
      type: 'order_marked_paid_by_1c',
      title: 'Т',
      body: 'Б',
      email: {
        template: 'managerOrderMarkedPaidBy1C',
        props: {
          orderNumber: '42',
          amount: 100,
          paidAt: '2026-07-01T10:00:00.000Z' as unknown as Date,
          orderUrl: 'https://x',
        },
      },
    });
    const props = revived.email!.props as { paidAt: Date };
    expect(props.paidAt).toBeInstanceOf(Date);
    expect(props.paidAt.toISOString()).toBe('2026-07-01T10:00:00.000Z');
  });

  it('без email-контента и без Date-props — no-op', () => {
    const noEmail = { type: 't', title: 'Т', body: 'Б' };
    expect(reviveChannelPayload(noEmail)).toBe(noEmail);

    const noDates = reviveChannelPayload({
      type: 't',
      title: 'Т',
      body: 'Б',
      email: { template: 'notification', props: { recipientName: 'И', title: 'Т', body: 'Б' } },
    });
    expect(noDates.email!.props).toEqual({ recipientName: 'И', title: 'Т', body: 'Б' });
  });

  it('невалидная строка даты остаётся строкой', () => {
    const revived = reviveChannelPayload({
      type: 't',
      title: 'Т',
      body: 'Б',
      email: {
        template: 'managerOrderMarkedPaidBy1C',
        props: {
          orderNumber: '42',
          amount: 100,
          paidAt: 'not-a-date' as unknown as Date,
          orderUrl: 'https://x',
        },
      },
    });
    expect((revived.email!.props as { paidAt: unknown }).paidAt).toBe('not-a-date');
  });
});
