# Этап 3 PR-2 — экспорт реестров и документы («новый», группировка)

Спека: [2026-07-24-stage3-certificates-registry-design.md](../specs/2026-07-24-stage3-certificates-registry-design.md) §5.5–5.6, §3.
Ветка: `claude/stage3-pr2-certificates-export`. Завершает этап 3.

## Объём

1. **Xlsx-экспорт реестров (ФТ-6.5, ФТ-12.1)**: рендерер
   `src/lib/services/certificates/xlsx.ts` (образец — commission/xlsx.ts:
   бренд-шапка, `safeText` от формула-инъекций, автофильтр, frozen row; лимит
   10 000 строк + строка-предупреждение); роуты
   `GET /api/organization/certificates/export` (роль organization) и
   `GET /api/partner/certificates/export` (requirePartner, + колонка
   «Организация»). Та же сервис-выборка `listCertificates` с теми же
   query-фильтрами, что у экрана; кнопки «Выгрузить в Excel» на обеих
   страницах реестров несут активные фильтры. `certificateStatus` перенесён
   из бейджа в сервис (единый источник статуса для экрана и файла).
2. **Документы (ФТ-6.6)**: модель `DocumentViewMark` (unique
   (documentId, userId), Cascade; ручная миграция
   `20260724170000_stage3_document_view_marks`); сервис
   `documents/viewMarks.ts` (`markDocumentViewed` — best-effort upsert,
   `viewedDocumentIds`); отметка ставится в download-роутах (общий +
   организация); `DocumentsList` — бейдж «новый» (`newDocIds`, локально
   гаснет после скачивания) и `groupByOrder` (секции «Заказ №…»/«Без заказа»
   на вкладке «По заказам»); страницы документов org/partner считают
   непросмотренные по текущему пользователю.
3. **Аудит доставки уведомления о документе**: клиентам при загрузке
   менеджером уходит `document_published` (notifyOrgUsers/notifyPartnerUsers)
   с прямой ссылкой (`url` в meta и email-payload: заказ → страница заказа,
   общий → список документов). Покрыто существующими тестами
   (notifications.notifyOrgUsers/partner/manager-upload) — разрывов не
   найдено, правок не потребовалось.

## Тесты

Unit: рендерер (колонки/статусы/инъекции/лимит), export-роуты (гейты +
разбор xlsx обратно), viewMarks (upsert/best-effort/Set), DocumentsList
(бейдж/группировка/плоский режим), страницы документов (вычисление
newDocIds), кнопки экспорта в тестах страниц реестров; актуализация моков в
существующих тестах download-роутов и страниц документов. Integration (живой
Postgres): viewMarks (уникальность/повторный просмотр/каскад).
