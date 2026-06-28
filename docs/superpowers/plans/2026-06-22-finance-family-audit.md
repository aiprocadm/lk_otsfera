# План — аудит + ремедиация семейства «Финансы» (Track D, SP2)

Spec: `docs/superpowers/specs/2026-06-22-finance-family-audit-design.md`
Findings: `docs/superpowers/specs/2026-06-22-finance-family-audit-FINDINGS.md`

Принцип скоупа (как SP1): в одном проходе — аудит + ремедиация находок, которые являются прямым
продолжением **уже ратифицированного канона** Заказов (R1/R3/F2) либо однозначные correctness-баги.
Judgment-call находки (DF4 общий PaymentsTable, DF8 empty-state, подтверждение approve) — в «Открытых
решениях для владельца», в код не вносим.

## Задачи

- [x] **A1 — FINDINGS + spec** (audit-доки по шаблону SP1).
- [x] **DF1 — заголовки**: `font-semibold text-[#111111]` + обёртка-`<div>` + `mt-0.5` + контейнер
  `space-y-6` во всех 5 ролях (partner/admin были `font-bold`; admin `space-y-5`; manager/leader без
  обёртки; org `mt-1`).
- [x] **DF2 — форматтеры**: удалить локальные `fmtMoney`/`fmtDate` в `manager-finance-payments`,
  `org-finance-payments`, `org-finance-kpis`, `org-finance-commission`, `partner/finance/page`; импорт из
  `@/lib/format` (попутно фикс TZ — `Europe/Moscow`).
- [x] **DF3 — basePath**: `ManagerFinancePayments` + `ManagerFinanceView` принимают `basePath`/
  `ordersBasePath` (дефолт `/manager`); страницы передают manager→`/manager`, leader→`/leader`,
  admin→`/admin`. Чинит мёртвую ссылку платёж→заказ у admin.
- [x] **DF7 — `?org=`**: `OrgFinancePayments` принимает `orgId`, ссылка несёт `?org=${orgId}`.
- [x] **DF5 — toast**: approve-ошибка `alert()` → `toast.error`; success → `toast.success`.
- [x] **DF6 — pluralizeRu**: ручной `'заказ'/'заказов'` → `pluralizeRu`.
- [x] **Тесты**: +4 кейса (basePath admin/leader, проброс через View, `?org=`) + `import React` в
  `org-finance-payments` (попадает под renderToString). Targeted 13/13 зелёные.
- [ ] **Гейты**: typecheck ✅ · lint ✅ · test:unit (в процессе) · build (после unit).
- [ ] **Close-out** `-DONE.md` после зелёных гейтов.

## Открытые решения для владельца (НЕ реализуем без ратификации)

DF4 (общий презентационный `PaymentsTable`, sibling-vs-shared §4), DF8 (empty-state nested-context),
подтверждение approve (`Dialog`), подтверждение текстов подзаголовков. См. FINDINGS §«Открытые решения».
