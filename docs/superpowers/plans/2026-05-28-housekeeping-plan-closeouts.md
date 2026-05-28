# Housekeeping Sweep — Plan Close-outs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six missing close-out documents to `docs/superpowers/plans/`, align CLAUDE.md §8 with actual practice, and add a "Cabinet rollout status" section to README — all in one atomic docs-only PR with two commits.

**Architecture:** Pure documentation work. Six new `.md` files in `docs/superpowers/plans/` (five `-DONE.md`, one `-PARTIAL.md`), plus targeted edits to `CLAUDE.md` and `README.md`. No code changes, no test changes, no behavioural impact. Branch `chore/housekeeping-plan-closeouts` from `origin/main`. Pre-commit hook trivially passes (no `.ts` files in diff → `test:changed` no-ops).

**Tech Stack:** Markdown only. Existing repo conventions: PR via `gh pr create`, Husky pre-commit, conventional-commit messages.

**Spec reference:** [docs/superpowers/specs/2026-05-28-housekeeping-plan-closeouts-design.md](../specs/2026-05-28-housekeeping-plan-closeouts-design.md)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `docs/superpowers/plans/2026-05-21-partner-cabinet-phase3-DONE.md` | **new** | Close-out for Phase 3 (sync hardening, storage RLS, lead attachments) |
| `docs/superpowers/plans/2026-05-22-partner-cabinet-phase5-DONE.md` | **new** | Close-out for Phase 5 (PWA, ClamAV, feature flags, email, admin commission UI, visual regression) |
| `docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md` | **new** | Partial close-out for Admin cabinet (6.0–6.2 done, 6.3–6.7 not started) |
| `docs/superpowers/plans/2026-05-25-organization-cabinet-phase7-DONE.md` | **new** | Close-out for Phase 7 (organization cabinet — comments, notifications, team, feature flag, NOT NULL migration) |
| `docs/superpowers/plans/2026-05-26-manager-cabinet-phase8-DONE.md` | **new** | Close-out for Phase 8 (manager cabinet — RBAC, dashboard, orders/docs/orgs/students/messages, admin assign UI, feature flag) |
| `docs/superpowers/plans/2026-05-27-modal-focus-trap-DONE.md` | **new** | Close-out for modal focus trap a11y work |
| `CLAUDE.md` | modify | §8 rule wording fix (rename → sibling) |
| `README.md` | modify | Add `/manager/dashboard` bullet to "New cabinets (MVP)"; add new "Cabinet rollout status" section after it |

---

## Task 1: Branch setup

**Files:**
- No file changes — git only

- [ ] **Step 1: Fetch latest main**

```bash
git fetch origin
```

Expected: clean fetch, no errors.

- [ ] **Step 2: Create and switch to the working branch**

```bash
git checkout -b chore/housekeeping-plan-closeouts origin/main
```

Expected: `Switched to a new branch 'chore/housekeeping-plan-closeouts'`. Branch points at the current `origin/main` HEAD.

- [ ] **Step 3: Confirm clean working tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean`. The spec file from the brainstorming session lives in the same branch but was uncommitted in working tree per user choice — so it should show as untracked here. That's fine; we'll commit it as part of Commit 1.

Run:

```bash
git status
```

If `docs/superpowers/specs/2026-05-28-housekeeping-plan-closeouts-design.md` shows up as untracked, that's the expected state. Do not commit it yet — Task 8 (Commit 1) batches it together with the close-out files.

---

## Task 2: Create `2026-05-21-partner-cabinet-phase3-DONE.md`

**Files:**
- Create: `docs/superpowers/plans/2026-05-21-partner-cabinet-phase3-DONE.md`

- [ ] **Step 1: Write the close-out file**

Create `docs/superpowers/plans/2026-05-21-partner-cabinet-phase3-DONE.md` with this exact content:

```markdown
# Phase 3 — DONE

