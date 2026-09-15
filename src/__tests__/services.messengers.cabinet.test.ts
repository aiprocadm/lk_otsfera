import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  createNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/notifications/core', () => ({
  createNotification: m.createNotification,
  deliverNotificationToUser: m.deliverNotificationToUser,
}));
vi.mock('@/lib/logging', () => ({ log: { warn: m.warn, info: vi.fn(), error: vi.fn() } }));

import { deliverToCabinet } from '@/lib/services/messengers/cabinet';

/**
 * Кабинет как канал переписки (`У-212`, этап 3 PR-7).
 *
 * Вопрос из кабинета — такая же реплика, как сообщение в мессенджере, только
 * «транспорт» внутренний: ответ кладётся уведомлением. Поэтому у диалога
 * канала `cabinet` вместо адреса — идентификатор пользователя, и главных
 * проверок две: ответ действительно доходит до человека, а неизвестный
 * адресат получает понятный отказ, а не молчаливое «отправлено».
 */
beforeEach(() => {
  vi.clearAllMocks();
  m.createNotification.mockResolvedValue({ id: 'n-1' });
  m.deliverNotificationToUser.mockResolvedValue({});
});

const dialog = { id: 'd1', peerRef: 'u-7', userId: 'u-7' };

describe('deliverToCabinet — доставка ответа', () => {
  it('заводит уведомление и доставляет его тому же человеку', async () => {
    await expect(deliverToCabinet(dialog, 'ответ менеджера')).resolves.toEqual({ ok: true });
    expect(m.createNotification).toHaveBeenCalledWith({
      userId: 'u-7',
      type: 'inbound_reply',
      title: 'Ответ на ваше обращение',
      body: 'ответ менеджера',
    });
    expect(m.deliverNotificationToUser).toHaveBeenCalledWith({
      userId: 'u-7',
      title: 'Ответ на ваше обращение',
      body: 'ответ менеджера',
      type: 'inbound_reply',
      // Ключ от записи уведомления: без него повторная доставка того же ответа
      // пришла бы человеку дважды (в кабинет и в бота).
      dedupKey: 'n-1',
    });
  });

  it('связь с пользователем важнее ключа диалога', async () => {
    // `peerRef` — тот же идентификатор строкой, но связь проставляет приём
    // вопроса, и она надёжнее: по ней ответ попадёт туда, куда надо.
    await deliverToCabinet({ id: 'd1', peerRef: 'странный-ключ', userId: 'u-9' }, 'ответ');
    expect(m.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-9' }));
  });

  it('без связи адресатом становится ключ диалога', async () => {
    await deliverToCabinet({ id: 'd1', peerRef: 'u-7', userId: null }, 'ответ');
    expect(m.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-7' }));
  });
});

describe('deliverToCabinet — краевые случаи', () => {
  it('неизвестный адресат → понятный отказ, ничего не создаётся', async () => {
    // «Отправлено» в такой ситуации было бы враньём: ответ уходит в никуда.
    await expect(
      deliverToCabinet({ id: 'd1', peerRef: '', userId: null }, 'ответ')
    ).resolves.toEqual({ ok: false, error: 'Неизвестно, кому в кабинет отвечать' });
    expect(m.createNotification).not.toHaveBeenCalled();
    expect(m.deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('сбой записи уведомления не бросается наружу, а возвращает причину', async () => {
    // §3 «degrade gracefully»: исключение здесь уронило бы отправку целиком, и
    // сообщение не попало бы даже в историю диалога.
    m.createNotification.mockRejectedValue(new Error('база недоступна'));
    await expect(deliverToCabinet(dialog, 'ответ')).resolves.toEqual({
      ok: false,
      error: 'Не удалось положить ответ в кабинет',
    });
    expect(m.warn).toHaveBeenCalledWith(
      '[messengers/cabinet] доставка ответа в кабинет не удалась',
      expect.objectContaining({ dialogId: 'd1', error: 'база недоступна' })
    );
  });

  it('сбой самой доставки — так же: причина вместо исключения', async () => {
    m.deliverNotificationToUser.mockRejectedValue(new Error('транспорт лёг'));
    await expect(deliverToCabinet(dialog, 'ответ')).resolves.toEqual({
      ok: false,
      error: 'Не удалось положить ответ в кабинет',
    });
  });

  it('брошено не-исключение — в журнал всё равно попадает текст, а не «[object]»', async () => {
    m.createNotification.mockRejectedValue('строковый сбой');
    await deliverToCabinet(dialog, 'ответ');
    expect(m.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: 'строковый сбой' })
    );
  });
});
