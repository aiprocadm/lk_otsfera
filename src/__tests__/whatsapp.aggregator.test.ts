import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

import {
  isWhatsAppEnabled,
  sendWhatsAppMessage,
  whatsappAggregatorBaseUrl,
} from '@/lib/whatsapp/aggregator';

const ENV = [
  'WHATSAPP_AGGREGATOR_BASE_URL',
  'WHATSAPP_AGGREGATOR_API_KEY',
  'WHATSAPP_AGGREGATOR_CHANNEL_ID',
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

describe('isWhatsAppEnabled', () => {
  it('требует флаг whatsapp_channel + API-ключ + channelId', () => {
    process.env.WHATSAPP_AGGREGATOR_API_KEY = 'key';
    process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID = 'ch1';
    expect(isWhatsAppEnabled()).toBe(true);

    isFeatureEnabled.mockReturnValue(false);
    expect(isWhatsAppEnabled()).toBe(false);
  });

  it('false без кредов агрегатора', () => {
    delete process.env.WHATSAPP_AGGREGATOR_API_KEY;
    delete process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID;
    expect(isWhatsAppEnabled()).toBe(false);
    process.env.WHATSAPP_AGGREGATOR_API_KEY = 'key';
    expect(isWhatsAppEnabled()).toBe(false); // channelId ещё нет
  });

  it('передаёт флаг whatsapp_channel в isFeatureEnabled', () => {
    process.env.WHATSAPP_AGGREGATOR_API_KEY = 'key';
    process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID = 'ch1';
    isWhatsAppEnabled();
    expect(isFeatureEnabled).toHaveBeenCalledWith('whatsapp_channel');
  });
});

describe('whatsappAggregatorBaseUrl', () => {
  it('env или дефолт Wazzup', () => {
    delete process.env.WHATSAPP_AGGREGATOR_BASE_URL;
    expect(whatsappAggregatorBaseUrl()).toBe('https://api.wazzup24.com');
    process.env.WHATSAPP_AGGREGATOR_BASE_URL = 'https://mock.agg.local';
    expect(whatsappAggregatorBaseUrl()).toBe('https://mock.agg.local');
  });
});

describe('sendWhatsAppMessage', () => {
  it('no-op без кредов', async () => {
    delete process.env.WHATSAPP_AGGREGATOR_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendWhatsAppMessage('+79991234567', 'hi')).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /v3/message с Bearer-ключом и телом агрегатора', async () => {
    process.env.WHATSAPP_AGGREGATOR_API_KEY = 'secret-key';
    process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID = 'ch-42';
    process.env.WHATSAPP_AGGREGATOR_BASE_URL = 'https://mock.agg.local';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendWhatsAppMessage('+79991234567', 'привет');
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://mock.agg.local/v3/message');
    expect(init.headers.authorization).toBe('Bearer secret-key');
    expect(JSON.parse(init.body)).toEqual({
      channelId: 'ch-42',
      chatType: 'whatsapp',
      chatId: '+79991234567',
      text: 'привет',
    });
  });

  it('сетевая ошибка → {ok:false}', async () => {
    process.env.WHATSAPP_AGGREGATOR_API_KEY = 'key';
    process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID = 'ch1';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('agg down')));
    expect(await sendWhatsAppMessage('+79991234567', 'hi')).toEqual({ ok: false });
  });

  it('ключи никогда не в коде — только из env (проверка: без env нет вызова)', async () => {
    delete process.env.WHATSAPP_AGGREGATOR_API_KEY;
    delete process.env.WHATSAPP_AGGREGATOR_CHANNEL_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendWhatsAppMessage('+79991234567', 'hi');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
