# Этап 8 PR-2 — Счёт и акт (ФТ-9.3–9.6)

Спека: [2026-07-26-stage8-requisites-docgen-design.md](../specs/2026-07-26-stage8-requisites-docgen-design.md) §5–6 (подтверждена; акт наследует номер счёта).
Ветка `claude/stage8-pr2-invoice-act` (стек поверх PR-1 #238). Договор/допсоглашение — PR-3.

## A. Модель (аддитивная миграция)

- [x] `DocumentCounter` (`@@id([companyId, year])`, `lastNumber Int`) — счётчик
      СЧЕТОВ per company+год (акт наследует номер связанного счёта — решение
      заказчика; отдельные счётчики других типов не нужны).
- [x] `Document` + `number String?`; `OrderItem` + `amount Decimal?` (задел
      попозиционного счёта — решение §9-3).

## B. Генерация

- [x] Кириллический шрифт DejaVu (обычный+bold) в `public/fonts/` + лицензия;
      `lib/pdf/fonts.ts` — `registerPdfFonts()` (идемпотентно).
- [x] `lib/documents/requisites-check.ts` — `listMissingRequisites(company,
      org, docType)` → русские названия недостающих полей (образец completion).
- [x] Единый PDF-рендер `lib/services/documents/orderDocumentPdf.ts`
      (@react-pdf, React.createElement-стиль как commission/pdf; счёт и акт —
      один шаблон с вариациями):
      шапка исполнителя, стороны с реквизитами, таблица позиций (v1 — одна
      строка «Услуги по заказу №X» на `Order.totalAmount`, НДС из
      vatIncluded/vatRate; позиции с `amount` — попозиционно), подписанты.
- [x] Сервис `services/documents/generate.ts` — `generateOrderDocument(prisma,
      session, {orderId, docType: invoice|act})`: staff-гейт + canSeeOrder,
      полнота реквизитов (список недостающего в ошибке), транзакция: счёт —
      upsert+increment счётчика → номер «С-{год}-{N}»; акт — номер последнего
      счёта заказа → «А-{год}-{N}» (без счёта → validation «Сначала
      сформируйте счёт»); рендер → S3 `orders/{id}/generated/...` → Document
      (`generatedBy='system'`, `direction='outgoing'`, `number`,
      `scanStatus='clean'`, `version+1`+`replacesDocumentId` при повторе);
      аудит `document_generated`; клиенту `document_published` (graceful).
      Синхронно (замер < 2 с — unit-тест).
- [x] «Запросить у клиента»: `requisites_requested` в `notifyOrgUsers`
      (+ветки buildOrgNotification/href) → url `/organization/settings`.

## C. UI

- [x] Флаг `document_generation` (opt-in, поведенческий: гейтит кнопки+action;
      комментарий с точками чтения в featureFlags).
- [x] Блок «Сформировать документы» на деталке заказа менеджера: кнопки
      «Счёт» / «Акт» (акт disabled без счёта), при неполных реквизитах —
      кнопки disabled + список недостающего + «Запросить у клиента»
      (кулдаун сутки не требуется — просто кнопка с toast); server-actions.
- [x] `DocumentsList` не менялся: номер входит в имя файла («С-2026-17.pdf»), версия — в пути; отдельный бейдж отложен (решение по ходу PR).

## D. Тесты (порог 100%)

- [x] Unit: listMissingRequisites (матрица), генерация (гейты, счётчик-номер,
      акт-наследование, нет счёта → ошибка, версии, scanStatus=clean, аудит,
      graceful notify), рендеры (renderToBuffer не падает, замер < 2с),
      requisites_requested, actions, кнопки-компонент, флаг.
- [x] Integration (живой Postgres, S3-мок): полный путь «реквизиты → счёт
      С-{год}-1 → акт А-{год}-1 → повторный счёт v2»; конкурентные генерации
      → номера без дублей; неполные реквизиты → список.

## E. Финал

- [x] typecheck / lint / unit / integration зелёные; CHANGELOG; STATUS.md; PR
      (base — ветка PR-1 до мержа #238, затем retarget на main).
