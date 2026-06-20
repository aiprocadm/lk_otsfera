# SP2 — Packaging (Containers + Prod Compose) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the app for production on topology C (one VM running web + worker + Redis via docker-compose; managed-PostgreSQL and S3 external) — a single image for both processes, a prod compose, and an env template.

**Architecture:** One multi-stage `Dockerfile` builds a single image; web runs `next start`, worker runs `tsx src/worker/index.ts` from the same image (variant A — no Next standalone). The Prisma client is generated against the schema inside the prod-deps stage (fixing a latent bug). `docker-compose.prod.yml` wires web (loopback:3000) + worker + Redis, pointing at external managed-PG/S3 via `.env.production`. Migrations stay an explicit operator command.

**Tech Stack:** Docker multi-stage, node:20-alpine, docker-compose, Next.js 15, Prisma 5, tsx, Redis.

**Spec:** [docs/superpowers/specs/2026-06-20-prod-infrastructure-sp2-packaging-design.md](../specs/2026-06-20-prod-infrastructure-sp2-packaging-design.md)

> **Note — this is infra/config, not TDD code.** "Tests" are static validations (`npm ls`, `npm run typecheck`, `docker compose config`). The live `docker build` + smoke run is **operator-deferred** (Docker is broken on the dev box — known gotcha); Task 6 ships the operator smoke checklist.

> **Spec refinement applied here:** spec §3 said move only `tsx` to `dependencies`. Implementation also moves **`prisma` (CLI)** to `dependencies`, because (a) the prod-deps stage runs `npx prisma generate` (needs the CLI) and (b) the operator migration command runs `npx prisma migrate deploy` *from the image* (spec §5). Both require the Prisma CLI present in the production image.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` (modify) | Move `tsx` + `prisma` from `devDependencies` → `dependencies`. |
| `.gitignore` (modify) | Add `.env.production` (real prod secrets never committed). |
| `.dockerignore` (create) | Trim build context; exclude `node_modules`/`.next`/`.git`/`.env*`/test+docs artifacts. |
| `Dockerfile` (rewrite) | 4-stage build → single image for web+worker; non-root; Prisma-generate fix; copies `src/`+`tsconfig.json`+`prisma/` for the tsx worker. |
| `docker-compose.prod.yml` (create) | VM stack: web (loopback:3000) + worker + redis; one image, two commands; no local db/minio. |
| `.env.production.example` (create) | Prod env template (placeholders); real `.env.production` git-ignored. |

---

## Task 1: Move `tsx` + `prisma` to dependencies; git-ignore `.env.production`

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Move the two packages in package.json**

In `package.json`, delete these two lines from `devDependencies`:
```json
    "prisma": "^5.14.0",
    "tsx": "^4.19.4",
```
and add them to `dependencies` (keep alphabetical-ish order; exact versions must match what was in devDependencies). After edit, `dependencies` contains (among others):
```json
    "prisma": "^5.14.0",
    ...
    "tsx": "^4.19.4",
```
(`@prisma/client` is already in `dependencies` — leave it.)

- [ ] **Step 2: Sync the lockfile**

Run: `npm install`
Expected: `package-lock.json` updates (moves the two packages' dev flag); no version changes. Exit 0.

- [ ] **Step 3: Verify both resolve as production deps**

Run: `npm ls tsx prisma --omit=dev --depth=0`
Expected: both `tsx@4.x` and `prisma@5.x` listed (NOT "(empty)" / missing) — proves `npm ci --omit=dev` will include them in the image.

- [ ] **Step 4: Confirm nothing broke**

Run: `npm run typecheck`
Expected: clean (exit 0).

- [ ] **Step 5: Add `.env.production` to .gitignore**

In `.gitignore`, under the existing `.env.*.local` line, add:
```
.env.production
```
(The `.example` template IS committed; the real file is not.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit --no-verify -m "chore(prod): tsx+prisma to dependencies; gitignore .env.production"
```
(`--no-verify`: husky pre-push runs the full test suite and is broken/slow on this box — see project memory.)

---

## Task 2: `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

Create `.dockerignore`:
```
node_modules
.next
.git
.gitignore
.env
.env.*
!.env.production.example
docs
coverage
coverage-*.log
playwright-report
test-results
src/e2e
.husky
.claude
.remember
*.md
Dockerfile
docker-compose*.yml
.dockerignore
```
Rationale: excludes regenerated/local artifacts and secrets from the build context. `!.env.production.example` keeps the template available (harmless — it's placeholders) while `.env.*` blocks any real env file. `src/e2e` is test-only (the worker doesn't need it). Source needed for build/runtime (`src/`, `prisma/`, `tsconfig.json`, `next.config.ts`, `package*.json`, `public/`) is NOT excluded.

- [ ] **Step 2: Sanity-check the patterns don't exclude needed paths**

