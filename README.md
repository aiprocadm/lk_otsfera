# lk-otsfera — B2B личный кабинет (Next.js + Prisma + S3)

Личный кабинет «Промтехносферы»: пять ролей (organization / partner / manager / admin / student),
заказы, документы с антивирус-сканом, комиссии, синхронизация с 1С, уведомления
(email / Telegram / Max / WhatsApp), фоновый воркер на BullMQ.

**Стек**: Next.js 15 (App Router) · React 19 · TypeScript 5 (strict) · Prisma 5 + PostgreSQL ·
S3-совместимое объектное хранилище · BullMQ + Redis · Vitest · Playwright.

## Запуск за 10 минут

Нужны: Node.js 24.x, Docker (для Postgres/Redis/MinIO).

1. Клонируйте и поставьте зависимости (husky-хуки поставятся сами через `prepare`):

   ```bash
   git clone <repo-url> && cd lk_otsfera
   npm ci
   ```

2. Скопируйте env и поправьте под локальный запуск **вне** Docker:

   ```bash
   cp .env.example .env
   ```

   В `.env` замените docker-хосты на localhost и включите демо-логины:
   - `DATABASE_URL` и `DIRECT_URL`: `@db:5432` → `@localhost:5432`
   - `REDIS_URL=redis://localhost:6379`
   - `JWT_SECRET` — любая строка **от 32 символов** (короче — middleware не пустит)
   - `SHOW_DEMO_LOGINS=on` — блок готовых логинов на `/login` (только dev/staging!)

3. Поднимите инфраструктуру (Postgres 16 на :5432, Redis на :6379, MinIO на :9000/:9001):

   ```bash
   docker compose up -d db redis minio
   ```

4. Сгенерируйте Prisma Client и примените миграции:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate:deploy
   ```

   > **Windows**: если кластер Postgres с локалью `C`, регистронезависимый поиск по кириллице
   > молча ломается. Пересоздайте БД с ICU: `npm run db:recreate-local`, затем снова
   > `npm run prisma:migrate:deploy` (подробности — в [Troubleshooting](#windows--локаль-c--кириллический-поиск)).

5. Засейдите демо-данные:

   ```bash
   npm run prisma:seed
   ```

   Сидируются учётки (пароль у всех — `Password123!`, это открытые dev-данные из
   [prisma/seed.ts](prisma/seed.ts)):
   - `admin@demo.local` — админ
   - `partner@demo.local` / `partner-mgr@demo.local` — партнёр (админ / менеджер)
   - `org@demo.local` — организация
   - `manager@demo.local` / `leader@demo.local` — менеджер / руководитель
   - `student@demo.local` — студент

6. Запустите dev-сервер и откройте [http://localhost:3000](http://localhost:3000):

   ```bash
   npm run dev
   ```

   Войдите любой учёткой из шага 5 (при `SHOW_DEMO_LOGINS=on` они кликабельны на `/login`).

7. (Опционально) фоновые задачи — воркер во втором терминале: `npm run worker:dev`.
   Без него UI работает, но 1С-sync / скан документов / генерация комиссий не выполняются.

8. (Опционально) загрузка документов: создайте bucket `documents` в консоли MinIO
   [http://localhost:9001](http://localhost:9001) (логин/пароль `minioadmin`/`minioadmin`).

9. (Опционально) кабинеты organization/manager по умолчанию выключены (staged rollout) —
   включаются в `.env`: `FEATURE_ORGANIZATION_CABINET=1`, `FEATURE_MANAGER_CABINET=1`.

Одна команда проверки, что всё в порядке (typecheck + lint + boundaries + deadcode +
dup + format + unit-тесты, БД не нужна):

```bash
npm run verify
```

## Команды дня

Полная таблица команд с пояснениями — в [CLAUDE.md §1](CLAUDE.md). Самое частое:

| Команда | Что делает |
|---|---|
| `npm run dev` | Dev-сервер на :3000 |
| `npm run worker:dev` | Воркер BullMQ (отдельный процесс) |
| `npm run verify` | Полный статический гейт + unit-тесты |
| `npm test` | Все vitest'ы (unit + integration; integration требует Postgres) |
| `npm run gate` | Integration-слой против эфемерного Docker-Postgres |
| `npm run prisma:migrate` | Локальная миграция (dev) |
| `npm run prisma:seed` | Демо-данные |
| `npm run build` | Production-сборка |

## Документация

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — карта архитектуры: слои, направление зависимостей, домены.
- [CLAUDE.md](CLAUDE.md) — проектные правила: контракт сервисов, RBAC, feature flags, тестовая дисциплина.
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — эксплуатация: деплой, инциденты, восстановление.
- [docs/CI.md](docs/CI.md) — устройство CI и локальной лестницы хуков.
- [docs/INVARIANTS.md](docs/INVARIANTS.md) — неизменяемые инварианты системы (безопасность, изоляция, деньги).

## Env

Минимально обязательные переменные для запуска:

- `DATABASE_URL`, `DIRECT_URL`
- `APP_URL` — базовый URL сервера (без него падает `/student/redirect`, а dev-письма ссылаются на прод)
- `JWT_SECRET` — минимум 32 символа
- `S3_ENDPOINT` — endpoint S3-совместимого хранилища (РФ-провайдер: Yandex Object Storage / VK Cloud / Selectel; локально MinIO `http://localhost:9000`)
- `S3_REGION` — регион хранилища (например `ru-central1`)
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — ключи доступа к хранилищу (server-only)
- `S3_BUCKET` — имя bucket для документов (по умолчанию `documents`)

