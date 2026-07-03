import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * E2E (Track D) — веер доставки уведомлений сквозь настоящий слой настроек.
 *
 * Отличие от unit-мирроров (notifications.dispatch.test.ts,
 * services.notifications.preferences.test.ts): здесь `notificationChannels`
 * пишутся/читаются из ЖИВОГО Postgres (integration-tier: `new PrismaClient()`),
 * реальная строка `User` подаётся в production-логику `dispatchToRecipient`
 * через тот же `CHANNEL_RECIPIENT_SELECT`, что и фан-ауты. Проверяем сквозной
 * инвариант ТЗ §12.1 / трека D:
 *   • email — базовый канал, доставляется ВСЕГДА (настройки его не мьютят);
 *   • канал, выключенный пользователем (telegram=false), пропускается даже при
 *     привязке и включённом транспорте;
 *   • канал ON + привязка (max=true, maxChatId) — доставляется;
 *   • идемпотентность: повторный dispatch того же (dedupKey,userId,channel)
 *     использует детерминированный jobId → BullMQ дедуплицирует, без задвоения.
 *
 * ВСЕ транспорты (Resend/Telegram/Max/WhatsApp) и очередь замоканы — сети нет.
 * Мок-паттерн скопирован с notifications.dispatch.test.ts (vi.hoisted + vi.mock).
 */

const {
  sendNotificationEmail,
  isTelegramEnabled,
  sendTelegramMessage,
  isMaxEnabled,
  sendMaxMessage,
  isWhatsAppEnabled,
  sendWhatsAppMessage,
  queueAdd,
  getQueue,
} = vi.hoisted(() => {
  const queueAdd = vi.fn();
  return {
    sendNotificationEmail: vi.fn(),
    isTelegramEnabled: vi.fn(),
    sendTelegramMessage: vi.fn(),
    isMaxEnabled: vi.fn(),
    sendMaxMessage: vi.fn(),
    isWhatsAppEnabled: vi.fn(),
    sendWhatsAppMessage: vi.fn(),
    queueAdd,
    getQueue: vi.fn(() => ({ add: queueAdd })),
  };
});

