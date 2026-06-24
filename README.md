# B2B Cabinet MVP (Next.js + Prisma + S3)

## Stack
Next.js 15, TypeScript, Tailwind, Prisma, PostgreSQL, S3-совместимое объектное хранилище, BullMQ + Redis.

## Установка
1. Установите зависимости:
```bash
npm ci
```
2. Скопируйте переменные окружения:
```bash
cp .env.example .env
```
3. Сгенерируйте Prisma Client:
```bash
npm run prisma:generate
```

## Env

Минимально обязательные переменные для запуска:

- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `S3_ENDPOINT` — endpoint S3-совместимого хранилища (РФ-провайдер: Yandex Object Storage / VK Cloud / Selectel; локально MinIO `http://localhost:9000`).
- `S3_REGION` — регион хранилища (например `ru-central1`).
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — ключи доступа к хранилищу (server-only).
- `S3_BUCKET` — имя bucket для документов (по умолчанию `documents`).

Переменные для Student bridge:

- `STUDENT_BRIDGE_JWT_SECRET` — отдельный секрет для bridge JWT (если не задан, используется `JWT_SECRET`).
- `STUDENT_BRIDGE_ISSUER` — issuer bridge JWT (если не задан, используется `APP_URL`).
- `STUDENT_BRIDGE_TTL` — TTL bridge JWT в секундах, ограничен диапазоном `300..900`.
- `STUDENT_REDIRECT_URL` — базовый URL внешнего student/LMS портала для редиректа.
- `STUDENT_REDIRECT_ALLOWED_DOMAINS` — единый allowlist разрешенных доменов для redirect URL (CSV хостов, без wildcard).
- Переходный период совместимости: если `STUDENT_REDIRECT_URL` или `STUDENT_REDIRECT_ALLOWED_DOMAINS` пусты, код читает legacy-переменные `STUDENT_PORTAL_URL` и `STUDENT_PORTAL_ALLOWED_HOSTS` и пишет server-side warning без секретов.

Дополнительно:

- `S3_FORCE_PATH_STYLE` — `1` для MinIO и провайдеров без virtual-host-style (path-style адресация).
- `DOCUMENT_MAX_FILE_SIZE_MB` — максимальный размер загружаемого файла в MB; значение должно быть конечным числом больше `0` (рекомендуемый диапазон `1..100`, по умолчанию `10`).

Telegram-уведомления пользователям (§18, опционально — фича дремлет, если не задано):

- `TELEGRAM_BOT_TOKEN` — токен бота (может совпадать с `ALERT_TELEGRAM_BOT_TOKEN`).
- `TELEGRAM_BOT_USERNAME` — username бота без `@` (для deep-link `https://t.me/<username>?start=<code>`).
- `TELEGRAM_WEBHOOK_SECRET` — секрет (32+ симв.) для проверки заголовка `X-Telegram-Bot-Api-Secret-Token`.

Настройка бота: создать бота у @BotFather, затем зарегистрировать webhook (один раз):

```
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<APP_HOST>/api/integrations/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Пользователь привязывает Telegram в кабинете → «Настройки»: получает deep-link, открывает его и
жмёт «Старт» у бота. После привязки уведомления зеркалятся в Telegram наравне с ЛК и e-mail.

## Локальный запуск

```bash
npm run prisma:migrate
npm run dev
```

Приложение по умолчанию доступно на `http://localhost:3000`.

## Docker запуск

1. Поднимите контейнеры:
```bash
docker compose up --build
```
2. Примените миграции в контейнере приложения:
```bash
docker compose exec app npx prisma migrate deploy
```

## Миграции

Для локальной разработки:
```bash
npm run prisma:migrate
```

Для production/deploy:
```bash
npm run prisma:migrate:deploy
```

## Сиды

Заполнение тестовыми данными:
```bash
npm run prisma:seed
```

## Тесты

Тестовая дисциплина — трёхслойная (см. [CLAUDE.md §6](CLAUDE.md)). GH Actions отключены, гейтинг локальный через Husky.

| Команда | Слой | Когда |
|---|---|---|
| `npm test` | Всё (unit + integration) | Полный прогон |
| `npm run test:unit` | Только unit (без БД) | Pre-push hook, быстрая обратная связь |
| `npm run test:integration` | Только integration (нужен Postgres) | Перед PR / релизом, вручную |
| `npm run test:changed` | Vitest на изменённых файлах в unit-режиме | Pre-commit hook (автоматически) |
| `npm run test:watch` | Интерактивный режим | Во время разработки |

