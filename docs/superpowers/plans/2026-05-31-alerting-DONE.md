# Proactive Ops Alerting — DONE (close-out)

**Date:** 2026-05-31
**Plan:** [2026-05-31-alerting.md](2026-05-31-alerting.md) · **Spec:** [../specs/2026-05-31-alerting-design.md](../specs/2026-05-31-alerting-design.md)
**Branch:** `claude/alerting` (off `main`). Committed.

## Shipped (8 tasks)

| Component | What |
|---|---|
| `AlertState` model + migration `20260531092855_alert_state` | Postgres-backed dedup state (`key`, `status`, `severity`, `message`, `value`, timestamps). |
| `src/lib/monitoring/thresholds.ts` | env → `Thresholds` (queue 100 / DLQ 0 / lag 24h / cooldown 6h), numeric-safe. |
| `src/lib/monitoring/evaluate.ts` | pure `(metrics, thresholds) → Breach[]` over queue depth / DLQ / sync lag. |
| `src/lib/monitoring/dedup.ts` | pure `diffAlerts` → `{toFire, toRenotify, toResolve}` (edge-trigger + cooldown). |
| `src/lib/monitoring/deliver.ts` | fan-out to all `role=admin` (in-app + email) + Telegram; per-channel try/catch; Telegram timeout-raced + skipped when unconfigured. |
| `monitoring.evaluateAlerts` queue + `ALERT_SCHEDULES`/`registerAlertSchedules` | 5-min cron, registered behind `ENABLE_SYNC_CRON`. |
| `src/worker/processors/evaluate-alerts.ts` | orchestrator: read metrics → evaluate → diff vs `AlertState` → deliver fire/resolve → persist. |
| `src/worker/index.ts` + `.env.example` | worker wiring + documented `ALERT_*` / Telegram env. |

## Verification

- `npm run typecheck` ✓ · `npm run lint` ✓ (0 warnings)
- `npm run test:unit` ✓ — **107 files, 898 tests** (16 new unit: thresholds/evaluate/dedup/deliver/alertScheduling)
- `npm run test:integration -- worker.evaluate-alerts` ✓ — 3/3 (real `AlertState` lifecycle: fire → silent-within-cooldown → resolve)
- Migration created + applied against the Dockerized Postgres.

## Notes — two real bugs caught mid-execution by the gates

1. **`getThresholds(env: NodeJS.ProcessEnv)`** — Next.js augments `ProcessEnv` to require `NODE_ENV`, so partial test env objects failed `tsc` (though vitest/esbuild ran them fine). The pre-commit typecheck caught it; widened the param to `Record<string, string | undefined>`.
2. **`toHaveBeenCalledWith(prisma, ...)`** — deep-equality on a PrismaClient (circular/huge graph) → "Maximum call stack size exceeded". Fixed with `expect.anything()` for the opaque client arg.

Both: the L1 hook / test run did its job. (Same pattern as the health-probe mock-reset catch.)

## Follow-ups (out of scope)

- **`ops_alert` notification UI label** — the admin notification feed may render the new type without a friendly label; small UI follow-up.
- **Per-entity sync-lag thresholds** — current single 24h default is generous to avoid false alarms across entities with different cadences; per-entity would be tighter.
- **Admin "active alerts" view** — `AlertState` is queryable; a small admin page could surface firing alerts (the reason it lives in Postgres, not Redis).
- **Thresholds via UI** — currently env-only.

This completes subsystem 1В (operability). Remaining Track 1 item: the real 1C adapter (1А), still blocked on the external 1C contract.
