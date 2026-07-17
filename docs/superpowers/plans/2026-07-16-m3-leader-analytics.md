# M3 — Аналитика руководителя (воронка-конверсия + план/факт): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Страница `/leader/analytics`: когортная конверсия воронки за месяц + снапшот открытых стадий + план/факт по каждому менеджеру с инлайн-редактированием месячного плана (`SalesTarget`).

**Architecture:** Одна аддитивная таблица `SalesTarget`; сервис `leader/analytics.ts` (3 функции Result-контракта §3, roster-driven по образцу `leaderDashboard`, Decimal-safe, деньги наружу строками); тонкий server-action; server-component страница + 3 компонента (`month-picker` GET-форма, презентационная `funnel-analytics-panel`, клиентская `plan-fact-table` c `useFormAction`). Новый opt-in флаг `leader_analytics` (3 точки §5). PII-журнал не требуется (агрегаты + staff-имена; прецедент `leaderDashboard`).

**Tech Stack:** Next.js 15 App Router, React 19, TS strict, Prisma 5 + PostgreSQL, Vitest (unit/integration/jsdom-component), примитивы `src/components/ui/`.

**Спека:** [2026-07-16-m3-leader-analytics-design.md](../specs/2026-07-16-m3-leader-analytics-design.md) — итог решений в §0, инварианты в §3.

**Инварианты репо в каждой задаче:** Result-контракт §3; defense-in-depth §4; флаги §5 (3 точки); логи только `@/lib/logging`; 100% coverage §6; узкие селекты §13; русские user-строки.

---

## Карта файлов

**Создаём:** `src/lib/services/leader/analytics.ts` · `src/server-actions/leader/analytics.ts` · `src/app/leader/analytics/page.tsx` · `src/components/leader/analytics/{month-picker,funnel-analytics-panel,plan-fact-table}.tsx` · тесты `src/__tests__/{services.leader-analytics.unit.test.ts, server-actions.leader-analytics.test.ts, components.leader-analytics.test.tsx, pages.leader-analytics.test.tsx, services.leader-analytics.idor.integration.test.ts}` · миграция `m3_sales_target` · close-out `-DONE.md`.

**Модифицируем:** `prisma/schema.prisma` (модель + 2 back-relations) · `src/lib/featureFlags.ts` (`leader_analytics` в `FEATURE_FLAGS`+`OPT_IN_FLAGS`) · `src/middleware.ts` (`FEATURE_PREFIXES` += `/leader/analytics`) · `src/lib/navigation/cabinet.ts` (nav-item leader) · `src/__tests__/pii.contexts.test.ts` НЕ трогаем (контекстов не добавляем).

---

## Task 1: Схема `SalesTarget` + флаг `leader_analytics` (3 точки)

**Files:** Modify `prisma/schema.prisma`, `src/lib/featureFlags.ts`, `src/middleware.ts`, `src/lib/navigation/cabinet.ts`.

- [ ] **Step 1: Модель** — в конец `schema.prisma` модель `SalesTarget` ровно из спеки §2.1; back-relations: `Company.salesTargets SalesTarget[]`, `User.salesTargets SalesTarget[] @relation("SalesTargetManager")`.
- [ ] **Step 2: Миграция** — `npm run prisma:generate` → `npm run prisma:migrate -- --name m3_sales_target`. Expected: applied; `npx prisma migrate status` → up to date. НЕ редактировать применённые миграции.
- [ ] **Step 3: Флаг** — в `featureFlags.ts` добавить `'leader_analytics'` в `FEATURE_FLAGS` и `OPT_IN_FLAGS` (рядом с `sales_funnel`, с комментарием-точками чтения по образцу соседей).
- [ ] **Step 4: Middleware** — в `FEATURE_PREFIXES` (после `/leader/funnel`-строки): `{ prefix: '/leader/analytics', flag: 'leader_analytics' }`.
- [ ] **Step 5: Nav** — в `navByRole['leader']` после пункта «Воронка»: `{ href: '/leader/analytics', label: 'Аналитика', icon: '📊', flag: 'leader_analytics' }`.
- [ ] **Step 6: Существующие guard-тесты флагов/nav** — прогнать `npx vitest run` на тестах featureFlags/navigation/middleware (найти по grep `FEATURE_PREFIXES|navByRole` в `src/__tests__`); если есть закрытые списки флагов/пунктов — обновить (зеркало M2-прецедента `pii.contexts.test.ts`).
- [ ] **Step 7: `npm run typecheck` → commit** `feat(m3): SalesTarget schema + leader_analytics flag (3 gate points)`.

