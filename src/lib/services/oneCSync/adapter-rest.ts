import type { OneCAdapter } from './adapter';
import type {
  OneCOrgDto, OneCOrderDto, OneCPaymentDto, OneCDocumentDto,
  OneCLeadPushPayload, OneCLeadPushResult, SyncCursor
} from './dto';
import { OneCLeadPushResultSchema } from './schemas';
import { withTimeout, withRetry, OneCHttpError } from './resilience';
import { ENDPOINTS, buildAuthHeader, buildUrl, buildLeadBody, unwrapEnvelope, normalizeOrderRecord } from './rest-wire';

export type RestAdapterConfig = { baseUrl: string; token: string };

async function doFetch(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) {
    const retryAfterHeader = Number(res.headers?.get?.('retry-after'));
    const retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : undefined;
    throw new OneCHttpError(res.status, `1C responded ${res.status} for ${url}`, retryAfter);
  }
  return res.json();
}

export class RestOneCAdapter implements OneCAdapter {
  constructor(private readonly config: RestAdapterConfig) {}

  private async getArray(path: string, cursor: SyncCursor): Promise<unknown[]> {
    const url = buildUrl(this.config.baseUrl, path, cursor);
    const headers = { ...buildAuthHeader(this.config.token), Accept: 'application/json' };
    const raw = await withRetry(() => withTimeout((signal) => doFetch(url, { method: 'GET', headers }, signal)));
    return unwrapEnvelope(raw);
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
    const headers = { ...buildAuthHeader(this.config.token), 'Content-Type': 'application/json', Accept: 'application/json' };
    const body = JSON.stringify(buildLeadBody(payload));
    const raw = await withRetry(() => withTimeout((signal) => doFetch(url, { method: 'POST', headers, body }, signal)));
    return OneCLeadPushResultSchema.parse(raw);
  }
}
