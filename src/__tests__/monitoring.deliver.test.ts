import { describe, it, expect, beforeEach, vi } from 'vitest';

const { recordNotificationMock, deliverToUserMock } = vi.hoisted(() => ({
  recordNotificationMock: vi.fn(),
  deliverToUserMock: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({
  recordNotification: recordNotificationMock,
  deliverNotificationToUser: deliverToUserMock,
}));

import { deliverAlert } from '@/lib/monitoring/deliver';

function fakePrisma(adminIds: string[]) {
  return {
    user: { findMany: vi.fn().mockResolvedValue(adminIds.map((id) => ({ id }))) },
  } as never;
}

beforeEach(() => {
  recordNotificationMock
    .mockReset()
    .mockResolvedValue({ row: { id: 'alert-notif' }, deduped: false });
  deliverToUserMock.mockReset().mockResolvedValue(undefined);
  delete process.env.ALERT_TELEGRAM_BOT_TOKEN;
  delete process.env.ALERT_TELEGRAM_CHAT_ID;
  vi.unstubAllGlobals();
});

describe('deliverAlert', () => {
  it('writes in-app + email for every admin', async () => {
    await deliverAlert(fakePrisma(['a1', 'a2']), { kind: 'fire', message: 'boom' });
    expect(recordNotificationMock).toHaveBeenCalledTimes(2);
    expect(deliverToUserMock).toHaveBeenCalledTimes(2);
    // Ops-алерты — только email: персональный Telegram дублировал бы общий алерт-чат.
    expect(deliverToUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'a1', channels: ['email'] })
    );
    expect(recordNotificationMock.mock.calls[0][1]).toMatchObject({
      userId: 'a1',
      type: 'ops_alert',
    });
    // У оповещения нет ключа объекта — дедупа нет: «сработало» и
    // «восстановлено» одной проверки за час — два разных письма.
    expect(recordNotificationMock.mock.calls[0][1].entityId).toBeNull();
    expect(recordNotificationMock.mock.calls[0][1]).not.toHaveProperty('meta');
  });

  it('повтор за час (deduped: true) — письмо этому администратору не шлётся', async () => {
    recordNotificationMock
      .mockResolvedValueOnce({ row: { id: 'alert-notif' }, deduped: true })
      .mockResolvedValueOnce({ row: { id: 'alert-notif-2' }, deduped: false });
    await deliverAlert(fakePrisma(['a1', 'a2']), { kind: 'fire', message: 'boom' });
    expect(recordNotificationMock).toHaveBeenCalledTimes(2);
    expect(deliverToUserMock).toHaveBeenCalledTimes(1);
    expect(deliverToUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'a2', dedupKey: 'alert-notif-2' })
    );
  });

  it('posts to Telegram when configured', async () => {
    process.env.ALERT_TELEGRAM_BOT_TOKEN = 'bot123';
    process.env.ALERT_TELEGRAM_CHAT_ID = '42';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'boom' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'https://api.telegram.org/botbot123/sendMessage'
    );
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
    expect(recordNotificationMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[alerts] telegram failed', expect.anything());
    errorSpy.mockRestore();
  });

  it('uses resolve kind with ✅ prefix and "Восстановление" title', async () => {
    await deliverAlert(fakePrisma(['a1']), { kind: 'resolve', message: 'all good' });
    expect(recordNotificationMock.mock.calls[0][1]).toMatchObject({
      title: 'Восстановление',
      body: expect.stringContaining('✅'),
    });
  });

  it('uses custom type when provided', async () => {
    await deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'x', type: 'custom_alert' });
    expect(recordNotificationMock.mock.calls[0][1]).toMatchObject({ type: 'custom_alert' });
  });

  it('logs and continues when recordNotification throws', async () => {
    recordNotificationMock.mockRejectedValue(new Error('db error'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      deliverAlert(fakePrisma(['a1']), { kind: 'fire', message: 'boom' })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('[alerts] in-app notification failed', expect.anything());
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
    expect(errorSpy).toHaveBeenCalledWith('[alerts] email failed', expect.anything());
    errorSpy.mockRestore();
  });

  it('handles zero admins without error', async () => {
    await expect(
      deliverAlert(fakePrisma([]), { kind: 'fire', message: 'boom' })
    ).resolves.toBeUndefined();
    expect(recordNotificationMock).not.toHaveBeenCalled();
    expect(deliverToUserMock).not.toHaveBeenCalled();
  });
});
