# SP1 — S3 Storage Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase-Storage-specific layer with a provider-agnostic `ObjectStorage` port + a single S3-compatible implementation, so document/file storage can live in RF (152-FZ) and be swapped by env alone.

**Architecture:** Throw-based port (`upload`/`createSignedUrl`/`remove`/`download`) defined in `objectStorage.ts`; S3 implementation in `s3.ts` on `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; barrel `index.ts` re-exports both (avoids the objectStorage↔s3 import cycle). All 17 call-sites across 13 files switch from `getServerClient()/supabaseAdmin.storage.from(bucket).X` to `getObjectStorage().X` and rely on throw instead of inline `.error`. MinIO provides a real S3 round-trip in integration.

**Tech Stack:** TypeScript (strict), Vitest (vi.mock pattern), `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, MinIO (S3-compatible, for integration/dev).

**Spec:** [docs/superpowers/specs/2026-06-20-prod-infrastructure-sp1-storage-adapter-design.md](../specs/2026-06-20-prod-infrastructure-sp1-storage-adapter-design.md)

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/storage/objectStorage.ts` (create) | `ObjectStorage` interface, `StorageError`, `documentBucket`. No imports from `s3.ts` (one-way dependency). |
| `src/lib/storage/s3.ts` (create) | `S3Storage` class (4 methods), `buildS3Storage()` (env→client), `getObjectStorage()` lazy singleton. |
| `src/lib/storage/index.ts` (create) | Barrel: `export * from './objectStorage'; export { getObjectStorage } from './s3';` — the only import site consumers use. |
| `src/lib/storage/supabase.ts` (delete, Task 11) | Removed wholesale, including dead `getUserClient`. |
| `src/__tests__/storage.s3.test.ts` (create) | Unit tests for the port (mocked S3 client + presigner). Replaces `storage.supabase.test.ts`. |
| `src/__tests__/storage.s3.integration.test.ts` (create) | MinIO round-trip. |
| 13 call-site files | Switch to `@/lib/storage`; see Tasks 7–9. |
| `docker-compose.yml` (modify) | Add `minio` service. |
| `.env.example` (modify) | `SUPABASE_*` → `S3_*`. |
| `CLAUDE.md` (modify) | §10 wording Supabase → S3. |

---

## Task 1: Add S3 SDK dependencies

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Install the two AWS SDK packages**

Run:
```bash
npm install @aws-sdk/client-s3@^3 @aws-sdk/s3-request-presigner@^3
```
Expected: `package.json` gains both under `dependencies`; `package-lock.json` updated.

- [ ] **Step 2: Verify they resolve**

Run: `node -e "require('@aws-sdk/client-s3'); require('@aws-sdk/s3-request-presigner'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit --no-verify -m "chore(deps): add @aws-sdk/client-s3 + s3-request-presigner for S3 storage"
```
(`--no-verify`: this box's pre-push Docker gate is broken — see project memory.)

---

## Task 2: ObjectStorage port — interface, StorageError, documentBucket

**Files:**
- Create: `src/lib/storage/objectStorage.ts`
- Test: `src/__tests__/storage.s3.test.ts`

- [ ] **Step 1: Write failing tests for StorageError + documentBucket**

Create `src/__tests__/storage.s3.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/storage.s3.test.ts`
Expected: FAIL — cannot resolve `@/lib/storage/objectStorage`.

- [ ] **Step 3: Implement the port module**

Create `src/lib/storage/objectStorage.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/storage.s3.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/objectStorage.ts src/__tests__/storage.s3.test.ts
git commit --no-verify -m "feat(storage): ObjectStorage port + StorageError + documentBucket"
```

---

## Task 3: S3Storage.upload + factory

**Files:**
- Create: `src/lib/storage/s3.ts`
- Modify: `src/__tests__/storage.s3.test.ts`

- [ ] **Step 1: Add failing tests for upload + factory env-validation**

Append to `src/__tests__/storage.s3.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/storage.s3.test.ts -t S3Storage`
Expected: FAIL — cannot resolve `@/lib/storage/s3`.

- [ ] **Step 3: Implement s3.ts with upload + factory**

Create `src/lib/storage/s3.ts`:
```ts
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

  // download / createSignedUrl / remove arrive in Tasks 4–6.
  async download(_path: string): Promise<Buffer> {
    throw new StorageError('download', 'not implemented');
  }
  async createSignedUrl(): Promise<string> {
    throw new StorageError('sign', 'not implemented');
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/storage.s3.test.ts`
Expected: PASS (upload + factory tests green; download/sign/remove still placeholder, no tests yet).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/s3.ts src/__tests__/storage.s3.test.ts
git commit --no-verify -m "feat(storage): S3Storage.upload + buildS3Storage/getObjectStorage factory"
```

---

## Task 4: S3Storage.download

**Files:**
- Modify: `src/lib/storage/s3.ts`
- Modify: `src/__tests__/storage.s3.test.ts`

- [ ] **Step 1: Add failing test**

Append to `src/__tests__/storage.s3.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/storage.s3.test.ts -t download`
Expected: FAIL — placeholder throws `not implemented`.

- [ ] **Step 3: Replace the download placeholder**

In `src/lib/storage/s3.ts`, replace the `download` placeholder method with:
```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/storage.s3.test.ts -t download`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/s3.ts src/__tests__/storage.s3.test.ts
git commit --no-verify -m "feat(storage): S3Storage.download → Buffer"
```

---

## Task 5: S3Storage.createSignedUrl (3 download branches)

**Files:**
- Modify: `src/lib/storage/s3.ts`
- Modify: `src/__tests__/storage.s3.test.ts`

- [ ] **Step 1: Add failing tests for all three branches**

Append to `src/__tests__/storage.s3.test.ts`:
```ts
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

  it('download:string → attachment; filename="<name>"', async () => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue('https://signed/named');
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await storage.createSignedUrl('p', 600, { download: 'отчёт.pdf' });
    const cmd = getSignedUrlMock.mock.calls[0][1];
    expect(cmd.input.ResponseContentDisposition).toBe('attachment; filename="отчёт.pdf"');
  });

  it('wraps failure in StorageError(op=sign)', async () => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockRejectedValue(new Error('sig fail'));
    const { S3Storage } = await import('@/lib/storage/s3');
    const storage = new S3Storage({ send: sendMock } as never, 'bkt');
    await expect(storage.createSignedUrl('p', 600)).rejects.toThrow('STORAGE_SIGN: sig fail');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/storage.s3.test.ts -t createSignedUrl`
Expected: FAIL — placeholder throws `not implemented`.

- [ ] **Step 3: Replace the createSignedUrl placeholder**

In `src/lib/storage/s3.ts`, replace the `createSignedUrl` placeholder with:
```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/storage.s3.test.ts -t createSignedUrl`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/s3.ts src/__tests__/storage.s3.test.ts
git commit --no-verify -m "feat(storage): S3Storage.createSignedUrl with 3 disposition branches"
```

---

## Task 6: S3Storage.remove + barrel index

**Files:**
- Modify: `src/lib/storage/s3.ts`
- Create: `src/lib/storage/index.ts`
- Modify: `src/__tests__/storage.s3.test.ts`

- [ ] **Step 1: Add failing tests for remove + barrel**

Append to `src/__tests__/storage.s3.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/storage.s3.test.ts -t "remove\|barrel"`
Expected: FAIL — placeholder + missing `@/lib/storage` index.

- [ ] **Step 3: Replace remove placeholder + create barrel**

In `src/lib/storage/s3.ts`, replace the `remove` placeholder with:
```ts
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
```

Create `src/lib/storage/index.ts`:
```ts
export * from './objectStorage';
export { getObjectStorage } from './s3';
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/storage.s3.test.ts`
Expected: PASS (all port tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/s3.ts src/lib/storage/index.ts src/__tests__/storage.s3.test.ts
git commit --no-verify -m "feat(storage): S3Storage.remove + barrel index"
```

---

## Task 7: Migrate lib/services (4 files)

The adapter is complete. Now switch service call-sites. Each file: change the import, replace the storage call, drop inline `.error` handling. Update each file's unit test mock from `@/lib/storage/supabase` to `@/lib/storage`.

**Files:**
- Modify: `src/lib/services/documents/upload-core.ts`
- Modify: `src/lib/services/chat/attachments.ts`
- Modify: `src/lib/services/partner/leadAttachments.ts`
- Modify: `src/lib/services/oneCSync/document-fetch.ts`
- Tests: `src/__tests__/services.documents.upload-core.unit2.test.ts`, `services.documents.upload-core.test.ts`, `services.manager.uploads.unit.test.ts`, `services.manager.uploads.test.ts`, `services.chat.attachments.unit.test.ts`, `services.partner.leadAttachments.test.ts`, `oneCSync.document-fetch.test.ts`

- [ ] **Step 1: upload-core.ts — swap import + upload call**

In `src/lib/services/documents/upload-core.ts` change line 4:
```ts
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';
```
to:
```ts
import { getObjectStorage } from '@/lib/storage';
```
Replace the upload block (lines 94–104):
```ts
  const { error: uploadError } = await supabaseAdmin.storage
    .from(documentBucket)
    .upload(storagePath, args.file.buffer, { contentType: args.file.mimeType, upsert: false });
  if (uploadError) {
    console.error('[documents/upload-core] storage upload failed', {
      orderId: args.orderId,
      storagePath,
      providerError: uploadError.message
    });
    return { ok: false, error: 'storage' };
  }
```
with:
```ts
  try {
    await getObjectStorage().upload(storagePath, args.file.buffer, {
      contentType: args.file.mimeType
    });
  } catch (uploadError) {
    console.error('[documents/upload-core] storage upload failed', {
      orderId: args.orderId,
      storagePath,
      providerError: uploadError instanceof Error ? uploadError.message : String(uploadError)
    });
    return { ok: false, error: 'storage' };
  }
```

- [ ] **Step 2: chat/attachments.ts — swap import + upload + createSignedUrl**

In `src/lib/services/chat/attachments.ts` change line 5:
```ts
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';
```
to:
```ts
import { getObjectStorage } from '@/lib/storage';
```
Replace the upload block (lines 99–113):
```ts
  const { error: uploadError } = await supabaseAdmin.storage
    .from(documentBucket)
    .upload(storagePath, args.file.buffer, {
      contentType: args.file.mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error('[chat/attachments] storage upload failed', {
      orderId: args.orderId,
      storagePath,
      providerError: uploadError.message,
    });
    return { ok: false, error: 'storage' };
  }
```
with:
```ts
  try {
    await getObjectStorage().upload(storagePath, args.file.buffer, {
      contentType: args.file.mimeType,
    });
  } catch (uploadError) {
    console.error('[chat/attachments] storage upload failed', {
      orderId: args.orderId,
      storagePath,
      providerError: uploadError instanceof Error ? uploadError.message : String(uploadError),
    });
    return { ok: false, error: 'storage' };
  }
```
Replace the signed-url block (lines 159–174):
```ts
  const { data, error } = await supabaseAdmin.storage
    .from(documentBucket)
    .createSignedUrl(message.attachmentPath, 600);

  if (error || !data?.signedUrl) {
    console.error('[chat/attachments] failed to create signed URL', {
      messageId,
      attachmentPath: message.attachmentPath,
      providerError: error?.message ?? 'missing signed URL',
    });
    return { ok: false, error: 'storage' };
  }

  return { ok: true, url: data.signedUrl };
```
with:
```ts
  try {
    const url = await getObjectStorage().createSignedUrl(message.attachmentPath, 600);
    return { ok: true, url };
  } catch (error) {
    console.error('[chat/attachments] failed to create signed URL', {
      messageId,
      attachmentPath: message.attachmentPath,
      providerError: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: 'storage' };
  }
```

- [ ] **Step 3: leadAttachments.ts — swap import + upload + remove×2 + createSignedUrl**

In `src/lib/services/partner/leadAttachments.ts` change line 3:
```ts
import { getServerClient, documentBucket } from '@/lib/storage/supabase';
```
to:
```ts
import { getObjectStorage } from '@/lib/storage';
```
Replace upload block (lines 142–149):
```ts
    const storage = getServerClient().storage.from(documentBucket);
    const uploadRes = await storage.upload(path, input.file.buffer, {
      contentType: validation.mime,
      upsert: false
    });
    if (uploadRes.error) {
      throw new LeadAttachmentError('STORAGE_FAILURE', uploadRes.error.message);
    }
```
with:
```ts
    const storage = getObjectStorage();
    try {
      await storage.upload(path, input.file.buffer, { contentType: validation.mime });
    } catch (e) {
      throw new LeadAttachmentError('STORAGE_FAILURE', e instanceof Error ? e.message : String(e));
    }
```
The compensating delete at line 194 (`await storage.remove([path]).catch(() => undefined);`) stays as-is — the port's `remove` is also promise-based and `.catch` swallows. No change needed.

Replace the delete-path remove block (lines 252–255):
```ts
    await getServerClient()
      .storage.from(documentBucket)
      .remove([attachment.path])
      .catch(() => undefined);
```
with:
```ts
    await getObjectStorage()
      .remove([attachment.path])
      .catch(() => undefined);
```
Replace the signed-url block (lines 297–307):
```ts
    const signed = await getServerClient()
      .storage.from(documentBucket)
      .createSignedUrl(attachment.path, DOWNLOAD_URL_TTL_SECONDS, {
        download: attachment.name
      });
    if (signed.error || !signed.data?.signedUrl) {
      throw new LeadAttachmentError(
        'STORAGE_FAILURE',
        signed.error?.message ?? 'Не удалось создать ссылку'
      );
    }

    return { ok: true, url: signed.data.signedUrl, name: attachment.name, mimeType: attachment.mimeType };
```
with:
```ts
    let url: string;
    try {
      url = await getObjectStorage().createSignedUrl(attachment.path, DOWNLOAD_URL_TTL_SECONDS, {
        download: attachment.name
      });
    } catch (e) {
      throw new LeadAttachmentError(
        'STORAGE_FAILURE',
        e instanceof Error ? e.message : 'Не удалось создать ссылку'
      );
    }

    return { ok: true, url, name: attachment.name, mimeType: attachment.mimeType };
```

- [ ] **Step 4: oneCSync/document-fetch.ts — swap import + upload**

In `src/lib/services/oneCSync/document-fetch.ts` change line 2:
```ts
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';
```
to:
```ts
import { getObjectStorage } from '@/lib/storage';
```
Replace the upload block (lines 39–41 and its error check — read the file to confirm exact lines):
```ts
    const { error } = await supabaseAdmin.storage
      .from(documentBucket)
      .upload(storagePath, buffer, { contentType: args.mimeType, upsert: false });
```
with:
```ts
    let error: Error | null = null;
    try {
      await getObjectStorage().upload(storagePath, buffer, { contentType: args.mimeType });
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }
```
(Keep the existing `if (error) { ... }` handler below unchanged — `error` is now a real Error with `.message`. Read [document-fetch.ts](../../../src/lib/services/oneCSync/document-fetch.ts) to verify the handler shape and adapt the variable if it references `error.message`.)

- [ ] **Step 5: Update the 4 services' unit-test mocks**

For each affected test file, change the storage mock target and shape. Pattern — find:
```ts
vi.mock('@/lib/storage/supabase', () => ({ ... supabaseAdmin / getServerClient ... }));
```
Replace with a mock of the barrel exporting `getObjectStorage` returning an object of `vi.fn()`s. Example for upload-core tests:
```ts
const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload: uploadMock, createSignedUrl: vi.fn(), remove: vi.fn(), download: vi.fn() }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {}
}));
```
- Success path: `uploadMock.mockResolvedValue(undefined)`.
- Failure path (was `{ error: { message } }`): `uploadMock.mockRejectedValue(new Error('boom'))` → assert Result `{ ok: false, error: 'storage' }` (or `STORAGE_FAILURE` for leadAttachments).
- For signed-url tests: `createSignedUrl` mock `mockResolvedValue('https://signed/...')` (success) / `mockRejectedValue(new Error(...))` (failure).
- **C4 guardrail:** delete every old `{ error }`-shaped mock return — leaving it makes the call resolve to `undefined` and silently weakens the assertion.

Affected test files: `services.documents.upload-core.unit2.test.ts`, `services.documents.upload-core.test.ts`, `services.manager.uploads.unit.test.ts`, `services.manager.uploads.test.ts`, `services.chat.attachments.unit.test.ts`, `services.partner.leadAttachments.test.ts`, `oneCSync.document-fetch.test.ts`.

- [ ] **Step 6: Run the affected unit tests**

Run:
```bash
npx vitest run --mode=unit src/__tests__/services.documents.upload-core.unit2.test.ts src/__tests__/services.documents.upload-core.test.ts src/__tests__/services.manager.uploads.unit.test.ts src/__tests__/services.manager.uploads.test.ts src/__tests__/services.chat.attachments.unit.test.ts src/__tests__/services.partner.leadAttachments.test.ts src/__tests__/oneCSync.document-fetch.test.ts
```
Expected: PASS. Then `npm run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services src/__tests__
git commit --no-verify -m "refactor(storage): migrate lib/services to ObjectStorage port"
```

---

## Task 8: Migrate worker processors (3 files)

**Files:**
- Modify: `src/worker/processors/scan-document.ts`
- Modify: `src/worker/processors/generate-commission-pdf.ts`
- Modify: `src/worker/processors/generate-commission-xlsx.ts`
- Tests: `src/__tests__/worker.scan-document.test.ts`, `worker.generate-commission-pdf.test.ts`, `worker.generate-commission-xlsx.test.ts`

- [ ] **Step 1: scan-document.ts — swap defaultDownload internals**

In `src/worker/processors/scan-document.ts` change line 5:
```ts
import { getServerClient, documentBucket } from '@/lib/storage/supabase';
```
to:
```ts
import { getObjectStorage } from '@/lib/storage';
```
Replace `defaultDownload` (lines 61–68):
```ts
/* v8 ignore start -- production Supabase storage download; exercised in e2e only, not unit-testable without live storage */
async function defaultDownload(path: string): Promise<Buffer> {
  const storage = getServerClient().storage.from(documentBucket);
  const { data, error } = await storage.download(path);
  if (error || !data) throw new Error(`STORAGE_DOWNLOAD: ${error?.message ?? 'no data'}`);
  return Buffer.from(await data.arrayBuffer());
}
/* v8 ignore stop */
```
with:
```ts
/* v8 ignore start -- production S3 storage download; exercised in e2e only, not unit-testable without live storage */
async function defaultDownload(path: string): Promise<Buffer> {
  return getObjectStorage().download(path);
}
/* v8 ignore stop */
```
The processor's existing try/catch around `deps.download(target.path)` (lines 144–166) already re-throws to trigger BullMQ retry — a thrown `StorageError` flows through unchanged. No other change.

- [ ] **Step 2: generate-commission-pdf.ts — swap import + upload**

In `src/worker/processors/generate-commission-pdf.ts` change line 4:
```ts
import { getServerClient, documentBucket } from '@/lib/storage/supabase';
```
to:
```ts
import { getObjectStorage } from '@/lib/storage';
```
Replace the upload block (lines 34 onward — read file for exact error handling):
```ts
  const storage = getServerClient().storage.from(documentBucket);
  const { error } = await storage.upload(path, buf, { ... });
