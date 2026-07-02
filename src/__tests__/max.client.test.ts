import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

import { isMaxEnabled, maxDeepLink, sendMaxMessage, maxApiBaseUrl } from '@/lib/max/client';

const ENV = ['MAX_BOT_TOKEN', 'MAX_BOT_USERNAME', 'MAX_API_BASE_URL'] as const;
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

describe('isMaxEnabled', () => {
  it('требует флаг max_channel И оба env', () => {
    process.env.MAX_BOT_TOKEN = 'tok';
    process.env.MAX_BOT_USERNAME = 'lk_max_bot';
    expect(isMaxEnabled()).toBe(true);

    isFeatureEnabled.mockReturnValue(false);
    expect(isMaxEnabled()).toBe(false);
  });

  it('false без кредов даже при поднятом флаге', () => {
    delete process.env.MAX_BOT_TOKEN;
    delete process.env.MAX_BOT_USERNAME;
    expect(isMaxEnabled()).toBe(false);
    process.env.MAX_BOT_TOKEN = 'tok';
    expect(isMaxEnabled()).toBe(false); // username всё ещё нет
  });

  it('передаёт флаг max_channel в isFeatureEnabled', () => {
    process.env.MAX_BOT_TOKEN = 'tok';
    process.env.MAX_BOT_USERNAME = 'bot';
    isMaxEnabled();
    expect(isFeatureEnabled).toHaveBeenCalledWith('max_channel');
  });
});

describe('maxDeepLink / maxApiBaseUrl', () => {
  it('deep-link с username и кодом', () => {
    process.env.MAX_BOT_USERNAME = 'lk_max_bot';
    expect(maxDeepLink('abc123')).toBe('https://max.ru/lk_max_bot?start=abc123');
  });

  it('base URL из env или дефолт', () => {
    delete process.env.MAX_API_BASE_URL;
    expect(maxApiBaseUrl()).toBe('https://botapi.max.ru');
    process.env.MAX_API_BASE_URL = 'https://mock.max.local';
    expect(maxApiBaseUrl()).toBe('https://mock.max.local');
  });
});

describe('sendMaxMessage', () => {
  it('no-op при отсутствии токена', async () => {
    delete process.env.MAX_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendMaxMessage('c1', 'hi')).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST на API агрегатора Max, ok=res.ok', async () => {
    process.env.MAX_BOT_TOKEN = 'tok';
    process.env.MAX_API_BASE_URL = 'https://mock.max.local';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendMaxMessage('chat-1', 'привет');
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://mock.max.local/messages?access_token=tok');
    expect(JSON.parse(init.body)).toEqual({ chat_id: 'chat-1', text: 'привет' });
  });

  it('сетевая ошибка → {ok:false} (best-effort, не бросает)', async () => {
    process.env.MAX_BOT_TOKEN = 'tok';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('max down')));
    expect(await sendMaxMessage('c1', 'hi')).toEqual({ ok: false });
  });
});
