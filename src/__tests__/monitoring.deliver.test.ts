import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createNotificationMock, deliverToUserMock } = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  deliverToUserMock: vi.fn()
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: createNotificationMock,
  deliverNotificationToUser: deliverToUserMock
}));

import { deliverAlert } from '@/lib/monitoring/deliver';

function fakePrisma(adminIds: string[]) {
  return {
    user: { findMany: vi.fn().mockResolvedValue(adminIds.map((id) => ({ id }))) }
  } as never;
}

beforeEach(() => {
  createNotificationMock.mockReset().mockResolvedValue({ id: 'alert-notif' });
  deliverToUserMock.mockReset().mockResolvedValue(undefined);
  delete process.env.ALERT_TELEGRAM_BOT_TOKEN;
  delete process.env.ALERT_TELEGRAM_CHAT_ID;
  vi.unstubAllGlobals();
});

describe('deliverAlert', () => {
  it('writes in-app + email for every admin', async () => {
    await deliverAlert(fakePrisma(['a1', 'a2']), { kind: 'fire', message: 'boom' });
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(deliverToUserMock).toHaveBeenCalledTimes(2);
    // Ops-алерты — только email: персональный Telegram дублировал бы общий алерт-чат.
    expect(deliverToUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'a1', channels: ['email'] })
    );
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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'boom' })
    ).resolves.toBeUndefined();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[alerts] telegram failed', expect.anything());
    errorSpy.mockRestore();
  });

  it('uses resolve kind with ✅ prefix and "Восстановление" title', async () => {
    await deliverAlert(fakePrisma(['a1']), { kind: 'resolve', message: 'all good' });
    expect(createNotificationMock.mock.calls[0][0]).toMatchObject({
      title: 'Восстановление',
      body: expect.stringContaining('✅')
    });
  });

  it('uses custom type when provided', async () => {
    await deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'x', type: 'custom_alert' });
    expect(createNotificationMock.mock.calls[0][0]).toMatchObject({ type: 'custom_alert' });
  });

  it('logs and continues when createNotification throws', async () => {
    createNotificationMock.mockRejectedValue(new Error('db error'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'boom' })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[alerts] in-app notification failed',
      expect.anything()
    );
    // Email should still be called despite in-app failure
    expect(deliverToUserMock).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('logs and continues when deliverNotificationToUser throws', async () => {
    deliverToUserMock.mockRejectedValue(new Error('smtp error'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'boom' })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[alerts] email failed',
      expect.anything()
    );
    errorSpy.mockRestore();
  });

  it('handles zero admins without error', async () => {
    await expect(
      deliverAlert(fakePrisma([]), { kind: 'fire', message: 'boom' })
    ).resolves.toBeUndefined();
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(deliverToUserMock).not.toHaveBeenCalled();
  });
});
