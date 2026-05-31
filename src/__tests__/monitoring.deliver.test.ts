import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createNotificationMock, triggerEmailMock } = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  triggerEmailMock: vi.fn()
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: createNotificationMock,
  triggerNotificationEmail: triggerEmailMock
}));

import { deliverAlert } from '@/lib/monitoring/deliver';

function fakePrisma(adminIds: string[]) {
  return {
    user: { findMany: vi.fn().mockResolvedValue(adminIds.map((id) => ({ id }))) }
  } as never;
}

beforeEach(() => {
  createNotificationMock.mockReset().mockResolvedValue(undefined);
  triggerEmailMock.mockReset().mockResolvedValue(undefined);
  delete process.env.ALERT_TELEGRAM_BOT_TOKEN;
  delete process.env.ALERT_TELEGRAM_CHAT_ID;
  vi.unstubAllGlobals();
});

describe('deliverAlert', () => {
  it('writes in-app + email for every admin', async () => {
    await deliverAlert(fakePrisma(['a1', 'a2']), { kind: 'fire', message: 'boom' });
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(triggerEmailMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock.mock.calls[0][0]).toMatchObject({ userId: 'a1', type: 'ops_alert' });
  });

  it('posts to Telegram when configured', async () => {
    process.env.ALERT_TELEGRAM_BOT_TOKEN = 'bot123';
    process.env.ALERT_TELEGRAM_CHAT_ID = '42';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'boom' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://api.telegram.org/botbot123/sendMessage');
  });

  it('skips Telegram when not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'boom' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isolates channels — a Telegram failure does not block in-app/email', async () => {
    process.env.ALERT_TELEGRAM_BOT_TOKEN = 'bot123';
    process.env.ALERT_TELEGRAM_CHAT_ID = '42';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('tg down')));
    await expect(
      deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'boom' })
    ).resolves.toBeUndefined();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });
});