Переменные для Student bridge:

- `STUDENT_BRIDGE_JWT_SECRET` — отдельный секрет для bridge JWT (если не задан, используется `JWT_SECRET`).
- `STUDENT_BRIDGE_ISSUER` — issuer bridge JWT (если не задан, используется `APP_URL`).
- `STUDENT_BRIDGE_TTL` — TTL bridge JWT в секундах, ограничен диапазоном `300..900`.
- `STUDENT_REDIRECT_URL` — базовый URL внешнего student/LMS портала для редиректа.
- `STUDENT_REDIRECT_ALLOWED_DOMAINS` — единый allowlist разрешенных доменов для redirect URL (CSV хостов, без wildcard).
- Переходный период совместимости: если `STUDENT_REDIRECT_URL` или `STUDENT_REDIRECT_ALLOWED_DOMAINS` пусты, код читает legacy-переменные `STUDENT_PORTAL_URL` и `STUDENT_PORTAL_ALLOWED_HOSTS` и пишет server-side warning без секретов.

Дополнительно:

- `S3_FORCE_PATH_STYLE` — `1` для MinIO и провайдеров без virtual-host-style (path-style адресация).
- `DOCUMENT_MAX_FILE_SIZE_MB` — максимальный размер загружаемого файла в MB; значение должно быть конечным числом больше `0` (рекомендуемый диапазон `1..200`, по умолчанию `200`).
- `SHOW_DEMO_LOGINS` — блок демо-логинов на `/login`. Server-only env (не `NEXT_PUBLIC_*`), по умолчанию выключен. **Никогда не включать в production.**

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

Каналы Max и WhatsApp (Трек D, §25.3 — единый слой интеграций; opt-in feature-флаги):

- **Max** (нативно, по образцу Telegram). Включить: `FEATURE_MAX_CHANNEL=1` + `MAX_BOT_TOKEN` +
  `MAX_BOT_USERNAME` (+ опц. `MAX_API_BASE_URL`, `MAX_WEBHOOK_SECRET`). Webhook —
  `POST /api/integrations/max/webhook` (секрет-заголовок `x-max-webhook-secret`). Привязка в
  «Настройках» аналогична Telegram (deep-link + `/start`).
- **WhatsApp через агрегатор** (Wazzup-подобный сервис; **не** прямая интеграция с Meta). Включить:
  `FEATURE_WHATSAPP_CHANNEL=1` + `WHATSAPP_AGGREGATOR_API_KEY` + `WHATSAPP_AGGREGATOR_CHANNEL_ID`
  (+ опц. `WHATSAPP_AGGREGATOR_BASE_URL`). Номер отправителя подключается в самом сервисе-агрегаторе;
  пользователь указывает свой номер в «Настройках». Боевые креды подключаются позже — до этого
  канал спит.

