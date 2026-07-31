import { randomUUID } from 'node:crypto';
import { getObjectStorage } from '@/lib/storage';
import { log } from '@/lib/logging';
import { withTimeout, withRetry, OneCHttpError } from './resilience';

/**
 * DOC-03: a 1C document arrives as an external download URL. Storing that URL in
 * Document.path would break every download route (they call the object-storage
 * createSignedUrl, which expects a bucket key). So we fetch the file from 1C and
 * upload it into the same `documents` bucket as user uploads, returning the
 * storage KEY. The caller then writes that key as path and enqueues a ClamAV scan
 * — keeping 1C docs on the same signed-URL + scan path as everything else
 * (CLAUDE.md §10: never serve a file directly).
 *
 * Best-effort: returns null on any fetch/upload failure so the sync skips the doc
 * (with a visible reason) instead of crashing the batch (§3 graceful degrade).
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function fetchAndStore1CDocument(args: {
  url: string;
  orderId: string;
  name: string;
  mimeType: string;
}): Promise<string | null> {
  try {
    const buffer = await withRetry(() =>
      withTimeout(async (signal) => {
        const res = await fetch(args.url, { signal });
        // OneCHttpError so withRetry's isTransient applies HTTP semantics: 404 fails
        // fast (no retry), 503/504 retry.
        if (!res.ok)
          throw new OneCHttpError(
            res.status,
            `1C document fetch responded ${res.status} for ${args.url}`
          );
        return Buffer.from(await res.arrayBuffer());
      })
    );

    const storagePath = `orders/${args.orderId}/1c/${randomUUID()}-${sanitizeFilename(args.name)}`;
    try {
      await getObjectStorage().upload(storagePath, buffer, { contentType: args.mimeType });
    } catch (e) {
      log.warn('[1c] document store failed', {
        url: args.url,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
    return storagePath;
  } catch (err) {
    log.warn('[1c] document fetch failed', {
      url: args.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
