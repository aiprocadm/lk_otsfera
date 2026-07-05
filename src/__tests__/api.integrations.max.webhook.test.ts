import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { linkMaxByCode, sendMaxMessage, notFoundIfDisabled, isFeatureEnabled } = vi.hoisted(() => ({
  linkMaxByCode: vi.fn(),
  sendMaxMessage: vi.fn(),
  notFoundIfDisabled: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/max/link', () => ({ linkMaxByCode }));
vi.mock('@/lib/max/client', () => ({ sendMaxMessage }));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled, isFeatureEnabled }));

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
  isFeatureEnabled.mockReturnValue(false); // inbound_messaging — opt-in, по умолчанию выключен
  sendMaxMessage.mockResolvedValue({ ok: true });
  process.env.MAX_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.MAX_WEBHOOK_SECRET;
});

describe('POST /api/integrations/max/webhook', () => {
  it('404 когда флаг max_channel выключен (до раскрытия эндпоинта)', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await POST(req({ message: { text: '/start abc', chat: { id: 1 } } }));
    expect(res.status).toBe(404);
    expect(notFoundIfDisabled).toHaveBeenCalledWith('max_channel');
    expect(linkMaxByCode).not.toHaveBeenCalled();
  });

  it('401 при неверном секрете', async () => {
    const res = await POST(req({ message: {} }, { 'x-max-webhook-secret': 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('401 когда секрет не сконфигурирован', async () => {
    delete process.env.MAX_WEBHOOK_SECRET;
    const res = await POST(req({ message: {} }, { 'x-max-webhook-secret': 'anything' }));
    expect(res.status).toBe(401);
  });

  it('200 на валидный /start <code> (message-форма) → linkMaxByCode', async () => {
    linkMaxByCode.mockResolvedValue({ ok: true });
    const res = await POST(
      req({ message: { text: '/start CODE123', chat: { id: 42 } } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(200);
    expect(linkMaxByCode).toHaveBeenCalledWith({}, { code: 'CODE123', chatId: '42' });
    expect(sendMaxMessage).toHaveBeenCalledWith('42', expect.stringContaining('привязаны'));
  });

  it('200 на bot_started-форму апдейта (chatId из user_id)', async () => {
    linkMaxByCode.mockResolvedValue({ ok: true });
    const res = await POST(
      req({ bot_started: { payload: 'CODE9', user_id: 7 } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(200);
    expect(linkMaxByCode).toHaveBeenCalledWith({}, { code: 'CODE9', chatId: '7' });
  });

  it('chatId из message.recipient.chat_id (альтернативная форма адресации)', async () => {
    linkMaxByCode.mockResolvedValue({ ok: true });
    const res = await POST(
      req(
        { message: { text: '/start CODE-R', recipient: { chat_id: 555 } } },
        { 'x-max-webhook-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(linkMaxByCode).toHaveBeenCalledWith({}, { code: 'CODE-R', chatId: '555' });
  });

  it('chatId из bot_started.chat_id (приоритет над user_id)', async () => {
    linkMaxByCode.mockResolvedValue({ ok: true });
    const res = await POST(
      req(
        { bot_started: { payload: 'CODE-C', chat_id: 111, user_id: 222 } },
        { 'x-max-webhook-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(linkMaxByCode).toHaveBeenCalledWith({}, { code: 'CODE-C', chatId: '111' });
  });

  it('200 no-op когда нет распознаваемого chatId (только текст)', async () => {
    const res = await POST(
      req({ message: { text: '/start X' } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(200);
    expect(linkMaxByCode).not.toHaveBeenCalled();
  });

  it('невалидный код → ответ бота об ошибке, всё равно 200', async () => {
    linkMaxByCode.mockResolvedValue({ ok: false, error: 'invalid_code' });
    const res = await POST(
      req({ message: { text: '/start BAD', chat: { id: 1 } } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(200);
    expect(sendMaxMessage).toHaveBeenCalledWith('1', expect.stringContaining('недействителен'));
  });

  it('200 без падения на malformed JSON', async () => {
    const res = await POST(req('{ broken', { 'x-max-webhook-secret': SECRET }));
    expect(res.status).toBe(200);
    expect(linkMaxByCode).not.toHaveBeenCalled();
  });

  it('200 и no-op для не-/start сообщения (шов D6 — входящие игнорируются)', async () => {
    const res = await POST(
      req({ message: { text: 'привет', chat: { id: 1 } } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(200);
    expect(linkMaxByCode).not.toHaveBeenCalled();
  });

  it('ошибка linkMaxByCode не превращается в 500', async () => {
    linkMaxByCode.mockRejectedValue(new Error('db down'));
    const res = await POST(
      req({ message: { text: '/start X', chat: { id: 1 } } }, { 'x-max-webhook-secret': SECRET })
    );
    expect(res.status).toBe(200);
  });
});
