import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { ingest, notFoundIfDisabled } = vi.hoisted(() => ({
  ingest: vi.fn(),
  notFoundIfDisabled: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage: ingest }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

import { POST } from '@/app/api/integrations/whatsapp/webhook/route';

const SECRET = 'wazzup-secret-32-chars-xxxxxxxxxxxxx';

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://app.local/api/integrations/whatsapp/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null); // флаг inbound_messaging включён по умолчанию
  process.env.WHATSAPP_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.WHATSAPP_WEBHOOK_SECRET;
});

describe('POST /api/integrations/whatsapp/webhook', () => {
  it('404 когда флаг inbound_messaging выключен (до раскрытия эндпоинта)', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await POST(req({}, { 'x-wazzup-secret': SECRET }));
    expect(res.status).toBe(404);
    expect(notFoundIfDisabled).toHaveBeenCalledWith('inbound_messaging');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('401 при неверном секрете, ingest не вызывается', async () => {
    const res = await POST(req({}, { 'x-wazzup-secret': 'wrong' }));
    expect(res.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('401 когда секрет не сконфигурирован', async () => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    const res = await POST(req({}, { 'x-wazzup-secret': 'anything' }));
    expect(res.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('входящее сообщение → ingest с нормализованным телефоном, 200', async () => {
    ingest.mockResolvedValue({ ok: true, id: 'm', deduped: false });
    const res = await POST(
      req(
        { messages: [{ messageId: 'W1', chatId: '79990001122', text: 'здравствуйте' }] },
        { 'x-wazzup-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        channel: 'whatsapp',
        externalId: 'wa:W1',
        senderRef: '+79990001122',
        body: 'здравствуйте',
      })
    );
  });

  it('эхо-сообщение (isEcho) пропускается', async () => {
    const res = await POST(
      req(
        { messages: [{ messageId: 'W2', chatId: '79990001122', text: 'out', isEcho: true }] },
        { 'x-wazzup-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('флаг выключен → 404', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await POST(req({}, { 'x-wazzup-secret': SECRET }));
    expect(res.status).toBe(404);
  });

  it('200 без падения на malformed JSON', async () => {
    const res = await POST(req('{ broken', { 'x-wazzup-secret': SECRET }));
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('ошибка ingest не превращается в 500 (best-effort per message)', async () => {
    ingest.mockRejectedValue(new Error('db down'));
    const res = await POST(
      req(
        { messages: [{ messageId: 'W3', chatId: '79990001122', text: 'hi' }] },
        { 'x-wazzup-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
  });

  it('не-Error rejection ingest (строка) → 200 (String(e)-плечо error-лога)', async () => {
    ingest.mockRejectedValue('db string down');
    const res = await POST(
      req(
        { messages: [{ messageId: 'W3s', chatId: '79990001122', text: 'hi again' }] },
        { 'x-wazzup-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
  });

  it('несколько сообщений в одном апдейте → ingest вызывается для каждого', async () => {
    ingest.mockResolvedValue({ ok: true, id: 'm', deduped: false });
    const res = await POST(
      req(
        {
          messages: [
            { messageId: 'W4', chatId: '79990001122', text: 'first' },
            { messageId: 'W5', chatId: '79990001133', text: 'second' },
          ],
        },
        { 'x-wazzup-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it('пустой массив messages → 200, ingest не вызывается', async () => {
    const res = await POST(req({ messages: [] }, { 'x-wazzup-secret': SECRET }));
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('сообщение без messageId → отфильтровано, ingest не вызывается', async () => {
    const res = await POST(
      req({ messages: [{ chatId: '79990001122', text: 'hi' }] }, { 'x-wazzup-secret': SECRET })
    );
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('object/array chatId → отфильтровано (без фабрикации телефона)', async () => {
    const res = await POST(
      req(
        {
          messages: [
            { messageId: 'A', chatId: { x: 1 }, text: 'hi' },
            { messageId: 'B', chatId: [7, 9, 9], text: 'hi' },
          ],
        },
        { 'x-wazzup-secret': SECRET }
      )
    );
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });
});
