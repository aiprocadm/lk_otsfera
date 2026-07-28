# План — Этап 6 / PR-2: конверсии лид→сделка→заказ + лента

Спека: [2026-07-25-stage6-deals-kanban-design.md](../specs/2026-07-25-stage6-deals-kanban-design.md) §5–6, §9 (PR-2) — ✅ подтверждена.
База: PR-1 (#227) — модель/стадии/канбаны. Аналитика — PR-3.

## A. Сервисы

- [x] A1. `deals/convert.ts`: `convertLeadToDeal` (лид → сделка: наследование
  организации/менеджера/суммы, статус лида `promoted_to_deal`,
  `promotedDealId`; компания — организации лида или сессии) и `winDeal`
  (выигрыш → заказ по promoteLead-паттерну: организация обязательна
  (`org_required`), партнёр — из лида-источника, `Deal.orderId`, won/wonAt;
  целевая won-стадия словаря компании сделки).
- [x] A2. Воронка: дефолт-стадия «Передан в сделку» (терминальная, position 4)
  + ветка `promoted_to_deal` в `moveFunnelLead` → `convertLeadToDeal`.
- [x] A3. `deals/notes.ts`: `addNoteToDeal`/`listDealNotes` (параллельная
  привязка §10-1: DealNote.orderId стал nullable/SetNull — миграция; поток
  заметок по заказу не тронут).

## B. UI

- [x] B1. `deal-board`: won-диалог → `winDealAction` («Выиграна — создать
  заказ»; `org_required` → русское сообщение «привяжите организацию»);
  успех → тост со ссылкой на заказ.
- [x] B2. Карточка лида `/manager/leads/[id]`: кнопка «Создать сделку»
  (рядом с «Создать заказ»); воронка — перенос в «Передан в сделку» уже
  работает через A2. Терминальный статус `promoted_to_deal` — ссылка на
  доску сделок; кнопка — только при `deals_pipeline` (серверный проп).
- [x] B3. `deal-dialog`: блок «Заметки» (список + добавление) на
  редактировании сделки; при связанном заказе — ссылка «Открыть заказ»
  (полная лента — на заказе). `DealCard`/`DealDialogTarget` + `orderId`.
- [x] B4. Server-actions: `winDealAction`, `convertLeadToDealAction`,
  `addDealNoteAction`, `listDealNotesAction` (ленивая подгрузка в диалоге).

## C. Тесты и ворота

- [x] C1. convert: скоупы/lifecycle/наследование/org_required/партнёр из лида
  (unit + integration полный путь лид → сделка → won → заказ).
- [x] C2. notes: параллельность (orderId-поток жив), скоупы.
- [x] C3. Воронка: канон 6 стадий, ветка promoted_to_deal; обновить
  существующие funnel-тесты.
- [x] C4. UI: won-диалог, кнопка лида, заметки.
- [x] C5. Ворота + CHANGELOG + STATUS + PR (после мержа #227 — rebase).
