# План — Этап 6 / PR-3: «Выиграно сделок» в план/факт руководителя (ФТ-4.5)

Спека: [2026-07-25-stage6-deals-kanban-design.md](../specs/2026-07-25-stage6-deals-kanban-design.md) §7 — ✅ подтверждена
(решение §9-2: аналитика третьим PR этапа). Последний PR этапа 6.

Факт по оплатам НЕ трогаем (§10 спеки) — выигранные сделки показываются
**рядом**, отдельной колонкой.

## A. Сервис

- [x] A1. `leader/analytics.ts` / `getPlanFact`: в `Promise.all` добавить
  `prisma.deal.groupBy({ by: ['managerId'], where: { companyId, status: 'won',
  wonAt: { gte: from, lt: to } }, _sum: { amount: true }, _count: { _all: true } })`.
  `PlanFactRow` + `wonDeals: number`, `wonAmount: string` (Decimal → toFixed(2),
  null-amount = 0); строка «Без менеджера» учитывает won без менеджера;
  `PlanFactTotals` + `wonAmount`.

## B. UI

- [x] B1. `plan-fact-table.tsx`: колонка «Выиграно сделок» — `N · сумма`
  (fmtMoney; 0 → «—»), итоговая ячейка totals.wonAmount.

## C. Тесты и ворота

- [x] C1. `services.leader-analytics.unit.test.ts`: фикстуры + deal.groupBy;
  суммы по менеджерам, null-amount, «Без менеджера», totals.
- [x] C2. `components.leader-analytics.test.tsx` (+pages при необходимости):
  фикстуры rows/totals, рендер колонки.
- [x] C3. Integration: в существующий deals/analytics-файл — won-сделка месяца
  попадает в план/факт (живой Postgres).
- [ ] C4. typecheck/lint/test:unit зелёные; CHANGELOG; PR; STATUS.md
  (после мержа этап 6 = ✅ готов).
