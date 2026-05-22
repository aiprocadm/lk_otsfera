# Phase 5 — Plan: Полировка и rollout

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (или `superpowers:subagent-driven-development` если есть subagents) для пошаговой имплементации. Шаги в формате checkbox (`- [ ]`).

**Дата начала:** 2026-05-22
**Base commit:** `6d92943` (chore(lint): drop unused imports/vars...) — после `Phase 4 DONE` merge зафиксируем фактический base.
**Branch:** `claude/partner-cabinet-phase5`
**Spec reference:** `docs/superpowers/specs/2026-05-21-partner-cabinet-design.md` §§ 6.2 (ClamAV), 7.4 (Storage RLS — продолжение), 9.1 (Phase 5), 9.2 (feature flags), 9.3 (метрики).

## Цель фазы

После Phase 4 партнёрский кабинет имеет полный функциональный цикл (портфель → сделки → лиды → финансы/комиссия). Phase 5 — **production-ready polish + safety net** перед rollout-ом на всех партнёров.

Phase 5 — **не функциональная фаза**: не добавляем новых пользовательских сценариев. Закрываем накопленные «явные tech debts» из планов 0–4: PWA-актив, async-проверка загрузок, admin-UI для финального шага в lifecycle комиссии, реальный email-pipeline, мониторинг, visual regression, feature flags для постепенного раскатывания фич.

После завершения cabinet готов к production rollout по §9.1 spec («Полировка и масштаб → Production rollout на всех»).

## Архитектура (карта изменений)

```
┌──────────────────────────────────────────────────────────────────────┐
│ PWA layer                                                            │
│   public/icon-192.png, icon-512.png, apple-touch-icon.png            │
│   public/sw.js   (Service worker, app shell + asset caching)         │
│   src/app/layout.tsx → подключить SW registration через client comp  │
│                                                                      │
│ Async document scan                                                  │
│   src/lib/jobs/queues.ts        + 'docs.scanDocument'                │
│   src/worker/processors/scan-document.ts  (clamd через clamav-client)│
│   prisma migration → Document.scanStatus, scanReason, scannedAt      │
│   src/app/api/documents/upload/route.ts → enqueue после save         │
│                                                                      │
│ Email pipeline                                                       │
│   src/lib/email/                                                     │
│     transport.ts        (Resend SDK init, dev: console transport)    │
│     templates/                                                       │
│       commission-ready.tsx   (React Email)                           │
│       lead-promoted.tsx                                              │
│   src/lib/notifications.ts → triggerNotificationEmail() реальная     │
│                                                                      │
│ Admin UI                                                             │
│   src/app/admin/commission-statements/page.tsx  (list approved)      │
│   src/app/admin/commission-statements/[id]/page.tsx  (markPaid)      │
│   src/components/admin/...                                           │
│                                                                      │
│ Monitoring                                                           │
│   src/app/api/admin/queues/route.ts   (BullMQ depth + DLQ summary)   │
│   src/lib/services/admin/syncHealth.ts   (lag per syncCursor)        │
│   src/app/admin/health/page.tsx        (compact dashboard)           │
│                                                                      │
│ Feature flags                                                        │
│   src/lib/featureFlags.ts                                            │
│   Точки чтения: middleware, navigation/cabinet.ts, route handlers    │
│                                                                      │
│ Visual regression                                                    │
│   playwright.config.ts                                               │
│   src/e2e/snapshots/*.spec.ts  (dashboard, finance, leads, deals)    │
└──────────────────────────────────────────────────────────────────────┘
```

**Принципы:**

1. **Никаких новых пользовательских сценариев** — только polish существующих.
2. **Email — опциональный**: если `RESEND_API_KEY` пуст, ничего не шлём (поведение текущей заглушки), но без console-шума в проде.
3. **ClamAV — graceful degradation**: если `CLAMAV_HOST` не задан, processor skip-ит scan и оставляет `scanStatus='clean'` (для dev/CI), пишет SyncLog warn.
4. **Feature flags — read-only на runtime**, читаем из env при загрузке модуля. Никаких UI-управляемых флагов в Phase 5 (отложено).
5. **Admin UI — минималистичный** (Tailwind + базовые формы), не повторяем красоту партнёрского UI.

## Что входит в Phase 5

### Часть 1 — PWA polish

**Цель:** «Установить как приложение» работает на iOS Safari и Android Chrome, есть offline app shell.