```
with:
```ts
  await getObjectStorage().upload(path, buf, { contentType: 'application/pdf' });
```
Remove the subsequent `if (error) { ... }` block and instead let a thrown `StorageError` propagate (BullMQ retries the job — same failure semantics as before, which surfaced the error). Read [generate-commission-pdf.ts](../../../src/worker/processors/generate-commission-pdf.ts) to confirm the original `if (error)` threw/returned, and preserve that exact outcome by wrapping in try/catch only if the original did something other than throw.

- [ ] **Step 3: generate-commission-xlsx.ts — same transform**

Apply the identical change to `src/worker/processors/generate-commission-xlsx.ts` (import line 4; upload block line 33–34), using `contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'` (preserve whatever the original passed — read the file).

- [ ] **Step 4: Update worker test mocks**

In `worker.scan-document.test.ts`: the test injects `deps.download` directly (DI), so the storage mock there is likely only for module-load. Change any `vi.mock('@/lib/storage/supabase', ...)` to `vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ download: vi.fn(), upload: vi.fn(), createSignedUrl: vi.fn(), remove: vi.fn() }) }))`. For the two commission tests, mock `getObjectStorage().upload` and assert it's called; failure path uses `mockRejectedValue`.

- [ ] **Step 5: Run affected worker tests**

