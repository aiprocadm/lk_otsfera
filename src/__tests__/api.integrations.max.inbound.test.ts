import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- hoisted mocks (mirrors api.integrations.max.webhook.test.ts) ----
const {
  linkMaxByCode,
  sendMaxMessage,
  notFoundIfDisabled,
  isFeatureEnabled,
  ingestMock,
  recordWebhookEvent,
} = vi.hoisted(() => ({
  linkMaxByCode: vi.fn(),
  sendMaxMessage: vi.fn(),
  notFoundIfDisabled: vi.fn(),
  isFeatureEnabled: vi.fn(),
  ingestMock: vi.fn(),
  recordWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: { integrationSetting: { findUnique: async () => null } } }));
vi.mock('@/lib/services/max/link', () => ({ linkMaxByCode }));
vi.mock('@/lib/max/client', () => ({ sendMaxMessage }));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage: ingestMock }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled, isFeatureEnabled }));
vi.mock('@/lib/services/admin/webhookDiagnostics', () => ({ recordWebhookEvent }));

import { POST } from '@/app/api/integrations/max/webhook/route';

const SECRET = 'max-secret-32-chars-xxxxxxxxxxxxx';

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://app.local/api/integrations/max/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null); // флаг max_channel включён по умолчанию
  isFeatureEnabled.mockReturnValue(true); // inbound_messaging включён для этого набора тестов
  sendMaxMessage.mockResolvedValue({ ok: true });
  process.env.MAX_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.MAX_WEBHOOK_SECRET;
});

describe('POST /api/integrations/max/webhook — inbound ingest', () => {
  it('404 когда флаг max_channel выключен, ingest не вызывается', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await POST(
      req({ message: { text: 'привет', chat: { id: 1 } } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(404);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('401 при неверном секрете, ingest не вызывается', async () => {
    const res = await POST(
      req({ message: { text: 'привет', chat: { id: 1 } } }, { 'x-max-webhook-secret': 'wrong' })
    );
    expect(res.status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('не-/start текст → ingestInboundMessage с channel:max, 200', async () => {
    ingestMock.mockResolvedValue({ ok: true, id: 'm1', deduped: false });
    const res = await POST(
      req(
        { message: { message_id: 77, text: 'нужна помощь', chat: { id: 42 } } },
        { 'x-max-webhook-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: 'max',
        externalId: 'max:42:77',
        senderRef: '42',
        body: 'нужна помощь',
      })
    );
  });

  it('/start по-прежнему линкует и НЕ вызывает ingest', async () => {
    linkMaxByCode.mockResolvedValue({ ok: true });
    const res = await POST(
      req(
        { message: { message_id: 1, text: '/start CODE123', chat: { id: 42 } } },
        { 'x-max-webhook-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(linkMaxByCode).toHaveBeenCalledWith(expect.anything(), { code: 'CODE123', chatId: '42' });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('bot_started (synthetic /start) НЕ вызывает ingest даже если код невалиден', async () => {
    linkMaxByCode.mockResolvedValue({ ok: false, error: 'invalid_code' });
    const res = await POST(
      req({ bot_started: { payload: 'CODE9', user_id: 7 } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(200);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('голый /start (реальное сообщение, без кода) → 200, ingest НЕ вызывается', async () => {
    const res = await POST(
      req(
        { message: { message_id: 4, text: '/start', chat: { id: 1 } } },
        { 'x-max-webhook-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(ingestMock).not.toHaveBeenCalled();
    expect(linkMaxByCode).not.toHaveBeenCalled();
  });

  it('bot_started без кода (synthetic /start, isStart=true) → 200, ingest НЕ вызывается (защита !isStart)', async () => {
    // payload='' → synthetic text '/start ' не матчит /start-с-кодом → доходит
    // до inbound-ветки, где !isStart отсекает: это событие старта, не входящее.
    const res = await POST(
      req({ bot_started: { payload: '', user_id: 7 } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(200);
    expect(ingestMock).not.toHaveBeenCalled();
    expect(linkMaxByCode).not.toHaveBeenCalled();
  });

  it('отсутствует messageId на входящем сообщении → 200, ingest НЕ вызывается', async () => {
    const res = await POST(
      req({ message: { text: 'привет', chat: { id: 1 } } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(200);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('не вызывает ingest, когда inbound_messaging выключен', async () => {
    isFeatureEnabled.mockReturnValue(false);
    const res = await POST(
      req(
        { message: { message_id: 2, text: 'привет', chat: { id: 1 } } },
        { 'x-max-webhook-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('ошибка ingestInboundMessage не превращается в 500 (best-effort)', async () => {
    ingestMock.mockRejectedValue(new Error('db down'));
    const res = await POST(
      req(
        { message: { message_id: 3, text: 'привет', chat: { id: 1 } } },
        { 'x-max-webhook-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
  });

  it('не-Error rejection ingest (строка) → 200 (String(e)-плечо error-лога)', async () => {
    ingestMock.mockRejectedValue('db string down');
    const res = await POST(
      req(
        { message: { message_id: 4, text: 'привет опять', chat: { id: 1 } } },
        { 'x-max-webhook-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
  });
});
