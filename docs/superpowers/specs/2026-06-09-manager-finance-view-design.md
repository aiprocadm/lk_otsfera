# Витрина оплат менеджера (C-a) — Design / Spec

> **Roadmap:** под-проект 2 декомпозиции 1С-file-import (см. [2026-06-09-1c-file-import-design.md](2026-06-09-1c-file-import-design.md) §«Не входит»). Открытый пункт **C-a**. Под-проект 1 (импорт) отгружен в `main` через PR #104.

**Цель.** Дать менеджеру/руководителю кабинет с витриной **реальных оплат** (заведённых импортом из 1С), сгруппированных по его организациям, плюс гейтированный блок «проценты посредника». Зеркало для админа — `/admin/finance`.

**Почему сейчас.** PR #104 сделал `Payment` org-level (`organizationId` required, `orderId` nullable) и переключил 4 read-сайта на org-scope. Оплаты уже втекают в org/partner-кабинеты. Менеджер — единственная роль, у которой нет финансовой витрины; C-a закрывает этот пробел, переиспользуя уже готовый org-finance сервис.

---

## Решения (из брейнсторма 2026-06-09)

| Вопрос | Решение |
|---|---|
| Кто видит блок комиссии | **Руководитель (`managerRole='leader'`) + админ.** Рядовой менеджер — только оплаты. |
| Объём витрины | **KPI + реестр оплат + гейт-комиссия** (полное зеркало org `/finance`). |
| Агрегация | **Сгруппировано по организациям** — секция на орг + сводный KPI-итог сверху. |
| Admin-зеркало | **Включаем `/admin/finance`** (unscoped, всегда с комиссией) — пара к `/manager/finance`, как `/admin/import`+`/manager/import`. Админ **и руководитель** видят все комиссии. |

---

## Архитектура

### Маршруты
- `src/app/manager/finance/page.tsx` — `requireManager()`; scoped через `managerOrgScope`.
- `src/app/admin/finance/page.tsx` — `requireAdmin()`; unscoped (все орг), комиссия всегда видна.

Middleware уже гейтит `/manager/*` и `/admin/*` через `protectedPrefixes` ([src/lib/auth/access.ts](../../src/lib/auth/access.ts)) — **изменений в middleware нет**.

### Сервис — тонкий агрегатор поверх org-finance
`src/lib/services/manager/finance.ts`, одна публичная функция:

```ts
getManagerFinanceOverview(
  prisma: PrismaClient,
  session: SessionPayload,
  opts: { teamMode: boolean; unscoped?: boolean }
): Promise<ManagerFinanceOverview>
```

Шаги:
1. **Резолв орг в scope.** `unscoped` (админ) → все организации. Иначе `managerOrgScope(session, teamMode)`: OFF → `managedOrgIds`, ON (C8 `managerTeamVisibility`) → `companyId`. `teamMode` читается **свежим** через `getCompanyTeamVisibility(prisma, session.companyId)` на странице и передаётся внутрь.
2. **Сборка секций — переиспользование org-finance.** Для каждой in-scope орг параллельно (`Promise.all`) вызвать существующие [organization/finance.ts](../../src/lib/services/organization/finance.ts):
   - `getOrgFinanceKpis(prisma, orgId)` → KPI секции;
   - `listOrgPayments(prisma, { organizationId: orgId })` → реестр оплат секции (включая org-level оплаты с `orderId: null`);
   - **только при `canSeeCommission`** → `getOrgIntermediaryCommission(prisma, orgId)`; иначе `null` (field-level гейт — запрос маржи не выполняется вовсе).
3. **Сводный итог.** `summary` = сумма `billed`/`paid` по секциям; `outstanding = billed − paid`.

> **Гейт комиссии — внутри сервиса (§4 defense-in-depth), не только на странице.** `canSeeCommission = opts.unscoped || isManagerLeader(session)`. Рядовой менеджер физически не дотягивается до `getOrgIntermediaryCommission` — данные о марже не покидают сервер. Страница дополнительно не рендерит блок, если `commission === null` (belt-and-suspenders).

> **N-запросов trade-off (осознанно).** Переиспользование org-функций даёт ~2–3 запроса на орг. Распараллелено через `Promise.all` → латентность по худшему, не по сумме. Для типичного менеджера (единицы орг) приемлемо; батч-оптимизация (один проход заказов по scope) отложена до появления крупных команд. Выбор в пользу DRY + переиспользования уже покрытого тестами кода.

### Возврат (plain data — mirror org-finance reads, не Result)
```ts
export type ManagerOrgFinanceSection = {
  orgId: string;
  orgName: string;
  kpis: OrgFinanceKpis;                       // { billed, paid, outstanding } (строки)
  payments: OrgPaymentRow[];                  // переиспользуем тип из organization/finance
  commission: OrgIntermediaryCommission | null; // null, если не лидер/админ
};
export type ManagerFinanceOverview = {
  summary: OrgFinanceKpis;                     // агрегат по scope
  sections: ManagerOrgFinanceSection[];
  canSeeCommission: boolean;                   // для условного рендера/подписи
};
```

Типы `OrgFinanceKpis`/`OrgPaymentRow`/`OrgIntermediaryCommission` **импортируются** из `organization/finance.ts` (они роль-агностичны по сути — финансовые DTO, не org-специфика поведения).

