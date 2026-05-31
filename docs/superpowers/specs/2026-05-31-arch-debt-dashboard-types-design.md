# Arch-debt: dashboard services own their return types (§2) — design

**Дата:** 2026-05-31
**Автор:** Claude (session-driven, brainstorming)
**Статус:** Approved (design step), pending implementation
**Related:** Трек 3 (архитектурный долг) из whole-project backlog 2026-05-30, под-проблема #1. Под-проблемы #2 (контракт ошибок) и #3 (раздутые сервисы) — **вне scope** (см. Не-цели).

## Проблема

Нарушено направление зависимостей CLAUDE.md §2 (`app → server-actions → services → lib`; сервис не импортирует из `components/`). Два dashboard-сервиса тянут свои return-типы **вверх**, из UI-слоя:

- `src/lib/services/organization/dashboard.ts:2-4` → `OrgDashboardKpis`, `OrgAttention`, `OrgAttentionItem`, `OrgEvent` из `@/components/organization/*`.
- `src/lib/services/manager/dashboard.ts:4-6` → `KpiData`, `AttentionItem`, `EventItem` из `@/components/manager/*`.

Практический вред: форма данных, которую *вычисляет* сервис, формально *определяется* в презентационном слое — косметический UI-рефактор может вынудить правку бизнес-логики.

## Цель

Развернуть стрелку: типы живут в сервисе (он их производит), компонент импортирует их **вниз**. §2 восстановлен.

## Не-цели / Out of scope (явно)

- **#2 — контракт ошибок** (`admin/users.ts`/`partner/leadAttachments.ts` бросают вместо `{ok,error}`): высокий churn/риск (меняет все вызывающие), спорная ценность (throw-со-стабильными-кодами — уже когерентный контракт). Отдельное осознанное решение, не здесь.
- **#3 — раздутые сервисы** (`notifications.ts` 632 / `admin/users.ts` 416 / `manager/dashboard.ts` 376): «раздутость» субъективна; сплит = большой diff ради спорной выгоды. Не здесь.
- **Переименование типов** — сохраняем имена (минимум churn).

## Дизайн

Для каждого из 7 типов: переместить определение `export type X = {...}` из компонента в **владеющий dashboard-сервис**, и заменить в компоненте определение на `import type { X } from '@/lib/services/<role>/dashboard'`.

| Тип | Из компонента | В сервис |
|---|---|---|
| `OrgDashboardKpis` | `components/organization/org-kpi-grid.tsx` | `services/organization/dashboard.ts` |
| `OrgAttention`, `OrgAttentionItem` | `components/organization/org-attention-list.tsx` | `services/organization/dashboard.ts` |
| `OrgEvent` | `components/organization/org-events-feed.tsx` | `services/organization/dashboard.ts` |
| `KpiData` | `components/manager/manager-kpi-grid.tsx` | `services/manager/dashboard.ts` |
| `AttentionItem` | `components/manager/manager-attention-list.tsx` | `services/manager/dashboard.ts` |
| `EventItem` | `components/manager/manager-events-feed.tsx` | `services/manager/dashboard.ts` |

**Где живут:** в файле сервиса (экспортируются). В сервисах нет `server-only`-guard, а `import type` стирается на компиляции → клиентский компонент, импортирующий тип из серверного сервиса, **не тянет рантайм** в бандл. Отдельный `dashboard-types.ts`-модуль не нужен (YAGNI).

**Churn — минимальный:** эти 7 типов импортируют **только сами сервисы** (проверено: страницы `*/dashboard/page.tsx` импортируют компоненты-функции `OrgKpiGrid`/`ManagerKpiGrid`…, а не типы). Значит правок у страниц/других вызывающих нет — ровно 2 файла на тип (определение в сервисе ↔ импорт в компоненте). Любые **type-only зависимости** переносимого определения (вложенные типы) переносятся вместе с ним.

## Tests

- `npm run typecheck` — **главный гейт**: фикс type-only, `tsc` полностью верифицирует (компилируется ⇒ корректно, рантайм не менялся).
- `npm run lint` — зелёный (в т.ч. отсутствие неиспользуемых импортов после переноса).
- Существующие dashboard-тесты зелёные: `services.manager.dashboard.test.ts` (+ org-dashboard-тест, если есть) — поведение не меняется.

## Принятые решения (по делегированию пользователя)

1. **Scope = только #1** (направление зависимостей); #2/#3 вне scope.
2. **Типы — в файле сервиса** (не отдельный модуль).
3. **Имена сохраняем** (без переименований).

## Риск

Очень низкий. Type-only перемещение без рантайм-эффекта; `tsc` ловит любую оплошность. Единственная тонкость — перенести вместе с типом его вложенные type-only зависимости (если есть); покрыто typecheck'ом.
