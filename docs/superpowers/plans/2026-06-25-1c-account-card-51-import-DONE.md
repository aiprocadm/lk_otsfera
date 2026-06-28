# Close-out — импорт «карточки счёта 51» из 1С (банковские платежи)

**План:** [2026-06-25-1c-account-card-51-import.md](2026-06-25-1c-account-card-51-import.md)
**Ветка:** `claude/tz-account-card-51-import` (+ `claude/account-card-51-bind-ui`) · **PR:** #155 (импорт), #156 (UI «Привязать»)
**Метод:** subagent-driven-development.

> Бэкфилл close-out (housekeeping): план само-декларировал «РЕАЛИЗОВАНО (2026-06-25)» в шапке; работа в `main`. Этот файл приводит запись к §8-конвенции.

## Что отгружено

Загрузка выгрузки 1С «Карточка счёта 51» (банк) → платежи в кабинете. Точное сопоставление по счёту/ИНН пишется напрямую; нечёткое по имени уходит в очередь ручного разбора.

| Слой | Отгружено | Коммит |
|---|---|---|
| **Схема** | `PaymentImportBatch` + `PaymentImportRow` (очередь разбора); миграция `20260624222600_payment_import_card51`; dep SheetJS | `c714666` |
| **Экстракторы** | `oneCAccountCard/extractors.ts` — дата/сумма/№док/счёт/ИНН/НДС (чистые функции) | `41a2e66` |
| **Классификатор** | `classify.ts` — 62=платёж/возврат; 60/91/перемещение исключаются | `adc99f5` |
| **Парсер** | `parser.ts` — маркер-нарезка операций → `ParsedRow[]` | `a63bb1e` |
| **Ридер** | `read-spreadsheet.ts` — `.xls` (SheetJS) + `.xlsx` (exceljs), формат-агностичный | `f93ce0e` |
| **Матчер** | `matcher.ts` — точно по счёту/ИНН, нечётко по имени → очередь | `6a6c4d9` |
| **Оркестратор** | `import-batch.ts` — preview/commit; точное → writer, нечёткое → `PaymentImportRow` | `3cc522f` |
| **Очередь разбора** | `resolve-queue.ts` (list/resolve/dismiss) + `resolve-picker.ts` (поиск орг/заказов) | `6d0d40b`, PR #156 |
| **Server-actions** | `payment-import.ts` — preview/commit + resolve/dismiss + picker | `4ecc973` |
| **UI** | форма загрузки + таблица очереди с диалогом «Привязать»; страницы `admin/payments-import` и `manager/payments-import` (company-scoped) + nav | `73a2f38`, `09756cc`, `915f5a6` |

**Тесты (9 файлов):** extractors/classify/parser/reader/matcher unit, batch+resolveQueue+resolvePicker unit (mock Prisma), `import.card51.integration` (живой PG: INN-match/queue/excluded, идемпотентность, промоция). Fix `132be14`: `resolveQueueRow` оставляет строку в очереди при write-skip (out-of-scope).

## Гейты (merge-time, PR #155/#156)

typecheck ✅ · lint ✅ · test:unit ✅ · integration ✅ (живой PG).

## Остаток

- Боевой pre-check дублей ИНН перед массовым импортом (runbook).
- Сверка реального формата выгрузки 1С (номера документов) — зафиксировано в тестовых фикстурах.
