# Admin Cabinet MVP — PARTIAL

> **✅ ЗАКРЫТО 2026-05-29.** Отложенные фазы 6.3–6.7 отгружены планом [2026-05-29-admin-cabinet-6.3-6.7.md](2026-05-29-admin-cabinet-6.3-6.7.md) (PR #70–#73, #75). Итог — в close-out [2026-05-29-admin-cabinet-6.3-6.7-DONE.md](2026-05-29-admin-cabinet-6.3-6.7-DONE.md). Admin-кабинет (6.0–6.7) полностью в production. Документ ниже сохранён как исторический срез на 2026-05-24.

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
- [x] **6.3 — Users management** (list/edit/new, email invite template) — ✅ PR #70 (`fe7d3ce`)
- [x] **6.4 — Partners management** (CRUD + первый admin-user в одной транзакции) — ✅ PR #71 (`3d509c5`)
- [x] **6.5 — Organizations management** (CRUD, sibling `admin-rate-override-form`) — ✅ PR #72 (`db03a22`)
- [x] **6.6 — Audit log viewer** (URL-фильтры, поиск, cursor pagination) — ✅ PR #73 (`af84a09`)
- [x] **6.7 — Polish + Playwright visual regression** — ✅ PR #75 (`6395342`). ⚠️ ADMIN_CABINET feature flag **выброшен** — admin internal-only (≤10 пользователей), staged rollout не нужен.

**Решение (исходное, 2026-05-24):** Phase 6.3–6.7 deferred — приоритет ушёл на partner / organization / manager кабинеты (PRs #46, #55–#58).
**Возобновление (2026-05-29):** реализовано планом [2026-05-29-admin-cabinet-6.3-6.7.md](2026-05-29-admin-cabinet-6.3-6.7.md). Опасение про «audit viewer ждёт новые event types» не подтвердилось — viewer читает existing `AuditLog` через cursor pagination. Итог — [DONE](2026-05-29-admin-cabinet-6.3-6.7-DONE.md).

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
