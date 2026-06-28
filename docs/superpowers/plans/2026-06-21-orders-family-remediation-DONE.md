# Close-out — ремедиация семейства «Заказы» (Track D, R1–R5)

**План:** [2026-06-21-orders-family-remediation.md](2026-06-21-orders-family-remediation.md)
**Spec:** [../specs/2026-06-21-orders-family-remediation-design.md](../specs/2026-06-21-orders-family-remediation-design.md)
**PR:** #138–#141 · **Метод:** subagent-driven-development.

> Бэкфилл close-out (housekeeping). Продолжение findings аудита заказов ([audit close-out](2026-06-21-orders-family-audit-DONE.md)).

## Что отгружено

| Фаза | Отгружено | Коммит |
|---|---|---|
| **R1** | Унификация search-параметра `q` → `search` в `manager/orders.ts` + проброс через фильтр/таблицу; выравнивание заголовков списков (`font-semibold text-[#111111]` + подзаголовки) во всех ролях | `2072446` |
| **R2** | Мобильный card-list `ManagerOrdersCardList` (`md:hidden`, параметризован `basePath`) на manager+leader страницах; тест | — |
| **R3** | Извлечение общего вью + лоадера: `manager/orderDetail.ts` (`loadManagerOrderDetail`) + `manager-order-detail-view.tsx`; новая страница `leader/orders/[id]` через общий вью с `backHref='/leader/orders'`; тест | `2e293b3` |
| **R4** | Диалог-подтверждение на смене статуса: `manager-status-change-form.tsx` обёрнут в `Dialog` (`requestSubmit()` по подтверждению); тест | `77b0ac6` |
| **R5** | Верификация + добивка покрытия (`5fd0896`: R3-лоадер + S3-ветки) + фикс ревалидации leader-роутов (`a74e495`) | — |

## Гейты (merge-time, PR #138–#141)

typecheck ✅ · lint ✅ · test:unit ✅ · build ✅. Новые/обновлённые тесты: `services.manager.orders.unit`, `components.manager-orders-card-list`, `components.manager-order-detail-view`, `components.manager-status-change-form`.

## Остаток

- e2e:visual — operator-deferred (baseline заголовков обновить на следующем визпрогоне).
- Перенос того же канона на прочие семейства Track D — их отдельные планы.
