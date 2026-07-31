import { beforeAll, describe, expect, it } from 'vitest';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { S3Storage } from '@/lib/storage/s3';

const ENDPOINT = process.env.S3_ENDPOINT ?? '';
const BUCKET = 'documents-it';

const c = new S3Client({
  endpoint: ENDPOINT || 'http://localhost:9000',
  region: 'ru-central1',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  forcePathStyle: true,
});

describe.skipIf(!ENDPOINT)('S3Storage round-trip (MinIO)', () => {
  const storage = new S3Storage(c, BUCKET);
  const key = `it/roundtrip-${process.pid}.txt`; // pid varies per run; Date.now() is banned in some harnesses but fine here

  beforeAll(async () => {
    await c.send(new CreateBucketCommand({ Bucket: BUCKET })).catch((e) => {
      // BucketAlreadyOwnedByYou / BucketAlreadyExists are fine; rethrow anything else.
      const name = e?.name ?? '';
      if (!/BucketAlready/.test(name)) throw e;
    });
  });

  it('upload → download returns identical bytes', async () => {
    const body = Buffer.from('привет-S3');
    await storage.upload(key, body, { contentType: 'text/plain' });
    const got = await storage.download(key);
    expect(got.equals(body)).toBe(true);
  });

  it('createSignedUrl(download:name) yields a fetchable URL with attachment disposition', async () => {
    const url = await storage.createSignedUrl(key, 60, { download: 'файл.txt' });
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('remove deletes the object', async () => {
    await storage.remove([key]);
    await expect(storage.download(key)).rejects.toBeTruthy();
  });
});
