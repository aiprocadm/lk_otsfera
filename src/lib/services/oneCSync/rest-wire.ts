//
// EVERYTHING in this file depends on answers from the 1C integration meeting
// (docs/integrations/1c-meeting-agenda.md). Each constant is tagged with its
// DECISION Q#. If 1C answers "not REST" (Q1), this file + adapter-rest.ts are
// the only throwaway code — the rest of oneCSync is transport-agnostic.
import { translateFinancialStatus, translateExecutionStatus } from './translate';
import type { SyncCursor, OneCLeadPushPayload } from './dto';

// DECISION Q1: REST endpoint paths (or OData / file-export).
export const ENDPOINTS = {
  organizations: '/api/organizations',
  orders: '/api/orders',
  payments: '/api/payments',
  documents: '/api/documents',
  leadPush: '/api/leads',
  // Этап 8 (`У-167`): исходящие документы — тот же путь, что у входящего
  // `GET`, другой метод. Ключ отдельный намеренно: маршрут один, операции
  // разные, и в настройках их нельзя путать.
  documentPush: '/api/documents',
} as const;

// DECISION Q6/Q7: incremental cursor query param + datetime format on the wire.
export const SINCE_PARAM = 'since';
function formatSince(sinceIso: string): string {
  return sinceIso; // ISO passthrough; adjust if 1C wants МСК / no-offset (Q7).
}

// DECISION Q2: authentication. Bearer is the agenda default.
export function buildAuthHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// DECISION Q1/Q6: response envelope shape + pagination. A bare array means a
// single, complete page. An { items: [...] } object MAY carry an opaque
// `nextCursor` — when present, there are more pages and the caller must request
// the next one with PAGE_PARAM=nextCursor. The cursor is opaque to us (1C owns
// its meaning); we only echo it back.
export function parseEnvelope(raw: unknown): { items: unknown[]; nextCursor?: string | undefined } {
  if (Array.isArray(raw)) return { items: raw };
  if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) {
    const o = raw as { items: unknown[]; nextCursor?: unknown };
    const nextCursor =
      typeof o.nextCursor === 'string' && o.nextCursor.length > 0 ? o.nextCursor : undefined;
    return { items: o.items, nextCursor };
  }
  throw new Error('Unexpected 1C response envelope (expected JSON array or { items: [] })');
}

// DECISION Q6: query param carrying the opaque page cursor on follow-up requests.
export const PAGE_PARAM = 'cursor';

// Этап 8 (`У-172`): сверка спрашивает у 1С один документ по идентификатору
// кабинета — `GET /api/documents?externalId=` (контракт §7). Имя параметра
// одно на адаптер и на mock-1c, чтобы они не разъехались молча.
export const EXTERNAL_ID_PARAM = 'externalId';

export function buildUrl(
  baseUrl: string,
  path: string,
  cursor: SyncCursor,
  pageCursor?: string
): string {
  const url = new URL(path, baseUrl);
  if (cursor.since) url.searchParams.set(SINCE_PARAM, formatSince(cursor.since));
  if (pageCursor) url.searchParams.set(PAGE_PARAM, pageCursor);
  return url.toString();
}

// DECISION Q10: 1C natively emits Russian status names ("Оплачено", "Выполнен").
// Translate them to our internal enum codes here, at parity with the file adapter
// (which already calls translate.ts). Already-internal codes and unknown values
// pass through unchanged — unknowns are then quarantined by the per-record zod
// gate downstream (runRecordBatch), giving a visible report instead of silent loss.
export function normalizeOrderRecord(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  if (typeof r.financialStatus === 'string') {
    const t = translateFinancialStatus(r.financialStatus);
    if (t.ok) out.financialStatus = t.value;
  }
  if (typeof r.executionStatus === 'string') {
    const t = translateExecutionStatus(r.executionStatus);
    if (t.ok) out.executionStatus = t.value;
  }
  return out;
}

// DECISION Q5: the JSON field name carrying the partner key on the OUTBOUND
// lead-push body. The cabinet currently keys on Partner.slug in BOTH directions
// (see docs/integrations/1c-contract.md → "Ключ партнёра"):
//   • inbound orgs/orders arrive with `partnerExternalId`, matched against
//     Partner.slug in src/worker/processors/sync-organizations.ts;
//   • outbound lead push sends the slug under this field name.
// When the 1C meeting answers Q5, flip this ONE constant:
//   (A) slug stays the key  → leave as 'partnerSlug';
//   (B) 1C GUID is the key  → set to 'partnerExternalId' AND add a Partner.externalId
//       column (migration) + switch resolvePartnerId / push.ts mapLeadToPayload.
export const PARTNER_KEY_FIELD = 'partnerSlug';

// DECISION Q8: lead push body shape. Emit the partner key (Q5) under the agreed
// field name; pass the rest of the payload through unchanged.
export function buildLeadBody(payload: OneCLeadPushPayload): unknown {
  const { partnerSlug, partnerExternalId, ...rest } = payload;
  const partnerKeyValue = partnerSlug ?? partnerExternalId;
  return { [PARTNER_KEY_FIELD]: partnerKeyValue, ...rest };
}
