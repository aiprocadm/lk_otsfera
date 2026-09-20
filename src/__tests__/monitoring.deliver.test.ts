import { describe, it, expect, beforeEach, vi } from 'vitest';

const { recordNotificationMock, deliverToUserMock, cachedIntegrationSetting } = vi.hoisted(() => ({
  recordNotificationMock: vi.fn(),
  deliverToUserMock: vi.fn(),
  cachedIntegrationSetting: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({
  recordNotification: recordNotificationMock,
  deliverNotificationToUser: deliverToUserMock,
}));
// `У-126`: адресаты и реквизиты бота задаются в форме «Здоровье системы →
// Оповещения». По умолчанию настройки нет — тогда действует прежнее поведение.
vi.mock('@/lib/config/integrationSettingsCache', () => ({ cachedIntegrationSetting }));

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
  cachedIntegrationSetting.mockReset().mockReturnValue(undefined);
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

/**
 * Кому уходят ops-оповещения (`У-126`).
 *
 * Умолчание — всем активным администраторам, как было до появления формы.
 * Заданный список адресов его заменяет, и это **замена, а не добавление**:
 * иначе выключить рассылку администратору было бы нечем.
 *
 * Адрес без активной учётной записи молча пропускается: слать почту «в никуда»
 * бессмысленно, а оповещение об инфраструктуре не должно падать из-за опечатки
 * в списке — как раз тогда, когда что-то уже сломалось.
 */
describe('deliverAlert — адресаты из настройки', () => {
  /** База, запоминающая условие выборки получателей. */
  function db(ids: string[]) {
    // Параметр объявлен типом функции: у `vi.fn` без него кортеж аргументов
    // пустой, и обращение `calls[0][0]` не проходит проверку типов.
    const findMany = vi.fn<(args?: { where?: unknown }) => Promise<Array<{ id: string }>>>(
      async () => ids.map((id) => ({ id }))
    );
    return { prisma: { user: { findMany } } as never, findMany };
  }

  /**
   * Настройка отвечает ТОЛЬКО на свой ключ.
   *
   * Общий `mockReturnValue` возвращал бы то же значение и на
   * `alerts.telegramBotToken` — бот «оказался бы настроен», и тест ушёл бы в
   * настоящую сеть к api.telegram.org. Один раз так и вышло: прогон занял две
   * секунды и упёрся в таймаут соединения.
   */
  const setting = (values: Record<string, string>) =>
    cachedIntegrationSetting.mockImplementation((key: string) => values[key]);

  it('настройки нет — пишем всем активным администраторам', async () => {
    const { prisma, findMany } = db(['a1']);

    await deliverAlert(prisma, { kind: 'fire', message: 'boom' });

    expect(findMany).toHaveBeenCalledWith({
      where: { role: 'admin', isActive: true },
      select: { id: true },
    });
  });

  it('список задан — ищем этих людей по почте, без учёта регистра', async () => {
    setting({ 'alerts.emailRecipients': ' Ops@X.RU , dev@x.ru ' });
    const { prisma, findMany } = db(['u1', 'u2']);

    await deliverAlert(prisma, { kind: 'fire', message: 'boom' });

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, email: { in: ['ops@x.ru', 'dev@x.ru'], mode: 'insensitive' } },
      select: { id: true },
    });
    // Роль не проверяется: оповещения об инфраструктуре могут идти дежурному,
    // который администратором в системе не является.
    expect(recordNotificationMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['запятые', 'a@x.ru,b@x.ru'],
    ['точки с запятой', 'a@x.ru;b@x.ru'],
    ['переводы строк', 'a@x.ru\nb@x.ru'],
    ['всё вперемешку', ' a@x.ru ;, \n b@x.ru '],
  ])('список через %s разбирается одинаково', async (_name, raw) => {
    setting({ 'alerts.emailRecipients': raw });
    const { prisma, findMany } = db(['u1']);

    await deliverAlert(prisma, { kind: 'fire', message: 'boom' });

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { isActive: true, email: { in: ['a@x.ru', 'b@x.ru'], mode: 'insensitive' } },
    });
  });

  it('список из одних разделителей равен «списка нет»', async () => {
    setting({ 'alerts.emailRecipients': ' , ; ' });
    const { prisma, findMany } = db(['a1']);

    await deliverAlert(prisma, { kind: 'fire', message: 'boom' });

    // Иначе выборка ушла бы с пустым `in: []` и не нашла НИКОГО — оповещения
    // молча перестали бы приходить.
    expect(findMany).toHaveBeenCalledWith({
      where: { role: 'admin', isActive: true },
      select: { id: true },
    });
  });

  it('ни один адрес не совпал — никого не дёргаем, но и не падаем', async () => {
    setting({ 'alerts.emailRecipients': 'опечатка@x.ru' });
    const { prisma } = db([]);

    await expect(deliverAlert(prisma, { kind: 'fire', message: 'boom' })).resolves.toBeUndefined();

    expect(recordNotificationMock).not.toHaveBeenCalled();
  });

  it('реквизиты бота берутся из настройки, а не только из переменных сервера', async () => {
    setting({ 'alerts.telegramBotToken': 'тайна', 'alerts.telegramChatId': '-100' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await deliverAlert(db(['a1']).prisma, { kind: 'fire', message: 'boom' });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/botтайна/sendMessage');
  });
});