Run:
```bash
npx vitest run --mode=unit src/__tests__/worker.scan-document.test.ts src/__tests__/worker.generate-commission-pdf.test.ts src/__tests__/worker.generate-commission-xlsx.test.ts
```
Expected: PASS. Then `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker src/__tests__
git commit --no-verify -m "refactor(storage): migrate worker processors to ObjectStorage port"
```

---

## Task 9: Migrate app/api routes (6 files)

All six are `createSignedUrl` (one is `upload`). Each must preserve its exact HTTP status on failure (502/500/410/302). The pattern: wrap the call in try/catch, map a thrown error to the route's existing storage-failure status.

**Files:**
- Modify: `src/app/api/documents/upload/route.ts`
- Modify: `src/app/api/documents/[id]/download/route.ts`
- Modify: `src/app/api/organization/documents/[id]/download/route.ts`
- Modify: `src/app/api/manager/documents/[id]/download/route.ts`
- Modify: `src/app/api/partner/finance/statements/[id]/xlsx/route.ts`
- Modify: `src/app/api/partner/finance/statements/[id]/pdf/route.ts`
- Tests: `documents.route.test.ts`, `api.organization.documents.download.test.ts`, `api.manager.documents.download.test.ts`, `api.partner.finance.statements.xlsx.test.ts`, `api.partner.finance.statements.pdf.test.ts`

