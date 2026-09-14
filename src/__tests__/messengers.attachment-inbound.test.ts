import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Файл, присланный клиентом (`У-204`, спека §3.3).
 *
 * Правило одно: `fetchInboundAttachment` НИКОГДА не бросает и на любой сбой
 * отдаёт `null` — сообщение клиента всё равно должно записаться. И размер
 * проверяется дважды: провайдеру, назвавшему размер, верить нельзя.
 */
const m = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: m.upload,
    createSignedUrl: m.createSignedUrl,
    download: m.download,
    remove: m.remove,
  }),
}));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: vi.fn() }) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: m.warn, error: m.error },
  bestEffort: () => vi.fn(),
}));
vi.mock('@/lib/telegram/client', () => ({
  sendTelegramDocument: vi.fn(),
  sendTelegramMessage: vi.fn(),
  getTelegramFileUrl: vi.fn(),
}));

import { fetchInboundAttachment } from '@/lib/services/messengers/attachment';

const MB = 1024 * 1024;
const fetchImpl = vi.fn();

/** Ответ провайдера с телом файла. */
function response(bytes: Buffer, ok = true) {
  return {
    ok,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const source = {
  url: 'https://api.telegram.org/file/bot<токен>/photos/1.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
};

let savedLimit: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedLimit = process.env.DOCUMENT_MAX_FILE_SIZE_MB;
  delete process.env.DOCUMENT_MAX_FILE_SIZE_MB;
  m.upload.mockResolvedValue(undefined);
});

afterEach(() => {
  if (savedLimit === undefined) delete process.env.DOCUMENT_MAX_FILE_SIZE_MB;
  else process.env.DOCUMENT_MAX_FILE_SIZE_MB = savedLimit;
});

describe('fetchInboundAttachment — что не скачиваем вовсе', () => {
  it('провайдер назвал размер больше предела → null, файл даже не запрашивается', async () => {
    const r = await fetchInboundAttachment('d1', { ...source, size: 300 * MB }, { fetchImpl });
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.warn).toHaveBeenCalled();
  });

  it('формат вне разрешённого списка → null, файл не запрашивается', async () => {
    const r = await fetchInboundAttachment(
      'd1',
      { ...source, name: 'video.mp4', mimeType: 'video/mp4' },
      { fetchImpl }
    );
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('размер не сообщён (null) — это не повод отказать, скачиваем', async () => {
    fetchImpl.mockResolvedValueOnce(response(Buffer.from('картинка')));
    const r = await fetchInboundAttachment('d1', { ...source, size: null }, { fetchImpl });
    expect(r).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('fetchInboundAttachment — что делаем со сбоями', () => {
  it('провайдер ответил не-ok → null, в хранилище ничего не кладётся', async () => {
    fetchImpl.mockResolvedValueOnce(response(Buffer.from('x'), false));
    await expect(fetchInboundAttachment('d1', source, { fetchImpl })).resolves.toBeNull();
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('сеть оборвалась → null, без исключения наружу', async () => {
    fetchImpl.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(fetchInboundAttachment('d1', source, { fetchImpl })).resolves.toBeNull();
    expect(m.warn).toHaveBeenCalled();
  });

  it('сеть упала не ошибкой, а строкой → тот же null', async () => {
    fetchImpl.mockRejectedValueOnce('boom');
    await expect(fetchInboundAttachment('d1', source, { fetchImpl })).resolves.toBeNull();
  });

  it('провайдер соврал о размере: сказал 10 байт, прислал больше предела → null', async () => {
    process.env.DOCUMENT_MAX_FILE_SIZE_MB = '0.0001'; // ~104 байта
    fetchImpl.mockResolvedValueOnce(response(Buffer.alloc(500, 1)));
    const r = await fetchInboundAttachment('d1', { ...source, size: 10 }, { fetchImpl });
    expect(r).toBeNull();
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('хранилище недоступно → null (сообщение клиента запишется без файла)', async () => {
    fetchImpl.mockResolvedValueOnce(response(Buffer.from('картинка')));
    m.upload.mockRejectedValueOnce(new Error('S3 down'));
    await expect(fetchInboundAttachment('d1', source, { fetchImpl })).resolves.toBeNull();
    expect(m.error).toHaveBeenCalled();
  });

  it('хранилище упало не ошибкой, а строкой → тот же null', async () => {
    fetchImpl.mockResolvedValueOnce(response(Buffer.from('картинка')));
    m.upload.mockRejectedValueOnce('S3 down');
    await expect(fetchInboundAttachment('d1', source, { fetchImpl })).resolves.toBeNull();
  });
});

describe('fetchInboundAttachment — успех', () => {
  it('отдаёт путь, имя, тип и ФАКТИЧЕСКИЙ размер скачанного', async () => {
    const bytes = Buffer.from('это тело картинки');
    fetchImpl.mockResolvedValueOnce(response(bytes));
    const r = await fetchInboundAttachment('d1', { ...source, size: 1 }, { fetchImpl });
    expect(r).toEqual({
      path: expect.stringMatching(
        /^messengers\/d1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-photo\.jpg$/
      ),
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      // Размер — тот, что реально скачан, а не заявленная провайдером единица.
      size: bytes.byteLength,
    });
    expect(m.upload).toHaveBeenCalledWith(r!.path, expect.any(Buffer), {
      contentType: 'image/jpeg',
    });
  });

  it('запрос уходит по ссылке провайдера и умеет быть прерванным по таймауту', async () => {
    fetchImpl.mockResolvedValueOnce(response(Buffer.from('x')));
    await fetchInboundAttachment('d1', source, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(source.url, { signal: expect.any(AbortSignal) });
  });

  it('без подменённого fetch берётся глобальный', async () => {
    const globalFetch = vi.fn().mockResolvedValue(response(Buffer.from('y')));
    vi.stubGlobal('fetch', globalFetch);
    const r = await fetchInboundAttachment('d1', source);
    expect(r).not.toBeNull();
    expect(globalFetch).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
