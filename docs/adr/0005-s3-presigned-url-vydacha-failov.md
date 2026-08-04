# ADR 0005: Файлы живут в S3; выдача только через presigned URL

**Статус:** принято; закреплено в CLAUDE.md §10 (действует с постройки документооборота, июнь 2026).

## Контекст

Документы (счета, закрывающие, вложения) — до 200 МБ. Прокачивать их телом через
Next.js-приложение дорого и небезопасно; нужен единый паттерн скачивания.

## Решение

Файлы хранятся в S3-совместимом bucket `documents`. Приложение **никогда не отдаёт файл
напрямую** — только короткоживущий presigned URL: у документ-роутов JSON `{ downloadUrl }`
(TTL 600 сек у manager-роута; 60–300 у общего), у вложений/выписок — 302/307-redirect на
подписанный URL. Файл со статусом скана `infected` отдаёт **410 Gone**, не 404 — это
разные сигналы (карантин vs отсутствие/чужой документ).

## Последствия

- Upload обязан: MIME allow-list + size check, запись `Document`, enqueue `docs.scanDocument`, audit, уведомления.
- Скачивание фиксируется в audit log (`document_download_signed_url`).

## Источники

- [CLAUDE.md §10](../../CLAUDE.md) · [src/lib/storage/](../../src/lib/storage/) (`s3.ts`, `objectStorage.ts`)
- Роуты: [manager download](../../src/app/api/manager/documents/%5Bid%5D/download/route.ts) (TTL 600, 410) · [общий download](../../src/app/api/documents/%5Bid%5D/download/route.ts) · [messages attachment](../../src/app/api/messages/attachment/route.ts) (302)
