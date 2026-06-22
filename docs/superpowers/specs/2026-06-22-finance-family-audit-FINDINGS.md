# Findings — семейство «Финансы» (аудит 2026-06-22)

Источник методологии: `docs/superpowers/specs/2026-06-22-finance-family-audit-design.md`.
Severity: P1 ломает флоу / P2 заметная несогласованность / P3 косметика / INTENTIONAL намеренное ролевое различие.

Префикс находок — `DF` (Document/Finance? нет — **D**=Track D, **F**=Finance). DF1…DF8.

---

## Таблица «ось × роль»

| # | Ось | partner | organization | manager | leader | admin | Severity | Канон |
|---|-----|---------|--------------|---------|--------|-------|----------|-------|
| 1 | Навигация (платёж → заказ) | n/a (нет журнала платежей; у партнёра — отчёты) | `OrgFinancePayments` → `/organization/orders/${id}` **без `?org=`** | `ManagerFinancePayments` → `/manager/orders/${id}` | то же (shared) → `/manager/orders/${id}` (своего `basePath` нет, хотя `/leader/orders/[id]` существует) | то же → `/manager/orders/${id}` — **мёртвая ссылка** (Model A режет admin из `/manager`) | **P1 (admin)** / P2 (leader/org) | per-role `basePath`; org-ссылка несёт `?org=` |
| 2 | Доступность действий | отчёты read-only + (partner-admin) «Сформировать за период» (`ManualCalcForm`) + (partner-admin) «Утвердить» draft | read-only | read-only | read-only + видит блок комиссии | read-only + видит комиссию + unscoped | INTENTIONAL | действия только у партнёра — это его домен |
| 3 | Обратная связь | `ManualCalcForm`: `useFetchSubmit` + `Dialog error` (канон Tier-2) ✅; **approve: сырой `alert('Ошибка…' + status)`** ⚠️ | n/a | n/a | n/a | n/a | P2 (approve) | toast вместо `alert`; success-toast |
| 4 | Состояния empty/loading | empty: statements `EmptyState icon='📊'`; items-загрузка через `useClientResource` («Загружаю…») | empty: payments `EmptyState icon='💸'` | empty: payments `EmptyState` **без иконки, `p-8`**; no-orgs — кастомный блок (не `EmptyState`) | то же (shared) | то же | P3 | empty-state иконка/паддинг — см. DF8 (nested-context оправдывает разницу) |
| 5 | Подтверждения (Dialog) | approve draft → **без подтверждения** (мгновенный PATCH) | n/a | n/a | n/a | n/a | P3 | approve — обратимо (draft→approved), подтверждение опционально; решение владельца |
| 6 | Кросс-ролевая консистентность (заголовок/обёртка) | H1 `font-**bold**`; обёртка `space-y-6`; подзаг `mt-0.5` | H1 `font-semibold`; `space-y-6`; подзаг `mt-1` | H1 `font-semibold`; **нет обёртки-div**, `mb-1`/`mb-6`; нет `space-y` | то же что manager | H1 `font-**bold**`; обёртка **`space-y-5`**; подзаг `mt-0.5` | **P2** | `font-semibold text-[#111111]` + обёртка-div + подзаг `mt-0.5` + контейнер `space-y-6` (канон R1) |

Дополнительно (ось «форматтеры»): `fmtMoney`/`fmtDate` **дублируются локально** в 4 финкомпонентах и
partner-странице, хотя каноничные есть в `src/lib/format.ts` (их уже используют `manager-finance-view`
и `commission-statements-list`). Локальные `fmtDate` к тому же **без `timeZone:'Europe/Moscow'`** → вывод
зависит от TZ сервера/CI (то, что `lib/format` намеренно чинит). См. DF2.

---

## Подтверждённые находки

### DF1 — Заголовки расходятся (font-weight / обёртка / отступы) — P2

`partner` и `admin` используют `text-2xl font-bold`; `organization`/`manager`/`leader` — `font-semibold`.
Дополнительно: admin-обёртка `space-y-5` (остальные `space-y-6`); manager/leader не оборачивают
заголовок в `<div>` (используют `mb-1`/`mb-6` напрямую, нет общего `space-y` контейнера); org-подзаголовок
`mt-1` против `mt-0.5` у остальных.

**Канон (= R1 Заказов, уже ратифицирован):** во всех 5 ролях
`<h1 className='text-2xl font-semibold text-[#111111]'>Финансы</h1>` +
`<p className='text-sm text-gray-500 mt-0.5'>{подзаголовок}</p>`, заголовок в `<div>`, контейнер страницы
`space-y-6`. Тексты подзаголовков — role-scoped, без изменений.
→ **Чиним в этом проходе** (продолжение ратифицированного канона).

### DF2 — Дублирование `fmtMoney`/`fmtDate` по финкомпонентам — P2 (+TZ-корректность)