**Артефакты:**
- `public/icon-192.png` — 192×192, brand `#F97316`, white «ОТСФЕРА» wordmark
- `public/icon-512.png` — 512×512, то же
- `public/apple-touch-icon.png` — 180×180 (iOS требование)
- `public/sw.js` — service worker:
  - Precache app shell: `/`, `/login`, `/partner/dashboard` shell, `/manifest.webmanifest`, иконки
  - Runtime cache (NetworkFirst): `/api/partner/*` GET → 24h
  - Cache-first для static `/_next/static/*`
- `src/components/pwa-installer.tsx` — client component, регистрирует SW в browser
- `src/app/layout.tsx` — добавить `<PwaInstaller />` в body

**Принцип:** SW не блокирует первый render — регистрация в `useEffect`.

### Часть 2 — Async document scan (ClamAV)

**Цель:** Любой uploaded файл проходит async-сканирование. Заражённые — карантин (помечаем `scanStatus='infected'`, скрываем из выдачи).

**Миграция БД:**
```sql
ALTER TABLE "Document" ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Document" ADD COLUMN "scanReason" TEXT;
ALTER TABLE "Document" ADD COLUMN "scannedAt" TIMESTAMP;

ALTER TABLE "LeadAttachment" ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "LeadAttachment" ADD COLUMN "scanReason" TEXT;
ALTER TABLE "LeadAttachment" ADD COLUMN "scannedAt" TIMESTAMP;
```

**Очередь:**
- `docs.scanDocument` (новая в `QUEUE_NAMES`)
- payload: `{ kind: 'document' | 'leadAttachment', id: string }`

**Processor `src/worker/processors/scan-document.ts`:**
1. Загрузить сущность по id
2. Скачать файл из Supabase Storage (через service role)
3. Открыть TCP-соединение к `CLAMAV_HOST:CLAMAV_PORT` (env), послать INSTREAM
4. Получить ответ:
   - `stream: OK` → `scanStatus='clean'`
   - `stream: <virus-name> FOUND` → `scanStatus='infected'`, `scanReason=virus-name`
5. Update сущность
6. (Если infected) Не удаляем файл из Storage сразу — флаг достаточен; UI/list скрывает infected

**Graceful degradation:** если `CLAMAV_HOST` пуст или соединение fail — записать warn в `SyncLog`, `scanStatus='clean'` (не блокируем доступ к файлу).

**Триггеры:**
- `POST /api/documents/upload` после успешного save → enqueue
- `POST /api/partner/leads/[id]/attachments` после save → enqueue
- (Backfill для существующих) одноразовый script `scripts/scan-existing-documents.ts`

**Скрытие infected:**
- `getDocumentList`, `getAttachmentList` — фильтр `scanStatus != 'infected'` (если не admin)
- Download routes — 410 Gone для infected

### Часть 3 — Admin UI для commission lifecycle

**Цель:** Platform admin может перевести approved → paid без curl.

**Страницы:**
- `/admin/commission-statements` — список approved+paid statements **всех** партнёров; фильтр по статусу, партнёру, периоду
- `/admin/commission-statements/[id]` — карточка с items, кнопка «Отметить как оплачено» (modal с date picker и notes)
- Доступ: `requireAdmin` (platform admin, не partner-admin)

**API:** уже есть `PATCH /api/partner/finance/statements/[id]` с `action='markPaid'` — переиспользуем. UI просто бьёт по существующей ручке.

**Bonus:** в карточке показывать audit log для этого statement (calculated/approved/paid события).

### Часть 4 — Email pipeline (real)

