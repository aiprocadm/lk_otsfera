import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Вебхук Telegram: файл от клиента (`У-204`).
 *
 * До этапа 3 апдейт с одним фото не подходил ни под одну ветку и пропадал
 * МОЛЧА: клиент отправлял снимок, а в кабинете не появлялось ничего. Здесь
 * проверяется, что такой апдейт теперь становится сообщением — и что он
 * становится им ДАЖЕ ЕСЛИ файл скачать не удалось.
 */
const {
  linkByCodeMock,
  sendTelegramMessageMock,
  getTelegramFileUrlMock,
  fetchInboundAttachmentMock,
  prismaMock,
  ingestMock,
  isFeatureEnabledMock,
  recordWebhookEvent,
} = vi.hoisted(() => ({
  linkByCodeMock: vi.fn(),
  sendTelegramMessageMock: vi.fn(),
  getTelegramFileUrlMock: vi.fn(),
  fetchInboundAttachmentMock: vi.fn(),
  prismaMock: { integrationSetting: { findUnique: async () => null } },
  ingestMock: vi.fn(),
  isFeatureEnabledMock: vi.fn(),
  recordWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/telegram/link', () => ({ linkByCode: linkByCodeMock }));
vi.mock('@/lib/telegram/client', () => ({
  sendTelegramMessage: sendTelegramMessageMock,
  getTelegramFileUrl: getTelegramFileUrlMock,
}));
vi.mock('@/lib/services/messengers/attachment', () => ({
  fetchInboundAttachment: fetchInboundAttachmentMock,
}));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage: ingestMock }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: isFeatureEnabledMock }));
vi.mock('@/lib/services/admin/webhookDiagnostics', () => ({ recordWebhookEvent }));

import { POST } from '@/app/api/integrations/telegram/webhook/route';

const WEBHOOK_SECRET = 'test-secret-token-32-chars-long!!';

function makeRequest(body: unknown): Request {
  return new Request('https://app.local/api/integrations/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });
}

const stored = {
  path: 'messengers/inbound/uuid-photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 4096,
};

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  vi.clearAllMocks();
  isFeatureEnabledMock.mockReturnValue(true);
  sendTelegramMessageMock.mockResolvedValue({ ok: true });
  ingestMock.mockResolvedValue({ ok: true, id: 'in1', deduped: false });
  getTelegramFileUrlMock.mockResolvedValue('https://api.telegram.org/file/bot<токен>/p/1.jpg');
  fetchInboundAttachmentMock.mockResolvedValue(stored);
});

afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

