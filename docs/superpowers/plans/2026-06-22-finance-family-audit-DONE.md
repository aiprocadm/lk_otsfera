# Close-out — аудит + ремедиация семейства «Финансы» (Track D, SP2)

Что планировали — см. `2026-06-22-finance-family-audit.md`. Здесь — что отгружено.

## Отгружено

**Аудит** (`docs/superpowers/specs/2026-06-22-finance-family-audit-{design,FINDINGS}.md`): таблица 6 осей × 5
ролей + находки DF1–DF8 + «Открытые решения для владельца». Семейство «Финансы» структурно делится надвое:
партнёр = комиссионные отчёты (заработок, PDF/XLSX, ручной расчёт); org/manager/leader/admin = журнал
платежей + KPI задолженности + (leader/admin) оценка комиссии посредника. Это намеренное доменное
расхождение, не баг.

**Ремедиация** (ратификационно-безопасное подмножество — продолжение канона Заказов R1/R3/F2 + correctness):
- **DF1** заголовки: `font-semibold text-[#111111]` + обёртка-`<div>` + `mt-0.5` + контейнер `space-y-6` во
  всех 5 ролях (partner/admin были `font-bold`; admin `space-y-5`; manager/leader без обёртки; org `mt-1`).
- **DF2** форматтеры: 5 локальных копий `fmtMoney`/`fmtDate` → импорт из `@/lib/format` (попутно фикс
  TZ-нестабильности — локальные `fmtDate` были без `Europe/Moscow`).
- **DF3 (P1 у admin)** basePath: `ManagerFinancePayments`/`ManagerFinanceView` принимают
  `basePath`/`ordersBasePath` (дефолт `/manager`); страницы передают manager→`/manager`, leader→`/leader`,
  admin→`/admin`. Чинит **мёртвую** ссылку платёж→заказ у admin (Model A режет `/manager`) и выход из
  кабинета у leader.
- **DF7** org-ссылка платёж→заказ несёт `?org=${orgId}` (без неё мульти-орг участник попадал в `notFound`).
- **DF5** approve-ошибка `alert()` → `toast.error`/`toast.success`.
- **DF6** ручной плюрализатор → `pluralizeRu` («2 заказа», не «2 заказов»).

**Тесты:** +4 кейса (`basePath` admin/leader, проброс через `ManagerFinanceView`, `?org=`) + `import React`
в `org-finance-payments` (впервые под renderToString). `components.manager-finance.test.tsx` 13/13.

## Верификация

typecheck ✅ · lint ✅ (0 warnings) · test:unit **277 файлов / 3037 тестов** ✅ (3 skipped) · build ✅.
e2e:visual — operator-deferred (разметка эквивалентна канону Заказов; baseline меняться не должны, кроме
заголовков финэкранов — обновить при следующем визпрогоне).

## Не делалось (ждёт ратификации владельца)

DF4 (общий `PaymentsTable`, sibling-vs-shared §4 — `OrgPaymentRow` доменный, не agnostic),
DF8 (empty-state nested-context), `Dialog`-подтверждение approve, финальное утверждение текстов подзаголовков.

## Остаток Track D

Семейства **Документы / Сообщения / Команда / Заявки на обучение** — отдельные подпроекты (SP3+).