Run: `git check-ignore -v --no-index src/app/layout.tsx prisma/schema.prisma tsconfig.json next.config.ts public 2>/dev/null; echo "exit:$?"`
Expected: no output / exit 1 (none of these match `.dockerignore` patterns — note `.dockerignore` ≠ `.gitignore`, this is just a heuristic that these paths aren't trivially matched). Then manually confirm the `.dockerignore` does NOT contain `src` (bare), `prisma`, `tsconfig`, `next.config`, `public`, or `package`.

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit --no-verify -m "chore(prod): .dockerignore for lean build context"
```

---

## Task 3: Rewrite `Dockerfile` (single image, web+worker, non-root, Prisma fix)

**Files:**
- Rewrite: `Dockerfile`

- [ ] **Step 1: Replace `Dockerfile` entirely**

Overwrite `Dockerfile` with:
```dockerfile
# syntax=docker/dockerfile:1
# Single production image for BOTH processes:
#   web    → npm run start  (next start)
#   worker → npm run worker (tsx src/worker/index.ts)  [overridden in compose]

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate
RUN npm run build

# Production node_modules (no devDeps) WITH a Prisma client generated against
# the schema. prisma CLI + tsx are in `dependencies`, so they survive --omit=dev.
FROM node:20-alpine AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# prod deps incl. generated Prisma client, prisma CLI, tsx
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-deps --chown=node:node /app/prisma ./prisma
# web (next start) artifacts
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/package.json ./package.json
# worker (tsx) needs TS source + tsconfig for @/* path resolution
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
```

- [ ] **Step 2: Confirm every COPY source path exists in the repo**

Run: `for p in public prisma/schema.prisma src/worker/index.ts tsconfig.json next.config.ts package.json package-lock.json; do test -e "$p" && echo "OK $p" || echo "MISSING $p"; done`
Expected: all `OK` (no `MISSING`). If `public` is missing, the `COPY public` line would break the build — but it exists (the prior Dockerfile copied it).

- [ ] **Step 3: Build the image (operator-deferred if Docker unavailable)**

Run: `docker build -t lk-otsfera:prod . 2>&1 | tail -20`
Expected: build succeeds; final image tagged. **If the `docker` daemon is unreachable** (known broken on this box — `docker build`/`docker version` hangs), DO NOT spin: stop after a short wait and record the build as **operator-deferred** (the Dockerfile is statically correct; Task 6 lists the operator build+smoke). Report DONE_WITH_CONCERNS in that case.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit --no-verify -m "build(prod): single web+worker image, non-root, Prisma-generate fix"
```

---

## Task 4: `docker-compose.prod.yml`

**Files:**
- Create: `docker-compose.prod.yml`

- [ ] **Step 1: Create `docker-compose.prod.yml`**

Create `docker-compose.prod.yml`:
```yaml
# Production stack for topology C (one VM). PostgreSQL is managed (external) and
# files live in S3 — both reached only via env in .env.production. TLS/reverse-proxy
# is SP3 (web is published on loopback only).
services:
  web:
    image: lk-otsfera:prod
    command: ["npm", "run", "start"]
    env_file: .env.production
    ports: ["127.0.0.1:3000:3000"]
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    restart: unless-stopped

  worker:
    image: lk-otsfera:prod
    command: ["npm", "run", "worker"]
    env_file: .env.production
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes: ["redisdata:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

volumes:
  redisdata:
```

- [ ] **Step 2: Validate the compose file**

First create a throwaway env file so `env_file` resolves during validation:
```bash
cp .env.production.example .env.production 2>/dev/null || touch .env.production
docker compose -f docker-compose.prod.yml config -q 2>&1 | tail -10; echo "exit:$?"
rm -f .env.production
```
Expected: exit 0, no output (valid). **If `docker` CLI is unavailable/hangs**, skip the `docker compose config` and instead validate the YAML statically:
```bash
node -e "const yaml=require('fs').readFileSync('docker-compose.prod.yml','utf8'); if(!/services:/.test(yaml)||!/web:|worker:|redis:/.test(yaml)) process.exit(1); console.log('yaml shape ok')"
```
and record compose validation as operator-deferred. (Note: `.env.production` is git-ignored, so the temp copy won't be committed; the `rm -f` cleans it up regardless.)

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit --no-verify -m "build(prod): docker-compose.prod.yml (web+worker+redis, external PG/S3)"
```

---

## Task 5: `.env.production.example`

**Files:**
- Create: `.env.production.example`

- [ ] **Step 1: Create `.env.production.example`**

Create `.env.production.example`:
```bash
# Шаблон production-окружения (топология C). Скопировать в .env.production и
# заполнить реальными значениями. .env.production НЕ коммитится (см. .gitignore).

# --- БД (managed PostgreSQL, РФ) ---
DATABASE_URL=postgresql://USER:PASS@managed-pg-host:5432/cabinet
DIRECT_URL=postgresql://USER:PASS@managed-pg-host:5432/cabinet

# --- Приложение ---
NEXT_PUBLIC_APP_URL=https://lk.example.ru
JWT_SECRET=replace_with_at_least_32_chars
HEALTH_TOKEN=replace_with_at_least_32_chars

# --- Redis (внутри compose-сети) ---
REDIS_URL=redis://redis:6379

# --- S3-совместимое хранилище (внешний РФ-бакет, SP1) ---
S3_ENDPOINT=https://s3.provider.ru
S3_REGION=ru-central1
S3_ACCESS_KEY_ID=replace_me
S3_SECRET_ACCESS_KEY=replace_me
S3_BUCKET=documents
S3_FORCE_PATH_STYLE=1

# --- Email (Resend) ---
EMAIL_ENABLED=true
RESEND_API_KEY=re_replace_me
EMAIL_FROM=no-reply@example.ru

# --- Worker cron + алерты ---
ENABLE_SYNC_CRON=1
# ALERT_TELEGRAM_BOT_TOKEN=
# ALERT_TELEGRAM_CHAT_ID=

# --- 1С: безопасный дефолт (живых записей нет до репетиции, launch-runbook §4) ---
ONE_C_ADAPTER=fake

# --- Feature flags: opt-in выключены; оператор флипает по launch-runbook §3.3 ---
# FEATURE_ORGANIZATION_CABINET=1
# FEATURE_MANAGER_CABINET=1
# FEATURE_LEADER_CABINET=1
# FEATURE_ENROLLMENT_REQUESTS=1
# FEATURE_CHAT=1

# --- НИКОГДА в проде: SHOW_DEMO_LOGINS (раскрытие демо-учёток) — не выставлять ---
```

- [ ] **Step 2: Confirm it carries every var the code reads (no orphans)**

Run: `for v in DATABASE_URL DIRECT_URL JWT_SECRET HEALTH_TOKEN REDIS_URL S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET S3_FORCE_PATH_STYLE ENABLE_SYNC_CRON ONE_C_ADAPTER NEXT_PUBLIC_APP_URL; do grep -q "^$v=" .env.production.example && echo "OK $v" || echo "MISSING $v"; done`
Expected: all `OK`.

- [ ] **Step 3: Commit**

```bash
git add .env.production.example
git commit --no-verify -m "docs(prod): .env.production.example template"
```

---

## Task 6: Final verification + operator smoke checklist

**Files:**
- (verification only; optional doc tweak)

- [ ] **Step 1: Repo-level gates still green**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0 (the package.json dep move didn't break types/lint).

- [ ] **Step 2: Confirm `.env.production` is ignored**

Run: `touch .env.production && git check-ignore .env.production; echo "ignored-exit:$?"; rm -f .env.production`
Expected: prints `.env.production` and `ignored-exit:0` (it IS git-ignored).

- [ ] **Step 3: Record the operator smoke checklist**

The live build + smoke is operator-deferred (Docker broken on dev box). Confirm this checklist is captured in the report for the operator to run in a Docker-capable env (VM / WSL / CI):

```
# 1. Build
docker build -t lk-otsfera:prod .

# 2. Validate compose
cp .env.production.example .env.production   # then fill real values
docker compose -f docker-compose.prod.yml config -q

# 3. Bring up (Redis local; PG/S3 via .env.production)
docker compose -f docker-compose.prod.yml up -d

# 4. Migrations (explicit operator step — launch-runbook §3.2)
docker compose -f docker-compose.prod.yml run --rm web npx prisma migrate deploy

# 5. Smoke
#  - web liveness:   curl -fsS http://127.0.0.1:3000/api/health/live   → 200
#  - web readiness:  curl -fsS -H "Authorization: Bearer $HEALTH_TOKEN" http://127.0.0.1:3000/api/health  → DB+Redis ok
#  - worker:         docker compose -f docker-compose.prod.yml logs worker  → connects to Redis, no crash loop
#  - prisma client:  docker compose -f docker-compose.prod.yml run --rm worker node -e "require('@prisma/client'); console.log('prisma ok')"
#  - tsx present:    docker compose -f docker-compose.prod.yml run --rm worker npx tsx --version
```

- [ ] **Step 4: Final commit (if any doc tweak; otherwise skip)**

```bash
git add -A
git commit --no-verify -m "docs(prod): SP2 operator smoke checklist" || echo "nothing to commit"
```

---

## Self-Review Notes (author)

- **Spec coverage:** image rework + Prisma fix + non-root (T3); single-image web+worker via compose commands (T4); tsx→deps (T1, +prisma per refinement); .dockerignore (T2); .env.production.example + gitignore (T1/T5); migrations-as-operator-command (T6 checklist, no entrypoint); testing/operator-deferral (T3/T4/T6). All spec §8 acceptance criteria mapped.
- **Spec refinement flagged:** `prisma` CLI also moves to `dependencies` (spec §3 named only `tsx`). Reason: `npx prisma generate` (runtime-deps) and `npx prisma migrate deploy` (operator, from image) both need the CLI in the prod image. Surfaced to the user before planning.
- **Operator-deferred (Docker broken on dev box):** the live `docker build` (T3.3) and `docker compose up` smoke (T6) run in a Docker-capable env. Static validations (`npm ls`, typecheck, lint, COPY-path existence, compose YAML shape) run locally.
- **Type/name consistency:** image tag `lk-otsfera:prod`, service names `web`/`worker`/`redis`, command arrays, and env var names are identical across Dockerfile, compose, and the env template.