describe('вебхук Telegram — апдейт с файлом', () => {
  it('одно фото без текста больше не пропадает: берётся самый крупный вариант, тело — «Файл: photo.jpg»', async () => {
    const update = {
      message: {
        message_id: 55,
        chat: { id: 999 },
        photo: [
          { file_id: 'small', file_size: 100 },
          { file_id: 'big', file_size: 4096 },
        ],
      },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
    // Самый крупный вариант — последний в массиве.
    expect(getTelegramFileUrlMock).toHaveBeenCalledWith('big');
    expect(fetchInboundAttachmentMock).toHaveBeenCalledWith('inbound', {
      url: 'https://api.telegram.org/file/bot<токен>/p/1.jpg',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 4096,
    });
    expect(ingestMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        channel: 'telegram',
        externalId: 'tg:999:55',
        senderRef: '999',
        body: 'Файл: photo.jpg',
        attachmentPath: stored.path,
        attachmentName: 'photo.jpg',
        attachmentMime: 'image/jpeg',
        attachmentSize: 4096,
      })
    );
  });

  it('фото без размера у варианта → размер не заявляется вовсе', async () => {
    const update = {
      message: { message_id: 56, chat: { id: 999 }, photo: [{ file_id: 'only' }] },
    };
    await POST(makeRequest(update));
    expect(fetchInboundAttachmentMock).toHaveBeenCalledWith(
      'inbound',
      expect.objectContaining({ size: null })
    );
  });

  it('документ: имя и тип берутся из апдейта', async () => {
    fetchInboundAttachmentMock.mockResolvedValueOnce({
      path: 'messengers/inbound/uuid-act.pdf',
      name: 'act.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    });
    const update = {
      message: {
        message_id: 57,
        chat: { id: 12 },
        document: {
          file_id: 'doc-1',
          file_name: 'act.pdf',
          mime_type: 'application/pdf',
          file_size: 2048,
        },
      },
    };
    await POST(makeRequest(update));
    expect(fetchInboundAttachmentMock).toHaveBeenCalledWith('inbound', {
      url: expect.any(String),
      name: 'act.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    });
    expect(ingestMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ body: 'Файл: act.pdf', attachmentName: 'act.pdf' })
    );
  });

  it('документ без имени и типа → безопасные значения по умолчанию', async () => {
    const update = {
      message: { message_id: 58, chat: { id: 12 }, document: { file_id: 'doc-2' } },
    };
    await POST(makeRequest(update));
    expect(fetchInboundAttachmentMock).toHaveBeenCalledWith('inbound', {
      url: expect.any(String),
      name: 'file',
      mimeType: 'application/octet-stream',
      size: null,
    });
  });

  it('фото с подписью: телом сообщения становится подпись, а не имя файла', async () => {
    const update = {
      message: {
        message_id: 59,
        chat: { id: 999 },
        photo: [{ file_id: 'big' }],
        caption: 'вот договор, посмотрите',
      },
    };
    await POST(makeRequest(update));
    expect(ingestMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        body: 'вот договор, посмотрите',
        attachmentPath: stored.path,
      })
    );
  });

  it('/start <код> файлом не считается: привязка сработала, сообщение не заводится', async () => {
    linkByCodeMock.mockResolvedValueOnce({ ok: true });
    const update = {
      message: { message_id: 60, chat: { id: 5 }, text: '/start ABC123' },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
    expect(linkByCodeMock).toHaveBeenCalledWith(prismaMock, { code: 'ABC123', chatId: '5' });
    expect(ingestMock).not.toHaveBeenCalled();
    expect(getTelegramFileUrlMock).not.toHaveBeenCalled();
  });

  it('пустой апдейт без сообщения → 200 и ничего не заводится', async () => {
    const res = await POST(makeRequest({ update_id: 1 }));
    expect(res.status).toBe(200);
    expect(ingestMock).not.toHaveBeenCalled();
  });
});

describe('вебхук Telegram — файл не скачался', () => {
  it('ссылка на файл не получена → сообщение всё равно записано, но без вложения', async () => {
    getTelegramFileUrlMock.mockResolvedValueOnce(null);
    const update = {
      message: { message_id: 61, chat: { id: 999 }, photo: [{ file_id: 'big' }] },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
    expect(fetchInboundAttachmentMock).not.toHaveBeenCalled();
    const dto = ingestMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(dto.body).toBe('Файл: photo.jpg');
    expect(dto).not.toHaveProperty('attachmentPath');
  });

  it('getFile упал с ошибкой → сообщение всё равно записано', async () => {
    getTelegramFileUrlMock.mockRejectedValueOnce(new Error('сеть'));
    const update = {
      message: { message_id: 62, chat: { id: 999 }, photo: [{ file_id: 'big' }] },
    };
    const res = await POST(makeRequest(update));
    expect(res.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ body: 'Файл: photo.jpg' })
    );
  });

  it('скачивание вернуло null (формат или размер не подошли) → сообщение записано без вложения', async () => {
    fetchInboundAttachmentMock.mockResolvedValueOnce(null);
    const update = {
      message: {
        message_id: 63,
        chat: { id: 999 },
        document: { file_id: 'v1', file_name: 'клип.mp4', mime_type: 'video/mp4' },
      },
    };
    await POST(makeRequest(update));
    const dto = ingestMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(dto.body).toBe('Файл: клип.mp4');
    expect(dto).not.toHaveProperty('attachmentPath');
  });
});