Локальные копии в: `manager-finance-payments.tsx`, `org-finance-payments.tsx`, `org-finance-kpis.tsx`,
`org-finance-commission.tsx`, и `partner/finance/page.tsx` (`fmtMoney(amount:number)`). Каноничные
`fmtMoney(number|string)` и `fmtDate(Date|string)` живут в `src/lib/format.ts`. Локальные `fmtDate` не
ставят `timeZone:'Europe/Moscow'` → нестабильны по TZ.

**Канон (= F2 Заказов):** импортировать из `@/lib/format`, удалить локальные. → **Чиним в этом проходе.**

### DF3 — Ссылка платёж→заказ хардкодит `/manager` → мёртвая у admin — P1 (admin) / P2 (leader)

`ManagerFinancePayments` рендерит `<Link href={`/manager/orders/${orderId}`}>`. Компонент общий для
manager/leader/admin (через `ManagerFinanceView`). Для **admin** переход в `/manager/*` режется
middleware/page-гардом (Model A) → ссылка не открывается. Для **leader** — уводит из кабинета
(хотя `/leader/orders/[id]` уже существует, R3). Для manager — корректно.

**Канон (= R3 basePath Заказов):** `ManagerFinancePayments`/`ManagerFinanceView` принимают
`ordersBasePath?: string` (дефолт `/manager`); страницы передают: manager→`/manager`, leader→`/leader`,
admin→`/admin`. → **Чиним в этом проходе** (исправляет реальный broken-flow у admin).

### DF7 — Org-ссылка платёж→заказ теряет `?org=` — P2

`OrgFinancePayments` → `/organization/orders/${orderId}` без `?org=`. Деталь читает активную орг через
`getOrgPageContext(searchParams)`; у мульти-орг участника без `?org=` контекст разрешится в иную орг →
`getOrgOrder(activeOrgId, id)` вернёт null → `notFound()`. Org-страница заказов ссылается **с** `?org=`
(см. аудит Заказов) — внутрироле́вая несогласованность.

**Канон:** `OrgFinancePayments` принимает `orgId`, ссылка несёт `?org=${orgId}`. → **Чиним в этом проходе.**

### DF5 — approve использует `alert()` вместо toast — P2

`commission-statements-list.tsx` `handleApprove`: при ошибке `alert('Ошибка утверждения: ' + res.status)`.
Канон обратной связи (CLAUDE.md §9): toast для unexpected/network-ошибок, success-after-action.

**Канон:** `toast.error('Не удалось утвердить отчёт')` + `toast.success('Отчёт утверждён')`.
→ **Чиним в этом проходе.**

### DF6 — Ручной плюрализатор вместо `pluralizeRu` — P3

`commission-statements-list.tsx`: `{itemCount} {itemCount === 1 ? 'заказ' : 'заказов'}` → даёт «2 заказов»
вместо «2 заказа». `pluralizeRu` уже в `lib/format`.

**Канон:** `pluralizeRu(itemCount,'заказ','заказа','заказов')`. → **Чиним в этом проходе.**

---

## Открытые решения для владельца

1. **DF4 — общий презентационный `PaymentsTable`?** `ManagerFinancePayments` и `OrgFinancePayments`
   почти побайтово идентичны (различия: заголовок «История платежей», empty-state иконка, basePath,
   `?org=`). По §4 «строго презентационный + domain-agnostic тип» — `OrgPaymentRow` это финдоменный тип
   (не agnostic), поэтому извлечение в общий компонент — **judgment call** (sibling-vs-shared). В этом
   проходе оставлены sibling-копии, оба чинятся (basePath/?org=/lib-format) параллельно. Вопрос: извлекать
   ли общий `PaymentsTable(rows, basePath, orgQuery?, title?, emptyIcon?)` в следующем проходе?
2. **DF8 — empty-state платежей:** manager-версия без иконки + `p-8` (компактна, т.к. вложена в per-org
   секции), org-версия с `💸`. Оставить расхождение как оправданное вложенным контекстом или унифицировать?
3. **DF5/Подтверждение approve:** добавлять ли `Dialog`-подтверждение перед утверждением отчёта (draft→approved
   обратимо через supersede, но это денежное действие)?
4. **Подзаголовки:** подтвердить role-scoped тексты (партнёр «Комиссионные отчёты и выплаты», org «Платежи и
   задолженность по {org}», manager «Оплаты по вашим организациям», leader «Оплаты и комиссия по всем
   организациям компании», admin «Оплаты по всем организациям»).

---

## Файлы, прочитанные при аудите

Страницы: `src/app/{partner,organization,manager,leader,admin}/finance/page.tsx`.
Компоненты: `manager/manager-finance-{view,payments}.tsx`, `organization/org-finance-{kpis,payments,commission}.tsx`,
`partner/{commission-statements-list,manual-calc-form}.tsx`, `dashboard/stat-card.tsx`.
Сервисы: `services/{partner,organization,manager}/finance.ts`. Форматтеры: `lib/format.ts`.
Детальные роуты заказов (для basePath): подтверждено существование `/{admin,leader,manager,organization}/orders/[id]`, `/partner/deals/[id]`.
