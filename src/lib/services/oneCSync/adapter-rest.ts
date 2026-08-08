import { OneCLeadPushResultSchema } from './schemas';
import { withTimeout, withRetry, OneCHttpError } from './resilience';
import {
  ENDPOINTS,
  buildAuthHeader,
  buildUrl,
  buildLeadBody,
  parseEnvelope,
  normalizeOrderRecord,
} from './rest-wire';
import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushPayload,
  OneCLeadPushResult,
  SyncCursor,
} from './dto';
import type { OneCAdapter } from './adapter';

export type RestAdapterConfig = { baseUrl: string; token: string };

// Runaway guard: a misbehaving server that always returns a nextCursor would
// otherwise loop forever. Far above any real page count — hitting it is a bug.
const MAX_PAGES = 10_000;

async function doFetch(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) {
    const retryAfterHeader = Number(res.headers?.get?.('retry-after'));
    const retryAfter =
      Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : undefined;
    throw new OneCHttpError(res.status, `1C responded ${res.status} for ${url}`, retryAfter);
  }
  return res.json();
}

export class RestOneCAdapter implements OneCAdapter {
  constructor(private readonly config: RestAdapterConfig) {}

  // Q6: follow `nextCursor` to exhaustion within a single pull, accumulating
  // every page. The `since` filter rides on every request; the opaque page cursor
  // is echoed back via PAGE_PARAM. Without this loop only page 1 is ingested and
  // the cursor advances past the unfetched rest → permanent silent undercount.
  private async getArray(path: string, cursor: SyncCursor): Promise<unknown[]> {
    const headers = { ...buildAuthHeader(this.config.token), Accept: 'application/json' };
    const all: unknown[] = [];
    let pageCursor: string | undefined;
    let pages = 0;
    do {
      const url = buildUrl(this.config.baseUrl, path, cursor, pageCursor);
      const raw = await withRetry(() =>
        withTimeout((signal) => doFetch(url, { method: 'GET', headers }, signal))
      );
      const { items, nextCursor } = parseEnvelope(raw);
      all.push(...items);
      pageCursor = nextCursor;
      pages += 1;
      /* v8 ignore next 5 -- MAX_PAGES=10_000 is a runaway guard; hitting it in a unit test would require 10k fetch mock calls. Диапазон покрывает ВЕСЬ блок (61-65): prettier разнёс `throw new Error(...)` на четыре строки, и прежний `next 3` не доставал до закрывающих `);`/`}`. */
      if (pages >= MAX_PAGES) {
        throw new Error(
          `1C pagination exceeded ${MAX_PAGES} pages for ${path} — aborting to avoid a runaway loop`
        );
      }
    } while (pageCursor);
    return all;
  }

  // Returned arrays are validated per-record downstream by runRecordBatch (schemas).
  pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]> {
    return this.getArray(ENDPOINTS.organizations, cursor) as Promise<OneCOrgDto[]>;
  }
  async pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]> {
    // Q10: translate Russian status names before the per-record zod gate.
    const rows = await this.getArray(ENDPOINTS.orders, cursor);
    return rows.map(normalizeOrderRecord) as OneCOrderDto[];
  }
  pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]> {
    return this.getArray(ENDPOINTS.payments, cursor) as Promise<OneCPaymentDto[]>;
  }
  pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]> {
    return this.getArray(ENDPOINTS.documents, cursor) as Promise<OneCDocumentDto[]>;
  }

  async pushLead(payload: OneCLeadPushPayload): Promise<OneCLeadPushResult> {
    const url = buildUrl(this.config.baseUrl, ENDPOINTS.leadPush, {});
    const headers = {
      ...buildAuthHeader(this.config.token),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const body = JSON.stringify(buildLeadBody(payload));
    const raw = await withRetry(() =>
      withTimeout((signal) => doFetch(url, { method: 'POST', headers, body }, signal))
    );
    return OneCLeadPushResultSchema.parse(raw);
  }
}