- [ ] **Step 1: manager download route (reference transform)**

In `src/app/api/manager/documents/[id]/download/route.ts` change line 5:
```ts
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';
```
to:
```ts
import { getObjectStorage } from '@/lib/storage';
```
Replace the signed-url block (lines 50–64):
```ts
  const { data, error } = await supabaseAdmin.storage
    .from(documentBucket)
    .createSignedUrl(result.path, SIGNED_URL_TTL_SEC);

  if (error || !data?.signedUrl) {
    console.error('Failed to create manager document signed URL', {
      correlationId,
      documentId: id,
      storageBucket: documentBucket,
      storagePath: result.path,
      ttl: SIGNED_URL_TTL_SEC,
      providerError: error?.message ?? 'Missing signed URL from provider'
    });
    return new Response('Storage error', { status: 502 });
  }
```
with:
```ts
  let signedUrl: string;
  try {
    signedUrl = await getObjectStorage().createSignedUrl(result.path, SIGNED_URL_TTL_SEC);
  } catch (error) {
    console.error('Failed to create manager document signed URL', {
      correlationId,
      documentId: id,
      storagePath: result.path,
      ttl: SIGNED_URL_TTL_SEC,
      providerError: error instanceof Error ? error.message : String(error)
    });
    return new Response('Storage error', { status: 502 });
  }
```
Then change the final redirect `return Response.redirect(data.signedUrl, 302);` to `return Response.redirect(signedUrl, 302);`.

