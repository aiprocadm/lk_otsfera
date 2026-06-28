# Close-out — Prod-инфраструктура SP2: упаковка (контейнеры + prod-compose)

**План:** [2026-06-20-prod-infrastructure-sp2-packaging.md](2026-06-20-prod-infrastructure-sp2-packaging.md)
**Ветка:** `claude/prod-infrastructure` · **PR:** #135 · **Метод:** subagent-driven-development.

> Бэкфилл close-out (housekeeping). Часть prod-программы: SP1 ([DONE](2026-06-20-prod-infrastructure-sp1-storage-adapter-DONE.md)) · SP2 · SP3 ([DONE](2026-06-20-prod-infrastructure-sp3-runbook-DONE.md)).

## Что отгружено

Приложение упаковано для прода: multi-stage Docker-образ (web+worker из одного образа) + production-compose + шаблон env.

| Артефакт | Отгружено |
|---|---|
| **Dockerfile** | 4 стадии: `deps` (npm ci) → `build` (next build + prisma generate) → `runtime-deps` (npm ci --omit=dev + prisma generate) → `runtime` (non-root `node`, EXPOSE 3000, HEALTHCHECK, CMD web) |
| **.dockerignore** | исключает node_modules/.next/.git/.env*/docs/tests, с `!.env.production.example` |
| **docker-compose.prod.yml** | `web` (`npm run start`, `127.0.0.1:3000`), `worker` (`npm run worker`), `redis` (appendonly + том), depends_on/healthcheck; (+ caddy из SP3) |
| **.env.production.example** | DB/DIRECT_URL, JWT_SECRET, HEALTH_TOKEN, REDIS_URL, S3-блок, email, `ENABLE_SYNC_CRON`, `ONE_C_ADAPTER=fake` (безопасный дефолт), feature-flags (закомментированы) |
| **Зависимости рантайма** | `tsx` и `prisma` перенесены из devDependencies в dependencies (нужны в prod-образе для воркера/миграций) |
| **.gitignore** | реальный `.env.production` исключён |

## Гейты (merge-time, PR #135)

typecheck ✅ · lint ✅; нет stale-ссылок на Supabase.

## Остаток (operator-driven, по runbook SP3)

- Реальный `docker build` + `docker compose -f docker-compose.prod.yml up` smoke — Docker daemon на dev-машине сломан (известное ограничение проекта), валидация за оператором.
- Интеграция с управляемым Postgres / боевым S3 — по чеклисту SP3.
