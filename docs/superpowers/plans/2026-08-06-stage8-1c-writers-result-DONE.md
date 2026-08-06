# Этап 8 «Writer'ы возвращают результат + модели батча» — что отгружено

**Дата:** 2026-08-06
**Спека:** [2026-08-06-stage8-1c-writers-result-design.md](../specs/2026-08-06-stage8-1c-writers-result-design.md) — подтверждена заказчиком («ок», PR #324)
**План:** [2026-08-06-stage8-1c-writers-result.md](2026-08-06-stage8-1c-writers-result.md)
**ТЗ:** Т-32…Т-34 · ветка `stage8-1c-writers-result` · строго до этапа 9

---

## Отгружено

| Требование | Состояние |
|---|---|
| **Т-32** миграция | ✅ `OneCImportBatch`/`OneCImportRow` ровно по эскизу ТЗ + обратная связь `User.oneCImportBatches`; миграция `20260806121358_one_c_import_batch` аддитивная; каскад строк закреплён integration-тестом |
| **Т-33** история в `commitImport` | ✅ батч (importedById/companyId/fileName/counts/status='committed') + строки из результатов writer-ов; `before` — только `updated`, строго по per-entity списку ТЗ; предпросмотр историю не ведёт |
| **Т-34** возврат из writer-ов | ✅ `upsertOrgRecord`/`upsertOrderRecord`/`upsertPaymentRecord` → `Promise<WriteOutcome | undefined>`; `undefined` = skip/shadow; сетевой воркер результат игнорирует |

## Решения, закреплённые в коде

1. Тип обработчика `runRecordBatch` пришлось расширить до `Promise<unknown>`
   (спека предполагала «не менять» — void-подстановка TS не работает для
   `Promise<void>`); та же правка в `AnyWriter` replay-механизма pending.
2. Снимки `before`: организация `name/inn/kpp/externalId/partnerId`, заказ
   `totalAmount/paidAmount/financialStatus/executionStatus`, платёж
   `amount/paidAt/purpose`; `Decimal` → `String(x)`, `DateTime` → ISO. Снимок
   берётся из уже существовавших `SELECT` update-веток (лишних запросов нет).
3. Отказ записи истории — non-blocking (`log.error`, контракт аудита): импорт
   к этому моменту уже применён. Побочный эффект: старые тесты с мокнутой
   призмой без новых делегатов не падают, а честно логируют.
4. `historyCompanyId` батча: у руководителя — компания скоупа, у admin —
   выбранная в форме (фильтр «свои импорты» для UI этапа 9).
5. `fileKey` остаётся `null` — файл никуда не сохраняется (вопрос этапа 9).

## Проверки

- `typecheck` (2 проекта), `lint --max-warnings=0`, `prettier`, `prisma
  migrate dev` + `generate` — зелёные.
- Покрытие изменённых файлов (`writers.ts`, `record-batch.ts`,
  `import/index.ts`) — **100%**; `pending.ts` — только смена типа, его хвосты
  кроет integration-слой, как раньше.
- **Integration на живом Postgres 4/4** (`import.stage8-history`): батч
  `created` для трёх сущностей с настоящими id; повтор → второй батч `updated`
  со снимками ровно по списку Т-33; предпросмотр без истории; каскад удаления.
- Полный `test:integration` на свежей seed-базе + полный `test:unit` — см.
  журнал STATUS.md.

## Грабли этого этапа

- **`Promise<void>` в типе колбэка не принимает `Promise<T>`** (void-подстановка
  работает только для голого void) — смена возвращаемого типа writer-ов тянет
  правку каждого места, где их тип зафиксирован (`record-batch`, `pending`).
- Добавление `select: { id: true }` в `create`-вызовы разошлось по ~15
  моковым assert'ам трёх тестовых файлов (`toHaveBeenCalledWith` сверяет
  аргумент целиком); моки `create: vi.fn()` без `{id}` роняют writer на
  `created.id` — «Cannot read properties of undefined».
- В describe-строках не писать апостроф внутри одинарных кавычек
  («writer'ами» сломало строку).

## Что дальше

Этап 9 (Т-35…Т-40, **высокий риск**): сам откат — обратный порядок
платежи → заказы → организации, блокирующие связи (акт комиссии, пользователи
организации, документы заказа), частичный откат, срок 30 дней, UI «История
импортов» с кнопкой. Затем этап 10 (кнопка в очереди выписки).
