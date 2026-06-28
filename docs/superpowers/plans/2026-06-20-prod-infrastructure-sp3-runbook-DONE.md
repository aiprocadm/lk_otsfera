# SP3 — Greenfield Runbook РФ — Close-out (DONE)

**Date:** 2026-06-20
**Plan:** [2026-06-20-prod-infrastructure-sp3-runbook.md](2026-06-20-prod-infrastructure-sp3-runbook.md)
**Spec:** [2026-06-20-prod-infrastructure-sp3-runbook-design.md](../specs/2026-06-20-prod-infrastructure-sp3-runbook-design.md)
**Branch:** `claude/prod-infra-sp3-runbook` (stacked on SP2).

## Shipped
- `Caddyfile` — reverse-proxy `{$APP_DOMAIN}` → `web:3000`, auto-HTTPS (Let's Encrypt) + gzip.
- `docker-compose.prod.yml` — added `caddy` service (ports 80/443, `env_file`, `caddy_data`/`caddy_config` volumes); web/worker/redis unchanged; refreshed header comment.
- `.env.production.example` — added `APP_DOMAIN` + `NEXT_PUBLIC_APP_URL = https://<APP_DOMAIN>` invariant note.
- `docs/runbook-prod-infra-rf.md` — provider-agnostic operator runbook: topology → provision (ICU/S3-path-style/DNS/firewall) → VM prep → TLS bring-up → infra-smoke → hand-off to launch-deploy (containerized bootstrap/migrate forms) → rollback → one-page checklist.

## Verified (static)
- `npm run typecheck` + `npm run lint` green (no `src/` touched).
- compose validates (`docker compose config` or static YAML shape check).
- Caddyfile + env + runbook shape/grep checks pass; all runbook links resolve.

## Operator-deferred (needs live VM + domain + DNS)
- Real Let's Encrypt issuance + end-to-end HTTPS smoke (runbook §3–§4).
- Hand-off commands against managed-PG (runbook §5: `db:create-admin`, `migrate deploy`).

## Decisions (from spec brainstorm)
- TLS = Caddy in compose (auto-HTTPS, auto-renew) — not nginx+certbot / provider-LB.
- Provisioning = provider-agnostic (no Yandex worked example) — S3/PG contracts portable.
- Separate runbook (mirrors staged-rollout ↔ launch-deploy split), not an inline edit of launch-deploy.

## Track status
SP3 completes the SP1→SP2→SP3 greenfield prod-infra decomposition. Remaining is purely operator execution on live RF infra.
