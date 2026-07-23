import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- hoisted mocks (mirrors api.telegram.webhook.test.ts) ----
const { linkByCodeMock, sendTelegramMessageMock, prismaMock, ingestMock, isFeatureEnabledMock, recordWebhookEvent } =
  vi.hoisted(() => ({
    linkByCodeMock: vi.fn(),
    sendTelegramMessageMock: vi.fn(),
    prismaMock: {},
    ingestMock: vi.fn(),
    isFeatureEnabledMock: vi.fn(),
    recordWebhookEvent: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/telegram/link', () => ({ linkByCode: linkByCodeMock }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: sendTelegramMessageMock }));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage: ingestMock }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: isFeatureEnabledMock }));
vi.mock('@/lib/services/admin/webhookDiagnostics', () => ({ recordWebhookEvent }));

import { POST } from '@/app/api/integrations/telegram/webhook/route';

const WEBHOOK_SECRET = 'test-secret-token-32-chars-long!!';

function makeRequest(body: unknown, secret: string = WEBHOOK_SECRET): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-telegram-bot-api-secret-token': secret,
  };
  return new Request('https://app.local/api/integrations/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  vi.clearAllMocks();
  sendTelegramMessageMock.mockResolvedValue({ ok: true });
  isFeatureEnabledMock.mockReturnValue(true); // inbound_messaging включён для этого набора тестов
});

afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

describe('POST /api/integrations/telegram/webhook — inbound ingest', () => {
  it('401 при неверном секрете, ingest не вызывается', async () => {
    const res = await POST(makeRequest({}, 'wrong'));
    expect(res.status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('не-/start текст → ingestInboundMessage, 200 (с senderDisplay из from.username)', async () => {
    ingestMock.mockResolvedValue({ ok: true, id: 'm1', deduped: false });
    const update = {
      message: { message_id: 55, chat: { id: 999 }, text: 'нужна помощь', from: { username: 'ivan' } },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        channel: 'telegram',
        externalId: 'tg:999:55',
        senderRef: '999',
        senderDisplay: 'ivan',
        body: 'нужна помощь',
      })
    );
  });

  it('голый /start (кнопка Start) → 200, ingest НЕ вызывается', async () => {
    const update = {
      message: { message_id: 2, chat: { id: 7 }, text: '/start' },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
    expect(ingestMock).not.toHaveBeenCalled();
    expect(linkByCodeMock).not.toHaveBeenCalled();
  });

  it('отсутствует message_id → 200, ingest НЕ вызывается (идемпотентность не гарантируется)', async () => {
    const update = {
      message: { chat: { id: 7 }, text: 'привет' },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('/start по-прежнему линкует и НЕ вызывает ingest', async () => {
    linkByCodeMock.mockResolvedValue({ ok: true });
    const update = {
      message: { message_id: 1, chat: { id: 7 }, text: '/start abc' },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
    expect(linkByCodeMock).toHaveBeenCalledWith(prismaMock, { code: 'abc', chatId: '7' });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('не вызывает ingest, когда inbound_messaging выключен', async () => {
    isFeatureEnabledMock.mockReturnValue(false);
    const update = {
      message: { message_id: 56, chat: { id: 999 }, text: 'привет' },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('ошибка ingestInboundMessage не превращается в 500 (best-effort)', async () => {
    ingestMock.mockRejectedValue(new Error('db down'));
    const update = {
      message: { message_id: 57, chat: { id: 999 }, text: 'привет' },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
  });

  it('не-Error rejection ingest (строка) → 200 (String(e)-плечо error-лога)', async () => {
    ingestMock.mockRejectedValue('db string down');
    const update = {
      message: { message_id: 58, chat: { id: 999 }, text: 'привет ещё раз' },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
  });
});
