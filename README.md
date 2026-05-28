# B2B Cabinet MVP (Next.js + Supabase + Prisma)

## Stack
Next.js 15, TypeScript, Tailwind, Prisma, PostgreSQL, Supabase Auth/Storage.

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
- `SUPABASE_URL` — URL проекта Supabase для server-only кода (storage/admin client).
- `SUPABASE_SERVICE_ROLE_KEY` — сервисный ключ Supabase для серверных API.

Переменные для Student bridge:

- `STUDENT_BRIDGE_JWT_SECRET` — отдельный секрет для bridge JWT (если не задан, используется `JWT_SECRET`).
- `STUDENT_BRIDGE_ISSUER` — issuer bridge JWT (если не задан, используется `APP_URL`).
- `STUDENT_BRIDGE_TTL` — TTL bridge JWT в секундах, ограничен диапазоном `300..900`.
- `STUDENT_REDIRECT_URL` — базовый URL внешнего student/LMS портала для редиректа.
- `STUDENT_REDIRECT_ALLOWED_DOMAINS` — единый allowlist разрешенных доменов для redirect URL (CSV хостов, без wildcard).
- Переходный период совместимости: если `STUDENT_REDIRECT_URL` или `STUDENT_REDIRECT_ALLOWED_DOMAINS` пусты, код читает legacy-переменные `STUDENT_PORTAL_URL` и `STUDENT_PORTAL_ALLOWED_HOSTS` и пишет server-side warning без секретов.

Дополнительно:

- `SUPABASE_ANON_KEY` — публичный ключ для клиентских сценариев (если используются).
- `SUPABASE_STORAGE_BUCKET` — имя bucket для документов (по умолчанию `documents`).
- `DOCUMENT_MAX_FILE_SIZE_MB` — максимальный размер загружаемого файла в MB; значение должно быть конечным числом больше `0` (рекомендуемый диапазон `1..100`, по умолчанию `10`).

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
- Works on Vercel + managed Postgres/Supabase

## New cabinets (MVP)
- `/partner/dashboard` — dashboard партнера с агрегированными метриками.
- `/organization/dashboard` — dashboard организации.
- `/student` + `/student/redirect` — временный SSO-like переход во внешний LMS по signed JWT.
- Middleware ограничивает доступ по ролям и изолирует кабинеты.

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

### Supabase URL/key (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)

Симптомы:
- Ошибки загрузки/скачивания документов.
- Ошибки инициализации Supabase клиента на сервере.

Проверка:
```bash
node -e "console.log(process.env.SUPABASE_URL, Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY))"
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