Email всегда включён (базовые события уходят на почту без возможности отключить); Telegram/Max/
WhatsApp — по выбору пользователя в «Настройках». Доставка может идти через воркер (BullMQ):
`FEATURE_NOTIF_QUEUE=1` + `REDIS_URL` включают очередь `notifications.dispatch` с ретраями и
идемпотентностью (одно событие не задваивается в канале); без флага/Redis — доставка inline.

Полный справочник переменных с комментариями — [.env.example](.env.example).

## Docker запуск (всё приложение в контейнерах)

1. Поднимите контейнеры:
```bash
docker compose up --build
```
2. Примените миграции в контейнере приложения:
```bash
docker compose exec app npx prisma migrate deploy
```

В этом режиме `.env` использует docker-хосты как в `.env.example` (`db`, `redis`).

## Тесты

Тестовая дисциплина — четырёхслойная (см. [CLAUDE.md §6](CLAUDE.md)). Гейтинг локальный через
Husky + серверное зеркало на GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

| Команда | Слой | Когда |
|---|---|---|
| `npm test` | Всё (unit + integration) | Полный прогон |
| `npm run test:unit` | Только unit (без БД) | Pre-push hook, быстрая обратная связь |
| `npm run gate` | Integration против эфемерного Docker-Postgres | Pre-push при затронутых `prisma/`/`worker/`/`services/`; вручную перед PR |
| `npm run test:integration` | Только integration (нужен живой Postgres) | Перед PR / релизом, вручную |
| `npm run test:changed` | Vitest на изменённых файлах в unit-режиме | Pre-commit hook (автоматически) |
| `npm run test:watch` | Интерактивный режим | Во время разработки |

**Husky hooks** ([.husky/pre-commit](.husky/pre-commit), [.husky/pre-push](.husky/pre-push)) ставятся автоматически после `npm install` через `prepare` скрипт. Бипас: `git commit --no-verify` (использовать редко).

**Integration-слой** требует поднятого Postgres (см. [docker-compose.yml](docker-compose.yml)):

```bash
docker compose up -d db redis
npm run prisma:migrate:deploy
npm run test:integration
```

### Windows / локаль `C` — кириллический поиск

> Postgres сворачивает регистр (`lower()` и `ILIKE`, который Prisma генерит для `mode:'insensitive'`) по **коллации**, а не по глобальной настройке. Если локальная БД создана под локалью `C`/`POSIX` (типичный дефолт `template1` на Windows-кластере, который наследует БД, авто-созданная `prisma migrate deploy`), регистр сворачивается **только для ASCII** — и регистронезависимый поиск по кириллице молча возвращает 0 строк. Симптом: падают ровно integration-тесты поиска (org orders/students, partner portfolio) при зелёных unit. Это средовой дефект, не баг кода. Фикс — пересоздать локальную БД с ICU-провайдером (полное Unicode-сворачивание):
>
> ```bash
> npm run db:recreate-local          # drop + create `cabinet` с LOCALE_PROVIDER icu, проверка сворачивания
> npm run prisma:migrate:deploy
> npm run prisma:seed
> ```
>
> Скрипт ([scripts/recreate-local-db.ts](scripts/recreate-local-db.ts)) защищён на работу только с `localhost`. Диагностика: `SELECT ('Иван' ILIKE 'иван')` → `false` подтверждает сломанную локаль.

## Deployment

- Works on VPS by Docker
- РФ-инфраструктура: managed PostgreSQL + S3-совместимое объектное хранилище + Redis
  (см. [docs/runbook-prod-infra-rf.md](docs/runbook-prod-infra-rf.md))
- Bootstrap первого админа на чистой (не-демо) БД: `npm run db:create-admin`
  (вход через env `ADMIN_EMAIL`/`ADMIN_PASSWORD`, см. [.env.example](.env.example))

## Cabinet rollout status

| Cabinet | Маршрут | Feature flag | Default | Состояние |
|---|---|---|---|---|
| Partner | `/partner/*` | — | always on | Production (Phase 0–5 done) |
| Organization | `/organization/*` | `FEATURE_ORGANIZATION_CABINET` | **opt-in** (off) | Staged rollout (Phase 7 done, operator-driven enablement) |
| Manager | `/manager/*` | `FEATURE_MANAGER_CABINET` | **opt-in** (off) | Staged rollout (Phase 8 done, operator-driven enablement) |
| Admin | `/admin/*` | — | always on | Production (Phase 6.0–6.7 done — см. [admin-cabinet-6.3-6.7-DONE.md](docs/superpowers/plans/2026-05-29-admin-cabinet-6.3-6.7-DONE.md)) |
| Student | `/student/*` | — | always on | Production (bridge redirect) |

