# Close-out — этап 12 PR-1: готовность заказа и передача результата

План: [2026-07-27-stage12-pr1-readiness-delivery.md](2026-07-27-stage12-pr1-readiness-delivery.md) ·
Спека: [2026-07-27-stage12-order-readiness-delivery-design.md](../specs/2026-07-27-stage12-order-readiness-delivery-design.md) ·
PR [#253](https://github.com/aiprocadm/lk_otsfera/pull/253) ✅ в `main` 28.07.2026.

## Отгружено

- Аддитивная миграция `Order.resultDeliveredAt/ById` + `deliverablesApprovedAt/ById`.
- Чистая `lib/orders/readiness.ts` (`evaluateOrderReadiness`): обучение —
  попозиционно (обучение завершено · удостоверение создано · скан загружен),
  разработка документов — исходящие файлы **и** явная отметка согласования.
  Существующая `evaluateOrderCompletion` не тронута — новая проверка дополняет.
- `services/manager/orderDelivery.ts`: `getOrderReadiness`,
  `approveDeliverables`, `deliverOrderResult`; скоуп `canSeeOrder` (C8),
  идемпотентная передача, уведомление `order_result_delivered` + аудит,
  fan-out best-effort.
- Панель «Готовность к передаче» на деталке заказа; клиентский `orderStage`
  получил финальную точку «Результат передан».

## Решения заказчика, зафиксированные в коде

1. Передавать может **любой менеджер в скоупе** — отдельного гейта на
   руководителя нет.
2. Для `document_development` нужна **явная отметка** «работа согласована»:
   автоматический вывод из факта загрузки файлов признан недостаточным.
3. Дата передачи ставится **один раз**; повтор — no-op без второго уведомления.

## Тесты

+48: readiness 14 · сервис 12 · панель 11 · server-action 7 · orderStage 4,
плюс integration полного пути на живой БД.

## Что вскрылось и ушло в PR-2

Пункт чек-листа «загружен скан удостоверения» **нечем было закрыть через
интерфейс**: `Certificate.documentId` проставлялся только при создании
удостоверения через API, а диалог выдачи его не передавал. Учебный заказ
физически не мог стать «готовым» — это и стало содержанием PR-2.
