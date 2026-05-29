# Admin Cabinet Phase 6.3–6.7 — DONE

**Дата завершения:** 2026-05-29
**Base commit:** `82f30e1` (Merge PR #69 — admin 6.3-6.7 spec+plan, 1C agenda, Stage-2 smoke)
**Head commit:** `6395342` (Merge PR #75 — 6.7 Polish)
**Branches:** `claude/admin-6.3-users`, `claude/admin-6.4-partners`, `claude/admin-6.5-orgs-delta`, `claude/admin-6.6-audit`, `claude/admin-6.7-polish`
**Связанные PR:** #70 (6.3), #71 (6.4), #72 (6.5), #73 (6.6), #75 (6.7). Side-feature #74 (demo-login autofill) merged между #73 и #75 — отдельная фича, не часть этого плана.
**Spec:** [2026-05-29-admin-cabinet-6.3-6.7-design.md](../specs/2026-05-29-admin-cabinet-6.3-6.7-design.md) (supersede'ит §6–§9 оригинальной 2026-05-24 спеки)
**Plan:** [2026-05-29-admin-cabinet-6.3-6.7.md](2026-05-29-admin-cabinet-6.3-6.7.md) (36 tasks, 5 PR)

Закрывает [admin-cabinet-mvp-PARTIAL.md](2026-05-24-admin-cabinet-mvp-PARTIAL.md): Phases 6.0–6.2 отгружены 2026-05-24 (PR #51/#52), 6.3–6.7 — этим планом. **Admin-кабинет (6.0–6.7) теперь полностью отгружен в main.**

## Что готово

### PR-1 — 6.3 Users management (#70, merge `fe7d3ce`, 10 коммитов)
- `src/lib/services/admin/users.ts`: `listUsers` (фильтры role / organizationId / q / isActive), `getUser`, `createUser` (anti-escalation: admin-роль нельзя выдать через UI), `updateUser` (ограниченные role transitions per spec §4.6), `deactivateUser` / `reactivateUser` с `assertNotLastActiveAdmin` + self-action guard.
- `src/lib/email/templates/admin-user-invite.tsx` + `sendAdminUserInviteEmail` (`src/lib/email/send.tsx`) — invite-flow поверх `PasswordResetToken(purpose='invite')`.
- `src/server-actions/admin/users.ts`: zod-валидация + маппинг error-кодов.
- Страницы: `/admin/users` (list + `users-filters` + `users-table`), `/admin/users/new` (`user-invite-form`, inviteUrl fallback), `/admin/users/[id]` (`user-edit-form`).
- **Lesson:** первый `listUsers` имел OR-bleed баг (q + organizationId фильтры интерферировали через общий OR) — пофикшен в том же PR AND-обёрткой OR-клауз (`5a39f42`).

### PR-2 — 6.4 Partners management (#71, merge `3d509c5`, 11 коммитов)
- `src/lib/services/admin/partners.ts`: `listPartners` (rate / norate / q фильтры), `getPartner`, `updatePartner`, `deactivatePartner` / `reactivatePartner`, `createPartnerWithAdmin` (транзакционно: Partner + первый admin-user, slug/email pre-checks).
- `src/server-actions/admin/partners.ts` + страницы `/admin/partners`, `/admin/partners/new` (combined Partner + admin форма), `/admin/partners/[id]` (edit + read-only список админов партнёра).
- **Lessons:**
  - `Partner.commissionRate` — `Decimal NOT NULL @default(0)`, хранится дробью (0..1), отображается процентом. Форма работает в 0..100, action делит на 100 перед сервисом; `Intl.NumberFormat({style:'percent'})` уже умножает на 100 — повторно делить на display нельзя.
  - `Organization` не имеет `isActive` — `activeOrgCount` = орги, привязанные через `Organization.partnerId` (прямой FK), не исторические заказы (`0f85556`).
  - `AdminPartnerErrorCode` включает `AdminUserErrorCode`, т.к. `createPartnerWithAdmin` бросает `'duplicate_email'`.

### PR-3 — 6.5 Organizations delta (#72, merge `db03a22`, 5 коммитов)
- `src/lib/services/admin/organizations.ts`: extract + extend (`listOrganizations` с новыми фильтрами, `getOrganization`, `updateOrganization`).
- `src/server-actions/admin/organizations.ts` + компоненты `organization-edit-form.tsx` и `admin-rate-override-form.tsx`.
- **Sibling-pattern (CLAUDE.md §4):** `partner/rate-override-form.tsx` нельзя reuse (hardcoded на API `/api/partner/portfolio/{orgId}/rate`) — создан sibling, POST'ящий в `setOrgRateOverrideAction`.
- Обновлены `/admin/organizations` + `/admin/organizations/[id]` (блок «Ставка комиссии»).
- **Lessons:**
  - Plan-шаблон включал `legalName` в Org edit form, но у `Organization` нет колонки `legalName` (она только у `Partner`) — выброшено из `UpdateOrgArgs`, схемы server-action и формы.
  - `o.partnerCommissionRate ? Number(...) : null` — хрупкая truthiness-проверка на `Prisma.Decimal` (`Decimal(0)` — truthy объект). Заменено на `!== null` с регрессионными тестами (`4c8a3e5`).

### PR-4 — 6.6 Audit log viewer (#73, merge `af84a09`, 9 коммитов)
- `src/lib/services/admin/auditLog.ts`: `listAudit` (**cursor pagination** — opaque `id`-курсор, «Загрузить ещё»; стабильно при конкурентных вставках в append-only лог) + `listAuditFilters` (популяция dropdown'ов).
- Компоненты: `audit-log-filters.tsx`, `audit-log-table.tsx`, `audit-diff-dialog.tsx`.
- **Security invariant (CLAUDE.md §12):** `audit-diff-dialog.tsx` маскирует секреты — `SENSITIVE_KEY_REGEX = /^(passwordHash|token|code|secret|apiKey|signedUrl|.*Secret|.*Token)$/i`, рекурсивно по вложенным объектам/массивам → `*****`.
- Страница `/admin/audit`.
- **Lessons:**
  - Vitest здесь `environment: 'node'` — нет jsdom, нет `@testing-library/react`. Компонент-тесты используют `react-dom/server` `renderToString` + assertions по HTML-строке + `vi.mock` для хуков. План предлагал `@testing-library/react` — дефект плана, адаптировано.
  - Plan-дефект: Task 29 вызывал `<AuditLogFilters options={...}>`, но Task 26 построил компонент с props `{entities, actions, actors, current}` — выверено по реальной сигнатуре продюсера до диспатча.

### PR-5 — 6.7 Polish (#75, merge `6395342`, 3 коммита в src + seed/config)
- Dashboard drill-down: события-фид теперь `<Link>` на `/admin/audit?entity=…&action=…`; KPI/attention уже эмитили drill-down href'ы (`?filter=norate`, `/admin/health`, `…status=approved`) — Task 31 был почти pre-satisfied.
- `prisma/seed.ts`: admin-facing fixtures (в т.ч. `demo-partner-norate` с фиксированным id для детерминированной e2e-навигации).
- `src/e2e/auth.setup.ts`: admin login block → `playwright-report/.auth/admin.json`.
- `playwright.config.ts`: admin desktop/mobile projects.
- 4 e2e snapshot-спеки: `admin-users`, `admin-partners`, `admin-organizations-edit`, `admin-audit`. **Baselines НЕ закоммичены** — генерируются на первом staged Linux/Chromium прогоне.

## Проверка состояния

```
npm run typecheck   # 0 errors
npm run test:unit   # 873 passed (873) across 101 файлов
npm run build       # successful (per-PR проверено); новые роуты:
                    # /admin/users, /admin/users/new, /admin/users/[id]
                    # /admin/partners, /admin/partners/new, /admin/partners/[id]
                    # /admin/audit
                    # обновлены: /admin/organizations, /admin/organizations/[id], /admin/dashboard
```

## Что НЕ готово (осознанно отложено)

- **e2e visual baselines** — генерируются на staged Linux/Chromium прогоне (`npm run e2e:visual:update`), не коммитятся с Windows. Паттерн как Phase 5/8.
- **`npm run test:integration`** — требует живой Postgres; per-PR не гонялся в этой сессии (L3-слой, ручной перед релизом).
- **Open questions из плана (не баги, явные non-goals):**
  - AuditLog meta `q` ILIKE indexing — отложено до измеримой проблемы.
  - Каскадная деактивация User'ов при `deactivatePartner` — не в MVP.
  - Sessions revocation после deactivate — полагаемся на JWT TTL.

## Сознательные упрощения (не баги)

1. **Без feature flag** — admin-кабинет internal-only (≤10 пользователей), staged rollout не нужен (в отличие от organization/manager).
2. **`admin-sidebar.tsx` не трогали** — все 11 ссылок уже присутствовали с Phase 6.1.
3. **Sibling `admin-rate-override-form.tsx`** вместо reuse partner-формы (разные API-таргеты) — per CLAUDE.md §4 + `feedback-component-reuse`.
4. **Cursor pagination** для audit (vs skip/take везде) — стабильность под конкурентными вставками в append-only лог.
5. **renderToString-тесты** компонентов — vitest `environment: 'node'`, без jsdom/RTL.
6. **Last-active-admin protection** зеркалит org/team паттерн (`assertNotLastActiveAdmin`).

## Метрики

- **Коммитов (src):** ~38 (PR-1: 10, PR-2: 11, PR-3: 5, PR-4: 9, PR-5: 3).
- **Net diff (admin code) `82f30e1..6395342`:** 41 файл, +3549 / −122.
- **Новых unit-тестов:** +~150 (services.admin.users/partners/organizations/auditLog + server-actions.admin.* + email.templates.admin + components.admin-*). 6.7 (Polish) новых vitest'ов не добавил — его тесты это 4 Playwright-спеки.

## Deviations от плана

1. **`legalName` выброшен** из Org edit (нет колонки в `Organization`).
2. **`Decimal !== null`** вместо truthiness-проверки (`Decimal(0)` truthy).
3. **OR-bleed fix** в `listUsers` (q + organizationId).
4. **Plan-дефекты в PR-4** (audit): `@testing-library/react` недоступен → renderToString; page↔component prop mismatch; masking-envelope single-key unwrap. Все выверены/адаптированы.
5. **Task 31 почти pre-satisfied** — drill-down href'ы уже эмитились `attention()`/KPI; нужен был только `<Link>` на events-фиде.

## Test plan (выполнено)

- [x] `npm run typecheck` — 0 errors (на merged main `6395342`)
- [x] `npm run test:unit` — см. «Проверка состояния»
- [x] `npm run build` — per-PR successful, новые admin-роуты
- [x] Spot-check anti-escalation (`createUser` не выдаёт admin через UI) + last-admin protection
- [x] Spot-check secret masking в `audit-diff-dialog` (CLAUDE.md §12)
- [ ] `npm run test:integration` — operator-driven (live PG)
- [ ] e2e visual baselines — generated на staged Linux прогоне

---

**Следующих фаз admin-кабинета не запланировано.** Open questions выше переоткрыть при появлении измеримой нагрузки (audit q-index) или нового требования (cascade deactivate, session revocation).
