# История изменений

Все значимые изменения проекта **lk-otsfera** (личный кабинет Промтехносфера) фиксируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [Unreleased]

Подготовка к проду после pre-release v0.9.0: миграция хранилища под 152-ФЗ, упаковка и
greenfield-runbook РФ-инфраструктуры, bootstrap-вход в чистую БД, сквозная консистентность
кабинетов (Track D) и стабилизация запуска. Версия сознательно остаётся `0.9.x` — единственный
жёсткий блокер `v1.0.0` (живая 1С + стабилизация на проде) не закрыт.

### Изменено

- **Хранилище файлов: Supabase Storage → S3-совместимое (152-ФЗ).** Введён порт `ObjectStorage`
  (`StorageError`, `documentBucket`) + адаптер `S3Storage` (upload / download→Buffer / remove /
  createSignedUrl с тремя disposition-ветками, RFC 5987 Content-Disposition). На порт переведены
  app/api-роуты, `lib/services` и воркер-процессоры; модуль Supabase и зависимость удалены.
  Env: `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` /
  `S3_FORCE_PATH_STYLE` (см. `.env.example`, CLAUDE.md §10).
- **Track D — сквозная консистентность кабинетов** (6 семейств экранов × роли): заголовки и
  плюрализаторы выровнены, формат-хелперы дедуплицированы (`pluralizeRu`→`lib/format`,
  `ui/Paginator`). Заказы: единый search-параметр `q`→`search`, мобильный card-list для
  менеджера/руководителя, страница деталей заказа руководителя `/leader/orders/[id]`,
  confirm-диалог перед сменой статуса. Финансы / документы / сообщения / команда / заявки —
  выравнивание заголовков и авторизации (org через `requireOrganization()`).

### Добавлено

- **Настраиваемые поля (§11 ТЗ).** Admin заводит доп-поля заказа (text/number/date/select/
  boolean) в справочнике `/admin/custom-fields`; значения редактируются в карточке заказа
  (менеджер/админ/руководитель), org/partner видят read-only. Модели `CustomFieldDefinition`
  (конфиг) + `CustomFieldValue` (значение, полиморфно по entityType, v1=order); деактивация
  вместо удаления; значения scoped по доступу к заказу (C8). Без feature-flag.
- **Прод-упаковка и greenfield-runbook РФ.** `Dockerfile` (+`npm ci --ignore-scripts` против
  husky-prepare), `.dockerignore`, prod-compose, `.env.production.example`; `tsx`+`prisma`
  переведены в `dependencies`. Runbook РФ-инфраструктуры (provision → TLS → bring-up → hand-off)
  с design-spec и планом (SP1–SP3).
- **Bootstrap-вход в чистую БД.** CLI `db:create-admin` (env-driven, idempotent, runner-guard) —
  закрывает «замкнутый цикл» первого входа в не-демо БД; «демо» = demo-seed + `SHOW_DEMO_LOGINS`.
- **Self-healing нативный dev-stack** (`scripts/dev-stack.ps1`): портативные PG+Redis без
  Docker/WSL (идемпотентный запуск по свободному порту).

### Исправлено

- **Стабилизация запуска** (PR #147): утечка Prisma `Decimal` в RSC-границу (partner finance →
  DTO с `.toFixed(2)`), issuer student-bridge JWT, hydration-ошибка вложенного `<button>`
  в списке комиссионных ведомостей (toggle → `role="button"`).

## [0.9.0] — 2026-06-18

Первый оформленный релиз — **боевой запуск (pre-release)** всех шести кабинетов сразу.
Версия `0.9.x` сознательно держится до закрытия единственного внешнего блокера — живой
интеграции с 1С (см. раздел «Известные ограничения»). После перевода 1С в `live` и стабилизации
на проде планируется `v1.0.0`.

### Кабинеты (роли)

- **Партнёр** — заказы (видимы только через собственные лиды партнёра), лиды, документы
  (исходящие), финансы и комиссионные ведомости (PDF/XLSX), уведомления, заявки на обучение.
- **Организация** — заказы, документооборот с менеджером, финансовый хаб (KPI + реестр платежей),
  команда, под-роль `leader` (видит комиссию и управляет командой).
- **Менеджер** — заказы и их видимость с учётом режима команды (C8), общая очередь лидов,
  документооборот с организациями и партнёрами, финансы, комментарии к заказам, командный чат.
- **Руководитель (`/leader`)** — company-wide представление через `teamModeOverride`, хаб команды,
  комиссия.
- **Администратор** — зеркало `/admin/*` для управления всем (Model A), синхронизация 1С,
  пользователи, аудит, финансы.
- **Слушатель** — bridge-вход наружу (`/student`) с жёстким серверным гейтом на выпуск токена.

### Интеграция с 1С

- Подключаемый `OneCAdapter` с тремя реализациями: `Fake` (по умолчанию), `File` (Excel),
  `REST` (живая 1С).
- Контракт обмена решается на нашей стороне: пагинация по `{items, nextCursor}`, перевод
  справочников статусов в кабинете (`translate.ts`), `Partner.slug` как ключ партнёра.
- Excel-импорт платежей/заказов/организаций/документов: единый контракт и writer'ы
  (`upsert{Order,Payment,Org,Document}Record`), org-by-ИНН (attach-only), dedup по номеру документа.
