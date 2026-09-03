# Mock 1С REST server

Dev/test-only stand-in for the real 1С REST API. Speaks the exact dialect that
[`src/lib/services/oneCSync/rest-wire.ts`](../src/lib/services/oneCSync/rest-wire.ts)
expects, and can deliberately trigger the 3 meeting landmines + transport anomalies
so `RestOneCAdapter` and the full shadow pipeline can be exercised before the 1С meeting.

**Not** part of the app: outside `src/`, outside the Next build, never imported by `src/`
(ESLint-enforced). Seeded from the same `src/lib/services/oneCSync/fixtures/*` as the fake adapter.

## Run

    npm run mock:1c            # http://localhost:4010

## Scenarios (env or POST /__control)

| Flag | Values | Demonstrates |
|---|---|---|
| MOCK1C_STATUS_DIALECT | app \| russian | Q10: russian → 100% zod quarantine |
| MOCK1C_DATETIME | utc-z \| no-offset | Q7: no-offset → silent server-local skew |
| MOCK1C_PAGE_SIZE | 0 \| N | Q6: N>0 → adapter silently reads page 1 only |
| MOCK1C_ENVELOPE | array \| items \| other | Q1: `other` → envelope-failure |
| MOCK1C_MALFORMED_RATE | 0..1 | per-record quarantine over HTTP |
| MOCK1C_FAIL_MODE | none \| transient \| permanent | 503+Retry-After (retried) / 500 (job retry) |
| MOCK1C_LATENCY_MS | ms | > ONE_C_HTTP_TIMEOUT_MS → client timeout |
| MOCK1C_PUSH_FAIL_RATE | 0..1 | POST /api/leads **and** POST /api/documents → 500 (BullMQ retry + C6 claim) |

Introspection: `GET /__health`, `GET /__state` (active scenario, lead dedup count, partner key seen, accepted documents).
Runtime flip without restart: `POST /__control` with a JSON patch, e.g. `{"statusDialect":"russian"}`.

## Document push (этап 8, `У-167`)

`POST /api/documents` — the same path the cabinet reads documents from, other method
(contract `docs/integrations/1c-contract.md`, section 6). The body is validated with the
**same zod schema the cabinet uses** (`OneCDocumentPushSchema`), so the mock is a
two-way contract test: a body the cabinet would send but 1C would reject cannot pass.

| Situation | Answer |
|---|---|
| new `externalId` | `200 { externalId: "mock-doc-N" }` |
| same `externalId`, same `version` | `200`, the same id — no-op (idempotent retry) |
| same `externalId`, higher `version` | `200`, the same id, stored body replaced (reissue) |
| same `externalId`, lower `version` | `409` — not retried by the client |
| body off-contract (no `counterparty`, `type: commercial_proposal`, bad `fileUrl`) | `400 { error: "<path>: <message>" }` |
| `MOCK1C_PUSH_FAIL_RATE` hit | `500` — nothing stored |

`GET /__state` → `documents: { uniqueDocuments, documents: [{ externalId, oneCExternalId, type, number, version, attempts, lines }], lastBody }`.

## Shadow rehearsal (local)

    1. npm run prisma:seed        # Partner/Org slugs must match fixtures (1c-partner-001 etc.)
    2. npm run mock:1c
    3. ONE_C_ADAPTER=rest ONE_C_API_URL=http://localhost:4010 \
       ONE_C_API_TOKEN=mock-token ONE_C_MODE=shadow  npm run worker:dev
    4. trigger syncs; watch /admin/sync (watermark, cursor-lag, invalid/failed)
       shadow → 0 DB writes, SyncLog operation:'check'
    5. flip a scenario (POST /__control) → re-run → confirm the expected SyncLog outcome:
       russian → all invalid; PAGE_SIZE → undercount; no-offset → time skew
    6. cutover: ONE_C_MODE=shadow (clean) → live → rows are written
