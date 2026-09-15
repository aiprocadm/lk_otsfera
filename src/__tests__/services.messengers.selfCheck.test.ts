import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({
  isMessengerAvailable: vi.fn(),
  sendToMessenger: vi.fn(),
  cachedIntegrationSetting: vi.fn(),
}));
vi.mock('@/lib/services/messengers/availability', () => ({
  isMessengerAvailable: m.isMessengerAvailable,
}));
vi.mock('@/lib/services/messengers/transport', () => ({ sendToMessenger: m.sendToMessenger }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({
  cachedIntegrationSetting: m.cachedIntegrationSetting,
}));

import { checkWebhook, sendSelfTestMessage } from '@/lib/services/messengers/selfCheck';

/**
 * Две проверки канала «своими руками» (`У-213`, этап 3 PR-7).
 *
 * Они смотрят в разные стороны: тестовое сообщение проверяет путь НАРУЖУ,
 * проверка вебхука — путь ВНУТРЬ. Настроенный бот, который не получает
 * входящих, выглядит совершенно исправным до первого потерянного обращения
 * клиента, и без второй проверки об этом узнают от клиента, а не от системы.
 */
const findUnique = vi.fn();
const prisma = { user: { findUnique } } as unknown as PrismaClient;
const admin = { sub: 'a1', role: 'admin', companyId: null } as unknown as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
  m.isMessengerAvailable.mockReturnValue(true);
  m.sendToMessenger.mockResolvedValue({ ok: true });
  m.cachedIntegrationSetting.mockReturnValue('123456:AAH_secret');
  findUnique.mockResolvedValue({
    telegramChatId: 'tg-777',
    maxChatId: 'max-888',
    whatsappPhone: '79990000000',
  });
});

describe('sendSelfTestMessage — адрес берётся с сервера', () => {
  it('пишет в мессенджер, привязанный к учётной записи самого проверяющего', async () => {
    const r = await sendSelfTestMessage(prisma, admin, 'telegram');
    // Ключевая проверка: адресата НЕ вводят в форме. Иначе кнопкой «проверить»
    // можно было бы отправить сообщение кому угодно от имени компании.
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'a1' },
      select: { telegramChatId: true, maxChatId: true, whatsappPhone: true },
    });
    expect(m.sendToMessenger).toHaveBeenCalledWith('telegram', 'tg-777', expect.any(String));
    expect(r).toEqual({ ok: true, detail: 'Сообщение отправлено — проверьте мессенджер.' });
  });

  it.each([
    ['max', 'max-888'],
    ['whatsapp', '79990000000'],
  ] as const)('канал %s берёт свой адрес из профиля', async (channel, peer) => {
    await sendSelfTestMessage(prisma, admin, channel);
    expect(m.sendToMessenger).toHaveBeenCalledWith(channel, peer, expect.any(String));
  });

  it('в тексте проверки написано, что это проверка — получатель не пугается', async () => {
    await sendSelfTestMessage(prisma, admin, 'telegram');
    expect(m.sendToMessenger.mock.calls[0][2]).toContain('Проверка связи');
  });
});

