# Дизайн — прод-инфраструктура, SP2: упаковка (контейнеры + prod-compose)

**Дата:** 2026-06-20
**Статус:** утверждён (дизайн), готов к плану
**Родительская задача:** гринфилд прод-запуск на РФ-инфраструктуре (см. [SP1-спеку §0](2026-06-20-prod-infrastructure-sp1-storage-adapter-design.md) — контекст 152-ФЗ, топология C, декомпозиция).
**Зависит от:** SP1 (S3-адаптер, [PR #134](https://github.com/aiprocadm/lk_otsfera/pull/134)).
**Связанное:** [runbook-launch-deploy.md](../../runbook-launch-deploy.md) (операторская процедура — миграции, флип флагов).

---

## 0. Цель и граница

Сделать приложение запускаемым в проде на **топологии C** (одна VM: web + worker + Redis через docker-compose; managed-PostgreSQL и S3 — внешние, только через env). SP2 даёт: production-образ для обоих процессов, prod-compose для VM, шаблон `.env.production`, и операторскую команду миграций.

**Граница (зафиксировано):** SP2 = **только контейнеризация + prod-compose**. Reverse-proxy + TLS (HTTPS) → **SP3-runbook** (зависят от выбранного провайдера/домена). Поэтому web публикуется только на **loopback** (`127.0.0.1:3000`) — наружу его отдаст reverse-proxy в SP3.

**Стратегия образа (зафиксировано — вариант A):** один образ, воркер запускается через `tsx` (как в dev → ноль расхождения dev/prod), **без** Next standalone (на always-on VM размер образа нерелевантен; компиляция/standalone добавили бы риск esbuild-бандлинга Prisma/BullMQ без выигрыша).

**Не-цель:** TLS/reverse-proxy; провижн инфры (SP3); авто-миграции на старте; CI-пайплайн сборки образа.

---

## 1. Образ — переработка `Dockerfile`

Текущий [Dockerfile](../../Dockerfile) собирает **только web** (`npm run start`) и имеет латентный баг: стейдж `runtime-deps` делает `npm ci --omit=dev` без копирования `prisma/schema`, поэтому Prisma-клиент в рантайме **не сгенерирован под схему**. SP2 переделывает его под оба процесса и чинит это.

**Стейджи:**

| Стейдж | Действие |
|---|---|
| `deps` | `COPY package.json package-lock.json`; `npm ci` (полный — нужен для сборки). |
| `build` | `COPY --from=deps node_modules`; `COPY . .`; `npm run prisma:generate`; `npm run build`. |
| `runtime-deps` | `COPY package.json package-lock.json`; `npm ci --omit=dev`; **`COPY prisma ./prisma`** затем **`npx prisma generate`** (генерирует клиент под схему в prod-`node_modules`; `tsx` уже здесь, т.к. переехал в `dependencies` — см. §3). |
| `runtime` | `node:20-alpine`, `NODE_ENV=production`, **non-root user**. Копирует: `node_modules` (из `runtime-deps` — prod-deps + сгенерированный клиент + tsx), `.next` + `public` + `package.json` + `next.config.ts` (из `build`), **`src/` + `tsconfig.json` + `prisma/`** (нужны воркеру для `tsx src/worker/index.ts` + резолва алиасов `@/*` через `tsconfig.paths`). |

- **`CMD`** по умолчанию = web: `["npm","run","start"]`. Worker-сервис в compose переопределяет на `["npm","run","worker"]` (= `tsx src/worker/index.ts`).
- **HEALTHCHECK** (web) сохраняем: `fetch('http://localhost:3000/api/health/live')` (Node 20 — global fetch).
- **non-root:** создать `app` пользователя (`addgroup`/`adduser`), `chown` рабочей директории, `USER app`. Снижает blast-radius при компрометации.

**`.dockerignore` (новый)** — исключить из build-контекста: `node_modules`, `.next`, `.git`, `.env*`, `docs`, `playwright-report`, `coverage`, `*.md`, `.husky`, `src/e2e`. Ускоряет билд и исключает утечку локального `.env` в образ.

---

## 2. `docker-compose.prod.yml` (новый, для VM)

Три сервиса. **Нет** локальных `db`/`minio` — PostgreSQL managed, файлы в S3 (оба только через env в `.env.production`).

```yaml
services:
  web:
    image: lk-otsfera:prod          # собран `docker build -t lk-otsfera:prod .`
    command: ["npm","run","start"]
    env_file: .env.production
    ports: ["127.0.0.1:3000:3000"]  # loopback — наружу отдаст reverse-proxy (SP3)
    depends_on:
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD","node","-e","fetch('http://localhost:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    restart: unless-stopped
  worker:
    image: lk-otsfera:prod
    command: ["npm","run","worker"]
    env_file: .env.production        # incl. ENABLE_SYNC_CRON=1
    depends_on:
      redis: { condition: service_healthy }
    restart: unless-stopped          # liveness покрыт подсистемой алертов; HTTP-healthcheck не нужен (нет HTTP-сервера)
  redis:
    image: redis:7-alpine
    command: ["redis-server","--appendonly","yes"]
    volumes: ["redisdata:/data"]
    healthcheck:
      test: ["CMD","redis-cli","ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped
volumes:
  redisdata:
```

- Оба `web`/`worker` — **один образ**, разная `command`.
- `redis` не публикует порт (внутрисетевой; `REDIS_URL=redis://redis:6379`).
- `restart: unless-stopped` на всех — переживают рестарт VM/краши.

---

## 3. `package.json` — `tsx` в `dependencies`

Воркер в проде запускается `tsx src/worker/index.ts`. Сейчас `tsx` в `devDependencies` → выпадает из `npm ci --omit=dev`. **Переместить `tsx` в `dependencies`.** (`tsx` транспилирует TS на лету через esbuild и резолвит `tsconfig.paths` — компиляция не нужна.) Остальные dev-тулзы (vitest/eslint/playwright/typescript) остаются dev и в прод-образ не попадают.

---

## 4. `.env.production.example` (новый — шаблон, реальные значения НЕ коммитятся)

Все прод-переменные с плейсхолдерами и комментариями:

```bash
# --- БД (managed PostgreSQL, РФ) ---
DATABASE_URL=postgresql://USER:PASS@managed-pg-host:5432/cabinet
DIRECT_URL=postgresql://USER:PASS@managed-pg-host:5432/cabinet   # для prisma migrate
# --- Приложение ---
NEXT_PUBLIC_APP_URL=https://lk.example.ru
JWT_SECRET=<32+ символов>
HEALTH_TOKEN=<32+ символов>            # /api/health readiness
# --- Redis (внутри compose) ---
REDIS_URL=redis://redis:6379
# --- S3 (внешний РФ-бакет, SP1) ---
S3_ENDPOINT=https://s3.provider.ru
S3_REGION=ru-central1
S3_ACCESS_KEY_ID=<...>
S3_SECRET_ACCESS_KEY=<...>
S3_BUCKET=documents
S3_FORCE_PATH_STYLE=1
# --- Email ---
EMAIL_ENABLED=true
RESEND_API_KEY=<...>
EMAIL_FROM=no-reply@example.ru
# --- Worker cron/alerts ---
ENABLE_SYNC_CRON=1
# ALERT_TELEGRAM_BOT_TOKEN / ALERT_TELEGRAM_CHAT_ID (опц.)
# --- 1С: безопасный дефолт (живых записей нет до репетиции, см. launch-runbook §4) ---
ONE_C_ADAPTER=fake
# --- Feature flags: opt-in OFF; оператор флипает по launch-runbook §3.3 ---
# FEATURE_ORGANIZATION_CABINET / MANAGER_CABINET / LEADER_CABINET / ENROLLMENT_REQUESTS / CHAT
# --- SHOW_DEMO_LOGINS НЕ выставлять (раскрытие демо-учёток) ---
```

`.env.production` (без `.example`) добавить в `.gitignore` (если ещё не покрыт `.env*`).

---

## 5. Миграции — операторская команда, не авто-entrypoint

Образ несёт `prisma/` + сгенерированный клиент. Миграции запускаются **явным операторским шагом** (как [launch-runbook §3.2](../../runbook-launch-deploy.md)), а не в entrypoint:

```bash
docker compose -f docker-compose.prod.yml run --rm web npx prisma migrate deploy
```

**Почему не авто:** entrypoint-миграция бежит на каждом рестарте/масштабировании, гонится между инстансами, и опережает pre-deploy gate (`dedupe:commission` ДО migrate). Launch-runbook уже владеет этой дисциплиной — SP2 лишь даёт команду.

---

## 6. Тест-стратегия (верификация)

SP2 — инфра/конфиг, не unit-тестируемый код. Проверки:
1. **`docker compose -f docker-compose.prod.yml config`** — валидирует синтаксис/интерполяцию (можно без живого Docker-демона — статический парс).
2. **`docker build -t lk-otsfera:prod .`** — образ собирается; внутри неявно проверяется prisma-generate-fix и наличие `tsx`/`src`.
3. **Smoke (Docker-окружение):** поднять с локальным/тестовым PG+Redis+MinIO → `web` отвечает 200 на `/api/health/live`; `/api/health` (с `HEALTH_TOKEN`) — readiness green (DB+Redis); `worker` логирует подключение к Redis и берёт джобу (напр. enqueue `notifications.dispatch`).
4. **Образ-санити:** в runtime есть сгенерированный Prisma-клиент (`node -e "require('@prisma/client')"` не падает) и `tsx` (`npx tsx --version`).

**Docker на dev-машине сломан (известный gotcha) → build + smoke operator-deferred** (как MinIO-round-trip в SP1). В план войдёт **smoke-чеклист для оператора**; локально доступен только `docker compose config` (статический).

---

## 7. Файлы SP2

| Файл | Действие |
|---|---|
| `Dockerfile` | переработка (4 стейджа, prisma-generate-fix, non-root, copy src/tsconfig/prisma, web+worker) |
| `.dockerignore` | создать |
| `docker-compose.prod.yml` | создать |
| `.env.production.example` | создать |
| `.gitignore` | добавить `.env.production` (если не покрыто `.env*`) |
| `package.json` | `tsx`: devDependencies → dependencies |

---

## 8. Критерии готовности SP2

- [ ] `Dockerfile` собирает один образ для web+worker; non-root; Prisma-клиент генерируется под схему в runtime-deps; `src/`+`tsconfig.json`+`prisma/` в рантайме.
- [ ] `tsx` в `dependencies`; `npm ci --omit=dev` включает его (проверить `npm ls tsx --omit=dev`).
- [ ] `.dockerignore` исключает `node_modules`/`.next`/`.git`/`.env*`/docs/coverage.
- [ ] `docker-compose.prod.yml`: web(loopback:3000)+worker(no port)+redis; один образ, разные команды; `restart: unless-stopped`; нет локальных db/minio.
- [ ] `.env.production.example` со всеми переменными (плейсхолдеры); `.env.production` в `.gitignore`.
- [ ] `docker compose -f docker-compose.prod.yml config` валиден.
- [ ] Операторская команда миграций задокументирована.
- [ ] `npm run typecheck`/`lint` зелёные (правка package.json не ломает); build не затронут.
- [ ] **operator-deferred:** `docker build` + smoke-чеклист (web health / worker→redis / prisma client / tsx) — прогон в Docker/WSL-окружении.
