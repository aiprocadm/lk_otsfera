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
