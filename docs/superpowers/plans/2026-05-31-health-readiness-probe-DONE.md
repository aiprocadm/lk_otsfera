# Health / Readiness Probe — DONE (close-out)

**Date:** 2026-05-31
**Plan:** [2026-05-31-health-readiness-probe.md](2026-05-31-health-readiness-probe.md) · **Spec:** [../specs/2026-05-31-health-readiness-probe-design.md](../specs/2026-05-31-health-readiness-probe-design.md)
**Branch:** `claude/health-readiness-probe` (off `main`). Committed.

## Shipped

| Component | Commit | What |
|---|---|---|
| Check helpers | (Task 1) | `src/lib/health/checks.ts` — `withTimeout` (never rejects, races a 2s timeout — essential since ioredis `maxRetriesPerRequest:null` hangs on a down Redis) + `checkDb`/`checkRedis`. |
| Liveness | (Task 2) | `src/app/api/health/live/route.ts` — public, `200 {status:'ok'}`, no deps. |
| Readiness | (Task 3) | `src/app/api/health/route.ts` — token-gated (`HEALTH_TOKEN` bearer, `timingSafeEqual` on sha256 digests); parallel DB+Redis checks; `200`/`503`; `401` invalid/missing token; `503 health_token_unconfigured` when env unset (fail-closed). |
| Config | (Task 4) | `.env.example` (+`HEALTH_TOKEN`), `Dockerfile` `HEALTHCHECK` → liveness (Node 20 global `fetch`, no curl/wget). |

No middleware change — its matcher already excludes `/api`. Worker + Supabase deliberately excluded from readiness (separate process / external dep).

## Verification

- `npm run typecheck` ✓ · `npm run lint` ✓ (0 warnings)
- `npm run test:unit` ✓ — **105 files, 896 tests** (incl. 14 new: 7 checks + 1 liveness + 6 readiness). All unit-tier (prisma/redis mocked); no Docker needed.

## Note

The pre-commit hook caught a real test-isolation bug mid-execution: the readiness test's `beforeEach` set mock return values but didn't reset call history, so a cumulative `expect(checkDbMock).not.toHaveBeenCalled()` failed after earlier tests called it. Fixed with `mockReset()` in `beforeEach` — same "scope/reset per test" discipline as the safety-net stabilization. The probe code itself was correct; the hook did its job.

## Follow-ups (out of scope)

- **Alerting** — thresholds on queue depth / DLQ / sync-lag → operator notifications. The second half of subsystem 1В; its own spec.
- **Worker-liveness probe** — a separate signal for the worker process, if its health needs orchestration.
- **Readiness DB-hit cache** (~1s) — only if an aggressive poller makes the per-request `SELECT 1` a concern (YAGNI now).
