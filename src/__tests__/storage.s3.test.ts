import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('StorageError', () => {
  it('prefixes the message with the op and sets name', async () => {
    const { StorageError } = await import('@/lib/storage/objectStorage');
    const e = new StorageError('upload', 'boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('StorageError');
    expect(e.op).toBe('upload');
    expect(e.message).toBe('STORAGE_UPLOAD: boom');
  });
});

describe('documentBucket', () => {
  it('defaults to "documents" when S3_BUCKET is unset', async () => {
    const saved = process.env.S3_BUCKET;
    delete process.env.S3_BUCKET;
    vi.resetModules();
    const { documentBucket } = await import('@/lib/storage/objectStorage');
    expect(documentBucket).toBe('documents');
    if (saved !== undefined) process.env.S3_BUCKET = saved;
  });

  it('uses S3_BUCKET when set', async () => {
    vi.stubEnv('S3_BUCKET', 'my-bucket');
    vi.resetModules();
    const { documentBucket } = await import('@/lib/storage/objectStorage');
    expect(documentBucket).toBe('my-bucket');
  });
});

// --- S3Storage (mocked client) ---
const { sendMock, getSignedUrlMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getSignedUrlMock: vi.fn()
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock
}));

describe('S3Storage.upload', () => {
  it('sends PutObject with bucket/key/body/contentType', async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await storage.upload('orders/1/x.pdf', Buffer.from('hi'), { contentType: 'application/pdf' });
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input).toMatchObject({
      Bucket: 'bkt',
      Key: 'orders/1/x.pdf',
      ContentType: 'application/pdf'
    });
    expect(cmd.input.Body).toEqual(Buffer.from('hi'));
  });

  it('wraps provider failure in StorageError(op=upload)', async () => {
    sendMock.mockReset();
    sendMock.mockRejectedValue(new Error('net down'));
    const { S3Storage } = await import('@/lib/storage/s3');
    const { StorageError } = await import('@/lib/storage/objectStorage');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await expect(storage.upload('p', Buffer.from(''), { contentType: 'x' }))
      .rejects.toBeInstanceOf(StorageError);
    await expect(storage.upload('p', Buffer.from(''), { contentType: 'x' }))
      .rejects.toThrow('STORAGE_UPLOAD: net down');
  });
});

describe('buildS3Storage env validation', () => {
  const setAll = () => {
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_REGION', 'ru-central1');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'ak');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'sk');
  };
  it('throws when S3_ENDPOINT missing', async () => {
    setAll();
    vi.stubEnv('S3_ENDPOINT', '');
    vi.resetModules();
    const { buildS3Storage } = await import('@/lib/storage/s3');
    expect(() => buildS3Storage()).toThrow('S3_ENDPOINT is not configured');
  });
  it('throws when S3_ACCESS_KEY_ID missing', async () => {
    setAll();
    vi.stubEnv('S3_ACCESS_KEY_ID', '');
    vi.resetModules();
    const { buildS3Storage } = await import('@/lib/storage/s3');
    expect(() => buildS3Storage()).toThrow('S3_ACCESS_KEY_ID is not configured');
  });
  it('getObjectStorage returns the same instance (singleton)', async () => {
    setAll();
    vi.resetModules();
    const { getObjectStorage } = await import('@/lib/storage/s3');
    expect(getObjectStorage()).toBe(getObjectStorage());
  });
  it('builds without S3_REGION (defaults to ru-central1)', async () => {
    // Set everything except S3_REGION so the `?? 'ru-central1'` fallback fires.
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'ak');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'sk');
    delete process.env.S3_REGION;
    vi.resetModules();
    const { buildS3Storage, S3Storage } = await import('@/lib/storage/s3');
    expect(buildS3Storage()).toBeInstanceOf(S3Storage);
  });
});

describe('S3Storage.download', () => {
  it('returns a Buffer assembled from GetObject body', async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) }
    });
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    const buf = await storage.download('orders/1/x.pdf');
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input).toMatchObject({ Bucket: 'bkt', Key: 'orders/1/x.pdf' });
    expect(buf).toEqual(Buffer.from([1, 2, 3]));
  });

  it('wraps failure in StorageError(op=download)', async () => {
    sendMock.mockReset();
    sendMock.mockRejectedValue(new Error('gone'));
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await expect(storage.download('p')).rejects.toThrow('STORAGE_DOWNLOAD: gone');
  });

  it('throws StorageError(op=download) when the response has no Body', async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    const { S3Storage } = await import('@/lib/storage/s3');
    const { StorageError } = await import('@/lib/storage/objectStorage');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    const p = storage.download('p');
    await expect(p).rejects.toBeInstanceOf(StorageError);
    await expect(storage.download('p')).rejects.toThrow('STORAGE_DOWNLOAD: empty body');
  });

  it('stringifies a non-Error rejection in the StorageError message', async () => {
    sendMock.mockReset();
    sendMock.mockRejectedValue('plain string boom');
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await expect(storage.download('p')).rejects.toThrow('STORAGE_DOWNLOAD: plain string boom');
  });
});

