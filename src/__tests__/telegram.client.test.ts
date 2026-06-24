import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- mock fetch globally ----
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { isTelegramEnabled, botDeepLink, sendTelegramMessage } from '@/lib/telegram/client';

const TOKEN = 'test-bot-token';
const USERNAME = 'test_bot';

describe('isTelegramEnabled', () => {
  const origToken = process.env.TELEGRAM_BOT_TOKEN;
  const origUser = process.env.TELEGRAM_BOT_USERNAME;

  afterEach(() => {
    if (origToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = origToken;
    if (origUser === undefined) delete process.env.TELEGRAM_BOT_USERNAME;
    else process.env.TELEGRAM_BOT_USERNAME = origUser;
  });

  it('возвращает true, когда оба env выставлены', () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_BOT_USERNAME = USERNAME;
    expect(isTelegramEnabled()).toBe(true);
  });

  it('возвращает false, когда TOKEN отсутствует', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_USERNAME = USERNAME;
    expect(isTelegramEnabled()).toBe(false);
  });

  it('возвращает false, когда USERNAME отсутствует', () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    delete process.env.TELEGRAM_BOT_USERNAME;
    expect(isTelegramEnabled()).toBe(false);
  });

  it('возвращает false, когда оба env отсутствуют', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_USERNAME;
    expect(isTelegramEnabled()).toBe(false);
  });

  it('возвращает false для пустой строки TOKEN', () => {
    process.env.TELEGRAM_BOT_TOKEN = '   ';
    process.env.TELEGRAM_BOT_USERNAME = USERNAME;
    expect(isTelegramEnabled()).toBe(false);
  });

  it('возвращает false для пустой строки USERNAME', () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_BOT_USERNAME = '   ';
    expect(isTelegramEnabled()).toBe(false);
  });
});

describe('botDeepLink', () => {
  const origUser = process.env.TELEGRAM_BOT_USERNAME;

  afterEach(() => {
    if (origUser === undefined) delete process.env.TELEGRAM_BOT_USERNAME;
    else process.env.TELEGRAM_BOT_USERNAME = origUser;
  });

  it('формирует корректную deep-link ссылку', () => {
    process.env.TELEGRAM_BOT_USERNAME = USERNAME;
    expect(botDeepLink('abc123')).toBe(`https://t.me/${USERNAME}?start=abc123`);
  });
});

describe('sendTelegramMessage', () => {
  const origToken = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (origToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = origToken;
  });

  it('возвращает {ok:true} при успешном ответе 2xx', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const result = await sendTelegramMessage('123456', 'hello');
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string) as { chat_id: string; text: string };
    expect(body).toEqual({ chat_id: '123456', text: 'hello' });
  });

  it('возвращает {ok:false} при не-2xx ответе', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    const result = await sendTelegramMessage('123456', 'hello');
    expect(result).toEqual({ ok: false });
  });

  it('возвращает {ok:false} при network error (не бросает наружу)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network fail'));
    await expect(sendTelegramMessage('123456', 'hello')).resolves.toEqual({ ok: false });
  });

  it('возвращает {ok:false} при AbortError (таймаут)', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(sendTelegramMessage('123456', 'hello')).resolves.toEqual({ ok: false });
  });
});
