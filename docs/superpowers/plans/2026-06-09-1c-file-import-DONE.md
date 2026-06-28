# Close-out — файловый импорт 1С (Excel → DTO)

**План:** [2026-06-09-1c-file-import.md](2026-06-09-1c-file-import.md)
**Ветка:** `claude/1c-file-import` · **PR:** #104 (merge `53b5278`).

> Бэкфилл close-out (housekeeping). Работа отгружена и **поглощена/унифицирована** последующим T1 (см. ниже) — отдельный `-DONE` не создавался в своё время.

## Что отгружено

Excel-выгрузки 1С (организации / заказы / платежи) → импорт в кабинет: загрузка → preview/dry-run → подтверждение, с RBAC-скоупом и транзакционным коммитом.

- Модуль `src/lib/services/import/` — типы, column-map, валидация, разбор книги (`parse-workbook.ts`), планировщик dry-run, транзакционный коммит с Result-контрактом.
- Схема org-level платежей: `Payment.organizationId` required, `orderId` nullable (M1–M5); обновлены 4 read-сайта платежей (organization/partner/manager/admin finance).
- Страницы `/import` (manager + admin) с upload/preview/confirm UI; RBAC-скоуп (admin/leader без скоупа, обычный manager ограничен).

## Связь с T1 (важно)

Последующий план [2026-06-13-t1-ingestion-contract](2026-06-13-t1-ingestion-contract.md) **свёл Excel- и API-ингестию к единому writer'у** (`upsertOrderRecord`/`upsertPaymentRecord` + `FileOneCAdapter`, коммит `37bd79d`, PR #122). Исходный отдельный пайплайн был поглощён: импорт теперь идёт через unified writer, расходящийся код удалён (−756 строк) + guardrail «нет второго writer'а». Т.е. функциональность этого плана **жива в `main`, но реструктурирована** в рамках T1.

## Гейты (merge-time, PR #104 + T1 PR #122)

typecheck ✅ · lint ✅ · test:unit ✅ · build ✅. Паритет Excel↔API закреплён guardrail-тестом `import.no-second-writer.guardrail.test.ts`.

## Остаток

- Прогон integration на живом Postgres по unified-импорту — operator-deferred (см. [T1 PARTIAL](2026-06-13-t1-ingestion-contract-PARTIAL.md)).
