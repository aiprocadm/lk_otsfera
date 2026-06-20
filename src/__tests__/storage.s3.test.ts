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
});