**Husky hooks** ([.husky/pre-commit](.husky/pre-commit), [.husky/pre-push](.husky/pre-push)) ставятся автоматически после `npm install` через `prepare` скрипт. Бипас: `git commit --no-verify` (использовать редко).

**Integration-слой** требует поднятого Postgres (см. [docker-compose.yml](docker-compose.yml)):

```bash
docker compose up -d db redis
npm run prisma:migrate:deploy
npm run test:integration
```

> **Windows / локаль `C` — кириллический поиск.** Postgres сворачивает регистр (`lower()` и `ILIKE`, который Prisma генерит для `mode:'insensitive'`) по **коллации**, а не по глобальной настройке. Если локальная БД создана под локалью `C`/`POSIX` (типичный дефолт `template1` на Windows-кластере, который наследует БД, авто-созданная `prisma migrate deploy`), регистр сворачивается **только для ASCII** — и регистронезависимый поиск по кириллице молча возвращает 0 строк. Симптом: падают ровно integration-тесты поиска (org orders/students, partner portfolio) при зелёных unit. Это средовой дефект, не баг кода. Фикс — пересоздать локальную БД с ICU-провайдером (полное Unicode-сворачивание):
>
> ```bash
> npm run db:recreate-local          # drop + create `cabinet` с LOCALE_PROVIDER icu, проверка сворачивания
> npm run prisma:migrate:deploy
> npm run prisma:seed                # seed не завершается сам локально (BullMQ handle) — Ctrl-C после "[seed] done"
> ```
>
> Скрипт ([scripts/recreate-local-db.ts](scripts/recreate-local-db.ts)) защищён на работу только с `localhost`. Диагностика: `SELECT ('Иван' ILIKE 'иван')` → `false` подтверждает сломанную локаль.

## Build

Проверка сборки production:
```bash
npm run build
```

## Features
- Auth via JWT cookie + RBAC (organization/partner/student/manager/admin)
- Dashboard with orders/documents/comments summary
- Orders list/detail
- Documents metadata + upload endpoint
- Order comments API
- Dark mode support via Tailwind class
- Middleware route protection
- Basic audit log model

## Deployment
- Works on VPS by Docker
- РФ-инфраструктура: managed PostgreSQL + S3-совместимое объектное хранилище + Redis
  (см. [docs/runbook-prod-infra-rf.md](docs/runbook-prod-infra-rf.md))

## New cabinets (MVP)
- `/partner/dashboard` — dashboard партнера с агрегированными метриками.
- `/organization/dashboard` — dashboard организации.
- `/manager/dashboard` — dashboard внутреннего менеджера Промтехносферы.
- `/student` + `/student/redirect` — временный SSO-like переход во внешний LMS по signed JWT.
- Middleware ограничивает доступ по ролям и изолирует кабинеты.

## Cabinet rollout status

| Cabinet | Маршрут | Feature flag | Default | Состояние |
|---|---|---|---|---|
| Partner | `/partner/*` | — | always on | Production (Phase 0–5 done) |
| Organization | `/organization/*` | `FEATURE_ORGANIZATION_CABINET` | **opt-in** (off) | Staged rollout (Phase 7 done, operator-driven enablement) |
| Manager | `/manager/*` | `FEATURE_MANAGER_CABINET` | **opt-in** (off) | Staged rollout (Phase 8 done, operator-driven enablement) |
| Admin | `/admin/*` | — | always on | Production (Phase 6.0–6.7 done — см. [admin-cabinet-6.3-6.7-DONE.md](docs/superpowers/plans/2026-05-29-admin-cabinet-6.3-6.7-DONE.md)) |
| Student | `/student/*` | — | always on | Production (bridge redirect) |

Opt-in флаги означают: код в `main`, но эндпоинты возвращают 404 пока env-флаг не выставлен в `1/true/on`. Это поэтапная раскатка по операторам — см. [src/lib/featureFlags.ts](src/lib/featureFlags.ts) для семантики флагов. Пошаговая процедура включения (staging-smoke → флип флага на prod → наблюдение → откат) — в **[runbook staged-rollout](docs/runbook-staged-rollout-cabinets.md)** (smoke-чеклисты: [organization](docs/qa-staging-smoke-organization.md) · [manager](docs/qa-staging-smoke-manager.md)).

## Явная RBAC-матрица

### Web routes