**Выбор провайдера:** Resend (https://resend.com) — простой SDK, дешевизна, российский рынок не блокирован. Альтернатива: SMTP через Mail.ru (если требуется в России).

**Зависимости:**
- `resend ^4.0.0`
- `@react-email/components ^0.0.20` — для React-шаблонов

**Структура:**
```
src/lib/email/
  transport.ts          # initResend(), getTransport()
  send.ts               # send({ to, subject, react, text? })
  templates/
    commission-ready.tsx
    lead-promoted.tsx
    document-uploaded.tsx
```

**Изменения:**
- `triggerNotificationEmail` в `src/lib/notifications.ts:35-43` — вызывает `send()` с шаблоном по `type`
- env: `RESEND_API_KEY`, `EMAIL_FROM` (default `no-reply@otsfera.ru`), `EMAIL_ENABLED`

**Graceful degradation:** если `RESEND_API_KEY` пуст — silent no-op (без console.info шума как сейчас); `EMAIL_ENABLED=true` без ключа → warn в log.

**Шаблоны (минимум):**
1. **commission-ready** — «Ваш отчёт по комиссии за {period} готов, итог {amount} ₽. Скачать PDF: {url}»
2. **lead-promoted** — «Ваша заявка {lead.subject} превратилась в сделку {order.number}. Открыть: {url}» (партнёру)
3. **document-uploaded** — «На вашу сделку {order.number} загружен документ {filename}» (партнёру, если document.uploadedBy != self)

### Часть 5 — Feature flags

**Цель:** Раскатывать `partner_leads`, `commission_pdf`, `1c_sync` поэтапно (`/partner/leads` отключаем у партнёра, у которого пилот ещё не дошёл).

**`src/lib/featureFlags.ts`:**
```ts
export type FeatureFlag =
  | 'partner_leads'
  | 'commission_pdf'
  | 'commission_xlsx'
  | 'one_c_sync'
  | 'pwa_installer'
  | 'document_scan';

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  // env mapping: FEATURE_PARTNER_LEADS, FEATURE_COMMISSION_PDF, ...
}

export function requireFeature(flag: FeatureFlag): void {
  // throws if disabled, для route handlers
}
```

**Точки чтения:**
- `src/lib/navigation/cabinet.ts` — скрывает пункт «Заявки» если `!partner_leads`
- `src/middleware.ts` — 404 для `/partner/leads/*` если `!partner_leads`
- `src/app/api/partner/leads/route.ts` — `requireFeature('partner_leads')` в начале
- Download routes PDF/XLSX — `requireFeature('commission_pdf'/'commission_xlsx')`

**Default:** все флаги `true` в `.env.example`; в проде — настраиваются по партнёрам через env (одна копия = одна группа партнёров) или (Phase 6+) через БД-таблицу `PartnerFeatureFlag`.

### Часть 6 — Мониторинг

**`/admin/health` страница:**
- Sync lag: `now - max(syncCursor.updatedAt)` per syncCursor.entity (`organizations`, `orders`, `payments`, `documents`)
- BullMQ queue depth: `waiting`, `active`, `delayed`, `failed` для каждой очереди в `QUEUE_NAMES`
- Failed jobs (DLQ): таблица последних 50 failed jobs (queue, jobId, reason, failedAt) с кнопкой «Retry»

**API endpoints:**
- `GET /api/admin/queues` — JSON `{ queue: name, counts: {...} }[]`
- `GET /api/admin/dlq` — `{ queue, jobId, name, failedReason, failedAt }[]`
- `POST /api/admin/dlq/[queue]/[jobId]/retry` — переотправить в активную очередь

**Зависимости:** BullMQ уже имеет `Queue.getJobCounts()` и `Queue.getFailed()` — без новых deps.

### Часть 7 — Playwright visual regression

**Цель:** Защититься от случайных регрессий вёрстки на ключевых страницах. Cap-snapshot хранятся в репо, CI сравнивает.

**Установка:**
- `playwright ^1.52.0` (devDep)
- `playwright install --with-deps chromium` в CI step

**Конфиг `playwright.config.ts`:**
- baseURL: `http://localhost:3000`
- viewport: 2 проекта — `mobile` (375×667) и `desktop` (1280×800)
- screenshots: `mode: 'only-on-failure'`, snapshots для assertions

**Спеки `src/e2e/snapshots/`:**
- `dashboard.spec.ts` — login → `/partner/dashboard` → snapshot
- `finance.spec.ts` — `/partner/finance` с demo statement
- `leads.spec.ts` — `/partner/leads` empty + filled
- `deals.spec.ts` — `/partner/deals` list

**Auth:** login через UI один раз в `beforeAll`, сохраняем `storageState` в файл; остальные тесты загружают state.

**CI:** не обязательно прогонять при каждом PR (медленно); вынести в отдельный workflow `visual-tests.yml`, триггер `workflow_dispatch` + `push` на `main`.

### Часть 8 — QR-код в PDF (Phase 4 carry-over)

**Цель:** Закрыть стретч-задачу Phase 4 — QR в углу PDF со ссылкой на statement в кабинете для верификации.

**Зависимость:**
- `qrcode ^1.5.4`

**Изменения в `src/lib/services/commission/pdf.ts`:**
- `renderStatementPdf` уже принимает `verifyUrl: string | null` (без рендера). Phase 5: рендерим QR из этой ссылки в правый нижний угол первой страницы (80×80 pt).
- Тест в `services.commission.pdf.test.ts` — добавить case «PDF contains QR if verifyUrl passed».

## Что НЕ делаем в Phase 5

- **UI-управляемые feature flags** (БД-таблица + admin page) — отложено. Сейчас всё через env.
- **Push notifications через Web Push API** — отложено (Phase 6+); только email и in-app bell.
- **Bulk approve/markPaid** — пока один statement за раз.
- **Полноценный admin-cabinet** — только странички для финансов + health. Никакого универсального admin layout.
- **Telegram-бот** — не в скоупе кабинета.
- **Dark theme** — в spec §10 уже исключено.
- **PWA push** — отложено.
- **Distributed tracing / OpenTelemetry** — overkill для текущего scale.

## Сознательные упрощения Phase 5

1. **Service worker — простой**, без Workbox. Кэш-стратегии написаны вручную для понимания и контроля.
2. **ClamAV graceful degradation = clean** — в dev/CI без ClamAV всё считается чистым. Это не security hole т.к. в проде CLAMAV_HOST обязателен.
3. **Email — Resend по умолчанию**, не SMTP. Если бизнес требует self-hosted/Mail.ru — заменим в transport.ts (одна точка).
4. **Admin UI — голый минимум**. Без таблиц с сортировкой по клику, без bulk-actions. Только то, что нужно для финального шага комиссии.
5. **Feature flags только env-driven** — нет UI для toggle. Достаточно для pilot rollout (≤10 партнёров).
6. **Мониторинг — pull-based** (страница в админке). Без webhook-алертов на Slack/email (Phase 6+).
7. **Visual regression — на cron/manual run**, не на каждый PR. Snapshot diffs шумные при mass-edit, не хотим блокировать iteration speed.

## Метрики приёмки

- `npm test` — Phase 4 testbase + новые проходят. Ожидается +30-40 unit/integration тестов (email transport mock, scan processor, feature flags, admin API).
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 новых warnings.
- `npm run build` — successful. Новые роуты: `/admin/commission-statements`, `/admin/commission-statements/[id]`, `/admin/health`, `/api/admin/queues`, `/api/admin/dlq*`.
- Manual smoke: PWA install на iOS Safari + Android Chrome успешен, иконки видны.
- Manual smoke (admin): `/admin/commission-statements` показывает approved statement, кнопка «Mark paid» работает.
- Manual smoke: загрузка документа → через 2-3 секунды в БД `scanStatus='clean'` (если ClamAV не настроен — graceful).
- Email: при `RESEND_API_KEY` и `EMAIL_ENABLED=true` после approve commission — получаем письмо. Иначе silent.
- Playwright: `npm run e2e:visual` зелёный baseline.

## Зависимости (новые)

- `resend` — email transport
- `@react-email/components` — email templates
- `qrcode` — QR в PDF (carry-over)
- `clamav-client` или `node-clamav` (TBD при имплементации) — TCP к ClamAV
- `playwright` (devDep) — visual tests

Без новых runtime-зависимостей в основном бандле, кроме `qrcode` (~30KB).

## Открытые вопросы (для бизнеса, не блочат план)

- [ ] Email-провайдер: Resend OK или нужен Mail.ru SMTP для compliance? **Default**: Resend.
- [ ] ClamAV: deploy в той же сети что worker, или managed (Hetzner/AWS)? **Default**: docker-compose рядом с worker, в той же VPC.
- [ ] Feature flags: env per-партнёр или одна копия = одна группа? **Default**: одна копия, один набор флагов; для дифференциации поднимаем вторую инстанцию.
- [ ] QR в PDF: ссылка на публичный verify-endpoint (без auth, read-only) или приватный кабинет (требует логин)? **Default**: приватный — security простeer.

---

## Bite-sized tasks (для агентов-исполнителей)

### Task 1: PWA polish (иконки + SW)

**Files:**
- Add: `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Add: `public/sw.js`
- Create: `src/components/pwa-installer.tsx`
- Modify: `src/app/layout.tsx` (add `<PwaInstaller />` + `<link rel="apple-touch-icon" />`)

- [ ] **Step 1.1**: Сгенерировать иконки (192/512/180) — можно через `sharp` script `scripts/generate-pwa-icons.ts` из base SVG. SVG-логотип уже есть в `public/logo.svg` или нет — если нет, рисуем минимум: оранжевый круг `#F97316` + белая буква «О» центрировано.
- [ ] **Step 1.2**: Написать `public/sw.js` с precache + runtime cache.
- [ ] **Step 1.3**: `PwaInstaller` client component, регистрирует SW в `useEffect`.
- [ ] **Step 1.4**: Подключить в `layout.tsx`.
- [ ] **Step 1.5**: Manual smoke — Chrome DevTools Application tab показывает SW и Manifest без ошибок.
- [ ] **Step 1.6 — Commit**: `feat(pwa): icons, service worker, install prompt component`

### Task 2: Document scan migration + queue + processor

**Files:**
- Create: `prisma/migrations/{timestamp}_document_scan/migration.sql`
- Modify: `prisma/schema.prisma` (add scanStatus, scanReason, scannedAt to Document, LeadAttachment)
- Modify: `src/lib/jobs/queues.ts` (add `docs.scanDocument`)
- Modify: `src/lib/jobs/types.ts` (payload type)
- Create: `src/worker/processors/scan-document.ts`
- Modify: `src/worker/index.ts` (register processor)
- Test: `src/__tests__/worker.scan-document.test.ts`

- [ ] **Step 2.1**: Prisma миграция + schema update.
- [ ] **Step 2.2**: Queue name + payload type.
- [ ] **Step 2.3**: Processor с TCP-клиентом к ClamAV INSTREAM (или библиотекой `clamav-client`). Graceful degradation.
- [ ] **Step 2.4**: Тесты с mock-сокетом: clean / infected / unreachable.
- [ ] **Step 2.5 — Commit**: `feat(docs): async ClamAV scan queue and processor with graceful degradation`

### Task 3: Document upload integration + UI hide infected

**Files:**
- Modify: `src/app/api/documents/upload/route.ts` (enqueue scan после save)
- Modify: `src/app/api/partner/leads/[id]/attachments/route.ts` (то же)
- Modify: `src/lib/services/partner/orgDocuments.ts` (filter `scanStatus != 'infected'` для не-admin)
- Modify: `src/app/api/.../download/route.ts` (410 Gone для infected)
- Test: `src/__tests__/api.documents.upload.scan.test.ts`

- [ ] **Step 3.1**: Enqueue в upload routes.
- [ ] **Step 3.2**: Фильтр в list services.
- [ ] **Step 3.3**: 410 в download.
- [ ] **Step 3.4 — Commit**: `feat(docs): enqueue scan on upload, hide infected from non-admin`

### Task 4: Backfill scan для существующих файлов

**Files:**
- Create: `scripts/scan-existing-documents.ts`

- [ ] **Step 4.1**: Скрипт идёт по `Document` + `LeadAttachment` с `scanStatus='pending'`, шлёт в очередь.
- [ ] **Step 4.2**: Идемпотентный (повторный запуск не ломает).
- [ ] **Step 4.3 — Commit**: `chore(scripts): backfill scan job for existing documents`

### Task 5: Email transport + templates

**Files:**
- `npm install resend @react-email/components`
- Create: `src/lib/email/transport.ts`
- Create: `src/lib/email/send.ts`
- Create: `src/lib/email/templates/commission-ready.tsx`
- Create: `src/lib/email/templates/lead-promoted.tsx`
- Create: `src/lib/email/templates/document-uploaded.tsx`
- Modify: `src/lib/notifications.ts` (реальный triggerNotificationEmail)
- Test: `src/__tests__/email.send.test.ts` (mock Resend)

- [ ] **Step 5.1**: Install deps, transport singleton.
- [ ] **Step 5.2**: Три шаблона (минимум текста, не дизайнерская верстка — простой layout).
- [ ] **Step 5.3**: `send()` маршрутизирует по type.
- [ ] **Step 5.4**: `triggerNotificationEmail` зовёт `send()`.
- [ ] **Step 5.5**: Тесты с mocked Resend client.
- [ ] **Step 5.6 — Commit**: `feat(email): Resend transport with React templates for partner notifications`

### Task 6: Admin UI commission lifecycle

**Files:**
- Create: `src/app/admin/commission-statements/page.tsx`
- Create: `src/app/admin/commission-statements/[id]/page.tsx`
- Create: `src/components/admin/commission-statements-table.tsx`
- Create: `src/components/admin/mark-paid-form.tsx`
- Modify: `src/middleware.ts` (если ещё не покрывает `/admin/commission-statements`)
- Test: `src/__tests__/admin.commission-statements.test.ts`

- [ ] **Step 6.1**: List page (server), фильтры в URL.
- [ ] **Step 6.2**: Detail page, items + кнопка markPaid.
- [ ] **Step 6.3**: Mark-paid модалка с подтверждением.
- [ ] **Step 6.4**: Тесты RBAC и happy path.
- [ ] **Step 6.5 — Commit**: `feat(admin): commission statements list and mark-paid UI`

### Task 7: Feature flags

**Files:**
- Create: `src/lib/featureFlags.ts`
- Modify: `src/lib/navigation/cabinet.ts` (читать флаги)
- Modify: `src/middleware.ts` (404 если флаг off)
- Modify: route handlers `api/partner/leads/*`, `api/partner/finance/statements/[id]/pdf/route.ts` etc (`requireFeature`)
- Test: `src/__tests__/featureFlags.test.ts`

- [ ] **Step 7.1**: `featureFlags.ts` с env-mapping.
- [ ] **Step 7.2**: `requireFeature` гард + 404 в middleware.
- [ ] **Step 7.3**: Точки чтения per spec.
- [ ] **Step 7.4**: Тесты с env-injection.
- [ ] **Step 7.5 — Commit**: `feat(flags): env-driven feature flags with middleware + route gating`

### Task 8: Monitoring (admin/health)

**Files:**
- Create: `src/lib/services/admin/syncHealth.ts`
- Create: `src/lib/services/admin/queueStats.ts`
- Create: `src/app/api/admin/queues/route.ts`
- Create: `src/app/api/admin/dlq/route.ts`
- Create: `src/app/api/admin/dlq/[queue]/[jobId]/retry/route.ts`
- Create: `src/app/admin/health/page.tsx`
- Create: `src/components/admin/queue-stats-grid.tsx`
- Create: `src/components/admin/dlq-table.tsx`
- Test: `src/__tests__/admin.health.test.ts`

- [ ] **Step 8.1**: syncHealth + queueStats services.
- [ ] **Step 8.2**: 3 API routes.
- [ ] **Step 8.3**: Server-page с двумя секциями.
- [ ] **Step 8.4**: Retry button client component (POST + router.refresh).
- [ ] **Step 8.5 — Commit**: `feat(admin): health dashboard with sync lag, queue depth, DLQ retry`

### Task 9: QR в PDF (carry-over)

**Files:**
- `npm install qrcode`
- Modify: `src/lib/services/commission/pdf.ts` (рендер QR из verifyUrl)
- Test: `src/__tests__/services.commission.pdf.test.ts` (extend)

- [ ] **Step 9.1**: Install qrcode.
- [ ] **Step 9.2**: Render QR в правом нижнем углу PDF при наличии verifyUrl.
- [ ] **Step 9.3**: Тест на наличие в Buffer.
- [ ] **Step 9.4 — Commit**: `feat(commission): QR code in PDF linking to verify URL`

### Task 10: Playwright visual regression

**Files:**
- `npm install -D playwright @playwright/test`
- Create: `playwright.config.ts`
- Create: `src/e2e/auth.setup.ts`
- Create: `src/e2e/snapshots/dashboard.spec.ts`
- Create: `src/e2e/snapshots/finance.spec.ts`
- Create: `src/e2e/snapshots/leads.spec.ts`
- Create: `src/e2e/snapshots/deals.spec.ts`
- Create: `.github/workflows/visual-tests.yml`
- Modify: `package.json` (`"e2e:visual": "playwright test"`)

- [ ] **Step 10.1**: Install, config, auth setup.
- [ ] **Step 10.2**: 4 snapshot spec-а × 2 viewport.
- [ ] **Step 10.3**: Зафиксировать baselines (первый прогон).
- [ ] **Step 10.4**: GH Action manual + on main push.
- [ ] **Step 10.5 — Commit**: `test(e2e): Playwright visual regression for partner dashboard, finance, leads, deals`

### Task 11: Lint + typecheck + build + final tests

- [ ] **Step 11.1**: `npm run typecheck` → 0 errors.
- [ ] **Step 11.2**: `npm run lint` → 0 new warnings.
- [ ] **Step 11.3**: `npm run build` → successful (новые роуты в выводе).
- [ ] **Step 11.4**: `npm test` → все 319+новые проходят.
- [ ] **Step 11.5**: Manual smoke per «Метрики приёмки» выше.
- [ ] **Step 11.6 — Final commit**: `chore(phase5): final polish`.

---

**После завершения**: PR на main, заголовок `feat(phase5): PWA, ClamAV scan, email, admin UI, feature flags, monitoring`. После merge → production rollout по §9.1 spec — кабинет готов.
