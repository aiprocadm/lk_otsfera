# Close-out — Prod-инфраструктура SP1: S3 storage-адаптер

**План:** [2026-06-20-prod-infrastructure-sp1-storage-adapter.md](2026-06-20-prod-infrastructure-sp1-storage-adapter.md)
**Ветка:** `claude/prod-infrastructure` · **PR:** #134 · **Метод:** subagent-driven-development.

> Бэкфилл close-out (housekeeping). Часть трёхспринтовой prod-программы: SP1 (storage) · SP2 (packaging, [DONE](2026-06-20-prod-infrastructure-sp2-packaging-DONE.md)) · SP3 (runbook, [DONE](2026-06-20-prod-infrastructure-sp3-runbook-DONE.md)).

## Что отгружено

Хранилище документов переведено с Supabase Storage на **S3-совместимый порт + адаптер** (server-only), с presigned-URL скачиванием.

| Слой | Отгружено |
|---|---|
| **Порт** | `src/lib/storage/objectStorage.ts` — интерфейс `ObjectStorage`, класс `StorageError`, `documentBucket` |
| **Адаптер** | `src/lib/storage/s3.ts` — `S3Storage` (upload/download/createSignedUrl/remove), `buildS3Storage()`, ленивый singleton `getObjectStorage()` |
| **Barrel** | `src/lib/storage/index.ts` |
| **Зависимости** | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| **Миграция вызовов** | 31 use `getObjectStorage()` в 13 файлах: services (`documents/upload-core`, `chat/attachments`, `partner/leadAttachments`, `oneCSync/document-fetch`), worker (`scan-document`, `generate-commission-pdf`, `generate-commission-xlsx`), 6 API-роутов скачивания/выгрузки |
| **Удаление Supabase** | `storage/supabase.ts` + тест удалены, `@supabase/supabase-js` выпилен; 0 ссылок |
| **Конфиг** | `.env.example` (`S3_ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/FORCE_PATH_STYLE`); MinIO-сервис в `docker-compose.yml`; CLAUDE.md §10 переписан на S3 |

**Тесты:** `storage.s3.test.ts` (unit — все 4 метода + 3 ветки Content-Disposition + barrel), `storage.s3.integration.test.ts` (MinIO round-trip, гейтится `S3_ENDPOINT`).

## Гейты (merge-time, PR #134)

typecheck ✅ · lint ✅ · test:unit ✅.

## Остаток

- Боевой round-trip против реального S3/MinIO — операторская проверка (см. SP3 runbook).
