import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Клиент Telegram: отправка текста и файла, ссылка на присланный файл
 * (`У-204`, `У-213`).
 *
 * Два правила, ради которых файл и написан. **Сбой не бросается наружу**: он
 * превращается в «не доставлено» в истории диалога, иначе одно упавшее
 * сообщение роняло бы всю обработку. И **причину отказа Telegram пишет
 * словами** («бот заблокирован пользователем») — её нужно донести до
 * сотрудника, а не заменять номером ошибки.
 *
 * Отдельно: ссылка на файл содержит токен бота и наружу не отдаётся никогда —
 * только в серверное скачивание.
 */
const { cachedIntegrationSetting } = vi.hoisted(() => ({
  cachedIntegrationSetting: vi.fn(),
}));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ cachedIntegrationSetting }));

import {
  isTelegramEnabled,
  botDeepLink,
  sendTelegramMessage,
  sendTelegramDocument,
  getTelegramFileUrl,
} from '@/lib/telegram/client';

/** Настройки бота: токен и имя. */
function settings(over: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    'telegram.botToken': 'ТОКЕН',
    'telegram.botUsername': 'otsfera_bot',
    ...over,
  };
  cachedIntegrationSetting.mockImplementation((key: string) => values[key]);
}

beforeEach(() => {
  vi.clearAllMocks();
  settings();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  );
});

describe('isTelegramEnabled / botDeepLink', () => {
  it('бот считается подключённым только когда есть и токен, и имя', () => {
    expect(isTelegramEnabled()).toBe(true);

    settings({ 'telegram.botToken': undefined });
    expect(isTelegramEnabled()).toBe(false);

    settings({ 'telegram.botUsername': undefined });
    expect(isTelegramEnabled()).toBe(false);
  });

  it('ссылка на бота собирается с кодом привязки', () => {
    expect(botDeepLink('abc123')).toBe('https://t.me/otsfera_bot?start=abc123');
  });

  it('без имени бота ссылка не ломается, а собирается пустой', () => {
    settings({ 'telegram.botUsername': undefined });

    expect(botDeepLink('abc')).toBe('https://t.me/?start=abc');
  });
});

describe('sendTelegramMessage — текст', () => {
  it('бот не настроен — честный отказ, в сеть не ходим', async () => {
    settings({ 'telegram.botToken': undefined });

    const res = await sendTelegramMessage('42', 'привет');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('Telegram');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('успех — просто «отправлено»', async () => {
    const res = await sendTelegramMessage('42', 'привет');

    expect(res).toEqual({ ok: true });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/botТОКЕН/sendMessage');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      chat_id: '42',
      text: 'привет',
    });
  });

  it('причина отказа словами доходит до сотрудника', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ description: 'bot was blocked by the user' }),
      }))
    );

    const res = await sendTelegramMessage('42', 'привет');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('bot was blocked by the user');
  });

  it('пустое пояснение не подставляется — остаётся общий текст с кодом', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ description: '   ' }) }))
    );

    const res = await sendTelegramMessage('42', 'привет');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('500');
  });

  it('тело ответа не JSON — отказ всё равно осмысленный', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('не json');
        },
      }))
    );

    const res = await sendTelegramMessage('42', 'привет');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('502');
  });

  it('сеть не ответила — «не доставлено», а не исключение наружу', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('сеть');
      })
    );

    const res = await sendTelegramMessage('42', 'привет');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('Telegram');
  });
});

describe('sendTelegramDocument — файл', () => {
  it('бот не настроен — отказ без похода в сеть', async () => {
    settings({ 'telegram.botToken': undefined });

    await expect(
      sendTelegramDocument('42', {
        name: 'a.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('x'),
      })
    ).resolves.toEqual({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('картинка уходит как фото — клиент видит её прямо в переписке', async () => {
    await sendTelegramDocument(
      '42',
      { name: 'скан.png', mimeType: 'image/png', buffer: Buffer.from('x') },
      'подпись'
    );

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/sendPhoto');
    const form = (init as RequestInit).body as FormData;
    expect(form.get('chat_id')).toBe('42');
    expect(form.get('caption')).toBe('подпись');
    expect(form.get('photo')).toBeInstanceOf(Blob);
  });

  it('остальные файлы уходят документом; без подписи поле не добавляется', async () => {
    await sendTelegramDocument('42', {
      name: 'акт.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('x'),
    });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/sendDocument');
    const form = (init as RequestInit).body as FormData;
    expect(form.get('caption')).toBeNull();
    expect(form.get('document')).toBeInstanceOf(Blob);
  });

  it('файл без типа отправляется как двоичный, а не ломает запрос', async () => {
    await sendTelegramDocument('42', { name: 'без-типа', mimeType: '', buffer: Buffer.from('x') });

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const blob = ((init as RequestInit).body as FormData).get('document') as Blob;
    expect(blob.type).toBe('application/octet-stream');
  });

  it('отказ провайдера — «не доставлено»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 413 }))
    );

    await expect(
      sendTelegramDocument('42', {
        name: 'a.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('x'),
      })
    ).resolves.toEqual({ ok: false });
  });

  it('сетевой сбой не бросается наружу', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('сеть');
      })
    );

    await expect(
      sendTelegramDocument('42', {
        name: 'a.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('x'),
      })
    ).resolves.toEqual({ ok: false });
  });
});

describe('getTelegramFileUrl — ссылка на присланный файл', () => {
  it('бот не настроен — ссылки нет', async () => {
    settings({ 'telegram.botToken': undefined });

    await expect(getTelegramFileUrl('f1')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ссылка собирается из пути, который вернул провайдер', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { file_path: 'documents/file_1.pdf' } }),
      }))
    );

    const url = await getTelegramFileUrl('f 1');

    expect(url).toBe('https://api.telegram.org/file/botТОКЕН/documents/file_1.pdf');
    const [called] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    // Идентификатор файла кодируется — пробел не должен ломать адрес.
    expect(String(called)).toContain('file_id=f%201');
  });

  it.each([
    ['отказ провайдера', { ok: false, status: 404, json: async () => ({}) }],
    ['ответ «не ок»', { ok: true, status: 200, json: async () => ({ ok: false }) }],
    ['ответ без пути', { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }],
  ])('%s — ссылки нет', async (_name, response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );

    await expect(getTelegramFileUrl('f1')).resolves.toBeNull();
  });

  it('сетевой сбой — ссылки нет, исключение наружу не летит', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('сеть');
      })
    );

    await expect(getTelegramFileUrl('f1')).resolves.toBeNull();
  });
});