## Task 2: Сервис `leader/analytics.ts` (TDD)

**Files:** Create `src/lib/services/leader/analytics.ts`; Test `src/__tests__/services.leader-analytics.unit.test.ts`.

- [ ] **Step 1: Падающий unit-тест.** Мок-паттерн `vi.hoisted` + `vi.mock` (эталон — `services.deal-activity.unit.test.ts`): мокаются `@/lib/auth/audit` (`recordAudit`), `@/lib/services/manager/team` (`listCompanyManagers` — сверить реальный путь/имя по коду!), `@/lib/funnel/stages` (`resolveFunnelStages`, `stageForLead` — можно НЕ мокать, чистые), fake-prisma объект. Кейсы (минимум):
  - `getFunnelAnalytics`: не-staff → `forbidden`; `companyId=null` → `forbidden`; снапшот раскладывает открытые лиды по стадиям c суммами; когорта считает total/promoted/rejected/inWork + `conversionPct` (например 2 из 5 promoted → 40) + `avgDaysToPromote` из `promotedOrder.createdAt`; perManager строится roster-driven + «Без менеджера»; скоуп-where содержит `OR:[{assignedManagerId:null},{assignedManager:{companyId}}]` (assert по аргументу findMany).
  - `getPlanFact`: невалидный месяц → `invalid_period`; нетто-агрегация (оплата 1000 + возврат 200 → факт 800); строки roster-driven, `executionPct` = fact/target*100 (null без плана); «Без менеджера» появляется только при ненулевом факте; totals корректны.
  - `upsertSalesTarget`: не-leader (manager без managerRole) → `forbidden`; admin → ok; менеджер чужой компании → `forbidden`; несуществующий → `not_found`; `targetAmount:'0'`/`'-5'`/`'abc'` → `invalid`; валидный → `upsert` с правильным unique-ключом + `recordAudit('sales_target_set')`; `null` → `deleteMany` + `recordAudit('sales_target_cleared')`.
  - `monthRange`: экспортировать и покрыть границы (январь/декабрь, `[1-е,1-е)`).
- [ ] **Step 2:** `npx vitest run src/__tests__/services.leader-analytics.unit.test.ts` → FAIL (модуля нет).
- [ ] **Step 3: Реализация** по спеке §2.2 (сигнатуры и формулы — из спеки; before coding СВЕРИТЬ по исходникам: точный экспорт `listCompanyManagers`, форму `resolveFunnelStages`/`stageForLead`/`DEFAULT_FUNNEL_STAGES`, `SessionPayload.managerRole`). Decimal: суммировать через `Prisma.Decimal` (прецедент `leaderDashboard`), наружу `.toFixed(2)`.
- [ ] **Step 4:** тест зелёный; targeted coverage файла 100% (incl. branches) — `--coverage.include='src/lib/services/leader/analytics.ts'`; `npm run typecheck`.
- [ ] **Step 5: commit** `feat(m3): leader analytics service (funnel cohort + plan/fact + sales targets)`.

## Task 3: Server-action + UI + страница (TDD по компонентам)

**Files:** Create `src/server-actions/leader/analytics.ts`, `src/app/leader/analytics/page.tsx`, `src/components/leader/analytics/{month-picker,funnel-analytics-panel,plan-fact-table}.tsx`; Tests `server-actions.leader-analytics.test.ts`, `components.leader-analytics.test.tsx`, `pages.leader-analytics.test.tsx`.

