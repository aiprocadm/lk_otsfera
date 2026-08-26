import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- hoisted mocks ----
const { linkByCodeMock, sendTelegramMessageMock, prismaMock, recordWebhookEvent } = vi.hoisted(
  () => ({
    linkByCodeMock: vi.fn(),
    sendTelegramMessageMock: vi.fn(),
    prismaMock: { integrationSetting: { findUnique: async () => null } },
    recordWebhookEvent: vi.fn().mockResolvedValue(undefined),
  })
);

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/telegram/link', () => ({ linkByCode: linkByCodeMock }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: sendTelegramMessageMock }));
vi.mock('@/lib/services/admin/webhookDiagnostics', () => ({ recordWebhookEvent }));

import { POST } from '@/app/api/integrations/telegram/webhook/route';

const WEBHOOK_SECRET = 'test-secret-token-32-chars-long!!';

function makeRequest(body: unknown, secret?: string): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (secret !== undefined) {
    headers['x-telegram-bot-api-secret-token'] = secret;
  }
  return new Request('https://app.local/api/integrations/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/integrations/telegram/webhook — auth', () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    vi.clearAllMocks();
    sendTelegramMessageMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it('возвращает 401, если заголовок отсутствует', async () => {
    const req = makeRequest({ update_id: 1 });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('возвращает 401, если секрет неверный', async () => {
    const req = makeRequest({ update_id: 1 }, 'wrong-secret');
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('возвращает 401, если TELEGRAM_WEBHOOK_SECRET не задан', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const req = makeRequest({ update_id: 1 }, WEBHOOK_SECRET);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/integrations/telegram/webhook — /start handling', () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    vi.clearAllMocks();
    sendTelegramMessageMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it('вызывает linkByCode при /start <code> и возвращает 200', async () => {
    linkByCodeMock.mockResolvedValue({ ok: true });
    const update = {
      update_id: 100,
      message: {
        text: '/start abc123',
        chat: { id: 987654321 },
      },
    };
    const res = await POST(makeRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect(linkByCodeMock).toHaveBeenCalledWith(prismaMock, {
      code: 'abc123',
      chatId: '987654321',
    });
  });

  it('шлёт "привязано" в telegram при успешной привязке', async () => {
    linkByCodeMock.mockResolvedValue({ ok: true });
    const update = {
      update_id: 101,
      message: { text: '/start mycode', chat: { id: 111 } },
    };
    await POST(makeRequest(update, WEBHOOK_SECRET));
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      '111',
      expect.stringContaining('привязан')
    );
  });

  it('шлёт "недействителен" в telegram при ошибке invalid_code', async () => {
    linkByCodeMock.mockResolvedValue({ ok: false, error: 'invalid_code' });
    const update = {
      update_id: 102,
      message: { text: '/start badcode', chat: { id: 222 } },
    };
    await POST(makeRequest(update, WEBHOOK_SECRET));
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      '222',
      expect.stringMatching(/недействителен|истёк/i)
    );
  });

  it('не логирует код привязки', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    linkByCodeMock.mockResolvedValue({ ok: true });
    const sensitiveCode = 'super-secret-code-xyz';
    const update = {
      update_id: 103,
      message: { text: `/start ${sensitiveCode}`, chat: { id: 333 } },
    };
    await POST(makeRequest(update, WEBHOOK_SECRET));
    const allLogCalls = [...consoleLogSpy.mock.calls, ...consoleInfoSpy.mock.calls].map((args) =>
      JSON.stringify(args)
    );
    for (const call of allLogCalls) {
      expect(call).not.toContain(sensitiveCode);
    }
    consoleLogSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  it('ошибка отправки ответа в telegram не превращается в 500 (best-effort, warn-лог)', async () => {
    linkByCodeMock.mockResolvedValue({ ok: true });
    sendTelegramMessageMock.mockRejectedValue(new Error('tg api down'));
    const update = {
      update_id: 105,
      message: { text: '/start okcode', chat: { id: 777 } },
    };
    const res = await POST(makeRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
  });

  it('не-Error rejection отправки ответа (строка) → 200 (String(e)-плечо warn-лога)', async () => {
    linkByCodeMock.mockResolvedValue({ ok: true });
    sendTelegramMessageMock.mockRejectedValue('tg string down');
    const update = {
      update_id: 106,
      message: { text: '/start okcode2', chat: { id: 778 } },
    };
    const res = await POST(makeRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
  });

  it('не-Error throw из linkByCode (строка) → 200 (String(e)-плечо error-лога)', async () => {
    linkByCodeMock.mockRejectedValue('db string down');
    const update = {
      update_id: 107,
      message: { text: '/start failcode', chat: { id: 779 } },
    };
    const res = await POST(makeRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
  });

  it('не логирует секрет вебхука', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    linkByCodeMock.mockResolvedValue({ ok: true });
    const update = {
      update_id: 104,
      message: { text: '/start somecode', chat: { id: 444 } },
    };
    await POST(makeRequest(update, WEBHOOK_SECRET));
    const allLogCalls = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls].map((args) =>
      JSON.stringify(args)
    );
    for (const call of allLogCalls) {
      expect(call).not.toContain(WEBHOOK_SECRET);
    }
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

describe('POST /api/integrations/telegram/webhook — non-start updates', () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    vi.clearAllMocks();
    sendTelegramMessageMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it('возвращает 200 для обычного сообщения без /start', async () => {
    const update = {
      update_id: 200,
      message: { text: 'hello', chat: { id: 555 } },
    };
    const res = await POST(makeRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect(linkByCodeMock).not.toHaveBeenCalled();
  });

  it('возвращает 200 для update без message', async () => {
    const update = { update_id: 201, callback_query: { data: 'whatever' } };
    const res = await POST(makeRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect(linkByCodeMock).not.toHaveBeenCalled();
  });

  it('возвращает 200 для /start без кода (одно слово)', async () => {
    const update = {
      update_id: 202,
      message: { text: '/start', chat: { id: 666 } },
    };
    const res = await POST(makeRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect(linkByCodeMock).not.toHaveBeenCalled();
  });

  it('возвращает 200 и не вызывает linkByCode при ошибке JSON', async () => {
    const req = new Request('https://app.local/api/integrations/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      body: 'NOT JSON',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(linkByCodeMock).not.toHaveBeenCalled();
  });
});

describe('диагностика вебхука (ФТ-14.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordWebhookEvent.mockResolvedValue(undefined);
    sendTelegramMessageMock.mockResolvedValue({ ok: true });
    process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it('well-formed update → отметка webhook.telegram', async () => {
    const res = await POST(makeRequest({ message: {} }, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect(recordWebhookEvent).toHaveBeenCalledWith(expect.anything(), 'telegram');
  });

  it('401 (неверный секрет) → отметки нет', async () => {
    const res = await POST(makeRequest({}, 'wrong'));
    expect(res.status).toBe(401);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });
});
