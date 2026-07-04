/**
 * cov2 — catch→finally path для трёх транспортов (Max / Telegram / WhatsApp).
 *
 * Каждая send-функция обёрнута в try/catch/finally: при отклонении fetch
 * должен исполниться catch (`return { ok: false }`) И finally (`clearTimeout`).
 * Мы поднимаем нужный env-токен (чтобы пройти ранний return), стабим global
 * fetch на REJECT и проверяем `{ ok: false }`. Внешних систем нет — только
 * замоканный fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// featureFlags замокан для max/whatsapp (telegram его не использует, но мок безвреден).
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

import { sendMaxMessage } from '@/lib/max/client';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { sendWhatsAppMessage } from '@/lib/whatsapp/aggregator';

const ENV = [
  'MAX_BOT_TOKEN',
  'MAX_API_BASE_URL',
  'TELEGRAM_BOT_TOKEN',
  'WHATSAPP_AGGREGATOR_API_KEY',
  'WHATSAPP_AGGREGATOR_CHANNEL_ID',
  'WHATSAPP_AGGREGATOR_BASE_URL',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  for (const k of ENV) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('sendMaxMessage — catch→finally', () => {
  it('fetch reject → {ok:false} (catch), clearTimeout в finally не бросает', async () => {
    process.env.MAX_BOT_TOKEN = 'tok';
    const fetchMock = vi.fn().mockRejectedValue(new Error('max transport down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendMaxMessage('chat-1', 'hi')).resolves.toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('sendTelegramMessage — catch→finally', () => {
  it('fetch reject → {ok:false} (catch), clearTimeout в finally не бросает', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    const fetchMock = vi.fn().mockRejectedValue(new Error('tg transport down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTelegramMessage('123456', 'hi')).resolves.toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('sendWhatsAppMessage — catch→finally', () => {
  it('fetch reject → {ok:false} (catch), clearTimeout в finally не бросает', async () => {
    process.env.WHATSAPP_AGGREGATOR_API_KEY = 'key';
    process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID = 'ch1';
    const fetchMock = vi.fn().mockRejectedValue(new Error('agg transport down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendWhatsAppMessage('+79991234567', 'hi')).resolves.toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