### UI
- **Страница** (server component): сводные KPI-карточки → секция на организацию (имя + мини-KPI + таблица оплат + блок комиссии при `!= null`). Пустой scope → «нет организаций / оплат».
- **Переиспользование презентационных компонентов (§4 исключение «строго презентационный + domain-agnostic тип»):** `OrgFinanceKpisGrid`, `OrgFinancePayments`, `OrgFinanceCommission` — чистые таблицы/карточки над финансовыми DTO. Новый код — только тонкая обёртка `src/components/manager/manager-finance-overview.tsx` (рендер `summary` + `map` секций) + сами страницы.
  - **Fallback:** если при импл prop-типы окажутся org-связаны (например, требуют org-контекст внутри), создать `manager-finance-*` сиблинги. По умолчанию — переиспользование.
- Локализация — русский; палитра §13 (оранжевая). Подпись блока комиссии — «видно только руководству».

---

## RBAC — defense-in-depth (3 точки)

1. **Middleware** — `/manager/*`, `/admin/*` уже в `protectedPrefixes` (без изменений).
2. **Page** — `requireManager()` (manager-страница) / `requireAdmin()` (admin-страница). Любой менеджер открывает страницу; комиссия гейтится тоньше.
3. **Service** — `managerOrgScope(session, teamMode)` фильтрует орг; гейт комиссии (`isManagerLeader || unscoped`) внутри сервиса.

**Cross-company изоляция** наследуется из `managerOrgScope`: OFF → `managedOrgIds` (только свои), ON → `{ companyId }` (своя компания). Менеджер компании B никогда не видит орг/оплаты компании A — инвариант держится в **обоих** режимах (регрессионный integration-тест ниже).

**`teamMode`-аргумент обязателен.** Пропуск = молча scoped (typecheck не ловит — CLAUDE.md §4). Страница читает флаг свежим и прокидывает.

---

## Навигация и флаги

- `src/lib/navigation/cabinet.ts` → `navByRole.manager`: пункт `{ href: '/manager/finance', label: 'Финансы', flag: 'manager_cabinet' }`.
- `navByRole.admin`: зеркальный пункт `{ href: '/admin/finance', label: 'Финансы' }` (admin-кабинет без флага — internal).
- **Без нового feature-флага** — переиспользуем `manager_cabinet` (opt-in, staged rollout). Страница/сервис гейта флага не требуют сверх существующего `manager_cabinet`-гейтинга кабинета.

---

## Read-path (готов из #104)

`Payment` уже org-level; `listOrgPayments` уже читает `where: { organizationId }` и возвращает `orderId: string | null`. **Новых правок read-path нет** — C-a только агрегирует существующее чтение по scope. Org-level оплаты (`orderId: null`) всплывают автоматически.

---

## Тест-стратегия (§6)

**Unit** (без Postgres, мокаем org-finance функции / prisma):
- scope: рядовой менеджер → секции только по `managedOrgIds`; лидер при `teamMode=ON` → секции по всей компании; админ (`unscoped`) → все орг.
- гейт комиссии: рядовой менеджер → каждая `section.commission === null` **и** `getOrgIntermediaryCommission` не вызывается (проверка через мок-spy); лидер/админ → `commission != null`.
- агрегация: `summary.billed/paid/outstanding` = корректная сумма по секциям; группировка оплат по orgId.
- пустой scope → `sections: []`, `summary` нули.

**Integration** (живой PG, `new PrismaClient(` → авто-integration, §6):
- **cross-company инвариант**: менеджер компании B с `teamMode=ON` получает **пустые** секции для орг компании A (write-scope ≠ read-visibility — тот же инвариант, что в импорте).
- org-level оплата (`orderId: null`, привязана к орг менеджера) присутствует в `section.payments`.
- лидер видит `commission` с корректным `effectiveRate` (org override ?? partner default).

**Component** (`import React` — [project-vitest-classic-jsx]):
- `manager-finance-overview` рендерит сводку + N секций; блок комиссии отсутствует, когда `commission === null`.

**Manual** перед merge: `npm run dev`, зайти `/manager/finance` рядовым менеджером (нет комиссии) и руководителем (комиссия есть) на seed-данных; `/admin/finance` админом.

---

## Не входит (YAGNI / отдельно)

- Экспорт витрины (xlsx/pdf) — отдельно при необходимости.
- Фильтры по периоду/методу/орг, пагинация ленты оплат сверх `take` — позже, когда появятся объёмы.
- Правка ставок комиссии из этой страницы — остаётся в org/admin управлении ставками.
- Привязка оплаты к заказу (парсинг назначения) — отвергнута ещё в под-проекте 1.
- Боевой REST-адаптер 1С (Трек A) — отдельный трек.

---

## Открытые пункты (к началу реализации)

1. **Переиспользование vs сиблинги компонентов** — дефолт: переиспользовать 3 презентационных org-finance компонента. Решается при первом рендере: если prop-тип потянет org-контекст — сделать `manager-finance-*`. Blast radius = обёртка + страницы.
2. **Батч-оптимизация комиссии** — если у руководителя в `teamMode` десятки орг, заменить per-org `getOrgIntermediaryCommission` на один проход заказов по scope. Не делать преждевременно; зафиксировать порог при ревью.