- [ ] **Step 1: Action** — `'use server'`: `upsertSalesTargetAction(args)` = `notFoundIfDisabled('leader_analytics')` → `requireManagerLeader()` → `upsertSalesTarget(prisma, session, args)`. Тест-делегация (зеркало `server-actions.deal-activity.test.ts`): flag-off → `{ok:false,error:'disabled'}`-семантика действия (сверить как flag-off обрабатывают соседние actions — если у `notFoundIfDisabled` в actions возвращают Response, замапить в Result как в M1), делегация с session, 100%.
- [ ] **Step 2: Компоненты** (эталоны: `funnel-board.tsx` стили, M1 `deal-activity-thread.tsx` для `useFormAction`+`toast`, `admin/commission-statements/page.tsx` для GET-формы периода):
  - `month-picker.tsx` — GET-форма `<input type="month" name="month" defaultValue>` + кнопка «Показать» (серверный, без 'use client').
  - `funnel-analytics-panel.tsx` — презентационный, props = результат `getFunnelAnalytics.ok`-ветки: KPI-плитки (создано/передано/отказ/конверсия %/ср. дни), снапшот стадий с шириной бара от max count, таблица per-manager. Пустые состояния (`EmptyState`).
  - `plan-fact-table.tsx` — `'use client'`, props `{ year, month, rows, totals }`: таблица менеджеров, колонка «План» = инлайн `Input` + submit через `useFormAction(upsertSalesTargetAction, { refresh: true })`, `toast` успех/ошибка, «Без менеджера»/итоги — read-only.
- [ ] **Step 3: Страница** — зеркало `leader/funnel/page.tsx`: `export const dynamic='force-dynamic'`; `if (!isFeatureEnabled('leader_analytics')) notFound()`; `const session = await requireManagerLeader()`; парс `searchParams.month` (`/^\d{4}-(0[1-9]|1[0-2])$/`, иначе текущий месяц); `Promise.all(getFunnelAnalytics(prisma, session, monthRange(y,m)), getPlanFact(prisma, session, {year,month}))`; `!ok` любой → `notFound()`; рендер `MonthPicker`+`FunnelAnalyticsPanel`+`PlanFactTable`.
- [ ] **Step 4: Тесты** — component (jsdom, все ветки: пустые состояния, бары, инлайн-сохранение плана с мокнутым action, ошибка → toast) + page через `renderServerComponent` (моки: `requireManagerLeader`, сервис, `isFeatureEnabled`; ветки: flag-off → notFound, невалидный month → текущий, `ok:false` → notFound). 100% на всех новых файлах (`\[` экранировать в coverage-glob не нужно — динамических сегментов нет).
- [ ] **Step 5:** `npm run typecheck && npm run lint` → 0 warnings; **commit** `feat(m3): /leader/analytics page (month picker, funnel panel, plan/fact table)`.

## Task 4: Integration-регрессы + close-out + гейты

**Files:** Test `src/__tests__/services.leader-analytics.idor.integration.test.ts`; Create `docs/superpowers/plans/2026-07-16-m3-leader-analytics-DONE.md`.

- [ ] **Step 1: Integration-тест** (`new PrismaClient()`, эталон `services.deal-activity.idor.integration.test.ts`): (a) `upsertSalesTarget` менеджеру чужой компании → `forbidden`, строка не создана; (b) leader A не видит в `getPlanFact` факты компании B (оплаты чужих заказов не суммируются); (c) когорта `getFunnelAnalytics` не включает лид, назначенный менеджеру компании B (скоуп §0.8), но включает неназначенный; (d) upsert→повторный upsert идемпотентен (1 строка, сумма обновлена), `null` → строка удалена; (e) факт нетто: оплата+возврат в месяце → разность; оплата в соседнем месяце не входит.
- [ ] **Step 2:** прогнать новый integration + M3 unit/component набор + typecheck + lint — всё зелёное.
- [ ] **Step 3: Close-out** `-DONE.md` (что отгружено vs спека; отложенное из §2.6; статус гейтов; какие гейты остаются контроллеру — полный `test:coverage`, `build`).
- [ ] **Step 4: commit** `test(m3): cross-company isolation + net-fact integration regressions; M3 close-out`.

## Порядок

T1 → T2 → T3 → T4 (строго последовательно; T2/T3 делят типы сервиса).

## Self-review плана против спеки

§2.1 схема → T1 ✅ · §2.2 три функции + monthRange → T2 ✅ · §2.3 action → T3 ✅ · §2.4 флаг 3 точки → T1 (+page-точка в T3) ✅ · §2.5 UI → T3 ✅ · §3 инварианты → T2 (unit), T4 (integration), флаг/гард — T1/T3 ✅ · PII — не требуется (спека §0.9) ✅.