- Режимы `shadow` → `live`; fetch-and-store документов 1С в Supabase Storage.
- Идентичность организации по dual-key `externalId ∨ ИНН`.

### Документооборот

- Двунаправленный, channel-isolated обмен документами (менеджер↔организация / менеджер↔партнёр)
  через first-class `counterparty` у `Document`.
- Общие («order-less») документы на уровне компании (`orderId` nullable + `companyId` XOR anchor).
- Скачивание только через signed URL (TTL 600 сек, 302-redirect); ClamAV-скан
  (`pending → clean | infected`, заражённые отдают 410 Gone); MIME allow-list + лимит 20 МБ.

### Финансы и комиссии

- Финансовый хаб организации (KPI + реестр платежей всех участников; блок посреднической
  комиссии — только admin/leader, с field-level гейтом).
- Финансы менеджера/админа (платежи по организациям + комиссия с гейтом по роли).
- Генерация комиссионных ведомостей в PDF и XLSX (BullMQ-воркер), ежемесячный расчёт по cron.
- Partial-unique индекс на активные ведомости (`WHERE supersededBy IS NULL`) против дублей;
  pre-deploy gate `npm run dedupe:commission`.
- Уведомление партнёра о готовности ведомости (in-app + email).

### Лиды и заявки на обучение

- Жизненный цикл лида: `assign / setStatus / promote / reject` (общая очередь команды);
  promote создаёт локальный заказ; видимость заказов партнёром только через
  `promotedFromLead.partnerId` (F2 — поведенческий флип).
- Заявки на обучение (`EnrollmentRequest`): подача 5 ролями → утверждение общей очередью →
  ручной провижн в LMS с отметкой `provisioned` + `externalStudentId`.

### Коммуникации и наблюдаемость

- Уведомления: in-app + email + Telegram; fan-out менеджерам/пользователям организации.
- Алертинг (cron-воркер): пороги по очередям/DLQ/лагу синхронизации с дедупликацией (edge + cooldown).
- Чат команды (флаг `chat`) + комментарии к заказам (ungated, до-`chat` фича).
- Health-пробы: `/api/health/live` (публичная liveness) и `/api/health` (token-gated readiness,
  проверка БД + Redis, fail-closed).

### Платформа и UI

- Система feature-флагов с тремя точками чтения (middleware → 404, навигация, route-handler).
- UI-примитивы (`ui/`: Button/Input/Select/Textarea/Badge/Spinner/Field), доступные модалки
  поверх нативного `<dialog>` (focus-trap, Escape, aria-live), оранжевая палитра бренда,
  словарь ошибок `errorMessageRu`, toast-обёртка.
- PWA-installer.
- Хуки форм `useFormAction` / `useFetchSubmit`, клиентский `useClientResource`.

### Безопасность

- RBAC defense-in-depth в трёх местах (middleware → route/server-action → service scope).
- C8: company-scoped изоляция (cross-company граница в обоих режимах видимости команды).
- Student bridge JWT с контрактными claims + rate-limit (Redis + in-memory degrade).
- Аудит-лог как единственный канал расследования; signed URL для файлов; ClamAV-скан.
- `JWT_SECRET` минимум 32 символа (иначе редирект на `/login`).

### Тесты и качество

- Четырёхслойная дисциплина тестов (L1 pre-commit → L2 pre-push unit → L2.5 gate на
  Docker-Postgres → L3 integration на живом Postgres). GitHub Actions намеренно отключены —
  гейтинг в Husky-хуках.
- Coverage-гейт фазы 1: per-glob 100% (lines/branches/functions/statements) на логических
  слоях (`src/lib/**/!(*.tsx)`, `src/server-actions/**`, `src/app/api/**`, `src/worker/**`,
  `src/middleware.ts`) — валидирован на живом Postgres.
- Playwright visual regression (три проекта по ролям).

### Документация

- Runbook прод-деплоя ([docs/runbook-launch-deploy.md](docs/runbook-launch-deploy.md)) и
  staged-rollout кабинетов ([docs/runbook-staged-rollout-cabinets.md](docs/runbook-staged-rollout-cabinets.md)).
- QA staging-smoke чек-листы (менеджер / организация).
- Контракт и повестка интеграции 1С, RLS Supabase Storage.
- Коммуникация партнёрам по флипу видимости F2
  ([docs/launch-comms-f2-partners.md](docs/launch-comms-f2-partners.md)).

### Известные ограничения

- **Живая 1С (T2 / A1)** — единственный жёсткий внешний блокер: REST-адаптер готов в коде, но
  требует доступов 1С и shadow-rehearsal перед `ONE_C_MODE=live`.
- Прод-деплой — операторские шаги по [docs/runbook-launch-deploy.md](docs/runbook-launch-deploy.md).
  **Footgun:** `npm run dedupe:commission --apply` обязателен **до** `prisma migrate deploy`
  (иначе partial-unique индекс не построится); `ONE_C_MODE` дефолтит в `live` — репетиция
  требует явный `ONE_C_MODE=shadow`.
- 100%-покрытие UI-слоёв (`components/**`, `app/**/*.tsx`) — фазы 2–3, ещё не под порогом.

[Unreleased]: https://github.com/aiprocadm/lk_otsfera/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/aiprocadm/lk_otsfera/releases/tag/v0.9.0
