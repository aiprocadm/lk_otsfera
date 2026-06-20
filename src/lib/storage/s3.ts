import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type ObjectStorage, StorageError, documentBucket } from './objectStorage';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class S3Storage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string
  ) {}

  async upload(path: string, body: Buffer, opts: { contentType: string }): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: path,
          Body: body,
          ContentType: opts.contentType
        })
      );
    } catch (e) {
      throw new StorageError('upload', errMsg(e));
    }
  }

  // createSignedUrl / remove arrive in Tasks 5–6.
  async download(path: string): Promise<Buffer> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: path })
      );
      if (!res.Body) throw new Error('empty body');
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (e) {
      throw new StorageError('download', errMsg(e));
    }
  }
  async createSignedUrl(
    path: string,
    ttlSeconds: number,
    opts?: { download?: boolean | string }
  ): Promise<string> {
    const disposition =
      typeof opts?.download === 'string'
        ? `attachment; filename="${opts.download}"`
        : opts?.download === true
          ? 'attachment'
          : undefined;
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: path,
          ResponseContentDisposition: disposition
        }),
        { expiresIn: ttlSeconds }
      );
    } catch (e) {
      throw new StorageError('sign', errMsg(e));
    }
  }
  async remove(): Promise<void> {
    throw new StorageError('remove', 'not implemented');
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

export function buildS3Storage(): S3Storage {
  const endpoint = requireEnv('S3_ENDPOINT');
  const region = process.env.S3_REGION ?? 'ru-central1';
  const accessKeyId = requireEnv('S3_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('S3_SECRET_ACCESS_KEY');
  const forcePathStyle = ['1', 'true', 'on'].includes(
    (process.env.S3_FORCE_PATH_STYLE ?? '').toLowerCase()
  );
  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle
  });
  return new S3Storage(client, documentBucket);
}

let _storage: S3Storage | null = null;
export function getObjectStorage(): ObjectStorage {
  if (!_storage) _storage = buildS3Storage();
  return _storage;
}
