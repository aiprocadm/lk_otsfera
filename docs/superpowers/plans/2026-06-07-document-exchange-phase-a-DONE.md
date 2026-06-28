# Close-out — обмен документами, фаза A (изоляция каналов)

**План:** [2026-06-07-document-exchange-phase-a.md](2026-06-07-document-exchange-phase-a.md)
**Ветка/PR:** план `dd0184e` (PR #101); реализация — внутри Phase B (PR #108, merge `532186e`).

> Бэкфилл close-out (housekeeping). Фаза A была **полностью отгружена в составе фазы B** — отдельного `-DONE` не было; авторитетный close-out — [2026-06-09-document-exchange-phase-b-DONE.md](2026-06-09-document-exchange-phase-b-DONE.md).

## Что отгружено (часть A внутри Phase B)

Двунаправленный обмен документами (manager↔org, manager↔partner) с жёсткой изоляцией каналов.

- Схема: `Document.counterpartyType` (enum) + `counterpartyId` + индексы; миграция `20260610000000_document_counterparty` (backfill-safe).
- Политика `src/lib/auth/documentChannelPolicy.ts` — единый источник правил канала.
- Общий upload-core `persistUploadedDocument` (MIME/size валидация, storage, audit, enqueue scan) с маршрутизацией по counterparty.
- Уведомления: `notifyPartnerUsers`, manager `document_uploaded_by_partner`.
- Обобщённый manager-upload (picker получателя: org|partner); reverse-upload у org (server-action + форма).
- Канало-скоупленные чтения во всех кабинетах.
- Инвариант-тест изоляции `services.document-channel-isolation.test.ts`.

## Гейты (merge-time, PR #108)

typecheck ✅ · lint ✅ · test:unit ✅ · integration ✅ (живой PG, прогон 2026-06-10: 1334 unit + 390/390 integration).

## Остаток

- Нет: фаза A закрыта целиком в рамках фазы B; дальнейшее — отдельные семейства.