Opt-in флаги означают: код в `main`, но эндпоинты возвращают 404 пока env-флаг не выставлен в `1/true/on`. Это поэтапная раскатка по операторам — см. [src/lib/featureFlags.ts](src/lib/featureFlags.ts) для семантики флагов. Пошаговая процедура включения (staging-smoke → флип флага на prod → наблюдение → откат) — в **[runbook staged-rollout](docs/runbook-staged-rollout-cabinets.md)** (smoke-чеклисты: [organization](docs/qa-staging-smoke-organization.md) · [manager](docs/qa-staging-smoke-manager.md)).

**Импорт из 1С** (Т-25/Т-29 ТЗ починки импорта): право — только `admin` и руководитель (`mayImportOneC`), обычный менеджер получает `/forbidden`. Страницы — `/admin/settings/integrations/1c/*` и зеркала `/leader/settings/integrations/1c/*`; на проде достаточно дефолтных флагов (`FEATURE_SETTINGS_HUB` — opt-out, **не** выставлять в `0`; своего флага у раздела нет), для кабинета руководителя — включённый `FEATURE_MANAGER_CABINET`. Подробнее — [docs/RUNBOOK.md](docs/RUNBOOK.md) §4.

## Явная RBAC-матрица

### Web routes

Таблица ниже — **не описание, а снимок кода**: её собирает из
[`protectedPrefixes`](src/lib/auth/access.ts) страж
[`docs.readme-rbac.guardrail`](src/__tests__/docs.readme-rbac.guardrail.test.ts) и
сравнивает с этим файлом. Разошлись — красная сборка (`У-260`, дефект `Д-42`).

| Route prefix | admin | leader | manager | partner | organization | student |
| --- | --- | --- | --- | --- | --- | --- |
| `/admin/*` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/leader/*` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/manager/*` | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/organization/*` | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `/partner/*` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `/student/*` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |

Две строки таблицы нуждаются в пояснении, иначе их читают неверно.

**Admin в чужие кабинеты не ходит — и это не упущение (Model A).** Администратор
управляет всем через зеркало `/admin/*` и `policy.ts` (`return true`), а не входом
в `/partner` или `/organization`. Добавить его в кабинетный префикс «чтобы
посмотреть» нельзя: страничные гарды всё равно его отобьют, и получится мёртвая
дверь. Исключение одно — `/student`: намеренный общий вход, где выпуск
bridge-токена закрыт отдельным серверным гейтом (админ видит страницу, но токена
не получает).

**Руководитель работает в двух кабинетах.** Роль `leader` — самостоятельная (с
18.08.2026), но `/manager/*` открыт и ей: «играющий тренер» ведёт свои сделки
наравне с командой.

### API routes

Явной таблицы здесь нет намеренно. Роутов в проекте сотни, а список из восьми
строк — это не матрица, а снимок, который устаревает первым же PR и врёт
умолчанием: отсутствие строки читается как «доступа нет».

Источник правды — код и страж
[`security.role-access-matrix.guardrail`](src/__tests__/security.role-access-matrix.guardrail.test.ts):
он держит явную таблицу ответов каждого предиката доступа для всех шести ролей и
**падает, когда в гардах появляется новая проверка, не описанная в таблице**.
Забыть про роль физически нельзя.

Общее правило ответов: `401` — сессии нет, `403` — роль не разрешена для ресурса.
Защита стоит в трёх местах и ни одно не сокращается (CLAUDE.md §4): middleware,
гард роута или server-action, фильтрация выборки в сервисе.

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

> Полная выкладка на стейджинг и прод — [docs/runbook-release.md](docs/runbook-release.md) (фаза B заменяет шаги 1–5 и 7 ниже: `npm ci`, `verify`, `gate`, `build`, `audit:prod`, `schema:drift`). Список ниже — быстрая локальная проверка перед PR.

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
