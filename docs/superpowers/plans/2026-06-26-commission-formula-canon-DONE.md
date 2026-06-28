# Close-out — канон формулы комиссии (платёжная модель §9.2)

**План:** [2026-06-26-commission-formula-canon.md](2026-06-26-commission-formula-canon.md)
**Ветка:** `claude/commission-formula-canon` · **PR:** #157 (база), #165 (интеграция A6)
**Метод:** subagent-driven-development.

> Бэкфилл close-out (housekeeping): работа отгружена и в `main`. Связанный поток коррекций §9.5 (A6) закрыт отдельно — [2026-06-26-commission-correction-a6-DONE.md](2026-06-26-commission-correction-a6-DONE.md).

## Что отгружено

Расчёт комиссии переведён с заказо-ориентированной на **платёжную** модель: база = сумма платежа (без вычета НДС, решение владельца), историческая ставка по `paidAt`, возвраты = отрицательные строки, нетто-месяц клампится к ≥0.

| Слой | Отгружено | Коммит |
|---|---|---|
| **Схема** | `CommissionStatementItem.orderId` nullable + `paymentId` + back-relation `Payment`; миграция `20260626120000_commission_item_payment` | `39cb7e7` |
| **Калькулятор** | `commission/calculator.ts` — платёжная база, без НДС, refund-строки, кламп к 0 (A1/A2/R0/R2) | `58a79bc` |
| **Резолвер ставки** | `commission/rateResolve.ts` — чистая функция, историческая ставка по `paidAt` через `CommissionRateChange.effectiveFrom` (A5) | `3440abe` |
| **Билдер выписки** | `commission/statement.ts` — выбор платежей по `paidAt` (A1/A4), историч. ставка, маппинг `orderId?`/`paymentId`/`correctionId` (готов к A6) | `7f91ed1` |
| **Воркер** | `calculate-monthly-commissions.ts` — выбор партнёров по платежам в периоде | `c026fdf` |
| **Admin backdate** | `admin/partners.ts` + server-action + `partner-edit-form.tsx` — `effectiveFrom` для смены ставки задним числом (A5 enablement) | `e7a68e1` |
| **PDF/XLSX** | релейбл «Детализация заказов» → «…платежей» | `64a9cce` |
| **Доки** | module-header + `CHANGELOG.md` §9.2; удалены env `COMMISSION_TRIGGER`/`COMMISSION_VAT_MODE` | `6385503` |

Follow-up по ревью (`4558451`): doc rate-history, валидация `effectiveFrom`, фильтр cron-запроса.

## Гейты (merge-time, PR #157/#165)

typecheck ✅ · lint ✅ · test:unit ✅ — обновлены `commission.calculator`, `services.commission.rateResolve`, `services.commission.statement.unit`, `worker.calculate-monthly-commissions`; integration `services.commission.statement` (A1/A2/A4, живой PG).

## Решения владельца, зафиксированные в коде

База = `amount` (НЕ amount−НДС); период по `paidAt` (не `closedAt`); одна строка = один платёж; возврат флипает знак; нетто-месяц `max(0, Σ)`; attribution партнёра = `order?.partnerId ?? organization.partnerId`.

## Остаток

- Поток коррекций §9.5 (late-refund, A6) — отгружен отдельно (см. ссылку выше).
- Перед боевым прогоном — сверка реальных ставок/истории по данным 1С (runbook).
