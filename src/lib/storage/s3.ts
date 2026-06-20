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

/**
 * Build an RFC 6266 Content-Disposition for a presigned GET.
 * - `download` absent/false → no disposition (inline).
 * - `download === true`     → bare `attachment`.
 * - `download` is a filename → `attachment` with an ASCII fallback plus an
 *   RFC 5987 `filename*` so non-ASCII (e.g. Cyrillic) names render correctly
 *   and reliably across RF S3 providers / browsers. The ASCII fallback also
 *   neutralises `"`/`\` so the header can't be broken by the filename.
 */
function contentDisposition(download: boolean | string | undefined): string | undefined {
  if (typeof download === 'string') {
    const asciiFallback = download.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(download);
    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
  }
  return download === true ? 'attachment' : undefined;
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
    const disposition = contentDisposition(opts?.download);
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
  async remove(paths: string[]): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: paths.map((Key) => ({ Key })) }
        })
      );
    } catch (e) {
      throw new StorageError('remove', errMsg(e));
    }
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