describe('sendSelfTestMessage — когда проверять нечем', () => {
  it('канал не подключён → channel_unavailable, база не спрашивается', async () => {
    m.isMessengerAvailable.mockReturnValue(false);
    await expect(sendSelfTestMessage(prisma, admin, 'telegram')).resolves.toEqual({
      ok: false,
      error: 'channel_unavailable',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('мессенджер не привязан → not_linked, а не «ошибка канала»', async () => {
    // Это разные беды: канал в порядке, просто адресата нет. Сваливать их в
    // одну подпись значит отправить администратора чинить исправное.
    findUnique.mockResolvedValue({ telegramChatId: null, maxChatId: null, whatsappPhone: null });
    await expect(sendSelfTestMessage(prisma, admin, 'telegram')).resolves.toEqual({
      ok: false,
      error: 'not_linked',
    });
    expect(m.sendToMessenger).not.toHaveBeenCalled();
  });

  it('учётной записи не нашлось → тоже not_linked, без падения', async () => {
    findUnique.mockResolvedValue(null);
    await expect(sendSelfTestMessage(prisma, admin, 'max')).resolves.toEqual({
      ok: false,
      error: 'not_linked',
    });
  });

  it('отправка не удалась → причина провайдера доезжает до экрана', async () => {
    m.sendToMessenger.mockResolvedValue({ ok: false, error: 'Telegram отклонил отправку (403)' });
    await expect(sendSelfTestMessage(prisma, admin, 'telegram')).resolves.toEqual({
      ok: false,
      error: 'failed',
      reason: 'Telegram отклонил отправку (403)',
    });
  });

  it('отправка не удалась без причины → просто failed, без пустой строки', async () => {
    m.sendToMessenger.mockResolvedValue({ ok: false });
    await expect(sendSelfTestMessage(prisma, admin, 'telegram')).resolves.toEqual({
      ok: false,
      error: 'failed',
    });
  });
});

describe('checkWebhook — путь внутрь', () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => vi.unstubAllGlobals());

  const reply = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: () => Promise.resolve(body),
  });

  it.each(['max', 'whatsapp'] as const)(
    'у канала %s такой проверки нет — честный отказ',
    async (channel) => {
      // Выдумывать чужой контракт хуже, чем отказать: «проверка прошла» на
      // несуществующей ручке — прямое враньё администратору.
      await expect(checkWebhook(channel)).resolves.toEqual({
        ok: false,
        error: 'channel_unavailable',
        reason: 'Проверка вебхука есть только у Telegram',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('без ключа бота проверять нечего', async () => {
    m.cachedIntegrationSetting.mockReturnValue(null);
    await expect(checkWebhook('telegram')).resolves.toEqual({
      ok: false,
      error: 'channel_unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('вебхук зарегистрирован → ок, но САМ АДРЕС наружу не печатается', async () => {
    fetchMock.mockResolvedValue(
      reply({ result: { url: 'https://lk.example.ru/api/inbound/telegram/секретный-путь' } })
    );
    const r = await checkWebhook('telegram');
    expect(r).toEqual({
      ok: true,
      detail: 'Вебхук зарегистрирован. Необработанных обновлений: 0.',
    });
    // В адресе приёма стоит наш секретный путь — показывать его на экране
    // настроек значило бы раздать всем способ подделать входящее сообщение.
    expect(JSON.stringify(r)).not.toContain('секретный-путь');
  });

  it('копящиеся обновления видны числом — это и есть признак обрыва', async () => {
    fetchMock.mockResolvedValue(
      reply({ result: { url: 'https://x/y', pending_update_count: 42 } })
    );
    const r = await checkWebhook('telegram');
    expect(r.ok && r.detail).toContain('Необработанных обновлений: 42');
  });

  it('последняя ошибка у Telegram доезжает и тоже чистится от секретов', async () => {
    fetchMock.mockResolvedValue(
      reply({
        result: {
          url: 'https://x/y',
          pending_update_count: 1,
          last_error_message: 'connect fail https://api.telegram.org/bot99:ZZZ/sendMessage',
        },
      })
    );
    const r = await checkWebhook('telegram');
    expect(r.ok && r.detail).toContain('Последняя ошибка у Telegram');
    expect(JSON.stringify(r)).not.toContain('ZZZ');
  });

  it('вебхук не зарегистрирован → прямая формулировка «нам ничего не шлют»', async () => {
    fetchMock.mockResolvedValue(reply({ result: { url: '' } }));
    await expect(checkWebhook('telegram')).resolves.toEqual({
      ok: false,
      error: 'failed',
      reason: 'Вебхук не зарегистрирован — Telegram нам ничего не шлёт',
    });
  });

  it('ответ без поля result считается «не зарегистрирован», а не падением', async () => {
    fetchMock.mockResolvedValue(reply({}));
    const r = await checkWebhook('telegram');
    expect(r.ok).toBe(false);
  });

  it('нечисловой счётчик обновлений не ломает подпись', async () => {
    fetchMock.mockResolvedValue(
      reply({ result: { url: 'https://x/y', pending_update_count: 'нет' } })
    );
    const r = await checkWebhook('telegram');
    expect(r.ok && r.detail).toContain('Необработанных обновлений: 0');
  });

  it('Telegram ответил кодом ошибки → код виден', async () => {
    fetchMock.mockResolvedValue(reply({}, false, 502));
    await expect(checkWebhook('telegram')).resolves.toEqual({
      ok: false,
      error: 'failed',
      reason: 'Telegram ответил ошибкой 502',
    });
  });

  it('сеть не ответила → проверка не падает, а объясняет', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(checkWebhook('telegram')).resolves.toEqual({
      ok: false,
      error: 'failed',
      reason: 'Telegram недоступен: сеть не ответила',
    });
  });

  it('запрос идёт с ограничением по времени — проверка не висит вечно', async () => {
    fetchMock.mockResolvedValue(reply({ result: { url: 'https://x/y' } }));
    await checkWebhook('telegram');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
