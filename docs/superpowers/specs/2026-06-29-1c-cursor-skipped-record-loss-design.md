# 1C sync cursor — silent loss of skipped/failed records (design)

**Date:** 2026-06-29
**Status:** Open — design only. No code shipped (architectural; do not hot-patch the cursor).
**Severity:** High (silent, permanent loss of financial inbound records).
**Source:** stabilization audit 2026-06-29 (adversarially verified, high confidence).

## 1. Problem

Every inbound 1C processor (`sync-orders`, `sync-payments`, `sync-organizations`,
`sync-documents`) advances a **single high-water-mark cursor** per entity:

```
maxUpdatedAt = max(updatedAt) over records that were bumped
bump() fires ONLY after a successful create/update (writers.ts)
advanceCursor(db, entity, maxUpdatedAt)  // cursor = applyOverlap(max, 5min)
getCursor() next run → since = cursor   // = max − 5min
```

A record that is **skipped** (`organization_not_found`, `order_not_found`,
`document_fetch_failed`, …) returns *before* `bump()`, and a record that **throws**
is caught in `runRecordBatch` (counted `failed`, loop continues) — neither contributes
to `maxUpdatedAt`. But a **later successful record in the same batch** still advances
the watermark past them. On the next pull, `since = batchMax − 5min`, so any skipped/
failed record whose `updatedAt` is more than the 5-minute overlap behind the batch max
**is never re-pulled** → permanent silent loss.

### Canonical failure

1. A `Payment` (or `Order`/`Document`) arrives referencing an `Organization` not yet synced
   → `upsertPaymentRecord` skips it (`organization_not_found`), no `bump`.
2. Other, newer payments in the same batch succeed and bump the watermark.
3. The org syncs later — but the payment is now behind the cursor and is **never re-pulled**.
4. `sync-reconcile` only checks `syncLog` freshness within a 25h window; it does **not**
   re-pull. There is no recovery path.

Payments feed commission calculation, so this is financially material.

### Design intent this violates

The phase-3b plan ([2026-05-31-1c-phase3b-readiness.md](../plans/2026-05-31-1c-phase3b-readiness.md), Task 6)
states the explicit invariant:

> Watermark rule: `maxUpdatedAt` is bumped only after a successful create/update — never
> for skipped/failed records. **A skipped order (organization not yet synced) must remain
> re-pullable next run.**

Not bumping on the skipped record is necessary but **not sufficient**: a single high-water
mark cannot keep an *older* skipped record re-pullable once a *newer* record in the same
batch advances the mark. The 5-minute overlap is a clock-skew guard, far too narrow to
cover an arbitrary `updatedAt` gap across a multi-minute or backfill batch (the normal case).

## 2. Why there is no safe one-line patch

The two naive patches each trade silent loss for a worse failure:

| Naive patch | New failure |
|---|---|
| "Don't advance the cursor when `skipped+failed > 0`" | A **permanently** unresolvable record (e.g. `partner_not_found`, or an org that genuinely never appears in 1C) pins the cursor forever → the whole entity stream **stalls** and stops ingesting anything new. Strictly worse than losing one record. |
| "Clamp cursor to the oldest skipped/failed `updatedAt`" | Same stall risk for any permanently-unresolvable record; the cursor never passes it. |

A correct fix must distinguish **transient** skips (dependency not yet synced — re-pulling
will eventually succeed) from **permanent** skips (re-pulling re-skips forever), and must
**bound** how long a transient record blocks progress. That is a feature, not a patch.

## 3. Skip/fail taxonomy (retryability)

| Reason | Source | Retryable? |
|---|---|---|
| `organization_not_found` | order/payment writer | **Transient** — org may sync later |
| `order_not_found` | payment/document writer | **Transient** — order may sync later |
| `document_fetch_failed` | document writer | **Transient** — network/storage blip |
| thrown error (`failed`) | any (e.g. transient deadlock, or a P2002 bug) | **Unknown** — treat as transient w/ cap |
| `partner_not_found` / `no_partner_external_id` | org writer | **Permanent** — partner absent from system |
| `out_of_scope` | scoped manual import only (cron worker is unscoped) | **Permanent** — intentional filter |

