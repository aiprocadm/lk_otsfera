# 1С Phase 3b Readiness — Close-out (DONE)

> Companion summary to [the plan](2026-05-31-1c-phase3b-readiness.md) and [the spec](../specs/2026-05-31-1c-phase3b-readiness-design.md). The plan records *what we intended*; this records *what shipped*.

**Date shipped:** 2026-06-01
**Branch:** `claude/fix-pre-push-errexit` (spec + plan + implementation committed here)
**Status:** All 13 plan tasks DONE + 2 review fixes. No feature flag change — `ONE_C_ADAPTER` stays `fake`; the REST adapter is built but NOT switched on (blocked on the 1C meeting, see below).

## What shipped (spec §4.1–§4.9 → code)

| § | Delivered | Key files |
|---|---|---|
| 4.1 | `SyncState` model + persistent incremental cursor, 5-min safety overlap | `prisma/schema.prisma`, `oneCSync/cursor.ts`, migration `…_sync_state` |
| 4.2 | zod schemas (single source of truth via `z.infer`), 2-level validation (envelope→throw/retry, record→quarantine) | `oneCSync/schemas.ts`, `oneCSync/dto.ts` |
| 4.3 | `runRecordBatch` — per-record validation + isolation, shared by all 4 pull processors | `oneCSync/record-batch.ts` |
| 4.4 | Idempotent lead push — `Lead.pushedToOneCAt` guard + contract dedup clause | `oneCSync/push.ts`, migration `…_lead_pushed_at`, `docs/integrations/1c-contract.md` |
| 4.5 | Resilience helpers — `withTimeout` / `withRetry` (Retry-After, transient-only) / `parseRecords` | `oneCSync/resilience.ts` |
| 4.6 | Concrete REST skeleton; ALL wire decisions isolated + `DECISION Q#`-tagged | `oneCSync/adapter-rest.ts`, `oneCSync/rest-wire.ts`, `oneCSync/index.ts` |
| 4.7 | Shadow/dry-run mode (`ONE_C_MODE=shadow`) — compute-without-commit across all 4 processors | `sync-{orders,payments,documents,organizations}.ts`, `oneCSync/config.ts` |
| 4.8 | Fake-adapter fidelity (env-gated malformed/latency) + cross-adapter contract test | `oneCSync/adapter-fake.ts`, `oneCSync.adapter-contract.test.ts` |
| 4.9 | Cursor-lag in `/admin/sync` UI **and** in the ops alert path | `syncSummary.ts`, `admin/sync/page.tsx`, `admin/syncHealth.ts` |

## Review fixes (found in final Opus review)

1. **Cursor-lag now actually drives the alert.** Task 13 wired cursor-lag into `getSyncSummary`/UI but the alert evaluator read lag from `getSyncLag`, which computed it from `lastSuccessAt` (SyncLog). In shadow mode a fresh success `check` log hid a frozen cursor → alert never fired. Fixed: `getSyncLag` derives `lagMs` from the cursor watermark (commit `f958162`).
2. **Push idempotency contract clause** added to `1c-contract.md` — 1C must dedup on `cabinetLeadId` (the guarantee that makes the push retry safe; the DB `pushedToOneCAt` guard is only a fast-path).
3. **Test-isolation fix** in `worker.push-lead.test.ts` — the idempotency guard short-circuited a reused lead in the failure-injection test (commit `6069eed`).
4. **Org processor symmetry** — an `organization.count()` cursor-bypass that had leaked into production was reverted; the real cause (stale cursor in test `cleanupAll`) was fixed in the test (commit `058068a`).

## Cutover runbook (shadow → live)

When the 1C meeting closes the open questions and `rest-wire.ts` is filled in:
1. Staging: `ONE_C_ADAPTER=rest`, `ONE_C_MODE=shadow`, set `ONE_C_API_URL` + `ONE_C_API_TOKEN`.
2. Watch `/admin/sync` for several sync cycles: confirm `operation: 'check'` logs, zero `invalid`/`failed`, and cursor-lag staying low. Watch for the sync-lag alert (now cursor-driven).
3. If clean → `ONE_C_MODE=live`; smoke on a pilot partner; then production.
`ONE_C_HTTP_TIMEOUT_MS` (15000) and `ONE_C_CURSOR_OVERLAP_MINUTES` (5) are tunable via env.

## Deliberately de-scoped

- **`sync-reconcile.ts` cursor-lag in payload** (listed in plan §3 file table): not implemented — redundant now that cursor-lag feeds both the alert (§4.9 fix #1) and `/admin/sync`. Reconcile keeps its independent 25h SyncLog-freshness check. Re-add only if a separate reconcile-side cursor signal is wanted.

## Open / blocked (external)

- The real adapter is blocked on the **10-question 1C meeting** ([1c-meeting-agenda.md](../../integrations/1c-meeting-agenda.md)). Until then `ONE_C_ADAPTER=fake`. All REST speculation is confined to `rest-wire.ts` + `adapter-rest.ts` (blast radius = 2 files if 1C answers "not REST").

## Verification

Full local run green on the branch: `typecheck` + `lint` clean; **unit 122 files / 950 tests**; **integration 39 files / 295 tests** (live Postgres). New modules are unit-tested; cursor/quarantine/shadow/idempotency paths have integration coverage; the worker processor-coverage guardrail still holds.