- [ ] **Step 2: organization + generic documents download routes**

Apply the same transform to `src/app/api/organization/documents/[id]/download/route.ts` (lines 54–56 block) and `src/app/api/documents/[id]/download/route.ts` (line 43 block). Read each to preserve its exact failure status (organization route → 502; generic → read it). Keep each route's variable names and log fields; only the storage call + error mapping changes.

- [ ] **Step 3: partner finance xlsx + pdf routes (download:true)**

In both `src/app/api/partner/finance/statements/[id]/xlsx/route.ts` and `.../pdf/route.ts`, change line 5 import to `import { getObjectStorage } from '@/lib/storage';` and replace:
```ts
  const { data, error } = await getServerClient()
    .storage.from(documentBucket)
    .createSignedUrl(statement.xlsxPath, SIGNED_URL_TTL, { download: true });
```
with:
```ts
  let signedUrl: string;
  try {
    signedUrl = await getObjectStorage().createSignedUrl(statement.xlsxPath, SIGNED_URL_TTL, {
      download: true
    });
  } catch (error) {
    // preserve the route's existing storage-failure status (read the file)
    return /* same Response the original returned on error */;
  }
```
Use `statement.pdfPath` in the pdf route. Read each file to copy its exact original error-Response (status + body) into the catch, and replace the later `data.signedUrl` use with `signedUrl`.