describe('S3Storage.ping (R1.1 readiness-проба)', () => {
  it('шлёт ListObjectsV2 MaxKeys=1 по бакету', async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ KeyCount: 0 });
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await storage.ping();
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input).toMatchObject({ Bucket: 'bkt', MaxKeys: 1 });
  });

  it('оборачивает провал в StorageError(op=ping)', async () => {
    sendMock.mockReset();
    sendMock.mockRejectedValue(new Error('s3 down'));
    const { S3Storage } = await import('@/lib/storage/s3');
    const { StorageError } = await import('@/lib/storage/objectStorage');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await expect(storage.ping()).rejects.toBeInstanceOf(StorageError);
    await expect(storage.ping()).rejects.toThrow('STORAGE_PING: s3 down');
  });
});

describe('s3HealthPing (singleton-делегат для lib/health/checks)', () => {
  it('строит singleton при первом вызове и переиспользует при втором', async () => {
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'ak');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'sk');
    vi.resetModules();
    const mod = await import('@/lib/storage/s3');
    const pingSpy = vi.spyOn(mod.S3Storage.prototype, 'ping').mockResolvedValue(undefined);
    await mod.s3HealthPing();
    await mod.s3HealthPing();
    expect(pingSpy).toHaveBeenCalledTimes(2);
    pingSpy.mockRestore();
  });
});

describe('S3Storage.createSignedUrl', () => {
  it('no download opt → no ResponseContentDisposition (inline)', async () => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue('https://signed/inline');
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    const url = await storage.createSignedUrl('chat/1/x.png', 600);
    expect(url).toBe('https://signed/inline');
    const cmd = getSignedUrlMock.mock.calls[0][1];
    expect(cmd.input.ResponseContentDisposition).toBeUndefined();
    expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 600 });
  });

  it('download:true → attachment (no filename)', async () => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue('https://signed/attach');
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await storage.createSignedUrl('stmt/1.xlsx', 600, { download: true });
    const cmd = getSignedUrlMock.mock.calls[0][1];
    expect(cmd.input.ResponseContentDisposition).toBe('attachment');
  });

  it('download:ascii-string → attachment + filename + filename* (RFC 5987)', async () => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue('https://signed/named');
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await storage.createSignedUrl('p', 600, { download: 'report.pdf' });
    const cmd = getSignedUrlMock.mock.calls[0][1];
    expect(cmd.input.ResponseContentDisposition).toBe(
      'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf'
    );
  });

  it('download:cyrillic-string → ascii fallback + RFC 5987 filename*', async () => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue('https://signed/named');
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await storage.createSignedUrl('p', 600, { download: 'отчёт.pdf' });
    const cmd = getSignedUrlMock.mock.calls[0][1];
    // «отчёт» = 5 non-ASCII chars → 5 underscores; «.pdf» stays ASCII.
    expect(cmd.input.ResponseContentDisposition).toBe(
      'attachment; filename="_____.pdf"; filename*=UTF-8\'\'%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf'
    );
  });

  it('download:string with a quote → quote replaced in ascii fallback (no broken header)', async () => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue('https://signed/named');
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await storage.createSignedUrl('p', 600, { download: 'a"b.pdf' });
    const cmd = getSignedUrlMock.mock.calls[0][1];
    expect(cmd.input.ResponseContentDisposition).toBe(
      'attachment; filename="a_b.pdf"; filename*=UTF-8\'\'a%22b.pdf'
    );
  });

  it('wraps failure in StorageError(op=sign)', async () => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockRejectedValue(new Error('sig fail'));
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await expect(storage.createSignedUrl('p', 600)).rejects.toThrow('STORAGE_SIGN: sig fail');
  });
});

describe('S3Storage.remove', () => {
  it('sends DeleteObjects with a Key per path', async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await storage.remove(['a/1', 'b/2']);
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input).toMatchObject({
      Bucket: 'bkt',
      Delete: { Objects: [{ Key: 'a/1' }, { Key: 'b/2' }] }
    });
  });

  it('wraps failure in StorageError(op=remove)', async () => {
    sendMock.mockReset();
    sendMock.mockRejectedValue(new Error('nope'));
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await expect(storage.remove(['x'])).rejects.toThrow('STORAGE_REMOVE: nope');
  });
});

describe('storage barrel', () => {
  it('re-exports getObjectStorage, StorageError, documentBucket', async () => {
    const mod = await import('@/lib/storage');
    expect(typeof mod.getObjectStorage).toBe('function');
    expect(typeof mod.StorageError).toBe('function');
    expect(typeof mod.documentBucket).toBe('string');
  });
});