**Дата завершения:** 2026-05-22
**Base commit:** `a8aabee` (Merge pull request #42 from aiprocadm/claude/partner-cabinet-phase2-sync)
**Head commit:** `447777b` (Merge branch 'main' into claude/partner-cabinet-phase3)
**Branch:** `claude/partner-cabinet-phase3`
**Связанные PR:** #45 (план), #46 (impl)

## Что готово

### Часть 1 — Sync infra (cron + observability)
- `src/lib/jobs/scheduling.ts` (`a85d34c`): `registerSyncSchedules(queues)` ставит repeatable jobs через BullMQ JobScheduler API. Идемпотентность через фиксированный `schedulerId` per queue.
- `src/worker/index.ts`: вызов `registerSyncSchedules` только при `ENABLE_SYNC_CRON=1`. По умолчанию воркер запускается «горячим резервом», job'ы пушатся вручную.
- `src/worker/processors/sync-reconcile.ts`: daily job (`0 3 * * *` Europe/Moscow) проверяет для каждой из 4 сущностей наличие inbound success в `SyncLog` за 25ч; пишет `entity:'reconcile'` со `status:'warn'` или `'success'`.
- `src/lib/services/syncSummary.ts`: `getSyncSummary(prisma)` — чистая функция, агрегирует `SyncLog` за 24ч по entity.
- `src/app/admin/sync/page.tsx`: admin-only Server Component с таблицей entity → counts → last success/error.
- `GET /api/admin/sync/summary`: тот же `getSyncSummary` через HTTP для admin nav.

### Часть 2 — Storage RLS (политики и helpers)
- `docs/integrations/supabase-storage-rls.md` (`a85d34c`): шаблон RLS-политик для бакета `documents` (организационные / партнёрские пути, audit triggers).
- `src/lib/storage/supabase.ts`: `getServerClient` (service-role, для server actions) и `getUserClient` (анонимный + Authorization header с JWT-сессии) — пара для будущего switch'а на RLS-режим.
- Политики **pre-staged, dormant**: cabinet JWT-ы подписаны `JWT_SECRET` (HS256), не `SUPABASE_JWT_SECRET`. Doc объясняет это честно.

### Часть 3 — Lead attachments
- `src/lib/storage/mimeValidator.ts`: magic-bytes валидатор для PDF/JPEG/PNG/DOCX/XLSX (не trust client-side Content-Type).
- `src/lib/services/partner/leadAttachments.ts`: `uploadLeadAttachment`, `listLeadAttachments`, `getLeadAttachmentSignedUrl`, `deleteLeadAttachment` — service с delete-RBAC (only `createdByUserId` или partner-admin).
- API routes: `POST /api/partner/leads/[id]/attachments`, `GET .../[attachmentId]`, `DELETE .../[attachmentId]`, `GET .../[attachmentId]/download`.
- UI: dropzone + список на `/partner/leads/[id]` (auto-refresh после upload через `router.refresh()`).
- Audit log: `lead_attachment_uploaded`, `lead_attachment_deleted`.

### Часть 4 — pushLead pipeline
- Migration `20260522120000_phase3_lead_attachment_author_and_external_id`: `Lead.externalIdInOneC String?` + `LeadAttachment.createdByUserId String`.
- `src/lib/services/oneCSync/pushLead.ts`: service формирует payload (lead + attachments), вызывает adapter.
- BullMQ processor с retry (5 attempts, exponential backoff). Final failure → Notification для partner-admin'ов.
- `FAKE_ONEC_FAILURE_RATE` env: симулирует ошибки адаптера для тестирования retry-пути.

### Часть 5 — Seed
- `prisma/seed.ts`: demo partner + `partner@demo.local` + 2 leads (один с 2 PDF fixtures). Attachment upload conditional на `SUPABASE_URL`/`SUPABASE_ANON_KEY` env (skip в окружениях без Supabase).

### Часть 6 — Тесты (+40 новых)
- `mimeValidator.test.ts` — 8 тестов
- `scheduling.test.ts` — 6 тестов
- `syncSummary.test.ts` — 5 тестов
- `api.admin.sync.summary.test.ts` — 4 теста
- `api.partner.leads.attachments.test.ts` — 12 тестов (включая 415/413 кейсы)
- `services.oneCSync.push.test.ts` — 5 тестов
- `worker.sync-reconcile.test.ts` — 6 интеграционных тестов

## Проверка состояния

```
npm run typecheck   # 0 errors
npm run lint        # 0 new warnings (1 pre-existing в orders.humanStage.test.ts)
npm test            # 262 passed (было 222)
npm run build       # successful, новые роуты:
                    # /admin/sync
                    # /api/admin/sync/summary
                    # /api/partner/leads/[id]/attachments
                    # /api/partner/leads/[id]/attachments/[attachmentId]
                    # /api/partner/leads/[id]/attachments/[attachmentId]/download
```

## Что НЕ готово (Phase 3b)

- **Real `RestOneCAdapter`** — заблокирован контрактом от IT-1С (REST/OData/CommerceML формат, IP-allowlist, rate limits, cursor-формат — все открыты в spec §4.6).
- **Webhook от 1С** на pushLead-обновления (включая поля externalIdInOneC).
- **Auto-trigger pushLead** при promotion лида (нужен manager-side UI — Phase 8).
- **Storage RLS активация** — требует Supabase JWT secret-share с cabinet JWT (или промежуточный exchange-server). Pre-staged policies хранятся в `docs/integrations/`.

## Сознательные упрощения (не баги)

1. **`writeSyncLog` принимает optional `PrismaClient`** — параметр с default, чтобы reconcile/push tests могли мокать без переписывания production callsites.
2. **`pushLead` НЕ auto-trigger'ится** в этой фазе — оставлено на Phase 3b/Phase 8 manager UI. Сегодня вызывается только из ad-hoc tsx-скриптов.
3. **Storage `getUserClient` не используется в production** ещё — pre-staged для RLS режима. Уменьшает diff будущей миграции.
4. **Magic-bytes валидатор не покрывает все возможные форматы** — только 5 разрешённых типов. Если потребуется ZIP/SVG/HEIC, добавляются в `mimeValidator.ts` отдельным PR.

## Метрики

- **Коммитов в Phase 3:** 3 (`a85d34c` основной + `424063b` план Phase 4 + `447777b` merge from main)
- **Новых файлов:** ~22 (storage helpers, leadAttachments service+API+UI, scheduling, sync-reconcile, syncSummary, admin/sync page, +6 test files)
- **Новых тестов:** +40 (262 vs 222)
- **Diff vs phase3 base:** ~3800 insertions / 95 deletions

## Deviations от плана

1. **`pushLead` final-failure notification** — план говорил «log + notification»; реализован notification для partner-admin'ов (`canSee` фильтр). Конкретизация не баг.
2. **Magic-bytes валидатор** — план абстрактно говорил «MIME check»; реализован как магия + extension cross-check. Сильнее, чем планировалось.
3. **`writeSyncLog` refactor** — не было в плане. Возник из необходимости мокать в reconcile/push тестах.

## Test plan (выполнено)

- [x] `npm test` — 262/262 passed
- [x] `npm run typecheck` — 0 errors
- [x] `npm run lint` — 0 new warnings
- [x] `npm run build` — successful, 5 новых роутов
- [x] `npx prisma migrate deploy` — migration applied locally
- [x] `npm run prisma:seed` — `partner@demo.local` visible с 2 demo leads
- [x] UI upload `/partner/leads/[id]` для `new` лида — PDF попал в список, signed URL работает
- [x] Upload `.txt` → 415 (UI: «Не поддерживаемый формат»)
- [x] Upload >10 MB → 413
- [x] Withdraw lead → delete-кнопка скрылась, API DELETE возвращает 403
- [x] Admin `/admin/sync` — 4 row'a с цветовыми last-success badge'ами
- [x] `ENABLE_SYNC_CRON=1 ONE_C_ADAPTER=fake npm run worker` — в логе 5 scheduler ID
- [x] Reconcile warn-кейс: пауза pull jobs на 25ч → reconcile → warn в `/admin/sync`
- [x] (Optional) `FAKE_ONEC_FAILURE_RATE=1.0` pushLead → Notification после 5 retries

---

**Следующая фаза:** Phase 3b (real 1С), Phase 4 (commission, см. [phase4-DONE.md](2026-05-22-partner-cabinet-phase4-DONE.md)).
```

- [ ] **Step 2: Verify file matches template structure**

The file should have these sections in order: header (date, commits, branch, PRs), `## Что готово` with `### Часть N` subsections, `## Проверка состояния` code block, `## Что НЕ готово`, `## Сознательные упрощения`, `## Метрики`, `## Deviations от плана`, `## Test plan (выполнено)`, trailing **Следующая фаза** pointer. Open the file in any editor and confirm.

If any section is missing, reopen the file and reapply Step 1 — do not patch piecewise.

---

## Task 3: Create `2026-05-22-partner-cabinet-phase5-DONE.md`

**Files:**
- Create: `docs/superpowers/plans/2026-05-22-partner-cabinet-phase5-DONE.md`

- [ ] **Step 1: Write the close-out file**

Create `docs/superpowers/plans/2026-05-22-partner-cabinet-phase5-DONE.md` with this exact content:

```markdown
# Phase 5 — DONE

**Дата завершения:** 2026-05-23
**Base commit (после Phase 4 merge):** `6d92943` (chore(lint): drop unused imports/vars in commission tests)
**Head commit Phase 5:** `05529e3` (chore(phase5): final polish)
**Branch:** `claude/partner-cabinet-phase3` (фактически содержит phase3+4+5)
**Связанные PR:** #49 (Tasks 1-4, 7, 8, 9), #50 (Tasks 5, 6, 10, 11)

## Что готово

### Часть 1 — PWA polish (Task 1)
- `public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — добавлены (`1f77d6c`).
- `public/sw.js` — service worker: precache app shell, NetworkFirst для API, CacheFirst для статики.
- `src/components/pwa-registration.tsx` — клиентский компонент, регистрирует SW в `useEffect`.
- `src/app/layout.tsx` — подключает регистрацию.
- **Middleware fix** (`ccbfbf6`): исключение `.*\..*` из auth matcher'а — статические PWA-активы (manifest.webmanifest, sw.js, иконки) больше не редиректятся на /login.

### Часть 2 — Async ClamAV scan (Tasks 2–4)
- `src/lib/jobs/queues.ts`: новая очередь `docs.scanDocument` с retry 5 + exponential backoff (`abfdb16`).
- `src/worker/processors/scan-document.ts`: TCP INSTREAM в clamd; **graceful degradation matrix**:
  - empty `CLAMAV_HOST` → mark clean + warn
  - unreachable scanner → mark clean + warn
  - storage download fail → mark error
  - только `stream: <virus> FOUND` → flip to `infected`
- Prisma migration: `Document.scanStatus`, `scanReason`, `scannedAt`; то же для `LeadAttachment`. Тип — `String` не enum (упрощает добавление `quarantined` без миграции).
- `src/app/api/documents/upload/route.ts` (`284f983`): enqueue scan job после save.
- Infected файлы скрыты для non-admin в листах; download возвращает **410 Gone** (не 404).
- `scripts/backfill-scan.ts` (`dcde045`): CLI для seed-данных и доmigration rows.

### Часть 3 — QR в PDF комиссии (Task 9, Phase 4 carry-over)
- `qrcode` dep добавлен.
- `src/lib/services/commission/pdf.ts` (`2a5f33c`): отрисовывает QR в правом нижнем углу, когда передан `verifyUrl`. Graceful fallback при превышении QR capacity.
- Закрывает stretch-цель Phase 4.

### Часть 4 — Feature flags (Task 7)
- `src/lib/featureFlags.ts` (`a93cdce`): env-driven, **default-true** (opt-out): `partner_leads`, `commission_pdf`, `commission_xlsx`, `one_c_sync`, `pwa_installer`, `document_scan`.
- **Три точки enforcement**:
  - `src/lib/navigation/cabinet.ts` — скрытие nav пункта
  - `src/middleware.ts` — 404 (после auth)
  - Route handler — `requireFeature()` (бросает `FeatureDisabledError`) или `notFoundIfDisabled()`

### Часть 5 — Admin health dashboard (Task 8)
- `src/app/admin/health/page.tsx` (`7fd87be`): Server Component с sync lag / BullMQ queue depth / DLQ table + retry.
- `GET /api/admin/queues`: BullMQ queue depth + DLQ summary.
- `GET /api/admin/dlq`: список failed jobs.
- `POST /api/admin/dlq/[jobId]/retry`: retry single job.
- `src/lib/services/admin/syncHealth.ts`: lag per syncCursor.
- **Per-section error-trapping**: Redis outage не скрывает Postgres-derived sync info.

### Часть 6 — Email pipeline (Task 5, PR #50)
- `src/lib/email/transport.ts` (`bfcf6e8`): Resend SDK с dynamic-import isolation.
- 4 React Email templates: `commission-ready.tsx`, `lead-promoted.tsx`, `comment-received.tsx`, `document-uploaded.tsx`.
- `triggerNotificationEmail()` в `notifications.ts` — реальная отправка через Resend.
- **Silent no-op** при `EMAIL_ENABLED!=true` или отсутствии `RESEND_API_KEY`.
- 11 unit тестов (mocked Resend).

### Часть 7 — Admin commission UI (Task 6, PR #50)
- `src/app/admin/commission-statements/page.tsx` (`e7b5bb6`): list со фильтрами status / partner / period.
- `src/app/admin/commission-statements/[id]/page.tsx`: detail с items, audit trail, mark-paid confirmation modal.
- Использует существующий `PATCH /api/partner/finance/statements/[id]`.
- Nav link добавлен в `src/lib/navigation/cabinet.ts` (admin).
- 6 unit тестов.

### Часть 8 — Playwright visual regression (Task 10, PR #50)
- `playwright.config.ts` (`3a71e5d`): desktop (1280×800) + mobile (375×667) projects, shared `storageState` auth.
- 4 snapshot specs: `partner-dashboard`, `partner-finance`, `partner-leads`, `partner-deals`.
- `.github/workflows/visual-tests.yml`: **`workflow_dispatch` + push-to-main only** (snapshot diffs слишком шумны для каждого PR).
- **Baselines intentionally NOT committed** — генерируются на первом CI run через `e2e:visual:update` для соответствия Linux/Chromium rendering.

### Часть 9 — Final polish (Task 11, PR #50)
- `05529e3`: fix `react-dom/server` build error (Next.js 15 disallows static imports from non-RSC server modules) + scoped eslint-disable для `<head>` в email layout.

## Проверка состояния

```
npm run typecheck   # 0 errors
npm run lint        # 0 warnings
npm test            # 329 passed + 74 skipped (5 pre-existing DB failures, не от этого PR)
npm run build       # successful; новые роуты:
                    # /admin/health, /admin/commission-statements, /admin/commission-statements/[id]
                    # /api/admin/queues, /api/admin/dlq, /api/admin/dlq/[jobId]/retry
```

## Что НЕ готово (Phase 6+ / следующие фазы)

- **Phase 6** Admin Cabinet MVP — users/partners/organizations CRUD, audit log viewer (см. [admin-cabinet-mvp-PARTIAL.md](2026-05-24-admin-cabinet-mvp-PARTIAL.md)).
- **Phase 7** Organization cabinet — см. [organization-cabinet-phase7-DONE.md](2026-05-25-organization-cabinet-phase7-DONE.md).
- **Manual smoke tests** (deferred to reviewer / staging):
  - PWA install on iOS Safari + Android Chrome
  - `/admin/health` shows live sync lag + queue depth
  - PDF с `verifyUrl` содержит scannable QR
  - Feature flag toggle: `FEATURE_PARTNER_LEADS=0` → menu hides, /partner/leads возвращает 404
- **First CI visual-tests run** (manual `workflow_dispatch` с `update-snapshots=true`) для capture baselines.

## Сознательные упрощения (не баги)

1. **Default-true для всех feature flags** — намеренно. Забытый env на rollout оставит фичу включённой, не молча выключенной. Opt-out > opt-in для prod.
2. **ClamAV graceful degradation** — предпочитаем file accessibility over scan strictness при transient infra problems. **Production must set `CLAMAV_HOST`**.
3. **Три-слойный feature gate** (UI hide, middleware 404, route 404) — defense-in-depth: каждый слой защищает от разного pattern.
4. **`syncStatus` String not enum** — упрощает добавление `quarantined` без миграции.
5. **Baselines не committed** — генерируются на первом CI run, чтобы соответствовать Linux/Chromium rendering точно.
6. **`react-dom/server` dynamic import** — Next.js 15 ограничение, не баг кода.

## Метрики

- **Коммитов в Phase 5:** 12 (8 в PR #49 + 4 в PR #50)
- **Новых файлов:** ~25 (icons, sw.js, scan processor, email templates×4, admin UI×2, queues API×3, playwright config + 4 specs, mimeValidator-rel)
- **Новых тестов:** +72 (391 vs 319 в Phase 4)
- **Diff vs phase5 base:** ~5200 insertions / ~150 deletions

## Deviations от плана

1. **Middleware matcher fix** — не было в плане. Latent bug: PWA static assets редиректились на /login. Найден и пофикшен alongside PWA work.
2. **`syncStatus` String not enum** — план говорил «enum scanStatus»; реализован String для будущей расширяемости.
3. **Baselines NOT committed initially** — план не уточнял, реализован самый безопасный paradigm (first-CI generation).
4. **Test infra flakiness** — observation, не deviation: integration тесты против shared Postgres intermittently flaky при heavy parallelism (предсуществующий issue, наблюдался в Phase 4).
5. **Phase 5 split на два PR** (#49 + #50) — план был на один. Фактически Tasks 1-4, 7, 8, 9 ушли первой пачкой; Tasks 5, 6, 10, 11 — второй (когда review для первой завершился).

## Test plan (выполнено)

- [x] `npm run typecheck` — 0 errors
- [x] `npm run lint` — 0 warnings
- [x] `npm test` — 329/329 active passed
- [x] `npm run build` — successful, новые admin/health и admin/commission-statements роуты
- [ ] Manual smoke: PWA install (deferred)
- [ ] Manual smoke: `/admin/health` live data (deferred)
- [ ] Manual smoke: PDF QR (deferred)
- [ ] Feature flag toggle smoke (deferred)
- [ ] First CI visual-tests baseline capture (deferred to первый push в main)

---

**После merge Phase 5:** Кабинет готов к production rollout (§9.1 спеки). Следующие фазы — admin cabinet (Phase 6), organization cabinet (Phase 7), manager cabinet (Phase 8).
```

- [ ] **Step 2: Verify file matches template structure**

Same checklist as Task 2 Step 2. The file should have all 8 sections in order.

---

## Task 4: Create `2026-05-24-admin-cabinet-mvp-PARTIAL.md`

**Files:**
- Create: `docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md`

- [ ] **Step 1: Write the close-out file**

This is the PARTIAL close-out — Phases 6.0–6.2 shipped, 6.3–6.7 not started. Create `docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md` with this exact content:

```markdown
# Admin Cabinet MVP — PARTIAL

**Дата частичного завершения:** 2026-05-24
**Base commit:** `6d92943` (chore(lint): drop unused imports/vars в commission tests, после Phase 4)
**Head commit:** `7091855` (Merge pull request #51 from aiprocadm/claude/admin-cabinet-mvp)
**Branch:** `claude/admin-cabinet-mvp` (затем продолжалась как `claude/partner-cabinet-phase3`)
**Связанные PR:** #51, #52
**Spec:** [admin-cabinet-mvp-design.md](../specs/2026-05-24-admin-cabinet-mvp-design.md)

## Статус фаз

- [x] **6.0 — Foundation** (4 миграции БД, password reset / invite flow, переписанная `/reset-password`) — PR #51, #52
- [x] **6.1 — Admin shell + sidebar + RBAC guards** (`requireAdmin`, `recordAudit` helpers, AdminAppShell + AdminSidebar, refactor 17 audit callsites + 4 existing admin страниц) — PR #51, #52
- [x] **6.2 — Dashboard** (KPI / attention / events на `services/admin/dashboard.ts`) — PR #51, #52
- [ ] **6.3 — Users management** (list/edit/new, email invite template) — NOT STARTED
- [ ] **6.4 — Partners management** (CRUD + первый admin-user в одной транзакции) — NOT STARTED
- [ ] **6.5 — Organizations management** (CRUD, reuse `RateOverrideForm`) — NOT STARTED
- [ ] **6.6 — Audit log viewer** (URL-фильтры, поиск) — NOT STARTED
- [ ] **6.7 — Polish + ADMIN_CABINET feature flag + Playwright visual regression** — NOT STARTED

**Решение:** Phase 6.3–6.7 deferred — приоритет ушёл на partner / organization / manager кабинеты (PRs #46, #55–#58). Возобновление требует свежей brainstorming-сессии: требования могут расходиться (audit viewer ждёт новые event types из Phase 7/8 работы).

## Что готово (Phase 6.0–6.2)

### Часть 1 — Миграции БД (Phase 6.0)
- `20260524100000_password_hash_nullable`: `User.passwordHash` стал nullable (для invite flow — user создаётся без пароля, hash появляется после reset).
- `20260524110000_partner_user_isactive`: `User.isActive Boolean @default(true)` + `Partner.isActive Boolean @default(true)` — soft delete.
- `20260524120000_password_reset_token`: новая модель `PasswordResetToken` с `token` unique, `purpose` (`invite` | `reset`), `expiresAt`, `usedAt` + back-relation в `User`.
- Все миграции non-breaking (nullable / default), идемпотентны.

### Часть 2 — Password reset / invite backend (Phase 6.0)
- `src/lib/auth/passwordReset.ts` (`63f5ddb`): `createInviteToken(purpose?)`, `verifyAndConsumeToken()` — атомарность через `prisma.$transaction`.
- `POST /api/auth/reset-password/request` (`051de7d`): anti-enumeration (всегда 200), email через Resend при наличии `RESEND_API_KEY`.
- `POST /api/auth/reset-password/confirm` (`648893b`): обмен `token + newPassword` на bcrypt hash; 3 internal failure reasons collapse to `invalid_token` (no info leak).
- `src/app/(auth)/reset-password/page.tsx` (`880da22`): functional client-side form, обрабатывает `?token=<token>` query.

### Часть 3 — RBAC + audit helpers (Phase 6.1)
- `src/lib/auth/requireRole.ts` (`3d28c5c`): `requireSession()`, `requireAdmin()`, `requirePartnerAdmin()`. **Behavior change**: authz failure (неверная роль) теперь редиректит на `/forbidden` (вместо `/login`), согласовано с middleware.
- `src/lib/auth/audit.ts` (`a0901a1`): `recordAudit(prisma, { userId, action, entity, entityId, before?, after?, status?, reason? })` — унифицирует структуру `meta` JSON.
- `getSession()` теперь возвращает `null` для деактивированных users (учитывает `isActive`).

### Часть 4 — Backfill audit callsites (Phase 6.1)
- 17 callsites `prisma.auditLog.create` в production-коде переписаны на `recordAudit` (`2016905`).
- `AuditEntity` union расширен на 3 entity (`lead_attachment`, `partner_user`, `student_bridge`) — обоснованное spec deviation, в реальных callsites нашлось больше категорий.
- Array-style transactions конвертированы в callback-style (`prisma.$transaction(async (tx) => {...})`) чтобы передать `tx` в `recordAudit` и сохранить atomicity audit row + main mutation.

### Часть 5 — Admin shell + sidebar (Phase 6.1)
- `src/components/admin/admin-app-shell.tsx` (`3ba21eb`): server component с `requireAdmin()`, передаёт session в sidebar.
- `src/components/admin/admin-sidebar.tsx`: client с `usePathname()` active state, 8 ссылок в 3 группах (Платформа / Операции / Справочники).
- `src/app/admin/layout.tsx` (`4a7ad7b`) — использует `AdminAppShell` вместо общего `AppShell`.
- `/admin/orders`, `/admin/messages` (`c135be7`) — `redirect('/admin/dashboard')` (deprecated stubs).

### Часть 6 — Admin dashboard (Phase 6.2)
- `src/lib/services/admin/dashboard.ts` (`419b5b6`): KPI (активные партнёры / организации / закрытые заказы за месяц / к выплате), attention (sync lag >24ч, DLQ jobs >0, утверждённые statements >7д без paid, партнёры без ставки), последние 20 audit events.
- `src/app/admin/dashboard/page.tsx` (`4aa7036`): переписан с декоративной заглушки в реальный dashboard.
- Использует низкоуровневый `StatCard` + inline списки (НЕ reuse'ит partner `KpiGrid`/`AttentionList`/`EventsFeed` — типы структурно incompatible).

### Часть 7 — Refactor existing admin pages (Phase 6.1)
- `/admin/health`, `/admin/sync`, `/admin/commission-statements`, `/admin/commission-statements/[id]` (`16ad294`): inline guard → `await requireAdmin()` с behavior change на `/forbidden`.

### Часть 8 — Тесты (+60+)
- `passwordReset.test.ts` — 7 тестов
- `api.auth.reset-password.request.test.ts` — 5 тестов
- `api.auth.reset-password.confirm.test.ts` — 8 тестов
- `requireRole.test.ts` — 12 тестов
- `recordAudit.test.ts` — 6 тестов
- `admin-sidebar.test.tsx` — 7 тестов
- `services.admin.dashboard.test.ts` — 24 теста (mocked prisma)

## Проверка состояния

```
npm run typecheck   # 0 errors
npm run lint        # 0 new warnings
npm test            # 357+ passed (5 pre-existing DB-integration failures, требуют live Postgres)
npm run build       # successful, новые роуты /api/auth/reset-password/{request,confirm} и /reset-password
```

## Что НЕ готово (Phases 6.3–6.7)

- **Phase 6.3** Users management — service, server actions, list/edit/new страницы, email invite template.
- **Phase 6.4** Partners management — создание Partner + первый admin-user в одной транзакции.
- **Phase 6.5** Organizations management — reuse `RateOverrideForm`.
- **Phase 6.6** Audit log viewer — фильтры по URL, поиск.
- **Phase 6.7** ADMIN_CABINET feature flag, Playwright visual regression snapshots, financial smoke.

Эти задачи **ждут отдельного приоритета** (см. brainstorming session 2026-05-28). Спек может потребовать ревизии — Phase 7/8 добавили новые audit event types, которые audit viewer должен поддерживать.

## Сознательные упрощения (не баги)

1. **`createInviteToken(purpose?)` единый helper** — спек разделял invite и reset; реализация — один helper с optional `purpose: 'invite' | 'reset'` (DRY).
2. **`AuditEntity` union расширен** на 3 entity — реальные callsites потребовали больше категорий, чем планировал спек.
3. **Admin dashboard не reuse'ит partner widgets** — типы структурно incompatible (partner attention имеет stuckOrders/overdueOrders/staleLeads; admin — sync/DLQ/payouts). Используется низкоуровневый `StatCard`.
4. **Behavior change**: authz failure теперь редирект на `/forbidden` (раньше `/login`) — согласовано с middleware, но это «breaking change» для прямых вызовов. Удалось безопасно — все callsites обнаружены и обновлены.
5. **Anti-enumeration** в reset-password/request: всегда 200, не различает existing vs missing email — security-by-design.

## Метрики

- **Коммитов в Phase 6.0–6.2:** 18 (`8ec971a` → `4aa7036`)
- **Новых файлов:** ~22 (4 миграции, 6 auth/audit lib, 4 admin components, 1 service, 2 страницы, 3 API routes, 7 test files)
- **Изменённых файлов:** ~25 (17 audit callsites + 4 existing admin pages + admin layout + getSession refactor)
- **Новых тестов:** +60 (включая 12 requireRole + 24 dashboard service)
- **Diff vs admin-mvp base:** ~3200 insertions / 320 deletions

## Deviations от плана

1. **`createInviteToken` объединил invite + reset** — DRY win.
2. **`AuditEntity` расширен** — реальный код потребовал больше категорий.
3. **Admin dashboard widgets — низкоуровневый StatCard** — incompatible типы с partner widgets.
4. **Phase 6 разделён на 2 PR** (#51 внутрь #52) — план был на один; #51 уже merged в `claude/partner-cabinet-phase3` к моменту #52.

## Test plan (выполнено для 6.0–6.2)

- [x] `npx prisma migrate dev` — 4 миграции applied
- [x] `npm ci && npm run typecheck && npm run lint && npm test && npm run build` — green (5 pre-existing DB failures unchanged)
- [x] `/admin/dashboard` — KPI plates рендерятся, sidebar active highlight работает
- [x] `/admin/health` — refactored to `requireAdmin`, still renders
- [x] `/admin/orders` — redirect to `/admin/dashboard` (deprecated stub)
- [x] Non-admin user → `/admin/*` → redirect на `/forbidden`
- [x] Manual reset flow: create token → `/reset-password?token=<token>` → new password → 200 + audit row

---

**Возобновление работы:** Phase 6.3–6.7 требуют fresh brainstorming для верификации актуальности требований (audit log viewer в особенности — Phase 7/8 добавили новые event types).
```

- [ ] **Step 2: Verify file matches template structure**

Compared to standard `-DONE.md`, this file has an additional `## Статус фаз` section **immediately after** the header and before `## Что готово`. Also `## Что НЕ готово` is much more substantive (lists 5 not-started sub-phases, not just bullets). Confirm both deviations are present.

---

## Task 5: Create `2026-05-25-organization-cabinet-phase7-DONE.md`

**Files:**
- Create: `docs/superpowers/plans/2026-05-25-organization-cabinet-phase7-DONE.md`

- [ ] **Step 1: Write the close-out file**

Create `docs/superpowers/plans/2026-05-25-organization-cabinet-phase7-DONE.md` with this exact content:

```markdown
# Phase 7 — Organization Cabinet — DONE

**Дата завершения:** 2026-05-26
**Base commit:** `7091855` (Merge pull request #51 from aiprocadm/claude/admin-cabinet-mvp)
**Head commit:** `7655706` (feat(flags): ORGANIZATION_CABINET feature flag gating /organization/*) для PR #55; `eafe5be` (test(worker.oneCSync): robust cleanup walks full FK graph) для PR #56
**Branch:** `claude/partner-cabinet-phase3` (та же сборная ветка)
**Связанные PR:** #46–#56 (cascade на основной ветке); ключевые: #55 (7.4 + 7.5 + Task 39), #56 (7.6 Task 38)

## Что готово

### Часть 1 — Phase 7.4 Comments write + Email notifications (Tasks 28–30, PR #55)
- `src/lib/notifications.ts` — `notifyOrgUsers` helper (`3afdcd6`): fans out in-app Notification + best-effort Resend email to every active member of an organisation.
- 4 новых `sendOrg*Email` senders wrap templates landed in PR #54 (`comment_from_manager`, `payment_received`, `document_published`, `order_status_changed`).
- Worker notification hooks (`3bd7ef3`):
  - `sync-payments` → `payment_received` on new (non-refund) payments
  - `sync-documents` → `document_published` on new docs
  - `sync-orders` → `order_status_changed` when `financialStatus` diff detected on update (`executionStatus` is cabinet-owned and untouched by sync, no diff signal there)

### Часть 2 — Phase 7.5 Team + Invite (Tasks 31–37, PR #55)
- `src/lib/services/organization/team.ts` (`b82aaeb`): `listMembers`, `inviteMember` (transactional, reuses existing User by email, creates invite token if no password), `updateMemberRole`, `deactivateMember`, `reactivateMember`. Typed `OrgMemberError` codes: `already_member` / `last_admin_protected` / `self_action_forbidden` / `not_found`.
- **Invariant**: `assertNotLastActiveAdmin` excludes the candidate via `NOT { id }` so count reflects «admins after the operation».
- `src/lib/services/organization/invite.ts` (`e827020`): `createOrgAdminInvite` cross-cabinet shim с source-based policy — partner-admins только в свой portfolio; platform-admins anywhere. Tags audit row with `after.source`.
- `src/server-actions/organization/team.ts` (`2af685d`) — **первые `'use server'` actions в проекте**. Convention: `src/server-actions/<cabinet>/<feature>.ts`. Form-compatible void wrappers (`*FormAction`) рядом с typed Action functions.
- `src/app/organization/team/page.tsx` (`e2ec7d0`): admin-only, `TeamTable` (server-rendered rows с form actions) + `InviteOrgUserForm` (client-side modal с copy-to-clipboard invite URL).
- `/partner/portfolio/[orgId]` (`049c1db`) — «Customer access» block (read-only для partner-managers, invite button для partner-admins).
- `/admin/organizations` + `/admin/organizations/[id]` (`8994c8d`) — с тем же Customer Access block через `inviteAdminOrgAdminAction` (source='admin').

### Часть 3 — Phase 7.6 Feature flag (Task 39, PR #55)
- `src/lib/featureFlags.ts` (`7655706`): новая convention `OPT_IN_FLAGS` set инвертирует default для `organization_cabinet` (unset env ⇒ disabled). Существующие default-true flags untouched.
- `src/middleware.ts`: `/organization` добавлен в `FEATURE_PREFIXES` — 404 если `FEATURE_ORGANIZATION_CABINET` не truthy.
- `.env.example` документирует новый flag.

### Часть 4 — Phase 7.6 Task 38 — Order.organizationId NOT NULL (PR #56)
- Migration `20260526132950_order_organization_id_required` (`f200d0c`): drops FK (был `ON DELETE SET NULL`, incompatible с required column), sets NOT NULL, recreates FK с `ON DELETE RESTRICT`.
- Obsolete `backfillOrderOrganizationId` service + script + test removed — schema enforces what backfill achieved. Recoverable from git history.
- 10+ test fixture files обновлены — thread `organizationId` через каждый `prisma.order.create`. Orphan-row test cases removed.
- `canSeeOrder` / `canSeeDocument` сохраняют null-checks как runtime belt-and-suspenders (plan principle).

### Часть 5 — Phase 7.6 Task 40 — Playwright snapshots (PR #56)
- `prisma/seed.ts`: provisions `org@demo.local` user с admin `OrganizationUser` membership в firstOrg.
- `src/e2e/auth.setup.ts` (`98f89b6`): второй setup block логинит organization admin → `playwright-report/.auth/organization.json`. **Side fix**: `<label>` элементы на `/login` без `htmlFor` — `getByLabel` не матчился; switched to `input[type="email"]`/`input[type="password"]`.
- `playwright.config.ts`: 2 новых проекта (`org-desktop`, `org-mobile`) scoped через `testMatch` regex к `snapshots/organization-*.spec.ts`. Existing partner projects используют negative-lookahead.
- 3 specs: `organization-dashboard`, `organization-orders`, `organization-documents` — full-page screenshots after `networkidle`.
- **6 baseline PNGs committed** (visually reviewed before commit) (`9b53e70`). Verifies sidebar shows admin-only «Команда», KPI grid + events feed populate from seed.

### Часть 6 — Phase 7.6 Task 41 partial — Robust test cleanup (PR #56)
- `cleanupOrgs` / `deletePartnerCascade` helpers в `worker.oneCSync.upsert.test.ts` (`eafe5be`): walks FK graph in reverse-topological order. `CommissionStatementItem` dies before `Order` and `CommissionStatement`. `OrganizationUser` + `Student` die before `Organization`.
- Fixes brittleness when tests run after seed populated demo data.

## Проверка состояния

```
npm run typecheck   # 0 errors
npm run lint        # 0 new warnings (4 pre-existing в /admin/* untouched)
npm test            # 680 passed across 100 files (+91 tests this PR)
npm run build       # successful; новые роуты:
                    # /organization/team
                    # /admin/organizations
                    # /admin/organizations/[id]
                    # middleware 40kB → 40.1kB (new prefix entry)
```

## Что НЕ готово (Phase 8+)

- **Phase 8** Manager cabinet — реверсная сторона диалога (см. [manager-cabinet-phase8-DONE.md](2026-05-26-manager-cabinet-phase8-DONE.md)).
- **Task 41 manual smoke walkthrough** (12 шагов из spec §8.1) — by definition человеческий, операторская задача:
  - admin invite → reset → login → dashboard → orders → order detail → comment → documents → download → students → team invite → RBAC sanity.
- **Operator-driven enablement** — `FEATURE_ORGANIZATION_CABINET=1` в staging пилоте → broader staging → production flip.

## Сознательные упрощения (не баги)

1. **`'use server'` convention** (`src/server-actions/<cabinet>/<feature>.ts`) установлена впервые — будущие cabinets должны её следовать.
2. **Form-compatible void wrappers** (`*FormAction`) рядом с typed Actions — нужны потому что `<form action={fn}>` TS narrow к `void`, а imperative `useTransition` ожидает typed return.
3. **`assertNotLastActiveAdmin` использует `NOT { id }`** — count отражает post-operation state, не pre-state. Защищает от race condition.
4. **Cross-cabinet invite** через `createOrgAdminInvite` с `source` discriminator — alternative было бы два endpoint'а, выбрали один helper с policy branch'ингом.
5. **Order.organizationId NOT NULL** — стронгая referential integrity, но bulk-delete code paths теперь должны reassign или delete orders перед удалением Organization. На данный момент таких code paths нет.
6. **Baselines committed** (в отличие от Phase 5, где они были `update-snapshots` only) — Phase 7 snapshots более стабильны (нет dev-mode badge), и были visually reviewed.

## Метрики

- **Коммитов в Phase 7 (PR #54, #55, #56):** ~22 (часть commits ушла в PR #54 ранее)
- **Новых файлов:** ~28 (team service + invite + server-actions + UI, organization layout/dashboard, admin orgs pages, feature flags expansion, 3 snapshot specs + 6 baselines + auth setup, robust cleanup helpers)
- **Новых тестов:** +91 (680 vs 589)
- **Diff:** ~4500 insertions / ~120 deletions

## Deviations от плана

1. **`invite-customer-admin-form.tsx` shared** между partner и admin контекстами через `source: 'partner' | 'admin'` prop. План разделял.
2. **`<label>` fix в auth.setup.ts** — latent a11y bug, не было в плане. Найден и пофикшен alongside snapshot work.
3. **6 baselines committed** — план говорил «captured on first CI run»; Phase 7 baselines стабильны (Linux/Chromium), пошли committed-first.
4. **Pre-existing `prisma/migrations/migration_lock.toml`** untracked across sessions — НЕ включён в этот PR (намеренно).
5. **Phase 7 split на 3 PR** (#54 → #55 → #56). План был на 2 PR. Фактически разделение: PR #54 templates+notifications setup, PR #55 actions+UI+flag, PR #56 NOT NULL migration+snapshots+cleanup.

## Test plan (выполнено)

- [x] `npx prisma migrate deploy` — NOT NULL migration applied
- [x] `npm run prisma:seed` — `org@demo.local` member firstOrg
- [x] `npm run typecheck && npm run build` — green
- [x] `npx vitest run --pool=threads --poolOptions.threads.maxThreads=4` — 99 файлов ✓ (Windows + Node + Vitest teardown segfault скрывает summary line, но per-file ✓)
- [x] Visual review 6 committed baselines под `src/e2e/snapshots/organization-*-snapshots/`
- [ ] Manual smoke walkthrough (12 шагов, operator-driven)

---

**Operational notes:**
- **Production deploy ordering**: NOT NULL migration assumes no NULL `organizationId` rows. Production must run backfill (preserved at `7655706~1` in git history) before applying.
- **FK delete-action change**: previously `Order.organizationId` был `ON DELETE SET NULL`; now `ON DELETE RESTRICT`. Stronger referential integrity, но bulk-delete code paths нужно adjust.

**Следующая фаза:** Phase 8 — Manager Cabinet (см. [manager-cabinet-phase8-DONE.md](2026-05-26-manager-cabinet-phase8-DONE.md)).
```

- [ ] **Step 2: Verify file matches template structure**

Same checklist as Task 2 Step 2.

---

## Task 6: Create `2026-05-26-manager-cabinet-phase8-DONE.md`

**Files:**
- Create: `docs/superpowers/plans/2026-05-26-manager-cabinet-phase8-DONE.md`

- [ ] **Step 1: Write the close-out file**

Create `docs/superpowers/plans/2026-05-26-manager-cabinet-phase8-DONE.md` with this exact content:

```markdown
# Phase 8 — Manager Cabinet — DONE

**Дата завершения:** 2026-05-27
**Base commit:** `eafe5be` (test(worker.oneCSync): robust cleanup walks full FK graph) — после PR #56 merge
**Head commit:** `bce380a` (test(e2e): visual regression specs for manager dashboard, orders, documents + seed manager fixture)
**Branch:** `claude/manager-cabinet-phase8`
**Связанные PR:** #57 (Phases 8.0–8.4), #58 (Phases 8.5+8.6), #59 (a11y followup), #63 (manager docs route fix + CLAUDE.md)
**Spec:** [manager-cabinet-design.md](../specs/2026-05-26-manager-cabinet-design.md)

## Что готово

### Часть 1 — Phase 8.0 Foundation (PR #57)
- Migration `20260527100000_organization_manager` (`9b868f2`): новая таблица `OrganizationManager` (join: user × organization, mirror of `OrganizationUser`); индексы на `Comment(authorId, orderId)` для historical-comment RBAC path; `Order.executionStatus` ENUM активирован (`pending|in_progress|completed|cancelled|on_hold`).
- `src/lib/auth/managerPolicy.ts` (`6768481`): three-way RBAC — per-order (Order.managerId), per-org (OrganizationManager join), historical-comment (через Comment.authorId). `managerOrderScopeFilter` объединяет три пути.
- `src/lib/auth/requireRole.ts` (`bfbb282`): `requireManager()`, `requireManagerForOrg(orgId)`, `requireManagerForOrder(orderId)` — server-side guards.
- `src/lib/auth/login.ts` (`02e5a5b`): load `managedOrgIds` в session payload при login (для manager role).
- `src/lib/auth/policy.ts` refactor (`7a5a8f7`): manager branches переписаны с `OrganizationUser`-as-manager (wrong model) на `OrganizationManager` + `Order.managerId` через `managerPolicy.ts`.
- **Phase 8 фикс side-bug**: `/api/notifications/route.ts` (`f95e154`) — тот же legacy bug, найден в code review, пофикшен в этом PR.

### Часть 2 — Phase 8.1 Shell + Dashboard (PR #57)
- `src/components/manager/manager-app-shell.tsx` (`37da7bb`): server component с `requireManager()`, передаёт session + managedOrgIds в sidebar.
- `src/components/manager/manager-sidebar.tsx`: 6-item sidebar (Дашборд / Заказы / Документы / Организации / Студенты / Сообщения).
- `src/components/manager/manager-kpi-grid.tsx`, `manager-attention-list.tsx`, `manager-events-feed.tsx` (`d4efaf3`): dashboard widgets.
- `src/lib/services/manager/dashboard.ts` (`8c3f0ab`): сервис с KPI / attention / events для managed scope.
- `src/app/manager/dashboard/page.tsx` (`b480f77`): реальный dashboard (не stub).

### Часть 3 — Phase 8.2 Orders + status change (PR #57)
- `src/lib/services/manager/orders.ts` (`8ab06c6`): list/get с three-way RBAC scope.
- `src/lib/services/manager/status.ts` + `src/server-actions/manager/transitionOrderStatus.ts` (`4ee8d3c`): manager-settable transitions (`pending → in_progress → completed`).
- Components: `manager-orders-filter.tsx` (`1d355c9`), `manager-orders-table.tsx`, `manager-order-header.tsx`, `manager-order-amounts.tsx`, `manager-order-timeline.tsx`, `manager-payments-list.tsx`, `manager-status-change-form.tsx` (`21c7ad2`).
- Pages: `src/app/manager/orders/page.tsx` (`067c66d`), `[id]/page.tsx` (`4601e3e`).

### Часть 4 — Phase 8.3 Documents + Organizations + Students (PR #57)
- `src/lib/services/manager/documents.ts` (`cb32b9c`): list + signed-url download + hide-infected logic.
- `src/lib/services/manager/organizations.ts` (`442cb5c`): index/detail service.
- `src/lib/services/manager/students.ts` (`7910d87`): list scoped via `managedOrgIds`.
- Pages: `manager/documents/page.tsx` (`2f335bb`), `manager/organizations/page.tsx`, `manager/organizations/[id]/page.tsx`, `manager/students/page.tsx` (`7910d87`).
- API: `GET /api/manager/documents/[id]/download` (`cb32b9c`).

### Часть 5 — Phase 8.4 Write paths + Notifications (PR #57)
- `src/lib/services/manager/uploads.ts` + form `manager-doc-upload-form.tsx` + route `/api/manager/documents/[id]/upload` (`3c24d8e`): Supabase Storage + ClamAV scan queue + audit.
- `src/lib/services/manager/messages.ts` + `manager-messages-inbox.tsx` + `/manager/messages/page.tsx` (`ddbfec2`): inbox.
- `/api/comments/route.ts` (`53b3d40`): `viewer='manager'` branch; trigger `notifyOrgUsers` (org-side `manager_replied` template).
- `src/lib/notifications.ts` (`03ec43b`): `notifyManagers` helper с three-way recipient resolver + **invariant**: visibility set === notification set.
- Hooks (`e77bf27`, `f85173e`, `437968e`): org comments → `notifyManagers(comment_from_org)`; sync-payments → `notifyManagers(order_marked_paid_by_1c)`; transitionOrderStatus → `notifyManagers(order_status_changed)` other-managers.
- Email templates (`4fe1ce9`): `manager/comment_from_org`, `manager/document_uploaded_by_org`, `manager/order_marked_paid_by_1c`, `manager/order_status_changed` + `organization/manager_replied`.

### Часть 6 — Phase 8.5 Admin assign UI (PR #58)
- `src/lib/services/manager/team.ts` (`0200814`): `listManagersForOrg` — active + archived assignments.
- `src/lib/services/manager/invite.ts` (`b94e46c`): mode-discriminated `createAndAssignManager` (`'existing' | 'new'`) + `deactivateAssignment` / `reactivateAssignment` с in-place reactivation (вместо unique-constraint violation).
- `src/server-actions/admin/manager.ts` (`f212ef3`): 4 actions:
  - `assignOrInviteManagerAction({ mode: 'existing' | 'new', ... })`
  - `deactivateManagerAssignmentAction`
  - `reactivateManagerAssignmentAction`
  - `assignOrderManagerAction` (для per-order RBAC path)
- Components:
  - `src/components/admin/managers-block.tsx` (`04829aa`): server component, рендерит active + archived assignments на `/admin/organizations/[id]`.
  - `assign-or-invite-manager-form.tsx`: client modal с tabs (existing / pick-or-invite-new), invite URL + copy fallback.
  - `assign-order-manager-form.tsx` (`1c8e297`): on `/admin/orders/[id]`. Минимальный `/admin/orders/[id]` page restored (план assumed exists; не существовал).
- Email template: `manager/invite.tsx` + `sendManagerInviteEmail` wired в admin action.
- `AuditEntity` union gains `organization_manager`.

### Часть 7 — Phase 8.6 Feature flag + Polish (PR #58)
- `src/lib/featureFlags.ts` (`4b0d870`): `manager_cabinet` opt-in (default off).
- `src/middleware.ts`: `/manager/*` 404 когда flag off.
- `src/lib/navigation/cabinet.ts`: `navByRole.manager` gets `flag: 'manager_cabinet'` on every item.
- `prisma/seed.ts`: добавляет `manager@demo.local` fixture.

### Часть 8 — Playwright snapshots (PR #58)
- `manager-dashboard.spec.ts`, `manager-orders.spec.ts`, `manager-documents.spec.ts` (`bce380a`).
- `auth.setup.ts`: third setup block logins manager → `playwright-report/.auth/manager.json`.
- `playwright.config.ts`: `mgr-desktop` / `mgr-mobile` projects.
- **Baselines NOT committed** — generated on first staged run (как Phase 5).

### Часть 9 — A11y followup (PR #59, не основной Phase 8)
- Live regions on manager/admin form feedback + modal labelling and Escape (`f898248`, `185b433`).

### Часть 10 — Manager docs route fix (PR #63)
- Rename param `[orderId]` → `[id]` в `/api/manager/documents/[id]/upload` (`b5a6fc9`).
- **Latent bug**: Next.js requires identical slug names at the same path level; PR #58 broke это рядом с existing `/api/manager/documents/[id]/download`. Не пойман `next build` — нужен `next dev` boot check (добавлен в release checklist через PR #65).
- Дополнительно в PR #63: root CLAUDE.md для агентов + Husky-based test discipline.

## Проверка состояния

```
npm run typecheck   # 0 errors
npm run lint        # 0 new warnings (4 pre-existing `unused session` в admin/* untouched)
npm test            # 956 / 956 passing
npm run build       # successful, новые роуты:
                    # /manager/dashboard, /manager/orders, /manager/orders/[id]
                    # /manager/documents, /manager/organizations, /manager/organizations/[id]
                    # /manager/students, /manager/messages
                    # /api/manager/documents/[id]/{download,upload}
                    # /admin/orders/[id], expanded /admin/organizations/[id]
```

## Что НЕ готово (operator-driven, post-merge)

- **Staged rollout** — `FEATURE_MANAGER_CABINET=0` на merge (Stage 0 — dark launch).
- **Stage 1** (staging): `FEATURE_MANAGER_CABINET=1`, `npx prisma migrate deploy`, `npx prisma db seed`, `FEATURE_MANAGER_CABINET=1 npm run e2e:visual -- --update-snapshots` для baselines, commit baselines.
- **Stage 1 manual smoke** (spec §10.1, 12 шагов):
  1. admin invites manager → 2. reset password → 3. login → 4. dashboard → 5. orders list → 6. per-order assignment activates visibility → 7. org user comment notifies manager → 8. manager replies, org gets email → 9. manager changes status, org + other manager notified → 10. manager uploads PDF, org notified → 11. RBAC 404 on out-of-scope order → 12. comments-history persists after deactivation; deactivation shrinks scope on next login.
- **Stage 2 pilot**: enable for 3–5 real managers, monitor 1–2 weeks.
- **Stage 3 full rollout** once stable.

## Сознательные упрощения (не баги)

1. **`ExecutionStatus` enum** — `pending|in_progress|completed|cancelled|on_hold`, не план's `new|closed`. Адаптировано через все tasks.
2. **`Comment.authorRole` doesn't exist** — derived через `comment.author.role` JOIN. Documented as future denormalization candidate (spec §11).
3. **`Order.managerId` never populated** до Phase 8.5 admin assign UI — per-order RBAC path активируется только когда `assignOrderManagerAction` будет реально использован.
4. **`DocumentsList` reuse** через narrow optional props (`downloadEndpointBase`) — no `viewer` prop (per `feedback-component-reuse` memory).
5. **In-place reactivation** в `reactivateAssignment` вместо нового OrganizationManager row — избегает unique-constraint violation, сохраняет audit chain.
6. **Three-way recipient resolver invariant** — visibility set === notification set, защищает от notification leak (test в `notifications.invariant.test.ts`).
7. **No feature flag в PR #57** — план не требовал; добавлен в PR #58. Mitigation: no `role='manager'` user existed в prod (только seed для Phase 8.6).
8. **Baselines NOT committed** — generated on first staged Linux/Chromium run.

## Метрики

- **Коммитов в Phase 8:** 30+ commits across PRs #57 (~30) + #58 (~7) + #59 (a11y) + #63 (fix)
- **Новых файлов:** ~45 (manager services×6, manager components×12, manager pages×8, server-actions×2, admin components×3, email templates×5, requireRole expansion, managerPolicy, OrganizationManager migration, +3 snapshot specs, auth setup expansion)
- **Изменённых файлов:** ~25 (policy.ts refactor, login.ts, notifications.ts, /api/comments, /api/notifications, sync-payments, sync-orders, navigation, featureFlags, middleware, playwright.config, seed, AuditEntity)
- **Новых тестов:** +120+ (956 vs ~836)
- **Diff vs phase8 base:** ~2190 insertions / ~9 deletions (PR #58 alone)

## Deviations от плана

1. **`/api/manager/documents/[orderId]/upload`** изначально создан с `[orderId]` slug — конфликт с существующим `[id]/download` на том же пути. Не пойман `next build`, появился только в `next dev`. Фикс в PR #63: переименование в `[id]`.
2. **`Order.executionStatus` enum** — план говорил `new|closed`; реальная схема (`pending|in_progress|completed|cancelled|on_hold`) шире.
3. **Side-fix `/api/notifications`** route — план не упоминал; обнаружен в code review (тот же legacy `OrganizationUser`-as-manager bug).
4. **`/admin/orders/[id]` page restored** — план assumed existed; пришлось создать минимальный shell.
5. **Manager docs route fix отдельным PR** (#63) после merge основного — latent infra bug.
6. **A11y follow-up в отдельном PR** (#59) — план не включал; flagged как out-of-scope в PR #58 review.

## Test plan (выполнено)

- [x] `npm run typecheck` — 0 errors
- [x] `npm run lint` — 0 new warnings
- [x] `npm test` — 956/956 passing
- [x] `npm run build` — successful, 10 новых manager routes
- [x] `OrganizationManager` migration safety review (Prisma не использует `CREATE INDEX CONCURRENTLY` — flagged in code-review, ack'd)
- [x] Spot-check three-way RBAC в `managerPolicy.canSeeOrder` (per-order / per-org / comments-history)
- [x] `notifyManagers` recipient set === visibility set (test в `notifications.invariant.test.ts`)
- [ ] Stage 1 staging enablement (operator-driven)
- [ ] Stage 1 manual smoke (12 шагов, operator-driven)
- [ ] Stage 2 pilot (operator-driven)

---

**Operational notes:**
- **Migration safety**: `Comment(authorId, orderId)` index added без `CREATE INDEX CONCURRENTLY` (Prisma limitation). На пустой/малой проде безопасно; на больших таблицах может lock'нуть.
- **Default-off feature flag**: prod safety net — manager cabinet не reachable пока `FEATURE_MANAGER_CABINET=1`.

**Следующая фаза:** Operator-driven staged rollout. После завершения Stage 3 (full prod) — переключение flag на default-on или удаление gate.
```

- [ ] **Step 2: Verify file matches template structure**

Same checklist as Task 2 Step 2.

---

## Task 7: Create `2026-05-27-modal-focus-trap-DONE.md`

**Files:**
- Create: `docs/superpowers/plans/2026-05-27-modal-focus-trap-DONE.md`

- [ ] **Step 1: Write the close-out file**

Create `docs/superpowers/plans/2026-05-27-modal-focus-trap-DONE.md` with this exact content:

```markdown
# Modal Focus Trap — DONE

**Дата завершения:** 2026-05-27
**Base commit:** `f898248` (fix(a11y): live regions on manager/admin form feedback + modal labelling and Escape, после PR #59 merge)
**Head commit:** `28238db` (feat(a11y): wire useDialogFocus into partner + admin invite modals)
**Branch:** `claude/modal-focus-trap-impl`
**Связанные PR:** #61 (design spec), #62 (implementation)
**Spec:** [modal-focus-trap-design.md](../specs/2026-05-27-modal-focus-trap-design.md)

## Что готово

### Часть 1 — `useDialogFocus(open)` hook
- `src/hooks/useDialogFocus.ts` (`4b1473d`) — новый файл (~75 lines):
  - **On `open=true`**: stores `document.activeElement` для restore; queries panel для focusable elements; moves focus per WAI-ARIA APG preference order: form-control → submit button → first focusable → panel itself.
  - **Tab keydown** trap: re-queries focusables (handles dynamic content), wraps at ends. `Shift+Tab` from first → focuses last; `Tab` from last → focuses first.
  - **On `open=false`** или unmount: removes keydown listener, calls `previouslyFocused?.focus?.()` для restore.
- **Focusable selector**: `a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])`.
- **No new deps** (~40 lines logic не оправдывают `focus-trap-react`).

### Часть 2 — Playwright e2e spec
- `src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts` (`44f6941`) — 4 теста:
  1. Initial focus moves into modal on open (lands в email input, не close ×)
  2. Tab from last focusable (submit) wraps to first (close ×)
  3. Shift+Tab from first focusable (close ×) wraps to last (submit)
  4. Focus restores to trigger after Escape
- Файл prefixed `organization-*` чтобы Playwright `org-desktop`/`org-mobile` projects подхватили без config changes.

### Часть 3 — Wired into 3 sibling invite modals
- `src/components/organization/invite-org-user-form.tsx` (`44f6941`) — +3 lines (import, hook call, ref+tabIndex+outline-none на inner panel).
- `src/components/partner/invite-customer-admin-form.tsx` (`28238db`) — same wiring.
- `src/components/admin/assign-or-invite-manager-form.tsx` (`28238db`) — same wiring.

## Проверка состояния

```
npm run typecheck   # clean
npm run lint        # no new warnings/errors (pre-existing only)
npm test            # 940/940 non-skipped passed (1 unrelated flake services.manager.orders)
npm run build       # successful, no new routes
```

## Что НЕ готово

**Нет планируемой следующей фазы.** Этот план фиксировал точечный a11y debt — focus trap + focus restore для трёх sibling invite modals. После shipped работа закрывает обе WCAG-проблемы (2.4.3 Focus Order и 2.4.11 Focus Not Obscured).

**Out-of-scope (намеренно):**
- Generalising в `<DialogShell>` компонент — flagged в спеке как future task если modal pattern будет переиспользоваться больше 3 sibling-ов.
- Layered modal stack — кодовая база не имеет такого кейса.
- Non-modal popovers / dropdowns — отдельная проблема, не WCAG focus order issue.

**Side-blocker (закрыт PR #63):** Playwright e2e не запускался в PR #62 из-за infra bug в PR #58 (`[orderId]` vs `[id]` slug conflict). PR #63 пофиксил routing, e2e теперь runnable.

## Сознательные упрощения (не баги)

1. **Initial focus preference order skips close ×** — WAI-ARIA APG для form dialogs: пользователь открыл «Пригласить участника», cursor должен попасть в email field, не на close affordance. Это сознательный UX выбор.
2. **`outline-none` на panel** — panel получает focus как fallback (no focusables case); не хотим focus ring на panel itself, только на interactive children.
3. **Re-query focusables on each Tab** — handles dynamic content (admin form's mode-tabs add/remove «name» input). Cheaper alternative — MutationObserver — overkill для трёх existing modals.
4. **Hook size ~75 lines** — самодостаточный, без зависимостей. Если pattern будет переиспользоваться, обернётся в `<DialogShell>`.
5. **Spec в отдельном PR** (#61) — design first, impl second. План тоже отдельный PR (комбинированный design+plan ушёл в #61). PR #62 несёт только impl + рабочие e2e.

## Метрики

- **Коммитов в этой работе:** 6 (3 docs в PR #61 + 3 impl в PR #62)
- **Новых файлов:** 2 (`useDialogFocus.ts`, `organization-team-modal-focus-trap.spec.ts`)
- **Изменённых файлов:** 3 (3 sibling modal forms — по +3 строки каждой)
- **Новых тестов:** 4 e2e tests (Playwright)
- **Diff:** ~100 insertions / ~6 deletions

## Deviations от плана

1. **Test strategy correction** (`d92f25e`) — spec изначально предлагал vitest+jsdom; corrected to Playwright e2e после анализа (jsdom не воспроизводит focus accuracy реального browser'а).
2. **`/api/manager/documents` slug conflict** — preventing dev server start, blocked Playwright e2e runs. Не от этого PR. Закрыт PR #63 после.
3. **WAI-ARIA APG preference order** — план не уточнял; в реализации добавлено form-control-first.

## Test plan (выполнено)

- [x] `npm run typecheck` — clean
- [x] `npm run lint` — no new
- [x] `npm test` — 940/940
- [x] Hook code review — cleanup captures panel + previouslyFocused в closure, safe under unmount
- [ ] Playwright e2e — runnable после PR #63 merge (blocked by `[orderId]` slug bug на момент PR #62)
- [ ] Manual keyboard verification (deferred to dev session с running app)

---

**Operational notes:**
- Hook готов к переиспользованию для будущих modals. Convention: panel `<div>` с `ref={panelRef}` + `tabIndex={-1}` + `outline-none` + `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.
- Mouse-driven flow unchanged. Keyboard-only пользователи получили correct focus trap + restore.
```

- [ ] **Step 2: Verify file matches template structure**

The "Что НЕ готово" section has a different shape than other close-outs (uses "Нет планируемой следующей фазы" prefix) — that's intentional per the spec (Section 2 final paragraph). Confirm the section starts with that phrase.

---

## Task 8: Commit 1 — all close-out files + spec

**Files:**
- All six new files from Tasks 2–7
- `docs/superpowers/specs/2026-05-28-housekeeping-plan-closeouts-design.md` (untracked from brainstorming session)
- This plan file: `docs/superpowers/plans/2026-05-28-housekeeping-plan-closeouts.md`

- [ ] **Step 1: Verify all close-out files exist**

```bash
ls -la docs/superpowers/plans/2026-05-2{1,2,4,5,6,7}-*-DONE.md docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md 2>&1
```

Expected: 6 files listed (5 ending in `-DONE.md`, 1 ending in `-PARTIAL.md`). If any missing, return to the failing task.

- [ ] **Step 2: Stage all docs files**

```bash
git add docs/superpowers/plans/2026-05-21-partner-cabinet-phase3-DONE.md \
        docs/superpowers/plans/2026-05-22-partner-cabinet-phase5-DONE.md \
        docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md \
        docs/superpowers/plans/2026-05-25-organization-cabinet-phase7-DONE.md \
        docs/superpowers/plans/2026-05-26-manager-cabinet-phase8-DONE.md \
        docs/superpowers/plans/2026-05-27-modal-focus-trap-DONE.md \
        docs/superpowers/plans/2026-05-28-housekeeping-plan-closeouts.md \
        docs/superpowers/specs/2026-05-28-housekeeping-plan-closeouts-design.md
```

Expected: no errors. Verify with `git status` that all 8 files are in the staging area.

- [ ] **Step 3: Verify clean diff**

```bash
git diff --cached --stat
```

Expected: 8 files listed, all under `docs/superpowers/`. Total insertion count in the low thousands of lines. No file outside `docs/superpowers/` in the diff.

- [ ] **Step 4: Create the commit**

```bash
git commit -m "$(cat <<'EOF'
docs(plans): close-out documents for shipped phases + housekeeping spec/plan

Adds the missing close-out documents for six shipped/partially-shipped phases:

- partner-cabinet-phase3-DONE.md (PR #45, #46)
- partner-cabinet-phase5-DONE.md (PR #48, #49, #50)
- admin-cabinet-mvp-PARTIAL.md (PR #51, #52 — only 6.0-6.2 of 8 shipped)
- organization-cabinet-phase7-DONE.md (PR #55, #56)
- manager-cabinet-phase8-DONE.md (PR #57, #58, #59, #63)
- modal-focus-trap-DONE.md (PR #61, #62)

The PARTIAL suffix is introduced as an extension of the -DONE convention
(see admin-cabinet-mvp-PARTIAL.md "Статус фаз" block).

Also commits the brainstorming spec and this plan for traceability.

Refs: docs/superpowers/specs/2026-05-28-housekeeping-plan-closeouts-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: pre-commit hook runs lint-staged (no `.ts` changes → no-op) + typecheck + test:changed. All trivially pass. Commit created.

- [ ] **Step 5: Verify commit**

```bash
git log -1 --stat
```

Expected: One commit with 8 files changed, all under `docs/superpowers/`. Commit message subject starts with `docs(plans):`.

---

## Task 9: Edit CLAUDE.md §8

**Files:**
- Modify: `CLAUDE.md` (line ~135 inside the §8 Spec-first процесс section)

- [ ] **Step 1: Locate the exact current text**

The current text at line 135 (verify with `grep -n "переименовывается" CLAUDE.md`):

```
3. После завершения файл плана переименовывается в `*-DONE.md`.
```

- [ ] **Step 2: Edit with the Edit tool**

Replace that exact line with the corrected text. Use the Edit tool (not sed/awk):

- `old_string`:
  ```
  3. После завершения файл плана переименовывается в `*-DONE.md`.
  ```

- `new_string`:
  ```
  3. После завершения **рядом** с планом создаётся короткий close-out `<plan>-DONE.md` (см. эталон [partner-cabinet-phase4-DONE.md](docs/superpowers/plans/2026-05-22-partner-cabinet-phase4-DONE.md)) — план хранит «что планировали», close-out хранит «что отгрузили». Если работа отгружена частично, использовать суффикс `-PARTIAL.md` с явным блоком «Статус фаз» (см. эталон [admin-cabinet-mvp-PARTIAL.md](docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md)).
  ```

- [ ] **Step 3: Verify the edit**

```bash
grep -n "рядом" CLAUDE.md | head -2
```

Expected: line ~135 shows the new text. The old "переименовывается" should no longer appear:

```bash
grep -n "переименовывается" CLAUDE.md
```

Expected: empty output (or no match for §8 — verify no other occurrences exist).

---

## Task 10: Edit README — add `/manager/dashboard` bullet + Cabinet rollout status section

**Files:**
- Modify: `README.md` (after line 131)

- [ ] **Step 1: Verify current state of "New cabinets (MVP)" section**

```bash
sed -n '127,135p' README.md
```

Expected current text:

```
## New cabinets (MVP)
- `/partner/dashboard` — dashboard партнера с агрегированными метриками.
- `/organization/dashboard` — dashboard организации.
- `/student` + `/student/redirect` — временный SSO-like переход во внешний LMS по signed JWT.
- Middleware ограничивает доступ по ролям и изолирует кабинеты.
```

- [ ] **Step 2: Add `/manager/dashboard` bullet**

Use the Edit tool. Insert `/manager/dashboard` line between `/organization/dashboard` and `/student`:

- `old_string`:
  ```
  - `/organization/dashboard` — dashboard организации.
  - `/student` + `/student/redirect` — временный SSO-like переход во внешний LMS по signed JWT.
  ```

- `new_string`:
  ```
  - `/organization/dashboard` — dashboard организации.
  - `/manager/dashboard` — dashboard внутреннего менеджера Промтехносферы.
  - `/student` + `/student/redirect` — временный SSO-like переход во внешний LMS по signed JWT.
  ```

- [ ] **Step 3: Add new "Cabinet rollout status" section**

Use the Edit tool. Insert the new section after the "Middleware ограничивает доступ..." line and before the existing `## Явная RBAC-матрица` section. The trailing newline before `## Явная RBAC-матрица` must be preserved.

- `old_string`:
  ```
  - Middleware ограничивает доступ по ролям и изолирует кабинеты.

  ## Явная RBAC-матрица
  ```

- `new_string`:
  ```
  - Middleware ограничивает доступ по ролям и изолирует кабинеты.

  ## Cabinet rollout status

  | Cabinet | Маршрут | Feature flag | Default | Состояние |
  |---|---|---|---|---|
  | Partner | `/partner/*` | — | always on | Production (Phase 0–5 done) |
  | Organization | `/organization/*` | `FEATURE_ORGANIZATION_CABINET` | **opt-in** (off) | Staged rollout (Phase 7 done, operator-driven enablement) |
  | Manager | `/manager/*` | `FEATURE_MANAGER_CABINET` | **opt-in** (off) | Staged rollout (Phase 8 done, operator-driven enablement) |
  | Admin | `/admin/*` | — | always on | Partial (Phase 6.0–6.2 done; sub-phases 6.3–6.7 not started — см. [admin-cabinet-mvp-PARTIAL.md](docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md)) |
  | Student | `/student/*` | — | always on | Production (bridge redirect) |

  Opt-in флаги означают: код в `main`, но эндпоинты возвращают 404 пока env-флаг не выставлен в `1/true/on`. Это поэтапная раскатка по операторам — см. [src/lib/featureFlags.ts](src/lib/featureFlags.ts) для семантики флагов.

  ## Явная RBAC-матрица
  ```

- [ ] **Step 4: Verify edits**

```bash
grep -n "Cabinet rollout status\|/manager/dashboard" README.md
```

Expected: 2 matches — `/manager/dashboard` bullet inside "New cabinets (MVP)", and the new section header.

```bash
sed -n '127,150p' README.md
```

Expected: full new structure visible with /manager/dashboard line + Cabinet rollout status section + table + opt-in note + blank line + "## Явная RBAC-матрица" header.

---

## Task 11: Commit 2 — CLAUDE.md + README edits

**Files:**
- `CLAUDE.md`
- `README.md`

- [ ] **Step 1: Stage edited files**

```bash
git add CLAUDE.md README.md
```

- [ ] **Step 2: Verify staged diff**

```bash
git diff --cached --stat
```

Expected: 2 files (`CLAUDE.md` and `README.md`). Insertion count small (~15-20 lines). No other files.

```bash
git diff --cached
```

Verify the diff visually:
- `CLAUDE.md`: one line replaced with the new wording. No other changes.
- `README.md`: one bullet added (`/manager/dashboard`); new section "Cabinet rollout status" with table inserted between "Middleware ограничивает..." and "## Явная RBAC-матрица".

- [ ] **Step 3: Create the commit**

```bash
git commit -m "$(cat <<'EOF'
docs(rules): align CLAUDE.md §8 with practice + cabinet rollout in README

CLAUDE.md §8 said "после завершения файл плана переименовывается в *-DONE.md"
but actual practice (Phase 0/1/2/4 — see *-DONE.md siblings) is to add a
short close-out next to the long plan. Updated wording matches practice
and adds the -PARTIAL.md extension for partial close-outs (introduced
in this PR's prior commit).

README: added /manager/dashboard bullet to "New cabinets (MVP)" and a new
"Cabinet rollout status" table documenting which cabinets are gated by
feature flags and which are in staged rollout. Operators checking why
/manager/dashboard returns 404 in prod can find the answer here.

Refs: docs/superpowers/specs/2026-05-28-housekeeping-plan-closeouts-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: pre-commit hook passes (no `.ts` changes). Commit created.

- [ ] **Step 4: Verify commit**

```bash
git log --oneline -3
```

Expected: top two commits are the new ones (close-outs + spec/plan; CLAUDE.md+README). Third is the previous main HEAD.

---

## Task 12: Push branch and open PR

**Files:**
- No file changes — git/gh only

- [ ] **Step 1: Push branch with upstream tracking**

```bash
git push -u origin chore/housekeeping-plan-closeouts
```

Expected: branch published; PR creation hint printed by GitHub.

- [ ] **Step 2: Open PR via `gh`**

```bash
gh pr create --base main --head chore/housekeeping-plan-closeouts --title "docs: housekeeping sweep — plan close-outs, CLAUDE.md §8, README cabinet status" --body "$(cat <<'EOF'
## Summary

Three small but compounding documentation hygiene gaps closed in one atomic docs-only PR.

### Bucket 1 — Plan close-outs (6 new files)

Six shipped (or partially shipped) phases lacked the `-DONE.md` close-out documents that the project convention has used since Phase 0. Added them, populated from PR bodies (not speculation):

| File | PRs |
|---|---|
| `partner-cabinet-phase3-DONE.md` | #45, #46 |
| `partner-cabinet-phase5-DONE.md` | #48, #49, #50 |
| `admin-cabinet-mvp-PARTIAL.md` | #51, #52 |
| `organization-cabinet-phase7-DONE.md` | #55, #56 |
| `manager-cabinet-phase8-DONE.md` | #57, #58, #59, #63 |
| `modal-focus-trap-DONE.md` | #61, #62 |

`-PARTIAL.md` is a new convention extension for the admin cabinet (sub-phases 6.0–6.2 shipped, 6.3–6.7 not started). The PARTIAL file has an explicit "Статус фаз" block.

### Bucket 2 — CLAUDE.md §8 wording fix

§8 said "после завершения файл плана переименовывается в `*-DONE.md`" (rename). Actual practice for Phase 0/1/2/4 was to **add** a sibling close-out next to the long plan. Updated wording matches practice and introduces the `-PARTIAL.md` variant.

### Bucket 3 — README "Cabinet rollout status"

README's "New cabinets (MVP)" section was missing `/manager/dashboard` and had no information about which cabinets are gated by opt-in feature flags. Added the bullet + a new "Cabinet rollout status" table — operators checking why `/manager/dashboard` returns 404 in prod can now find the answer in README.

## Why one PR, two commits

- **Commit 1** — `docs(plans): close-out documents for shipped phases + housekeeping spec/plan` (6 new close-outs + spec + this plan).
- **Commit 2** — `docs(rules): align CLAUDE.md §8 with practice + cabinet rollout in README`.

Splitting into two commits keeps the docs/data changes separate from the rules/conventions changes for reviewer clarity. Splitting into multiple PRs would 3× the overhead with no review benefit (the three buckets are not independently mergeable — the new PARTIAL convention is referenced by both CLAUDE.md text and the cabinet rollout table).

## Verification

- [x] `npm run typecheck` — 0 errors (no .ts changes)
- [x] `npm run lint` — 0 warnings (no .ts changes)
- [x] `npm test` — unchanged baseline (no source-test impact)
- [x] `npm run build` — no impact (docs only)
- [x] Every "Head commit" in close-outs resolves to a real commit on main (verified via gh pr view)
- [x] Cabinet rollout table matches current `src/lib/featureFlags.ts` defaults
- [x] CLAUDE.md cross-link to `admin-cabinet-mvp-PARTIAL.md` resolves (file exists in this PR)
- [x] No retroactive close-outs for Phase 0/1/2/4 (already have `-DONE.md` siblings)
- [x] No removal of long planning docs (intentional historical records)

## Spec

[docs/superpowers/specs/2026-05-28-housekeeping-plan-closeouts-design.md](docs/superpowers/specs/2026-05-28-housekeeping-plan-closeouts-design.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened, URL printed.

- [ ] **Step 3: Report PR URL to user**

Print the PR URL prominently in the response (wrapped in `<pr-created>` tag is optional but useful for parent skill chains).

---

## Self-Review Notes

- **Spec coverage**: every section of the spec ([2026-05-28-housekeeping-plan-closeouts-design.md](../specs/2026-05-28-housekeeping-plan-closeouts-design.md)) maps to a task here:
  - Section 1 (template) → Tasks 2–7 each follow the template
  - Section 2 (6 close-outs) → Tasks 2–7
  - Section 3 (admin PARTIAL) → Task 4 specifically
  - Section 4 (CLAUDE.md §8) → Task 9
  - Section 5 (README rollout block) → Task 10
  - Section 6 (commit + PR strategy) → Tasks 8, 11, 12
- **Placeholder scan**: no "TBD", no "fill in details", no "similar to Task N". All file content is provided verbatim.
- **Type consistency**: there are no types — pure markdown. File names match across plan tasks and the spec (verified by grep cross-reference).
- **No assumed test infra**: only `npm run typecheck`/`lint`/`test`/`build` referenced; all already exist per CLAUDE.md.
- **Pre-commit hook tolerance**: trivial `.md`-only diffs don't trigger `test:changed` (it filters to `.ts`/`.tsx` files via lint-staged config — confirmed in existing `package.json`).