vi.mock('@/lib/email/send', () => ({ sendNotificationEmail }));
vi.mock('@/lib/telegram/client', () => ({ isTelegramEnabled, sendTelegramMessage }));
vi.mock('@/lib/max/client', () => ({ isMaxEnabled, sendMaxMessage }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ isWhatsAppEnabled, sendWhatsAppMessage }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { dispatchToRecipient, notificationJobId } from '@/lib/notifications/channels/dispatch';
import { CHANNEL_RECIPIENT_SELECT } from '@/lib/notifications/channels/types';
import type { ChannelPayload, ChannelRecipient } from '@/lib/notifications/channels/types';

let prisma: PrismaClient;
const STAMP = Date.now();

// Детерминированный id/ключ идемпотентности события (id in-app Notification-строки
// в проде). НЕ Date.now() — на нём не ассертим, STAMP только для уникальности имён.
const DEDUP_KEY = 'evt-fixed-1';

let companyId: string;
// Пользователь: telegram привязан НО выключен (pref=false), max привязан И включён,
// whatsapp не привязан. Email — всегда.
let userOptMixId: string;

const payload: ChannelPayload = {
  type: 'payment_received',
  title: 'Оплата получена',
  body: 'Поступил платёж по заказу',
  email: {
    template: 'notification',
    props: { recipientName: 'Иван', title: 'Оплата получена', body: 'Поступил платёж по заказу' },
  },
};

const ENV_KEYS = ['FEATURE_NOTIF_QUEUE', 'REDIS_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};

/** Читает живую строку User и приводит к ChannelRecipient (как фан-аут в проде). */
async function loadRecipient(userId: string): Promise<ChannelRecipient> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: CHANNEL_RECIPIENT_SELECT,
  });
  return row as ChannelRecipient;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const company = await prisma.company.create({ data: { name: `e2eNotifCo-${STAMP}` } });
  companyId = company.id;

  const user = await prisma.user.create({
    data: {
      email: `e2e-notif-mix-${STAMP}@example.ru`,
      name: 'Иван',
      companyId,
      telegramChatId: `tg-${STAMP}`,
      maxChatId: `mx-${STAMP}`,
      whatsappPhone: null,
      // Настройки: telegram замьючен, max явно включён. email в prefs не хранится.
      notificationChannels: { telegram: false, max: true },
    },
  });
  userOptMixId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userOptMixId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Транспорты включены на уровне гейтов; фактический веер решают привязка+prefs.
  isTelegramEnabled.mockReturnValue(true);
  isMaxEnabled.mockReturnValue(true);
  isWhatsAppEnabled.mockReturnValue(true);
  sendNotificationEmail.mockResolvedValue({ status: 'sent', id: 'e1' });
  sendTelegramMessage.mockResolvedValue({ ok: true });
  sendMaxMessage.mockResolvedValue({ ok: true });
  sendWhatsAppMessage.mockResolvedValue({ ok: true });
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('E2E — веер доставки: email всегда + opt-in каналы (inline-режим)', () => {
  beforeEach(() => {
    // Inline-путь = флаг notif_queue выключен → dispatch зовёт транспорты сам.
    delete process.env.FEATURE_NOTIF_QUEUE;
    process.env.REDIS_URL = 'redis://localhost:6379'; // одного Redis мало без флага
  });

  it('живые настройки user: email SENT, telegram (OFF) SKIPPED, max (ON+bound) SENT, whatsapp (unlinked) отсутствует', async () => {
    const user = await loadRecipient(userOptMixId);
    // Sanity: строка реально пришла из БД с ожидаемыми prefs/привязками.
    expect(user.id).toBe(userOptMixId);
    expect(user.notificationChannels).toEqual({ telegram: false, max: true });
    expect(user.telegramChatId).toBe(`tg-${STAMP}`);
    expect(user.maxChatId).toBe(`mx-${STAMP}`);
    expect(user.whatsappPhone).toBeNull();

    const outcome = await dispatchToRecipient(user, payload, { dedupKey: DEDUP_KEY });

    expect(outcome.mode).toBe('inline');
    if (outcome.mode !== 'inline') throw new Error('ожидался inline-режим');

    // Email — базовый канал, доставлен всегда.
    expect(outcome.results.email).toEqual({ status: 'sent' });
    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(sendNotificationEmail).toHaveBeenCalledWith({
      to: user.email,
      recipientName: 'Иван',
      title: 'Оплата получена',
      body: 'Поступил платёж по заказу',
    });

    // Telegram привязан + транспорт включён, НО pref=false → канал не в вееере,
    // транспорт не тронут (isEnabledFor вернул false раньше send).
    expect(outcome.results.telegram).toBeUndefined();
    expect(sendTelegramMessage).not.toHaveBeenCalled();

    // Max: pref=true + привязка → доставлен транспортом.
    expect(outcome.results.max).toEqual({ status: 'sent' });
    expect(sendMaxMessage).toHaveBeenCalledTimes(1);
    expect(sendMaxMessage).toHaveBeenCalledWith(
      `mx-${STAMP}`,
      'Оплата получена\n\nПоступил платёж по заказу'
    );

    // WhatsApp не привязан → канал выключен, транспорт не тронут.
    expect(outcome.results.whatsapp).toBeUndefined();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('email доставляется ДАЖЕ когда все опциональные каналы выключены настройкой', async () => {
    // Ad-hoc получатель на базе живого id, но с полностью замьюченными каналами.
    const base = await loadRecipient(userOptMixId);
    const muted: ChannelRecipient = {
      ...base,
      notificationChannels: { telegram: false, max: false, whatsapp: false },
    };

    const outcome = await dispatchToRecipient(muted, payload, { dedupKey: DEDUP_KEY });

    expect(outcome.mode).toBe('inline');
    if (outcome.mode !== 'inline') throw new Error('ожидался inline-режим');
    expect(outcome.results.email).toEqual({ status: 'sent' });
    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    // Ни один опциональный транспорт не тронут — email не подчиняется prefs.
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(sendMaxMessage).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});

describe('E2E — идемпотентность через детерминированный jobId (queued-режим)', () => {
  beforeEach(() => {
    // Queued-путь = флаг + REDIS_URL. Транспорты доставит воркер — dispatch их не зовёт.
    process.env.FEATURE_NOTIF_QUEUE = '1';
    process.env.REDIS_URL = 'redis://localhost:6379';
    queueAdd.mockResolvedValue({ id: 'job1' });
  });

  it('ставит job на email + max (не на замьюченный telegram) с детерминированным jobId', async () => {
    const user = await loadRecipient(userOptMixId);
    const outcome = await dispatchToRecipient(user, payload, { dedupKey: DEDUP_KEY });

    expect(outcome).toEqual({ mode: 'queued', channels: ['email', 'max'] });
    expect(queueAdd).toHaveBeenCalledTimes(2);
    expect(queueAdd).toHaveBeenCalledWith(
      'deliver',
      { userId: userOptMixId, channel: 'email', payload },
      { jobId: notificationJobId(DEDUP_KEY, userOptMixId, 'email') }
    );
    expect(queueAdd).toHaveBeenCalledWith(
      'deliver',
      { userId: userOptMixId, channel: 'max', payload },
      { jobId: notificationJobId(DEDUP_KEY, userOptMixId, 'max') }
    );
    // Замьюченный telegram и непривязанный whatsapp не попали в очередь.
    const channelsQueued = queueAdd.mock.calls.map((c) => c[1].channel);
    expect(channelsQueued).not.toContain('telegram');
    expect(channelsQueued).not.toContain('whatsapp');
    // Доставку выполняет воркер — dispatch не зовёт транспорты напрямую.
    expect(sendNotificationEmail).not.toHaveBeenCalled();
    expect(sendMaxMessage).not.toHaveBeenCalled();
  });

  it('повторный dispatch того же события даёт ТЕ ЖЕ jobId (BullMQ дедуплицирует, без задвоения)', async () => {
    const user = await loadRecipient(userOptMixId);
    await dispatchToRecipient(user, payload, { dedupKey: DEDUP_KEY });
    await dispatchToRecipient(user, payload, { dedupKey: DEDUP_KEY });

    const jobIds = queueAdd.mock.calls.map((c) => c[2].jobId);
    const emailJobId = notificationJobId(DEDUP_KEY, userOptMixId, 'email');
    const maxJobId = notificationJobId(DEDUP_KEY, userOptMixId, 'max');
    // Оба прогона выдали идентичный набор jobId — очередь схлопнет дубли по jobId.
    expect(jobIds).toEqual([emailJobId, maxJobId, emailJobId, maxJobId]);
    // Двоеточие в jobId запрещено BullMQ — разделитель `_`.
    for (const id of jobIds) expect(id).not.toContain(':');
  });
});