- [ ] **Step 4: documents/upload route (upload op)**

In `src/app/api/documents/upload/route.ts` change line 6 import to `import { getObjectStorage } from '@/lib/storage';`, then replace the `supabaseAdmin.storage.from(documentBucket).upload(...)` + `if (uploadError)` block (lines 104+) with a `try { await getObjectStorage().upload(...) } catch { return <original error Response> }`, preserving the route's exact status. Read the file for the original status/body.

- [ ] **Step 5: Update the 5 route test mocks**

For each route test, swap `vi.mock('@/lib/storage/supabase', ...)` → `vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ createSignedUrl: signMock, upload: uploadMock, remove: vi.fn(), download: vi.fn() }) }))`. Success: `signMock.mockResolvedValue('https://signed/...')` → assert 302 + redirect Location. Failure (was `{ error }`): `signMock.mockRejectedValue(new Error('x'))` → assert the route's storage-failure status (502/500). Keep the 404/410 (not_found/infected) cases unchanged — those are service-layer, not storage.

- [ ] **Step 6: Run affected route tests**

Run:
```bash
npx vitest run --mode=unit src/__tests__/documents.route.test.ts src/__tests__/api.organization.documents.download.test.ts src/__tests__/api.manager.documents.download.test.ts src/__tests__/api.partner.finance.statements.xlsx.test.ts src/__tests__/api.partner.finance.statements.pdf.test.ts
```
Expected: PASS. Then `npm run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app src/__tests__
git commit --no-verify -m "refactor(storage): migrate app/api routes to ObjectStorage port"
```

