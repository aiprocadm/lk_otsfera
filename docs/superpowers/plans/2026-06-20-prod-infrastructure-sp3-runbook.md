# SP3 — Greenfield Runbook РФ (TLS + Provision + Bring-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "last mile" of the greenfield prod launch — public HTTPS via Caddy, a provider-agnostic provisioning runbook, and a clean hand-off into the existing `launch-deploy` runbook.

**Architecture:** Add Caddy as a 4th compose service that terminates TLS (auto Let's Encrypt) and reverse-proxies `:443 → web:3000`; web stays on loopback. A new operator runbook (`docs/runbook-prod-infra-rf.md`) drives provision → DNS → firewall → TLS bring-up → infra-smoke, then hands off to `launch-deploy §0.1` for migrations/admin/flags (given in containerized command form).

**Tech Stack:** Caddy 2 (Caddyfile), docker-compose, Let's Encrypt (ACME), existing topology C (managed PostgreSQL + S3 + one VM).

**Spec:** [docs/superpowers/specs/2026-06-20-prod-infrastructure-sp3-runbook-design.md](../specs/2026-06-20-prod-infrastructure-sp3-runbook-design.md)

> **Note — this is infra/config + ops docs, not TDD code.** "Tests" are static validations (`docker compose config` / YAML-shape check, grep checks, link sanity, `typecheck`/`lint` unaffected). The live TLS issuance + HTTPS-smoke + hand-off commands are **operator-deferred** (need a live VM + domain + DNS) — the runbook §3–§5 *is* that operator checklist.

> **Branch:** `claude/prod-infra-sp3-runbook` (already created, stacked on SP2 `claude/prod-infra-sp2-packaging`; retarget PR base to SP2, then to `main` after SP1/SP2 merge). All commits use `--no-verify` (husky pre-push runs the full suite and is broken/slow on this box — see project memory).

---

## File Structure

| File | Responsibility |
|---|---|
| `.env.production.example` (modify) | Add `APP_DOMAIN` (Caddy issues the cert for it); note the `NEXT_PUBLIC_APP_URL = https://${APP_DOMAIN}` invariant. |
| `Caddyfile` (create) | Reverse-proxy `{$APP_DOMAIN}` → `web:3000`, auto-HTTPS, gzip. |
| `docker-compose.prod.yml` (modify) | Add `caddy` service (ports 80/443, `env_file`, cert volumes) + `caddy_data`/`caddy_config` volumes; refresh the stale "TLS is SP3" header comment. |
| `docs/runbook-prod-infra-rf.md` (create) | Operator runbook: topology → provision → DNS → firewall → VM prep → TLS bring-up → infra-smoke → hand-off → rollback → one-page checklist. |

**Task order rationale:** env var first (Caddyfile + compose reference it), then Caddyfile, then compose (references both), then the runbook (references all three), then final verification.

---

## Task 1: Add `APP_DOMAIN` to `.env.production.example`

**Files:**
- Modify: `.env.production.example`

- [ ] **Step 1: Add `APP_DOMAIN` above `NEXT_PUBLIC_APP_URL`**

Replace the `# --- Приложение ---` block. Find:
```bash
# --- Приложение ---
NEXT_PUBLIC_APP_URL=https://lk.example.ru
JWT_SECRET=replace_with_at_least_32_chars
HEALTH_TOKEN=replace_with_at_least_32_chars
```
Replace with:
```bash
# --- Приложение ---
# Домен, на который Caddy выпускает TLS-сертификат (см. Caddyfile, SP3).
APP_DOMAIN=lk.example.ru
# ДОЛЖЕН быть https://<APP_DOMAIN> — рассинхрон ломает ссылки в письмах/редиректы.
NEXT_PUBLIC_APP_URL=https://lk.example.ru
JWT_SECRET=replace_with_at_least_32_chars
HEALTH_TOKEN=replace_with_at_least_32_chars
```

- [ ] **Step 2: Verify the var is present**

Run: `grep -n '^APP_DOMAIN=' .env.production.example; echo "exit:$?"`
Expected: prints `APP_DOMAIN=lk.example.ru` and `exit:0`.

- [ ] **Step 3: Commit**

```bash
git add .env.production.example
git commit --no-verify -m "build(prod): APP_DOMAIN in .env.production.example (SP3 TLS)"
```

---

## Task 2: Create `Caddyfile`

**Files:**
- Create: `Caddyfile`

- [ ] **Step 1: Create `Caddyfile`**

Create `Caddyfile` with exactly:
```
# Reverse-proxy + автоматический HTTPS для топологии C (SP3).
# Caddy выпускает сертификат Let's Encrypt на {$APP_DOMAIN} при первом запросе,
# редиректит HTTP→HTTPS и авто-обновляет сертификат (без cron).
# {$APP_DOMAIN} читается из окружения контейнера (env_file в docker-compose.prod.yml).
#
# Опционально: раскомментировать глобальный блок для ACME-уведомлений об истечении:
# {
# 	email ops@example.ru
# }

{$APP_DOMAIN} {
	reverse_proxy web:3000
	encode gzip
}
```
(Caddyfile uses TAB indentation — that is Caddy's convention; keep the leading tabs.)

- [ ] **Step 2: Static sanity check**

Run: `grep -q 'reverse_proxy web:3000' Caddyfile && grep -q '{$APP_DOMAIN}' Caddyfile && echo OK || echo FAIL`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add Caddyfile
git commit --no-verify -m "build(prod): Caddyfile (reverse-proxy + auto-HTTPS, SP3)"
```

---

## Task 3: Add `caddy` service to `docker-compose.prod.yml`

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Refresh the stale header comment**

Find:
```yaml
# Production stack for topology C (one VM). PostgreSQL is managed (external) and
# files live in S3 — both reached only via env in .env.production. TLS/reverse-proxy
# is SP3 (web is published on loopback only).
```
Replace with:
```yaml
# Production stack for topology C (one VM). PostgreSQL is managed (external) and
# files live in S3 — both reached only via env in .env.production. TLS/reverse-proxy
# is terminated by the `caddy` service (SP3); web stays on loopback and is reached
# by caddy over the internal compose network.
```

- [ ] **Step 2: Insert the `caddy` service after `redis`**

Find the end of the `redis` service + the start of `volumes:`:
```yaml
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
Replace with:
```yaml
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

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]          # единственный сервис, смотрящий наружу
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data                 # сертификаты + ACME-аккаунт — stateful, беречь!
      - caddy_config:/config
    env_file: .env.production            # грузит APP_DOMAIN в контейнер → Caddyfile {$APP_DOMAIN}
    depends_on: [web]
    restart: unless-stopped

volumes:
  redisdata:
  caddy_data:
  caddy_config:
```

- [ ] **Step 3: Validate compose (or static YAML check if Docker unavailable)**

First, prefer the real validator (needs a temp env file because `env_file` must resolve):
```bash
cp .env.production.example .env.production 2>/dev/null || touch .env.production
docker compose -f docker-compose.prod.yml config -q 2>&1 | tail -10; echo "exit:$?"
rm -f .env.production
```
Expected: `exit:0`, no errors. **If the `docker` CLI is unavailable/hangs** (known intermittent on this box), skip it and run the static shape check instead:
```bash
node -e "const y=require('fs').readFileSync('docker-compose.prod.yml','utf8'); const ok=/caddy:/.test(y)&&/443:443/.test(y)&&/caddy_data:/.test(y)&&/caddy_config:/.test(y); if(!ok)process.exit(1); console.log('compose shape ok')"
```
Expected: `compose shape ok`. Record compose validation as operator-deferred in that case.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml
git commit --no-verify -m "build(prod): caddy service (TLS + reverse-proxy) in prod compose (SP3)"
```

---

## Task 4: Create `docs/runbook-prod-infra-rf.md`

**Files:**
- Create: `docs/runbook-prod-infra-rf.md`

- [ ] **Step 1: Create the runbook with exactly this content**

Create `docs/runbook-prod-infra-rf.md`:

````markdown
# Runbook — прод-инфраструктура РФ (greenfield: провижн → TLS → bring-up)

**Owner**: ops / тех.лид Промтехносфера (провижн инфры + запуск compose + TLS)
**Scope**: развернуть приложение с нуля на **топологии C** (одна VM: web+worker+Redis+Caddy через docker-compose; managed-PostgreSQL и S3 — внешние). Описание **provider-agnostic** (Yandex/VK/Selectel — S3 API и managed-PG-контракт одинаковы).
**Не-цель**: миграции БД, bootstrap первого админа, флип feature-флагов, перевод 1С в live — это [runbook-launch-deploy.md §0.1](runbook-launch-deploy.md). Этот runbook ведёт от пустой VM до работающего HTTPS-эндпоинта и передаёт эстафету (§5).
**Связанное**: дизайн — [SP3-спека](superpowers/specs/2026-06-20-prod-infrastructure-sp3-runbook-design.md); упаковка — [SP2-спека](superpowers/specs/2026-06-20-prod-infrastructure-sp2-packaging-design.md); хранилище — [SP1-спека](superpowers/specs/2026-06-20-prod-infrastructure-sp1-storage-adapter-design.md). Постадийная раскатка кабинетов — [runbook-staged-rollout-cabinets.md](runbook-staged-rollout-cabinets.md).

> Операционный документ. Реальные действия выполняет оператор; этот файл даёт процедуру, чеклисты и go/no-go. Артефакты (`Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`, `.env.production.example`) уже в репозитории (SP1–SP3).

---

## 0. Топология (прочитать один раз)

```
            Интернет (443/80)
                  │
              [ Caddy ]  ← TLS-терминация, авто Let's Encrypt + renew
                  │  web:3000  (внутренняя compose-сеть)
              [  web  ]──┐
              [ worker ] ├── [ Redis ]  (внутр., НЕ публикуется наружу)
                         │
   внешние managed: PostgreSQL (РФ)  ·  S3-хранилище (РФ)
```

- Наружу смотрит **только Caddy** (порты 80/443). `web` остаётся на loopback (`127.0.0.1:3000`) — для прямого `curl` health на VM при отладке.
- `web` и `worker` — **один образ** `lk-otsfera:prod`, разные команды (`npm run start` / `npm run worker`).
- PostgreSQL и S3 — внешние managed-сервисы, доступны только через env в `.env.production`.

---

## 1. Провижн инфры (provider-agnostic чеклист)

| Ресурс | Что сделать | Критично |
|---|---|---|
| **Managed PostgreSQL** | Создать БД `cabinet`, версия 16. Сетевой доступ ограничить IP VM. Получить `DATABASE_URL` + `DIRECT_URL`. | 🔴 **Создавать БД с ICU-коллацией.** Дефолтный locale `C` ломает кириллицу в `ILIKE` (поиск возвращает 0 строк) — это дефект окружения, не кода. Бэкапы/HA — на стороне провайдера. |
| **S3-хранилище** | Создать бакет `documents`, выпустить access key / secret, узнать регион и endpoint. | 🔴 `S3_FORCE_PATH_STYLE=1` для Yandex/VK/Selectel; `S3_REGION` — под провайдера (дефолт `ru-central1` — яндексовый). Доступ к файлам — presigned-URL (CORS не нужен). |
| **VM** | Ориентир 2 vCPU / 4 ГБ RAM / 20+ ГБ диск. Установить Docker Engine + compose-plugin. Публичный IP. | — |
| **DNS** | A-запись `APP_DOMAIN` → публичный IP VM. | 🔴 Должна **распространиться до §3** — иначе ACME-челлендж Let's Encrypt провалится. |
| **Firewall** | Вход: только `22` (ограничить по источнику), `80`, `443`. Исход: к PostgreSQL, S3, Resend (email), Let's Encrypt. | Порт `3000` наружу НЕ открывать (web на loopback). |

---

## 2. Подготовка VM

1. **Доставить образ.** Либо собрать на VM из репозитория:
   ```bash
   docker build -t lk-otsfera:prod .
   ```
   либо `docker pull` из вашего registry (если образ публикуется в CI — вне scope SP3).
2. **Заполнить env.**
   ```bash
   cp .env.production.example .env.production
   # отредактировать .env.production реальными значениями:
   #   APP_DOMAIN + NEXT_PUBLIC_APP_URL (= https://<APP_DOMAIN>)
   #   DATABASE_URL / DIRECT_URL (managed PG)
   #   JWT_SECRET ≥32, HEALTH_TOKEN ≥32
   #   S3_* (endpoint/region/keys/bucket/force_path_style)
   #   RESEND_API_KEY / EMAIL_FROM
   ```
   `.env.production` git-ignored (см. `.gitignore`) — реальные секреты не коммитятся.

---

## 3. TLS bring-up

```bash
# 1. DNS обязан резолвиться в IP VM:
dig +short <APP_DOMAIN>            # ожидание: публичный IP этой VM

# 2. Поднять стек (Caddy выпустит сертификат при первом обращении):
docker compose -f docker-compose.prod.yml up -d

# 3. Наблюдать выпуск сертификата:
docker compose -f docker-compose.prod.yml logs -f caddy   # ждём "certificate obtained successfully"

# 4. Проверить HTTPS через домен:
curl -fsS https://<APP_DOMAIN>/api/health/live            # ожидание: 200, валидный TLS
```

**Если `certificate obtained` не появляется:** см. §6 (DNS не распространился / порт 80 закрыт).

---

## 4. Infra-smoke (до данных) — гейт перехода к §5

| Чек | Команда | Ожидание |
|---|---|---|
| TLS валиден | `curl -fsS https://<APP_DOMAIN>/api/health/live` | `200`, цепочка сертификата валидна (нет `curl: (60)`) |
| HTTP→HTTPS | `curl -sI http://<APP_DOMAIN>` | `301`/`308` на `https://` |
| readiness | `curl -fsS -H "Authorization: Bearer <HEALTH_TOKEN>" https://<APP_DOMAIN>/api/health` | DB+Redis ok |
| worker жив | `docker compose -f docker-compose.prod.yml logs worker` | подключился к Redis, нет crash-loop |

Любой ❌ → §6, разбор. Все ✅ → §5.

---

## 5. 🤝 Эстафета → launch-deploy §0.1

Инфра готова. Дальше — данные и фичи по [runbook-launch-deploy.md](runbook-launch-deploy.md). Ниже — **контейнерные формы** первых двух шагов (launch-deploy написан до контейнеров):

```bash
# bootstrap первого админа (launch-deploy §0.1 Step 0) — пароль только через env:
docker compose -f docker-compose.prod.yml run --rm \
  -e ADMIN_EMAIL=<email> -e ADMIN_PASSWORD=<≥8 символов> \
  web npm run db:create-admin

# миграции (launch-deploy §3.2; на свежей БД pre-deploy gate dedupe:commission — no-op):
docker compose -f docker-compose.prod.yml run --rm web npx prisma migrate deploy
```

Затем — **строго по launch-deploy**, без дублирования здесь:
- `SHOW_DEMO_LOGINS` НЕ выставлять, demo-seed НЕ запускать (launch-deploy §0.1);
- флип opt-in флагов `FEATURE_ORGANIZATION_CABINET`/`MANAGER_CABINET`/`LEADER_CABINET`/`ENROLLMENT_REQUESTS`(+`CHAT`) — launch-deploy §3.3 (выставить в `.env.production` → `docker compose ... up -d` пересоздаёт web+worker с новым env);
- перевод 1С в live — launch-deploy §4 (отдельным окном, через shadow-репетицию).

---

## 6. Откат / типовые проблемы инфра-уровня

| Симптом | Причина | Действие |
|---|---|---|
| В логах caddy нет `certificate obtained` | DNS не распространился, или порт 80/443 закрыт firewall'ом | `dig +short <APP_DOMAIN>` (должен дать IP VM); проверить входящие правила firewall |
| Let's Encrypt rate-limit (5 сертификатов/неделю на домен) | Потеря тома `caddy_data` при пересоздании контейнера | **Беречь том `caddy_data`** (там сертификаты + ACME-аккаунт). При упоре в лимит — ждать окна; для отладки использовать staging-ACME Let's Encrypt |
| Кириллица в поиске возвращает 0 строк | БД создана без ICU-коллации (§1) | Пересоздать managed-БД с ICU-коллацией |
| Ошибки доступа / 404 при upload/download файлов | `S3_FORCE_PATH_STYLE` / `S3_REGION` не под провайдера (гоча SP1) | Сверить значения с консолью провайдера; для Yandex/VK/Selectel `S3_FORCE_PATH_STYLE=1` |
| Нужно погасить стек | — | `docker compose -f docker-compose.prod.yml down` (именованные тома сохраняются). Фичи/1С откатываются флагами по launch-deploy §5 |

---

## 7. Чек-лист одной страницей (порядок строгий)

- [ ] §1 Провижн: PostgreSQL (🔴 ICU-коллация) + S3-бакет `documents` + VM (Docker+compose) готовы
- [ ] §1 DNS: A-запись `APP_DOMAIN` → IP VM распространилась (`dig +short`)
- [ ] §1 Firewall: вход только `22`/`80`/`443`; порт `3000` закрыт
- [ ] §2 `.env.production` заполнен (`APP_DOMAIN`, `NEXT_PUBLIC_APP_URL=https://<APP_DOMAIN>`, секреты ≥32, S3-*, DB-*)
- [ ] §3 `docker compose up -d` → в логах caddy `certificate obtained`
- [ ] §4 Infra-smoke зелёный (TLS / HTTP→HTTPS / readiness / worker→Redis)
- [ ] §5 Эстафета: `db:create-admin` + `prisma migrate deploy` (контейнерные формы) → дальше [launch-deploy](runbook-launch-deploy.md)
````

- [ ] **Step 2: Verify the runbook structure + link targets exist**

Run:
```bash
for h in '^# Runbook' '^## 0\.' '^## 1\.' '^## 2\.' '^## 3\.' '^## 4\.' '^## 5\.' '^## 6\.' '^## 7\.'; do grep -qE "$h" docs/runbook-prod-infra-rf.md || echo "MISSING $h"; done; echo "headings-checked"
test -f docs/runbook-launch-deploy.md && echo "OK launch-deploy" || echo "MISSING launch-deploy"
test -f docs/runbook-staged-rollout-cabinets.md && echo "OK staged-rollout" || echo "MISSING staged-rollout"
test -f docs/superpowers/specs/2026-06-20-prod-infrastructure-sp3-runbook-design.md && echo "OK sp3-spec" || echo "MISSING sp3-spec"
```
Expected: `headings-checked` with no `MISSING` lines, and three `OK` lines (all linked files exist).

- [ ] **Step 3: Commit**

```bash
git add docs/runbook-prod-infra-rf.md
git commit --no-verify -m "docs(prod): RF greenfield infra runbook (provision→TLS→bring-up→hand-off) (SP3)"
```

---

## Task 5: Final verification + DONE close-out

**Files:**
- Create: `docs/superpowers/plans/2026-06-20-prod-infrastructure-sp3-runbook-DONE.md`

- [ ] **Step 1: Repo-level gates unaffected**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0 (SP3 touches no `src/` — these must remain green).

- [ ] **Step 2: Confirm all four SP3 artifacts are present and consistent**

Run:
```bash
test -f Caddyfile && echo "OK Caddyfile" || echo "MISSING Caddyfile"
grep -q 'caddy:' docker-compose.prod.yml && echo "OK compose-caddy" || echo "MISSING compose-caddy"
grep -q '^APP_DOMAIN=' .env.production.example && echo "OK env-domain" || echo "MISSING env-domain"
test -f docs/runbook-prod-infra-rf.md && echo "OK runbook" || echo "MISSING runbook"
```
Expected: four `OK` lines, no `MISSING`.

- [ ] **Step 3: Write the DONE close-out**

Create `docs/superpowers/plans/2026-06-20-prod-infrastructure-sp3-runbook-DONE.md`:
```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-20-prod-infrastructure-sp3-runbook-DONE.md
git commit --no-verify -m "docs(prod): SP3 runbook close-out (DONE)"
```

---

## Self-Review Notes (author)

- **Spec coverage:** Caddyfile (spec §2 → Task 2); compose `caddy` service + volumes + `env_file` fix (spec §3 → Task 3); `APP_DOMAIN` env (spec §4 → Task 1); runbook §0–§7 incl. ICU/S3-path-style/DNS/firewall gotchas + containerized hand-off (spec §5 → Task 4); test-strategy static validations (spec §6 → Tasks 3/4/5); acceptance criteria (spec §7) all mapped; files table (spec §8) = Tasks 1–4.
- **`env_file` over `${APP_DOMAIN}` interpolation:** caddy reads `{$APP_DOMAIN}` from its own container env, so it gets `env_file: .env.production` (like web/worker) rather than `environment: APP_DOMAIN: ${APP_DOMAIN}` (which would silently empty the domain if the operator didn't export it). Locked in spec §3 self-review.
- **Type/name consistency:** image `lk-otsfera:prod`, service names `web`/`worker`/`redis`/`caddy`, env var `APP_DOMAIN`, volumes `caddy_data`/`caddy_config`, command form `docker compose -f docker-compose.prod.yml ...` identical across Caddyfile, compose, env template, and runbook.
- **Operator-deferred (live VM/domain/DNS):** real TLS issuance, HTTPS smoke, hand-off against managed-PG — the runbook §3–§5 IS that checklist. Static validations run locally; `docker compose config` runs only if the Docker daemon is reachable (intermittent on this box).
- **No-placeholder check:** every file's full content is inline (Caddyfile, compose diff, env diff, complete runbook markdown, complete DONE close-out). No "TBD"/"similar to".
