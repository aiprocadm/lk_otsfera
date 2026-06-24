# 6-стадийный рабочий статус заказа (gap #5) — Close-out

**Дата:** 2026-06-24
**Ветка:** `claude/tz-gap5-order-stage` (от main)
**Spec:** [2026-06-24-tz-gap5-order-stage-design.md](../specs/2026-06-24-tz-gap5-order-stage-design.md) · **Plan:** [2026-06-24-tz-gap5-order-stage.md](2026-06-24-tz-gap5-order-stage.md)
**Память:** [[project-tz-v04-gap-program-2026-06-23]] gap #5.

## Что отгружено (§10 ТЗ)

6-стадийный рабочий статус заказа как **производный слой** (подход утверждён владельцем) — БЕЗ
смены core-enum `ExecutionStatus` и 1С-маппинга (именно поэтому пункт был отложен по риску).

- **Чистая `orderWorkingStage()`** в `lib/orders/humanStage.ts`: выводит стадию 1..6 по самой
  дальней достигнутой вехе из полей заказа (closedAt→6 «Закрыт», completed→5 «Документы»,
  in_progress→4 «Обучение», paid>0→3 «Оплата», contractSignedAt→2 «Договор», else→1 «Новая»);
  cancelled/on_hold → терминальный бейдж (index 0). Существующие `executionStage`/`paymentStage`/
  `orderStage` **не тронуты** (additive — verified diff без удалений).
- **`OrderStageStepper`** — презентационный 6-шаговый индикатор (пройдено/текущее/предстоит),
  терминал → одиночный `Badge`. Только `ui/`+Tailwind-палитра (orange-*), без инлайн-hex.
- **Метки стадий** — единая константа `WORKING_STAGE_LABELS` (одна точка правки по §10).
- **Встроено** в карточку заказа во всех 5 кабинетах: manager+leader (`manager-order-header`),
  admin (order page), organization (`org-order-header`), partner (`deal-header`). Дата-поля
  (contractSignedAt/completedAt/closedAt) уже были во всех order-DTO — расширений select не
  потребовалось.

## Гейты

- typecheck ✓ · lint ✓ (0 warnings)
- **unit: 289 файлов / 3139 passed / 3 skipped / 0 failed** (вкл. 20 тестов derivation + 6 stepper)
- NO migration / NO schema / NO 1С / NO commission изменений (только производное отображение).
- Self-verify: humanStage additive (диф без удалений); новый компонент без инлайн-hex; монотонность derivation покрыта тестами.

## Остаток / follow-up (ВАЖНО для владельца)

- **Точные названия и порядок 6 стадий §10 НЕ подтверждены** — текущие метки (`Новая / Договор /
  Оплата / Обучение / Документы / Закрыт`) и условия достижения — предложенный дефолт. Правка =
  одна точка `WORKING_STAGE_LABELS` (+ при необходимости условия в `orderWorkingStage`), **без
  миграции** (производный слой). Подтвердить при ревью §10.

## Коммиты (5)
spec/plan → orderWorkingStage derivation → OrderStageStepper → встраивание (4 поверхности) → CHANGELOG.
