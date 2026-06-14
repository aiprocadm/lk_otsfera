//
// EVERYTHING in this file depends on answers from the 1C integration meeting
// (docs/integrations/1c-meeting-agenda.md). Each constant is tagged with its
// DECISION Q#. If 1C answers "not REST" (Q1), this file + adapter-rest.ts are
// the only throwaway code — the rest of oneCSync is transport-agnostic.
import type { SyncCursor, OneCLeadPushPayload } from './dto';
import { translateFinancialStatus, translateExecutionStatus } from './translate';

// DECISION Q1: REST endpoint paths (or OData / file-export).
export const ENDPOINTS = {
  organizations: '/api/organizations',
  orders: '/api/orders',
  payments: '/api/payments',
  documents: '/api/documents',
  leadPush: '/api/leads'
} as const;

// DECISION Q6/Q7: incremental cursor query param + datetime format on the wire.
export const SINCE_PARAM = 'since';
export function formatSince(sinceIso: string): string {
  return sinceIso; // ISO passthrough; adjust if 1C wants МСК / no-offset (Q7).
}

// DECISION Q2: authentication. Bearer is the agenda default.
export function buildAuthHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// DECISION Q1: response envelope shape. Assume a bare array; tolerate { items: [] }.
export function unwrapEnvelope(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) {
    return (raw as { items: unknown[] }).items;
  }
  throw new Error('Unexpected 1C response envelope (expected JSON array or { items: [] })');
}

export function buildUrl(baseUrl: string, path: string, cursor: SyncCursor): string {
  const url = new URL(path, baseUrl);
  if (cursor.since) url.searchParams.set(SINCE_PARAM, formatSince(cursor.since));
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
