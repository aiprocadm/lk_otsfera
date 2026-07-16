# Spec: M3 — Аналитика руководителя: воронка-конверсия + план/факт по менеджеру

**Дата:** 2026-07-16
**Источник:** программа CRM-паритет (брейнсторм 2026-07-14, [память crm-parity-program]): «руководитель видит воронку конверсии и план/факт по каждому менеджеру» — явный запрос владельца. Модуль **M3** (M1 ✅ PR #201/#204, M2 ✅ PR #202 — оба в `main`).
**Статус:** design — **автономный запуск по прямому заданию владельца** («Сделай запланированный M3. Принимай решения сам»); решения зафиксированы ниже без промежуточного согласования.
**Предпосылка:** ветка `claude/m3-analytics` от `origin/main` (`a900111`), в котором уже есть M1 (лента активности) и M2 (контакты).

---

## 0. Решения этой сессии (приняты автономно, по мандату владельца)

1. **Одна новая страница `/leader/analytics`** в существующем кабинете руководителя — две секции: «Воронка» (конверсия) и «План/факт» (по менеджерам). Manager-кабинет не трогаем (запрос владельца был «руководитель видит»).
2. **Новый opt-in флаг `leader_analytics`** по канону дома (§5): сабфичи leader-кабинета получают свои флаги (`sales_funnel`, `internal_tasks`, `role_constructor`, `enrollment_requests` — прецеденты). Три точки: middleware `FEATURE_PREFIXES` (`/leader/analytics`), nav `flag:`, page `notFoundIfDisabled`.
3. **Конверсия — когортная, без таблицы переходов.** Отдельной таблицы истории переходов лида нет (проверено: только `AuditLog` c 4 action'ами lifecycle). v1 считает по **текущему статусу когорты** (лиды, созданные в выбранный месяц): создано / передано в работу (promoted) / отказ / в работе + конверсия % + средние дни до передачи (по `promotedOrder.createdAt − lead.createdAt`). «Достигал ли лид стадии X» без event-log не вычислить честно — не выдумываем. Реконструкция по `AuditLog` — сознательный follow-up.
4. **Снапшот воронки** (как есть сейчас, без периода): нетерминальные стадии (`resolveFunnelStages` + `stageForLead`) → count + сумма `estimatedAmount` по стадии.
5. **План = новая модель `SalesTarget`** (месячный денежный план на менеджера, company-scoped, `@@unique([companyId, managerId, year, month])`). Руководитель задаёт/правит цель инлайн на странице. Очистка значения = удаление строки.
6. **Факт = нетто-оплаты месяца** (`Payment.paidAt` в границах месяца, `isRefund` вычитается) по заказам компании, сгруппированные по `Order.managerId`; плюс счётчик завершённых заказов (`completedAt` в месяце). Заказы с `managerId=null` — отдельная строка «Без менеджера» (в итог входят, к менеджеру не приписываются — честность важнее красоты).
7. **Период — один пикер месяца** (`?month=YYYY-MM`, `<input type="month">`, GET-форма без JS): управляет и когортой воронки, и план/фактом. Дефолт — текущий месяц. Месячные границы — `[1-е число 00:00 локали сервера, 1-е число следующего месяца)`; отдельного date-util модуля в репо нет — заводим минимальный хелпер в сервисе (не общий модуль — YAGNI до второго потребителя).
8. **Скоуп воронки — как у `/leader/funnel` + частичное C8-сужение.** У `Lead` нет `companyId` (общая очередь — проверено по схеме). Когорта фильтруется: `assignedManagerId=null` OR `assignedManager.companyId = session.companyId` — чужие (другой компании) назначенные лиды не учитываются. Полная company-принадлежность лида — вне M3 (архитектурное решение уровня схемы).
9. **PII-журнал не требуется**: страница показывает агрегаты и имена сотрудников (staff-контур), не ПДн физлиц клиентского контура — зеркало прецедента `leaderDashboard`/`/leader/team` (без `recordPiiAccess`). Клиентских имён/контактов на странице нет.
10. **Admin-зеркало** `/admin/analytics` — вне объёма (как в M1), follow-up.

---

## 1. Контекст (как есть, сверено разведкой по коду)

- **Leader-кабинет**: layout (`src/app/leader/layout.tsx`) = `isFeatureEnabled('leader_cabinet') → notFound()` + `requireManagerLeader()` (`src/lib/auth/requireRole.ts:96`); страницы дополнительно сами вызывают гард и свои `notFoundIfDisabled` (см. `funnel/page.tsx`). Nav — `navByRole['leader']` в [cabinet.ts](../../../src/lib/navigation/cabinet.ts); middleware — `FEATURE_PREFIXES` в [middleware.ts](../../../src/middleware.ts) (`/leader`→`leader_cabinet` + точечные сабпрефиксы).
- **`leaderDashboard`** ([leader/dashboard.ts](../../../src/lib/services/leader/dashboard.ts)) — прецедент агрегатора: roster-driven `perManager` через `listCompanyManagers(prisma, companyId)`, `groupBy(['managerId'])`, Decimal-safe суммирование, деньги наружу строками. Периодов нет.
- **Воронка**: `getFunnelBoard` ([funnel/board.ts](../../../src/lib/services/funnel/board.ts)) — только раскладка лидов по стадиям, конверсии нигде нет. Стадии — `resolveFunnelStages`/`DEFAULT_FUNNEL_STAGES`/`stageForLead` ([lib/funnel/stages.ts](../../../src/lib/funnel/stages.ts)); `FunnelStage` — company-scoped словарь, `default:*` — синтетика.
- **Lifecycle лида** ([leadLifecycle.ts](../../../src/lib/services/manager/leadLifecycle.ts)): `assignLead`/`setLeadStatus`/`promoteLead`/`rejectLead`, каждый пишет `AuditLog` (`lead_assigned|lead_status_changed|lead_promoted_to_order|lead_rejected`). Таблицы переходов нет. `Lead.companyId` **нет**.
- **Периодизация**: канон — явные `from/to` + `searchParams` GET-форма (`admin/commission-statements/page.tsx`); month-хелперов в репо нет.
- **M2** добавил `Contact`/`ContactChannel` и `User.internalPhone` — для M3 не требуются.
- Деньги: `Decimal(14,2)`, наружу — строки; `fmtMoney` в [lib/format.ts](../../../src/lib/format.ts).

## 2. Решения (дизайн)

### 2.1. Модель данных — одна аддитивная таблица

```prisma
/// M3: месячный план продаж менеджера (деньги, нетто-оплаты). Задаёт руководитель.
/// Company-scoped (C8). Очистка плана = удаление строки (нет "нулевых" планов).
model SalesTarget {
  id           String   @id @default(cuid())
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  companyId    String
  company      Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  managerId    String
  manager      User     @relation("SalesTargetManager", fields: [managerId], references: [id], onDelete: Cascade)
  year         Int
  month        Int      // 1..12
  targetAmount Decimal  @db.Decimal(14, 2)
  createdById  String?  // кто задал (аудит-денорм; полный трейл в AuditLog)

  @@unique([companyId, managerId, year, month])
  @@index([companyId, year, month])
}
```
`Company.salesTargets`, `User.salesTargets @relation("SalesTargetManager")` — back-relations. Миграция аддитивна/обратима.

### 2.2. Сервис `src/lib/services/leader/analytics.ts`

Все функции — Result-контракт §3, узкие селекты, Decimal-safe суммирование (наружу строки).

1. **`getFunnelAnalytics(prisma, session, { from, to })`** →
   `{ ok: true; snapshot: StageSnapshot[]; cohort: CohortStats; perManager: ManagerFunnelRow[] } | { ok: false; error: 'forbidden' }`
   - Гард: staff-гейт как в `getFunnelBoard` + `session.companyId` обязателен (null → `forbidden`).
   - `snapshot`: нетерминальные стадии `resolveFunnelStages(companyId)`; лиды `status in (new,in_review,qualified)` со скоупом §0.8, разложенные `stageForLead` → `{ stageId, name, color, count, estimatedSum: string }`.
   - `cohort` (лиды `createdAt ∈ [from,to)` со скоупом §0.8): `{ total, promoted, rejected, inWork, conversionPct, rejectedPct, avgDaysToPromote: number|null, estimatedTotal: string, promotedEstimated: string }`. `avgDaysToPromote` — по `promotedOrder.createdAt − lead.createdAt` (селект relation), null если promoted=0.
   - `perManager`: roster `listCompanyManagers` + строка «Без менеджера»: `{ managerId|null, name, assigned, promoted, rejected, conversionPct }` (по когорте).
2. **`getPlanFact(prisma, session, { year, month })`** →
   `{ ok: true; rows: PlanFactRow[]; totals: PlanFactTotals } | { ok: false; error: 'forbidden' | 'invalid_period' }`
   - Гард: `session.companyId` обязателен; `year/month` валидируются (2000≤y≤2100, 1≤m≤12 → иначе `invalid_period`).
   - Факт: `payment.findMany({ where: { paidAt: { gte, lt }, order: { companyId } }, select: { amount, isRefund, order: { select: { managerId } } } })` → in-memory Decimal-агрегация по `managerId` (объём: оплаты компании за месяц — сотни строк, приемлемо и честно против невозможного relation-groupBy).
   - Завершённые: `order.groupBy(by:['managerId'], where:{ companyId, completedAt:{gte,lt} }, _count)`.
   - Планы: `salesTarget.findMany({ where: { companyId, year, month } })`.
   - `rows` — roster-driven (`listCompanyManagers`) + «Без менеджера» (если есть факт): `{ managerId|null, name, email, target: string|null, fact: string, completedOrders, executionPct: number|null }`; `totals`: `{ target, fact, executionPct }`.
3. **`upsertSalesTarget(prisma, session, { managerId, year, month, targetAmount: string|null })`** →
   `{ ok: true } | { ok: false; error: 'forbidden' | 'not_found' | 'invalid' | 'invalid_period' }`
   - Гард **в сервисе** (defense-in-depth §4, поверх page/action-гардов): `session.role === 'manager' && session.managerRole === 'leader'` или `admin`; `session.companyId` обязателен.
   - Целевой менеджер: `user.findUnique` → должен существовать, `role='manager'`, `companyId === session.companyId` (иначе `not_found`/`forbidden` — кросс-компания невозможна).
   - `targetAmount`: строка → Decimal, `> 0`, ≤ 10^12 (иначе `invalid`); `null` → `deleteMany` (идемпотентно).
   - Запись: `upsert` по unique-ключу; `recordAudit({ action: 'sales_target_set' | 'sales_target_cleared', entity: 'user', entityId: managerId, meta: { year, month, targetAmount } })` — entity `'user'` (объект плана — менеджер; расширение `AuditEntity` не требуется).

Хелпер месяца (локальный в сервисе): `monthRange(year, month) → { from, to }` (1-е 00:00 — 1-е следующего).

### 2.3. Server-actions `src/server-actions/leader/analytics.ts`

`upsertSalesTargetAction(args)` — `'use server'`; `notFoundIfDisabled('leader_analytics')` → `requireManagerLeader()` → делегат в сервис (тонкий адаптер, зеркало M1 `deal-activity.ts`).

### 2.4. Флаг и разводка (§5, три точки)

`leader_analytics` в `FEATURE_FLAGS` + `OPT_IN_FLAGS`; middleware `FEATURE_PREFIXES` += `{ prefix: '/leader/analytics', flag: 'leader_analytics' }`; nav `navByRole['leader']` += `{ href: '/leader/analytics', label: 'Аналитика', icon: '📊', flag: 'leader_analytics' }` (после «Воронка»); page — `notFoundIfDisabled`-семантика через `isFeatureEnabled → notFound()` (зеркало `funnel/page.tsx`).

### 2.5. UI

- **Страница** `src/app/leader/analytics/page.tsx` (server component, `force-dynamic`, зеркало `leader/funnel/page.tsx`): гард флага + `requireManagerLeader()`; парс `?month=YYYY-MM` (невалидный/отсутствующий → текущий месяц); `Promise.all(getFunnelAnalytics, getPlanFact)`; рендер.
- **Компоненты** `src/components/leader/analytics/` (leader-специфичные, sibling-rule §4):
  - `month-picker.tsx` — GET-форма `<input type="month" name="month">` + submit (сервер-рендер, без JS);
  - `funnel-analytics-panel.tsx` — презентационный: KPI-плитки когорты (создано/передано/отказ/конверсия/ср. дни), снапшот стадий (count + сумма, полоса-бар шириной от max), таблица per-manager;
  - `plan-fact-table.tsx` — `'use client'`: таблица план/факт по менеджерам; инлайн-редактирование плана (Input + сохранить через `useFormAction` → `upsertSalesTargetAction`, `refresh: true`, `toast`); итоговая строка.
- Примитивы `ui/`, деньги `fmtMoney`, без инлайн brand-hex (§13); русские строки.

### 2.6. Явно вне объёма (follow-ups)

Таблица переходов лида (event-log) и «настоящая» stage-conversion; тренды/графики по месяцам; экспорт XLSX (T7-трек); admin-зеркало; план по количеству лидов/заказов (v1 — только деньги); нотификации о выполнении плана; `Lead.companyId` (архитектурный пробел общей очереди).

## 3. Инварианты приёмки

- Руководитель на `/leader/analytics` видит: когорту месяца (создано/передано/отказ/в работе, конверсия %, ср. дни до передачи), снапшот открытых стадий, план/факт по каждому менеджеру компании (+ «Без менеджера», + итог) за выбранный месяц; пикер месяца меняет обе секции.
- План: задаётся/правится/чистится инлайн; **upsert идемпотентен** (unique-ключ); кросс-компания невозможна (менеджер чужой компании → `forbidden`/`not_found` — integration-тест); аудит пишется.
- Факт: нетто (возвраты вычитаются), только оплаты заказов своей компании, месячные границы `[1-е, 1-е)` — граничные оплаты не двоятся между месяцами (unit-тест на границу).
- Скоуп воронки: чужие назначенные лиды (менеджер другой компании) не попадают в когорту/снапшот (integration-тест).
- Флаг `leader_analytics=off` → 404 на роуте (middleware) + пункт меню скрыт + страница `notFound()`; `manager` без `managerRole='leader'` → redirect `/forbidden` (существующий гард).
- Result-контракт §3; деньги наружу строками; `typecheck`/`lint`/`test`/`gate` зелёные; **100% coverage** на новых файлах; миграция аддитивна; `prisma migrate status` чист.

## 4. Открытые вопросы

Нет блокирующих. Зафиксированное допущение: «факт» = деньги по `Payment.paidAt` (кассовый метод), не по начислению (`Order.totalAmount`) — выбран кассовый как более честный для план/факта продаж; если владелец захочет метод начисления — это параметр сервиса, не перестройка.
