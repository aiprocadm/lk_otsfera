//
// EVERYTHING in this file depends on answers from the 1C integration meeting
// (docs/integrations/1c-meeting-agenda.md). Each constant is tagged with its
// DECISION Q#. If 1C answers "not REST" (Q1), this file + adapter-rest.ts are
// the only throwaway code — the rest of oneCSync is transport-agnostic.
import type { SyncCursor, OneCLeadPushPayload } from './dto';

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

// DECISION Q8: lead push body shape. Default: send the payload as-is.
export function buildLeadBody(payload: OneCLeadPushPayload): unknown {
  return payload;
}
