/**
 * Provider-agnostic object-storage port. The single boundary between the app
 * and whatever S3-compatible backend holds documents/attachments. Methods
 * THROW StorageError on provider failure (CLAUDE.md §3 boundary-catch): callers
 * already sit inside try/catch and map it to their Result code / HTTP status.
 */
export type StorageOp = 'upload' | 'sign' | 'remove' | 'download';

export class StorageError extends Error {
  constructor(
    public readonly op: StorageOp,
    message: string
  ) {
    super(`STORAGE_${op.toUpperCase()}: ${message}`);
    this.name = 'StorageError';
  }
}

export interface ObjectStorage {
  /**
   * Store an object. Overwrite semantics are best-effort: callers guarantee key
   * uniqueness via a randomUUID() in the path (Supabase's upsert:false is not
   * portably expressible across RF S3 providers).
   */
  upload(path: string, body: Buffer, opts: { contentType: string }): Promise<void>;
  /**
   * Presigned GET URL. `download` controls Content-Disposition:
   *   string  → `attachment; filename="<name>"`
   *   true    → `attachment` (browser names from key)
   *   absent/false → no header (inline view)
   */
  createSignedUrl(
    path: string,
    ttlSeconds: number,
    opts?: { download?: boolean | string }
  ): Promise<string>;
  remove(paths: string[]): Promise<void>;
  download(path: string): Promise<Buffer>;
}

export const documentBucket = process.env.S3_BUCKET ?? 'documents';
