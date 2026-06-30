# 1C cursor skipped-record loss — store-and-replay — CLOSE-OUT (DONE)

**Date shipped:** 2026-06-29
**Branch:** `claude/1c-cursor-store-and-replay`
**Spec:** [2026-06-29-1c-cursor-skipped-record-loss-design.md](../specs/2026-06-29-1c-cursor-skipped-record-loss-design.md)
**Plan:** [2026-06-29-1c-cursor-skipped-record-loss.md](2026-06-29-1c-cursor-skipped-record-loss.md)

## What shipped

The high-severity 1C data-integrity bug — the single high-water-mark cursor silently dropping
out-of-order inbound records (e.g. a payment that arrives before its organization) — is fixed
via **store-and-replay**. Out-of-order records are no longer lost; permanently-unresolvable
records are dead-lettered with an alert (loss is loud, never silent). The cursor logic is
**untouched** — no stall risk.

### Commits (9)
| SHA | What |
|---|---|
| `d37cebe` | `OneCPendingRecord` model + migration `20260629170428_one_c_pending_record` |
| `258234f` | `isTransientSkip` classifier (transient vs permanent skip reasons) |
| `491a607` | `capturePendingSkips` — persist transient skips' raw DTOs |
| `65df4cf` | config readers `oneCPendingMaxAttempts` (50) / `oneCPendingMaxAgeDays` (7) |
| `9976ad3` | `replayPendingRecords` — replay through idempotent writers + dead-letter |
| `a790f0d` | document the `any`-disables in the replay dispatch (review follow-up) |
| `b3fdb93` | wire capture+replay into the 4 sync processors (live-only) |
| `91adb07` | alert on dead-lettered records (`onec_dead_letters` critical breach) |
| `785ca4f` | integration test — recovery + dead-letter |

### How it works
1. A sync batch skips a record for a **transient** reason (`organization_not_found`,
   `order_not_found`, `document_fetch_failed`) **or its writer throws** (lands in
   `summary.failures` — e.g. a transient deadlock / P2002) → `capturePendingSkips` upserts the
   record's **raw DTO** into `OneCPendingRecord` (status `pending`). Permanent skips
   (`partner_not_found`, `out_of_scope`, …) are NOT captured. Thrown errors are treated as
   transient-with-cap (replayed; dead-lettered only after the attempt/age cap).
2. After each entity pull (live mode, after `advanceCursor`), `replayPendingRecords` re-runs
   the entity's **idempotent** writer against each pending DTO (re-validated by its zod schema
   first). Outcomes: success → delete the row; repeated transient skip → bump `attempts`;
   permanent skip / `attempts >= maxAttempts` / age `>= maxAgeDays` / invalid-stored-DTO →
   **dead-letter** (status `dead`).
3. The 5-min alert pass counts `status='dead'` records; any dead-letter fires a **critical**
   `onec_dead_letters` alert through the existing dedup/deliver pipeline.

The cursor still advances on the successful high-water mark — capture/replay run *beside* it,
not by holding it back, so a permanently-unresolvable record never stalls the stream.

## Decision: store-and-replay (Option A′) supersedes the spec's Option A/B

The spec offered Option A (re-pull each skipped record by externalId) and Option B (clamp the
cursor + alert). During planning the `OneCAdapter` interface was found to be **bulk-pull only**
(`pullOrders/pullPayments/…(cursor)`) — there is **no fetch-by-externalId**, so Option A was
infeasible without extending the adapter and adding a 1C REST endpoint that may not exist.
**Option A′ — store-and-replay** keeps Option A's "no loss, no stall" guarantee by replaying
the *stored* DTO (equivalent to a re-pull) with zero adapter / 1C-side change. Option B was
rejected because it only bounds loss, it doesn't eliminate it.

## Verification

- **Unit:** `oneCSync.pending.unit.test.ts` (12: classifier 3, capture 3, replay 6 — incl.
  thrown-error capture + retry-on-throw from final review),
  `oneCSync.pending.config.test.ts` (3), the 4 `worker.sync-*.shadow.test.ts` (live-calls +
  shadow-skips capture/replay), `monitoring.{thresholds,evaluate}.test.ts` +
  `worker.evaluate-alerts.test.ts` (dead-letter alert). Full `npm run test:unit` green.
- **Integration:** `services.oneCSync.pending.integration.test.ts` (2) — **recovery** (a payment
  that skips because its org is missing is *created* once the org appears; the row that would
  have been lost is recovered) and **dead-letter** (a record at the cap becomes `status='dead'`).
  Full `npm run gate` (Dockerized Postgres) green.
- typecheck + lint clean throughout; every task done via TDD (RED→GREEN), pre-commit hook
  (typecheck + test:changed) enforced on each commit — no `--no-verify`.
- Independent final code review (read-only) over the whole feature diff.

## Notes / deferrals

- **Replay batch cap:** `replayPendingRecords` drains up to `take: 500` pending rows per entity
  per run. At the 15-min pull cadence this drains 2000/hr/entity — ample for the expected
  out-of-order backlog. If a backlog ever exceeds that sustainably, raise the cap or add
  pagination (not needed now — YAGNI).
- **Runtime client regen gotcha:** `prisma migrate dev` on Windows can `EPERM` on the query-engine
  binary while a `next dev`/node process holds it, leaving the runtime client (`index.js`) without
  the new delegate even though the `.d.ts` types update (typecheck still passes). If
  `db.oneCPendingRecord` is undefined at runtime, run `npm run prisma:generate` with no dev server
  running.
- **Tuning knobs:** `ONE_C_PENDING_MAX_ATTEMPTS` (50), `ONE_C_PENDING_MAX_AGE_DAYS` (7),
  `ALERT_ONEC_DEADLETTER_MAX` (0) are env-overridable.
- **Migration drift bundled in:** `migration.sql` also drops/re-adds
  `CommissionStatementItem_orderId_fkey` as `ON DELETE SET NULL`. This is pre-existing drift
  from `20260626120000_commission_item_payment` (which made `orderId` nullable in the schema
  but never regenerated the FK), which `prisma migrate dev` reconciled into this migration. It
  is behaviorally benign (`SET NULL` is what the nullable relation implies) but is unrelated
  DDL riding in a feature migration — flagged for changelog/rollback awareness (caught in final
  review). Future drift should land in its own migration.
- **Schema-tightening awareness:** because the pending DTO is stored verbatim and re-validated
  against the *current* `OneC*Schema` on replay, a future tightening of those schemas could
  mass-dead-letter old pending rows. That is the intended fail-closed behavior and the
  dead-letter alert makes it visible — but worth remembering when changing the DTO schemas.
