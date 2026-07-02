import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendNotificationEmail, isTelegramEnabled, sendTelegramMessage, queueAdd, getQueue } =
  vi.hoisted(() => {
    const queueAdd = vi.fn();
    return {
      sendNotificationEmail: vi.fn(),
      isTelegramEnabled: vi.fn(),
      sendTelegramMessage: vi.fn(),
      queueAdd,
      getQueue: vi.fn(() => ({ add: queueAdd })),
    };
  });

vi.mock('@/lib/email/send', () => ({ sendNotificationEmail }));
vi.mock('@/lib/telegram/client', () => ({ isTelegramEnabled, sendTelegramMessage }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { dispatchToRecipient, notificationJobId } from '@/lib/notifications/channels/dispatch';
import type { ChannelPayload, ChannelRecipient } from '@/lib/notifications/channels/types';

function makeUser(overrides: Partial<ChannelRecipient> = {}): ChannelRecipient {
  return {
    id: 'u1',
    email: 'user@example.ru',
    name: 'Иван',
    telegramChatId: null,
    maxChatId: null,
    whatsappPhone: null,
    notificationChannels: null,
    ...overrides,
  };
}

const payload: ChannelPayload = {
  type: 'payment_received',
  title: 'Т',
  body: 'Б',
  email: { template: 'notification', props: { recipientName: 'Иван', title: 'Т', body: 'Б' } },
};

const ENV_KEYS = ['FEATURE_NOTIF_QUEUE', 'REDIS_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  isTelegramEnabled.mockReturnValue(false);
  sendNotificationEmail.mockResolvedValue({ status: 'sent', id: 'e1' });
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function enableQueueMode() {
  process.env.FEATURE_NOTIF_QUEUE = '1';
  process.env.REDIS_URL = 'redis://localhost:6379';
}

describe('notificationJobId', () => {
  it('детерминированный, без запрещённого BullMQ двоеточия', () => {
    const id = notificationJobId('n-1', 'u-1', 'email');
    expect(id).toBe('notif_n-1_u-1_email');
    expect(id).not.toContain(':');
    expect(notificationJobId('n-1', 'u-1', 'email')).toBe(id);
  });
});

describe('dispatchToRecipient — inline режим (флаг notif_queue выключен)', () => {
  it('без флага доставляет inline и не трогает очередь', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379'; // одного Redis мало
    const outcome = await dispatchToRecipient(makeUser(), payload, { dedupKey: 'n-1' });
    expect(outcome.mode).toBe('inline');
    if (outcome.mode === 'inline') {
      expect(outcome.results.email).toEqual({ status: 'sent' });
    }
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('флаг включён, но REDIS_URL пуст → inline (graceful)', async () => {
    process.env.FEATURE_NOTIF_QUEUE = '1';
    delete process.env.REDIS_URL;
    const outcome = await dispatchToRecipient(makeUser(), payload, { dedupKey: 'n-1' });
    expect(outcome.mode).toBe('inline');
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe('dispatchToRecipient — очередь (флаг + REDIS_URL)', () => {
  beforeEach(() => {
    enableQueueMode();
    queueAdd.mockResolvedValue({ id: 'job1' });
  });

  it('ставит job на каждый включённый канал с детерминированным jobId', async () => {
    isTelegramEnabled.mockReturnValue(true);
    const user = makeUser({ telegramChatId: '123' });
    const outcome = await dispatchToRecipient(user, payload, { dedupKey: 'n-1' });

    expect(outcome).toEqual({ mode: 'queued', channels: ['email', 'telegram'] });
    expect(queueAdd).toHaveBeenCalledTimes(2);
    expect(queueAdd).toHaveBeenCalledWith(
      'deliver',
      { userId: 'u1', channel: 'email', payload },
      { jobId: 'notif_n-1_u1_email' }
    );
    expect(queueAdd).toHaveBeenCalledWith(
      'deliver',
      { userId: 'u1', channel: 'telegram', payload },
      { jobId: 'notif_n-1_u1_telegram' }
    );
    // Транспорты не вызываются — доставит воркер.
    expect(sendNotificationEmail).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('идемпотентность: повторный dispatch с тем же dedupKey даёт те же jobId', async () => {
    await dispatchToRecipient(makeUser(), payload, { dedupKey: 'n-1' });
    await dispatchToRecipient(makeUser(), payload, { dedupKey: 'n-1' });
    const jobIds = queueAdd.mock.calls.map((c) => c[2].jobId);
    expect(jobIds).toEqual(['notif_n-1_u1_email', 'notif_n-1_u1_email']);
    // BullMQ дедуплицирует по jobId — второй add() является no-op на стороне очереди.
  });

  it('email без контента не ставится в очередь (in-app-only событие)', async () => {
    const outcome = await dispatchToRecipient(
      makeUser(),
      { type: 'lead_status_changed', title: 'Т', body: 'Б' },
      { dedupKey: 'n-2' }
    );
    expect(outcome).toEqual({ mode: 'queued', channels: [] });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('фильтр channels сужает веер', async () => {
    isTelegramEnabled.mockReturnValue(true);
    const user = makeUser({ telegramChatId: '123' });
    const outcome = await dispatchToRecipient(user, payload, {
      dedupKey: 'n-3',
      channels: ['email'],
    });
    expect(outcome).toEqual({ mode: 'queued', channels: ['email'] });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('ошибка enqueue деградирует в inline-доставку', async () => {
    queueAdd.mockRejectedValue(new Error('redis down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outcome = await dispatchToRecipient(makeUser(), payload, { dedupKey: 'n-4' });
    expect(outcome.mode).toBe('inline');
    if (outcome.mode === 'inline') {
      expect(outcome.results.email).toEqual({ status: 'sent' });
    }
    expect(warnSpy).toHaveBeenCalledWith(
      '[notifications] enqueue failed — falling back to inline delivery',
      expect.objectContaining({ dedupKey: 'n-4', error: 'redis down' })
    );
    warnSpy.mockRestore();
  });

  it('канал, выключенный настройкой пользователя, не получает job', async () => {
    isTelegramEnabled.mockReturnValue(true);
    const user = makeUser({ telegramChatId: '123', notificationChannels: { telegram: false } });
    const outcome = await dispatchToRecipient(user, payload, { dedupKey: 'n-5' });
    expect(outcome).toEqual({ mode: 'queued', channels: ['email'] });
  });
});