| Route prefix | admin | manager | partner | organization | student |
| --- | --- | --- | --- | --- | --- |
| `/admin/*` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/manager/*` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `/partner/*` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `/organization/*` | ✅ | ❌ | ❌ | ✅ | ❌ |
| `/student/*` | ✅ | ✅ | ❌ | ✅ | ✅ |

### API routes

| Endpoint | Method | admin | manager | partner | organization | student |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/orders` | `GET` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `/api/orders/:id` | `PATCH` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `/api/documents` | `GET` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `/api/documents/upload` | `POST` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `/api/documents/:id/download` | `POST` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `/api/comments` | `POST` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `/api/notifications` | `GET`, `PATCH` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `/api/student/bridge/token` | `POST` | ❌ | ❌ | ❌ | ❌ | ✅ |

> Все endpoint'ы возвращают `401`, если сессия отсутствует, и `403`, если роль пользователя не разрешена для конкретного ресурса.

## Student redirect

### Передаваемые поля (claims)

В Student bridge JWT передаются только:
- `sub` — идентификатор пользователя-студента.
- `role` — всегда `student`.
- `organizationId`
- `email`
- `name`
- `externalStudentId`
- `jti` — уникальный идентификатор токена.
- `iat`, `exp`
- `aud` — `external-student-portal`.
- `iss` — `STUDENT_BRIDGE_ISSUER` или fallback `APP_URL`.

### Запрещено передавать

- Секреты (`JWT_SECRET`, `STUDENT_BRIDGE_JWT_SECRET`, API keys, service keys).
- Внутренние служебные флаги и права (`isAdmin`, внутренние ACL, debug-поля).
- Полные профили/PII сверх перечисленного контракта.

### Security / logging

- Одноразовые bridge-коды (`code`) не логируются в явном виде и не пишутся даже в маскированной форме.
- Для расследования инцидентов в audit log сохраняются только технические поля: `reason`, `clientId`, `ip`, `entityId`.

### TTL policy

- Значение берется из `STUDENT_BRIDGE_TTL` (секунды).
- Жесткое ограничение диапазона: `300..900` секунд.
- Значение по умолчанию: `600` секунд.

### Allowed domain policy

- Redirect разрешен только на домены из `STUDENT_REDIRECT_ALLOWED_DOMAINS`.
- Allowlist парсится как CSV-список хостов, wildcard (`*`) игнорируется.
- Запрещены редиректы на произвольные URL пользователя без валидации against allowlist.

## Troubleshooting

### `JWT_SECRET`

Симптомы:
- Ошибки подписи/валидации JWT.
- Невозможно залогиниться или сессия сразу инвалидируется.

Проверка:
```bash
node -e "console.log(Boolean(process.env.JWT_SECRET), (process.env.JWT_SECRET||'').length)"
```

### S3 object storage (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`)

Симптомы:
- Ошибки загрузки/скачивания документов.
- Ошибки инициализации S3-клиента на сервере / `StorageError`.

Проверка:
```bash
node -e "console.log(process.env.S3_ENDPOINT, process.env.S3_BUCKET, Boolean(process.env.S3_ACCESS_KEY_ID), Boolean(process.env.S3_SECRET_ACCESS_KEY))"
```

### Prisma DB URL (`DATABASE_URL`, `DIRECT_URL`)

Симптомы:
- `prisma migrate` не подключается к базе.
- Ошибки вида connection refused/auth failed.

Проверка:
```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

## Финальный release checklist

Перед релизом выполните:

1. Установка зависимостей и генерация Prisma Client:
```bash
npm ci
npm run prisma:generate
```

2. Статические проверки качества:
```bash
npm run typecheck
npm run lint
```

3. Unit-тесты (без БД):
```bash
npm run test:unit
```

4. Integration-тесты (нужен поднятый Postgres):
```bash
docker compose up -d db redis
npm run prisma:migrate:deploy
npm run test:integration
```

5. Проверка production build:
```bash
npm run build
```

6. Dev-server boot check (ловит ошибки маршрутизации, которые `next build` не видит — например конфликт slug-имён в одном динамическом сегменте, см. инцидент с `[id]` vs `[orderId]` в `/api/manager/documents` после PR #58):
```bash
npm run dev
# дождаться "✓ Ready in ..." в логе, убедиться что нет ERROR/Failed,
# затем остановить Ctrl+C. ~30 секунд.
```

7. Применение production-миграций:
```bash
npm run prisma:migrate:deploy
```

8. (Опционально) smoke-check авторизации и роутов по ролям:
- `admin` → доступ только к `/admin/*`.
- `manager` → доступ только к `/manager/*`.
- `partner` → доступ к `/partner/*`, без `/admin/*` и `/manager/*`.
- `organization` → доступ к `/organization/*`.
- `student` → доступ к `/student/*` и выдаче bridge-token.
