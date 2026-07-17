# M3 — Аналитика руководителя: воронка-конверсия + план/факт — DONE

**Дата завершения:** 2026-07-16
**Branch:** `claude/m3-analytics`
**Base commit:** `a900111` (`main`, merge PR #204 — M1 деятельность по сделке)
**Head commit (после Task 4):** см. «Коммиты серии» ниже (Task 4 коммитится сразу после этого файла)
**Spec:** [2026-07-16-m3-leader-analytics-design.md](../specs/2026-07-16-m3-leader-analytics-design.md)
**Plan:** [2026-07-16-m3-leader-analytics.md](2026-07-16-m3-leader-analytics.md)

## Что отгружено

### Task 1 — Схема `SalesTarget` + флаг `leader_analytics` (`ce76349`)
- Модель `SalesTarget` (`prisma/schema.prisma`): `companyId → Company` (`onDelete: Cascade`), `managerId → User` (`onDelete: Cascade`, relation `SalesTargetManager`), `year`/`month` (Int), `targetAmount` (`Decimal(14,2)`), `createdById` (аудит-денорм, без FK). `@@unique([companyId, managerId, year, month])` — единственность плана на менеджера/месяц, основа идемпотентного upsert. Миграция `prisma/migrations/20260716103929_m3_sales_target/` применена, аддитивна.
- Флаг `leader_analytics` добавлен в `FEATURE_FLAGS`/`OPT_IN_FLAGS` ([featureFlags.ts](../../../src/lib/featureFlags.ts)) — opt-in по умолчанию OFF (канон §5).
- Три точки чтения флага (CLAUDE.md §5): middleware `FEATURE_PREFIXES` (`{ prefix: '/leader/analytics', flag: 'leader_analytics' }`), nav `navByRole['leader']` ([cabinet.ts](../../../src/lib/navigation/cabinet.ts), пункт «Аналитика»), page `notFoundIfDisabled`/`isFeatureEnabled` (Task 3).

### Task 2 — Сервис `leader/analytics.ts` (`6c8c982`)
[`src/lib/services/leader/analytics.ts`](../../../src/lib/services/leader/analytics.ts) — три экспорта + хелпер `monthRange`:
- `getFunnelAnalytics(prisma, session, {from,to})` — снапшот открытых стадий (`resolveFunnelStages`/`stageForLead`) + когортная конверсия (лиды, созданные в периоде: promoted/rejected/inWork, `conversionPct`/`rejectedPct` HALF_UP до 1 знака, `avgDaysToPromote` по `promotedOrder.createdAt − lead.createdAt`) + разбивка по менеджерам (roster-driven через `listCompanyManagers`, плюс синтетическая строка «Без менеджера» при наличии неназначенных лидов в когорте).
- `getPlanFact(prisma, session, {year,month})` — план (`SalesTarget` за период) vs факт (нетто-оплаты: `Payment.paidAt` в границах месяца, `isRefund` вычитается, сгруппированы по `Order.managerId`) + счётчик завершённых заказов (`completedAt` в месяце); заказы/оплаты без менеджера — отдельная строка «Без менеджера», включённая в итог.
- `upsertSalesTarget(prisma, session, args)` — гард в сервисе (defense-in-depth §4): `admin` ИЛИ `manager` с `managerRole==='leader'`; целевой менеджер обязан принадлежать `session.companyId` (иначе `forbidden`), не найден/не `role==='manager'` → `not_found`; `targetAmount` валидируется (`>0`, `<1e12`) или `invalid`; `targetAmount:null` → `deleteMany` (очистка); иначе `upsert` по уникальному ключу (идемпотентно) + `recordAudit` (`sales_target_set`/`sales_target_cleared`).
- Скоуп воронки — C8-partial (спека §0.8): `Lead` не имеет `companyId`, граница держится через `OR: [{ assignedManagerId: null }, { assignedManager: { companyId } }]` — неназначенные лиды видны как общая очередь, назначенные чужой компании — нет.
- 34 unit-теста ([services.leader-analytics.unit.test.ts](../../../src/__tests__/services.leader-analytics.unit.test.ts)), 100% coverage файла на момент коммита.

### Task 3 — Server-action + UI + страница (`5346fd9`)
- Server-action `upsertSalesTargetAction` — `notFoundIfDisabled('leader_analytics')` → `requireManagerLeader()` → делегация в сервис.
- Компоненты: `MonthPicker` (GET-форма, `<input type="month">`, без JS), `FunnelAnalyticsPanel` (снапшот-бары + когорта + per-manager таблица), `PlanFactTable` (инлайн-редактирование плана менеджера с `useFormAction` + `toast`).
- Страница `/leader/analytics` ([src/app/leader/analytics/page.tsx](../../../src/app/leader/analytics/page.tsx)) — зеркало `leader/funnel/page.tsx`: `force-dynamic`, flag-гейт, `requireManagerLeader()`, парсинг `?month=YYYY-MM` (regex-валидация, дефолт — текущий месяц), параллельный вызов обоих сервисов, `notFound()` при `!ok`.
- Регрессы: `server-actions.leader-analytics.test.ts`, `components.leader-analytics.test.tsx`, `pages.leader-analytics.test.tsx` — 100% на новых файлах на момент коммита.

### Task 4 — Integration-регрессы + close-out (этот коммит)
Новый файл [`src/__tests__/services.leader-analytics.idor.integration.test.ts`](../../../src/__tests__/services.leader-analytics.idor.integration.test.ts) (5 тестов, живой Postgres, `new PrismaClient()` → авто-integration-режим). Seed: компании A/B; leader-менеджер компании A (`managerRole:'leader'`); mgrA (companyId A) / mgrB (companyId B); Partner + partner-user (FK для `Lead.partnerId`/`createdByUserId`); orgA (companyId A) / orgB (companyId B); orderA/orderB привязаны к соответствующим компаниям/менеджерам; фиксированный тестовый месяц `2026-03` (в прошлом относительно текущей даты сессии, не пересекается с `now()`-таймстампами других тестов).

1. **`upsertSalesTarget` cross-company** — leader A пытается задать план менеджеру компании B → `{ ok:false, error:'forbidden' }`, `SalesTarget.count()` по обеим компаниям для этого ключа остаётся 0.
2. **Идемпотентность + очистка** — leader A: upsert 100000.00 → upsert 150000.00 (та же уникальная строка, `targetAmount` обновлён, не задублирован) → upsert `targetAmount:null` (строка удалена).
3. **`getPlanFact` изоляция + нетто** — оплаты: orderA получает 1000.00 (март) + возврат 200.00 (март, `isRefund:true`) + 500.00 (апрель, вне периода); orderB получает 9999.00 (март). `getPlanFact(2026,3)` от leader A → строка mgrA: `fact==='800.00'` (1000−200, апрельская оплата исключена по границе `[from,to)`); mgrB нигде не фигурирует (ни строкой, ни суммой — сериализованный ответ не содержит `"9999.00"`); `totals.fact==='800.00'`.
4. **`getFunnelAnalytics` когорта (§0.8)** — три лида, созданные в марте 2026: без менеджера, назначен mgrA, назначен mgrB. `getFunnelAnalytics(monthRange(2026,3))` от leader A → `cohort.total===2` (общая очередь + mgrA; лид mgrB исключён по company-скоупу), `perManager` содержит строки mgrA (`assigned:1`) и «Без менеджера» (`assigned:1`), строки для mgrB нет.
5. **Снапшот-скоуп** — те же три лида (все `status:'new'`, открытая стадия): сумма `count` по всем стадиям снапшота `===2` (лид mgrB не учтён тем же OR-скоупом).

Все 5 сценариев прошли **на первом запуске без исключений/ретраев** — глобальный OR-скоуп для неназначенных лидов (единственный риск ложной пометки, т.к. `Lead` не company-scoped) не столкнулся с посторонними данными в текущем состоянии живой БД.

Cleanup в `afterAll` в порядке, уважающем FK: `salesTarget → auditLog(userId=leaderA) → lead → payment → order → organization → partnerUser → partner → user(leaderA/mgrA/mgrB) → company`.

## Сознательно отложено (follow-up)

Из спеки §2.6 «Явно вне объёма» — без изменений, зафиксировано здесь для трассируемости:

- **Таблица переходов лида (event-log) и «настоящая» stage-conversion** — сейчас конверсия когортная (по текущему статусу лидов, созданных в периоде), не по факту прохождения стадий; честная реконструкция требует истории переходов, которой в схеме нет (только `AuditLog` с 4 lifecycle-action'ами).
- **Тренды/графики по месяцам** — v1 показывает один месяц за раз (пикер меняет период, история/сравнение месяцев не визуализируются).
- **Экспорт XLSX** (T7-трек, канон commission-статements) — не реализован для аналитики.
- **Admin-зеркало** `/admin/analytics` — вне объёма (как и в M1 для ленты активности).
- **План по количеству** лидов/заказов — v1 работает только с денежным планом (`targetAmount`); плана «N заказов» нет.
- **Нотификации о выполнении плана** — при достижении/недостижении цели уведомления руководителю/менеджеру не отправляются.
- **`Lead.companyId`** — архитектурный пробел общей очереди лидов; без него скоуп воронки остаётся C8-*partial* (неназначенные лиды видны межкомпанийно как общая очередь — сознательное решение спеки §0.8, не баг).

## Пост-ревью фикс (финальное адверсарное ревью всей ветки)

Финальное ревью нашло и был применён 1 Important-фикс: `targetAmount:'NaN'` парсился `Prisma.Decimal` без throw, а NaN-сравнения всегда false → обходил оба guard'а и ронял `upsert` необработанным `PrismaClientUnknownRequestError` (вместо Result-ошибки §3). Фикс: `!amount.isFinite()` в guard + тест-кейсы `'NaN'/'Infinity'/'-Infinity'`. Заодно: `forbidden`-лейбл в `TARGET_ERROR_LABEL` (plan-fact-table) и правка спеки §2.2.3 (`< 10^12`, граница `DECIMAL(14,2)`).

**Операционная заметка (TZ):** `monthRange` строит границы месяца в локальном времени сервера (как единственный прецедент в репо — `prevMonthRange` из `calculate-monthly-commissions`); prod-контейнеры не пинят `TZ` (=UTC), дисплей — Europe/Moscow → у границы месяца возможно ±3ч смещение классификации оплат. Учесть в deploy-runbook (пин `TZ=Europe/Moscow`) — вне объёма M3.

## Верификация — статус по гейтам

Выполнено в этой (Task 4) сессии:

| Гейт | Команда | Результат |
|---|---|---|
| Integration-тест Task 4 | `npx vitest run src/__tests__/services.leader-analytics.idor.integration.test.ts` | 1 файл, **5/5 passed** |
| Regression-набор M3 (unit+action+component+page+флаги+nav) | `npx vitest run services.leader-analytics.unit.test.ts server-actions.leader-analytics.test.ts components.leader-analytics.test.tsx pages.leader-analytics.test.tsx featureFlags.test.ts navigation.cabinet.leader.test.ts` | 6 файлов, **97/97 passed** |
| `npm run typecheck` | — | чисто, 0 ошибок |
| `npx eslint src/__tests__/services.leader-analytics.idor.integration.test.ts --max-warnings=0` | — | чисто, без предупреждений |

**Не запускалось в этой сессии (осознанно, per задание) — остаётся на контроллере при финализации ветки:**
- `npm run test:coverage` (полный unit+integration прогон с coverage-инструментацией, 100%-порог на затронутых glob'ах — требует отдельного продолжительного прогона против живого Postgres);
- `npm run build` (финальный pre-release чек);
- живой browser smoke на `/leader/analytics` — **флаг `leader_analytics` opt-in и по умолчанию OFF**; чтобы увидеть страницу, контроллеру нужно явно включить `FEATURE_LEADER_ANALYTICS=1` (или соответствующую env-переменную по конвенции `featureFlags.ts`) перед dev-сервером/сидом.

## Коммиты серии (M3, `a900111`..HEAD)

```
ce76349 feat(m3): SalesTarget schema + leader_analytics flag (3 gate points)
6c8c982 feat(m3): leader analytics service (funnel cohort + plan/fact + sales targets)
5346fd9 feat(m3): /leader/analytics page (month picker, funnel panel, plan/fact table)
```

Task 4 коммитится поверх `5346fd9` как `test(m3): cross-company isolation + net-fact integration regressions; M3 close-out`.

---

**Следующий шаг:** контроллер прогоняет `npm run test:coverage` + `npm run build` + живой browser smoke (с `leader_analytics=1`), затем решает про merge/PR (см. `superpowers:finishing-a-development-branch`).
