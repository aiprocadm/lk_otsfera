# 6-стадийный рабочий статус заказа (gap #5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** §10 ТЗ — 6-стадийная «дорожка» рабочего статуса заказа как **производный слой** (без смены core-enum), показанная в карточке заказа.

**Architecture:** Чистая `orderWorkingStage()` в `lib/orders/humanStage.ts` (выводит 1..6 из executionStatus+даты+оплаты) + презентационный `OrderStageStepper`, встроенный в order detail всех кабинетов. Spec: [2026-06-24-tz-gap5-order-stage-design.md](../specs/2026-06-24-tz-gap5-order-stage-design.md). Branch `claude/tz-gap5-order-stage` (от main). NO migration.

---

### Task 1: Производная `orderWorkingStage`
**Files:** `src/lib/orders/humanStage.ts`, test `src/__tests__/orders.workingStage.test.ts`
- [ ] TDD по spec §2/§3: типы `WorkingStageInput`/`WorkingStage`; функция выводит index 1..6 по самой дальней вехе (closedAt→6, completed&&!closed→5, in_progress→4, paid>0→3, contractSignedAt→2, else→1); cancelled/on_hold → `{index:0, terminal:true, label:'Отменён'/'На паузе'}`. Принимает Date и строку, Decimal-строку и number. НЕ трогать существующие executionStage/paymentStage/orderStage.
- [ ] Commit `feat(orders): orderWorkingStage 6-stage derivation (§10)`.

### Task 2: `OrderStageStepper` компонент
**Files:** `src/components/orders/order-stage-stepper.tsx`, test `components.order-stage-stepper.test.tsx`
- [ ] Презентационный (props: `WorkingStage` + метки 6 стадий). 6 сегментов, текущая подсвечена (Tailwind `orange-*`), пройденные отмечены; терминальный → одиночный `Badge`. Только `ui/`-примитивы, без инлайн-hex. `import React` в тесте (classic JSX).
- [ ] Commit `feat(orders): OrderStageStepper component (§10)`.

### Task 3: Встраивание в карточку заказа (все кабинеты)
**Files:** `ManagerOrderDetailView` (manager/admin/leader), `src/app/admin/orders/[id]/page.tsx`, organization order detail, partner deal detail
- [ ] Считать `orderWorkingStage` из полей заказа (executionStatus/contractSignedAt/completedAt/closedAt/totalAmount/paidAmount — убедиться, что они есть в order DTO; если нет — добавить в select узко) и отрисовать `<OrderStageStepper>` в шапке детали заказа. Метки стадий — единая константа (одна точка правки по §10).
- [ ] Обновить затронутые тесты order-detail (мок компонента / keep green).
- [ ] Commit `feat(orders): show 6-stage stepper in order detail (all cabinets) (§10)`.

### Task 4: Docs
- [ ] CHANGELOG `[Unreleased]` (производный 6-стадийный статус §10, метки предложены — подтвердить). Commit `docs: 6-stage order status (§10)`.

### Финал
- [ ] Гейты typecheck/lint/unit. Holistic review. Close-out `-DONE.md`. PR.

## Self-review (покрытие spec)
§10 6 стадий → Task 1 ✓; производный (не enum) → Task 1; индикатор в карточке → Task 2,3; метки в одной точке → Task 3; без миграции/1С/комиссий → весь план.