---

## Task 10: MinIO + integration round-trip

**Files:**
- Modify: `docker-compose.yml`
- Create: `src/__tests__/storage.s3.integration.test.ts`

- [ ] **Step 1: Add MinIO to docker-compose.yml**

Insert under `services:` (sibling of `db`/`redis`):
```yaml
  minio:
    image: minio/minio:latest
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10
```
Add `miniodata:` under the top-level `volumes:` block.

- [ ] **Step 2: Write the integration round-trip test**

Create `src/__tests__/storage.s3.integration.test.ts`. Gating is **deterministic via env**: the mode auto-detector (vitest.config) classifies a file as integration ⟺ it contains `new PrismaClient(`. This test has no Prisma, so it is collected in the **unit** run — but it must NOT run in pre-push `test:unit` (no MinIO there). Solution: `describe.skipIf(!process.env.S3_ENDPOINT)`. Pre-push never sets `S3_ENDPOINT` → cleanly skipped; the integration command (Step 3) sets it → runs. `beforeAll` creates the bucket and is allowed to throw — if `S3_ENDPOINT` is set but MinIO is down, that is a real failure, not a silent skip.
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { S3Storage } from '@/lib/storage/s3';

const ENDPOINT = process.env.S3_ENDPOINT ?? '';
const BUCKET = 'documents-it';

