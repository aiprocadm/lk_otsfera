# Automated Test Safety Net — DONE (close-out)

**Date:** 2026-05-31
**Plan:** [2026-05-31-test-safety-net.md](2026-05-31-test-safety-net.md) · **Spec:** [../specs/2026-05-31-test-safety-net-design.md](../specs/2026-05-31-test-safety-net-design.md)
**Branch:** `claude/test-safety-net` (off `main`). Committed; **not yet pushed / PR'd** (awaiting user — merge-via-UI workflow).

## Shipped

| Component | Commit | What |
|---|---|---|
| L2.5 gate | `c8c8389` | `npm run gate` ([scripts/gate.ts](../../../scripts/gate.ts)): Docker Postgres → host-facing `DATABASE_URL` → `prisma migrate deploy` + seed → `vitest --mode=integration`. `gate:down` stops containers. |
| Stabilization (Task 0) | `f470141` | See below. |
| Guardrail | `42eca19` | [worker.processor-coverage.guardrail.test.ts](../../../src/__tests__/worker.processor-coverage.guardrail.test.ts) — unit test fails if a processor lacks a test; ALLOWLIST empty. |
| Worker coverage | `6c84084` | 3 integration tests: push-lead (+`notifyPushLeadFinalFailure`), generate-commission-pdf/xlsx → all 10 processors covered. |
| Pre-push enforcement | `131ce39` | [scripts/gate-precheck.ts](../../../scripts/gate-precheck.ts) + [.husky/pre-push](../../../.husky/pre-push): gate runs on push only when changed paths touch `prisma/`/`worker/`/`services/` or a PrismaClient test; blocks if Docker down. |
| Docs | `7f49d87` | CLAUDE.md §6 four-layer table + `npm run gate` note + guardrail reference. |

## Scope expansion: Task 0 — L3 stabilization (`f470141`)

The gate surfaced that the **existing** integration suite was NOT reliably green on a fresh seeded DB — pre-existing, order-dependent isolation fragility (shared Postgres, `fileParallelism:false`; several tests reuse the seed's `1c-partner-001` fixtures). The spec had this out-of-scope; the user approved fixing it ("do it right"). Two bug classes fixed:
- **Incomplete cleanup cascade** — `deletePartnerCascade` in `worker.oneCSync.upsert.test.ts` missed `Comment`/`Upload` (before `Order`) and `AuditLog`/`SavedView`/etc. (before `User`); broke when the seed grew (admin-cabinet comments/audit) or another test left children on the shared partner. Rewrote it to delete all transitive children in FK order.
- **Global assertions** — `where: { type: '...' }` counts without scoping to own fixtures, in `worker.sync-payments.notifies-managers.test.ts` (3) and `notifications.notifyManagers.test.ts` (3). Scoped to the test's own managers.

## Verification (evidence)

- `npm run typecheck` ✓ · `npm run lint` ✓ (no warnings/errors)
- `npm run test:unit` ✓ — **103 files, 883 tests**
- `npm run gate` ✓ — **36 integration files, 286 tests**
- **Stability:** `docker compose down -v && npm run gate` ×3 (fresh + 2 accumulation cycles) all green — deterministic, not order-luck.
- Guardrail negative probe (empty ALLOWLIST) flagged exactly the 3 gaps.
- pre-push trigger: docs-only push → skip (exit 2); worker/test push → run (exit 0).

## Deviations from plan

- **Task 0 added** — not in the original plan; discovered + user-approved during execution.
- **Tasks 3-5 batched** into one commit (`6c84084`) instead of three (verified together via one gate run).
- **Prettier skipped on docs** — repo markdown isn't prettier-managed (no `.prettierignore`, but every committed doc/CLAUDE.md is non-conformant); `--write` would churn unrelated lines.
- **Task 6 Step 5** (Docker-down → block) verified by code inspection, not by stopping Docker mid-session.

## Follow-ups / known limitations

- Other integration tests may harbour latent global-assertion / cleanup fragility not surfaced by current orderings. The guardrail covers processor *existence*, not assertion hygiene. Consider a convention note ("scope DB assertions to own fixtures") or a lint rule.
- The gate reuses the Docker volume across runs (idempotent seed; no per-run reset). Stable because tests are now good citizens; a `--reset` flag (`prisma migrate reset`) could be added as defense-in-depth if cross-run drift ever reappears.
- Remaining safety-net backlog tracks (1C real adapter, monitoring/readiness) are untouched — separate features.