The cron worker runs **unscoped**, so `out_of_scope` never occurs there; the realistic
cron skips are the referential-ordering ones (transient) plus partner-absence (permanent).

## 4. Options

### Option A — Pending-record re-pull table (recommended)
Persist every transient skip/fail as a `OneCPendingRecord { entity, externalId, reason,
firstSeenAt, attempts }`. The cursor advances normally (no stall). A reconcile pass
re-pulls pending externalIds **individually by id** until they resolve or age/attempt out
(dead-letter). Decouples "keep making forward progress" from "don't lose the laggards".
- Pros: no stall; bounded retry; observable backlog; no cursor semantics change.
- Cons: new model + migration + a re-pull adapter call by externalId + reconcile wiring.

### Option B — Clamp cursor to oldest *transient* unresolved, with a max-lag escape hatch
`newCursor = min(applyOverlap(successMax), oldestTransientUpdatedAt − ε)`, but never hold
the cursor back more than `ONE_C_MAX_CURSOR_LAG` (e.g. 24h); past that, let it pass and
emit a `lastError`/alert so the loss is **loud**, not silent.
- Pros: smaller change; no new model.
- Cons: still loses the record after the cap (but now alerted); needs per-batch oldest-
  transient tracking threaded through `BatchSummary` → `advanceCursor`.

### Option C — Re-pull window widening only
Increase overlap. Rejected: cannot cover arbitrary `updatedAt` gaps; just hides the bug.

**Recommendation:** Option A. It is the only option with *no* data loss and *no* stall. If
scope must be minimized for a near-term release, Option B converts silent loss into an
alerted, bounded loss as a stopgap.

### Chosen approach — Option A′ (store-and-replay), supersedes A/B

Planning (2026-06-29) found the `OneCAdapter` interface is **bulk-pull only**
(`pullOrders/pullPayments/pullDocuments/pullOrganizations(cursor)`) — there is **no
fetch-by-externalId**. So Option A's per-record re-pull is infeasible without extending the
adapter + a 1C REST endpoint that may not exist (open question #1, now resolved: **not
supported**).

**Option A′** keeps Option A's "no loss, no stall" guarantee without any adapter/1C change:
on a *transient* skip, persist the record's **raw DTO** into a `OneCPendingRecord` table; a
replay pass re-runs the **idempotent** writer against stored DTOs until the dependency
appears (delete the row) or an attempt/age cap is hit (dead-letter + alert). Replaying the
stored DTO is equivalent to re-pulling it, but uses data we already hold. The cursor
advances normally. Plan:
[2026-06-29-1c-cursor-skipped-record-loss.md](../plans/2026-06-29-1c-cursor-skipped-record-loss.md).

## 5. Test strategy

- Integration: org-after-payment ordering — payment skipped on pull 1, org synced on pull 2,
  assert the payment is created on pull 3 (currently fails: it is lost). This is the
  regression test that must go red before any fix.
- Integration: a permanently-unresolvable record (partner absent) must **not** stall the
  cursor — newer records keep ingesting (guards against the naive patch).
- Unit: taxonomy classifier (`retryable(reason)`), `advanceCursor` clamp/escape-hatch math.
- For Option A: pending-row lifecycle (insert on skip, clear on resolve, dead-letter on cap).

## 6. Open questions

1. ~~Does the 1C adapter support fetch-by-externalId for a single record?~~ **Resolved: no**
   — the adapter is bulk-pull only, so Option A′ (store-and-replay of the stored DTO) is used
   instead of re-pull. No adapter or 1C-side change needed.
2. What is the acceptable max-lag / attempt cap before dead-lettering?
3. Should dead-lettered records raise an admin alert (sync control center) — yes, almost
   certainly, so loss is never silent.

## 7. Scope guard

Do **not** modify `cursor.ts` / the sync processors as part of an unrelated change. This
is core financial ingestion; it goes through the full spec → plan → subagent-driven-dev →
integration-gate path (§8), with the red regression test from §5 first.