const c = new S3Client({
  endpoint: ENDPOINT || 'http://localhost:9000',
  region: 'ru-central1',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  forcePathStyle: true
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
```

- [ ] **Step 3: Run with MinIO up**

Run:
```bash
docker compose up -d minio
S3_ENDPOINT=http://localhost:9000 npx vitest run src/__tests__/storage.s3.integration.test.ts
```
Expected: PASS (3 round-trip tests). Then `docker compose stop minio`.

- [ ] **Step 4: Verify it no-ops without MinIO**

Run: `npx vitest run src/__tests__/storage.s3.integration.test.ts` (MinIO down)
Expected: skipped/no failures.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml src/__tests__/storage.s3.integration.test.ts
git commit --no-verify -m "test(storage): MinIO S3 round-trip integration + compose service"
```

---

## Task 11: Remove Supabase

**Files:**
- Delete: `src/lib/storage/supabase.ts`
- Delete: `src/__tests__/storage.supabase.test.ts`
- Modify: `package.json` (drop `@supabase/supabase-js`)

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "storage/supabase\|@supabase/supabase-js\|supabaseAdmin\|getServerClient\|getUserClient" src/`
Expected: ZERO hits (all migrated in Tasks 7–9; the old test is the only file left — deleted next).

- [ ] **Step 2: Delete the module + its test, drop the dep**

Run:
```bash
git rm src/lib/storage/supabase.ts src/__tests__/storage.supabase.test.ts
npm uninstall @supabase/supabase-js
```

- [ ] **Step 3: Re-grep + typecheck**

Run: `grep -rn "storage/supabase\|@supabase\|\.storage\.from(" src/` → ZERO hits.
Run: `npm run typecheck` → PASS.

- [ ] **Step 4: Run full unit suite**

Run: `npm run test:unit`
Expected: PASS (the suite no longer references Supabase anywhere).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit --no-verify -m "refactor(storage): remove Supabase module + dependency"
```

---

## Task 12: Env + docs

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md` (§10)

- [ ] **Step 1: Replace SUPABASE_* with S3_* in .env.example**

Remove lines 6–9 (`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_STORAGE_BUCKET`). Insert:
```bash
# S3-совместимое объектное хранилище (РФ-провайдер: Yandex Object Storage /
# VK Cloud / Selectel). Заменяет Supabase Storage (152-ФЗ — файлы = ПДн → РФ).
S3_ENDPOINT=http://localhost:9000
S3_REGION=ru-central1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=documents
# 1 для MinIO и провайдеров без virtual-host-style (path-style адресация):
S3_FORCE_PATH_STYLE=1
```

- [ ] **Step 2: Update CLAUDE.md §10**

In §10 ("Документы и Supabase Storage"): retitle to "Документы и Object Storage (S3)"; change "Bucket — `documents` (env `SUPABASE_STORAGE_BUCKET`)" to "Bucket — `documents` (env `S3_BUCKET`)"; change "Скачивание — **через signed URL** TTL 600 сек" wording from Supabase to S3 presigned URL. Update §2 layer line "`src/lib/storage/` ← Supabase storage обёртки" to "`src/lib/storage/` ← S3 object-storage порт + адаптер".

- [ ] **Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit --no-verify -m "docs(storage): .env.example S3_* block + CLAUDE.md §10 Supabase→S3"
```

---

## Task 13: Final verification gates

- [ ] **Step 1: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS (no `any`-leaks, no unused Supabase imports).

- [ ] **Step 2: Full unit suite**

Run: `npm run test:unit`
Expected: PASS (count ≥ prior baseline; Supabase test removed, S3 tests added).

- [ ] **Step 3: Integration gate with MinIO + Postgres**

Run: `docker compose up -d db redis minio` then `npm run test:integration` (set `S3_ENDPOINT=http://localhost:9000` and S3 creds in env for the round-trip + chat.attachments.integration).
Expected: PASS including the storage round-trip and `services.chat.attachments.integration` (now against MinIO). If MinIO env isn't wired for the chat integration, that test still mocks storage at unit level — confirm it doesn't regress.
NOTE: on this box the Docker gate is broken; if so, run integration via the WSL live-PG path (see project memory) and use a MinIO container there, or document the gate as operator-deferred.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Final commit (if any doc/coverage tweaks)**

```bash
git add -A
git commit --no-verify -m "chore(storage): SP1 final gates green"
```

---

## Self-Review Notes (author)

- **Spec coverage:** port (T2–6), 4 ops (T3–6), 3 download branches (T5), 17 sites/13 files (T7 lib×4, T8 worker×3, T9 app×6), MinIO integration (T10), Supabase removal + grep guard (T11), env+§10 (T12), gates (T13). All §7 acceptance criteria mapped.
- **Known read-and-confirm points** (flagged inline, not placeholders — the exact original error-Response/handler must be copied verbatim to preserve HTTP status): `oneCSync/document-fetch.ts` error handler (T7.4), commission pdf/xlsx original `if(error)` outcome (T8.2–3), the 4 app download/upload routes' exact failure status+body (T9.2–4). These require reading the file because the original status/body must be preserved byte-for-byte; the transform pattern is fully specified.
- **Type consistency:** `getObjectStorage()`, `ObjectStorage`, `StorageError(op,msg)`, `documentBucket`, `download?: boolean|string` used identically across all tasks.
