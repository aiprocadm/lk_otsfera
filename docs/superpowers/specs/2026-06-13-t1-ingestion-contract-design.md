# T1 — Единый контракт ингестии 1С (design / spec)

**Дата:** 2026-06-13
**Трек:** T1 (фундамент) дорожной карты [launch-readiness-roadmap](2026-06-13-launch-readiness-roadmap.md)
**Статус:** на ревью владельца

## 1. Цель

Свести два расходящихся пайплайна ингестии данных 1С (Excel-файл и REST-API) к **одному нормализованному контракту, одному completeness-gate и одному writer'у**. Любой источник (API, Excel, в будущем CSV/XML) обязан отдать запись той же полноты, иначе строка уходит в карантин с видимым отчётом. Закрывает находки **F1, F3, F4, F5, F6, F7**.

## 2. Текущее состояние (как есть)

Две независимые ветки пишут в одни и те же таблицы `Order`/`Payment`/`Organization`/`Document`:

| | **API** (`src/lib/services/oneCSync/**` + `src/worker/processors/sync-*.ts`) | **Excel** (`src/lib/services/import/**`) |
|---|---|---|
| Контракт | zod `OneC*Schema` ([schemas.ts](../../../src/lib/services/oneCSync/schemas.ts)) — **полный** | zod per-sheet ([validate.ts](../../../src/lib/services/import/validate.ts)) — **обеднённый** |
| Идентичность org | `externalId` | `inn` |
| order→org | `organizationExternalId` | `orgInn` (ИНН) |
| payment→ | `orderExternalId` (к заказу) | `organizationId`, `orderId:null` (к орг) |
| `financialStatus` | из DTO ([mappers.ts:63](../../../src/lib/services/oneCSync/mappers.ts)) | **не ставит** → дефолт `not_billed` ([commit-import.ts:105](../../../src/lib/services/import/commit-import.ts)) |
| `executionStatus`, даты, НДС, `productMix`, `partnerId` заказа | из DTO / от org ([sync-orders.ts:55-106](../../../src/worker/processors/sync-orders.ts)) | **не ставит** |
| `isRefund` | из DTO | в схеме есть, **из файла не маппится** ([column-map.ts](../../../src/lib/services/import/column-map.ts) — нет колонки) |
| Writer | `runRecordBatch` + per-record upsert в процессоре, shadow/live, уведомления | `commit-import.ts` `$transaction`, bulk upsert |
| Карантин | `invalids`/`skips`/`failures` в `BatchSummary` ([record-batch.ts](../../../src/lib/services/oneCSync/record-batch.ts)) | `Quarantine[]` + `SkipReport` |
| RBAC | worker = system, unscoped | `importScope` — менеджер scoped (свои орг, update-only), admin/leader unscoped ([scope.ts](../../../src/lib/services/import/scope.ts)) |

**Корень F1:** Excel-writer теряет ~6 полей, критичных для финансовых витрин. Витрины фильтруют по `financialStatus IN ('billed','partially_paid','paid')` → импортированные заказы (`not_billed`) дают финансы=0.

**Ключевое наблюдение:** адаптерный паттерн уже существует — `OneCAdapter` ([adapter.ts](../../../src/lib/services/oneCSync/adapter.ts)) с методами `pullOrganizations/pullOrders/pullPayments/pullDocuments/pushLead`; выбор адаптера в [config `getOneCAdapter`](../../../src/lib/services/oneCSync/index.ts) по `ONE_C_ADAPTER` (`fake`/`rest`/**`file` — заглушка «not implemented yet»**). Excel задумывался как `file`-адаптер, но не достроен; вместо него появилась параллельная ветка `import/**`.

## 3. Целевая архитектура

```
┌─ RestOneCAdapter  (есть)  ─┐
├─ FileOneCAdapter  (Excel)  ┤──► OneC*Dto  ──► zod OneC*Schema ──► общий writer ──► Order/Payment/Org/Document
├─ FakeOneCAdapter  (тесты) ─┤     (контракт)    (completeness-gate)   (sync-* processors,
└─ (CSV/XML — потом)         ─┘                                          один upsert-путь)
```

**Принцип:** «полнота записи» — свойство **контракта** (`OneC*Schema`), а не каждого адаптера. Адаптер обязан отдать полный DTO; неполный/битый DTO отсекается zod-парсом в `runRecordBatch` → `invalids` (карантин). Writer один и тот же для всех источников.

### 3.1 Что делаем
1. **Реализуем `FileOneCAdapter`** (`src/lib/services/oneCSync/adapter-file.ts`), реализующий `OneCAdapter`. Внутри — парс workbook (переносим `parse-workbook.ts` + `column-map.ts`) и **обогащение до полного DTO** (см. §4). Возвращает `OneCOrderDto[]` и т.д. — те же типы, что REST.
2. **Включаем `case 'file'`** в `getOneCAdapter()` — убираем `throw`.
3. **Excel-загрузка (UI) маршрутизируется через общий writer.** `import/index.ts` (`previewImport`/`commitImport`) переписывается: вместо собственного `commit-import.ts` он создаёт `FileOneCAdapter` из буфера и прогоняет те же `runRecordBatch`-обработчики, что worker, в режиме `preview` (dry-run) или `commit`.
4. **Удаляем расходящийся код:** `import/commit-import.ts`, `import/payment-mapper.ts`, `import/validate.ts`, `import/types.ts` (DTO-дубли), `import/plan-import.ts` — их роль поглощается контрактом+writer'ом. (`scope.ts` сохраняется — см. §6.)

### 3.2 Что переиспользуем как есть
- `OneC*Schema` (контракт), `mappers.ts`, `record-batch.ts` (карантин-механика), `cursor.ts` (для API; для файла курсор не нужен), `log.ts`.
- Worker-процессоры `sync-orders/payments/orgs/documents` — их upsert-ядро становится **общим writer'ом**, выделяется из процессора в переиспользуемую функцию (`writeOrderRecord(db, dto, opts)` и т.п.), чтобы её мог звать и worker, и file-import.

## 4. Ключевые решения (подтверждены владельцем)

### 4.1 `financialStatus` для Excel — **гибрид**
`FileOneCAdapter` при сборке `OneCOrderDto.financialStatus`:
1. Если в выгрузке есть колонка статуса → берём её через **слой перевода** (русские значения 1С → enum `not_billed|billed|partially_paid|paid|refunded`). Неизвестное значение → строка в карантин (не молчаливый дефолт).
2. Если колонки нет → **выводим из сумм**: `paid≥total>0 → paid`; `0<paid<total → partially_paid`; `paid=0,total>0 → billed`; `total=0 → not_billed`. Возврат (`isRefund`/отрицательная сумма) → `refunded`.

Тот же слой перевода применяется к `executionStatus` (это и есть «мина перевода справочников» из T2 — решаем здесь один раз, общий модуль `oneCSync/translate.ts`).

### 4.2 Оплата → заказ — **гибко**
`OneCPaymentSchema` расширяется: `orderExternalId` становится **опциональным**, добавляется опциональный `organizationExternalId`; инвариант — должен быть указан хотя бы один. Writer оплаты: есть `orderExternalId` → линкуем к заказу (как API, закрывает **F3**); нет → org-level (`orderId:null`, резолв `organizationId` по `organizationExternalId`/ИНН). `FileOneCAdapter` заполняет `orderExternalId`, если в выгрузке есть ссылка на заказ, иначе только `organizationExternalId`.

### 4.3 Объём — **полная унификация** (а не заплатка). См. §3.1 (удаление дублей).

### 4.4 Идентичность org: externalId ∨ ИНН
REST даёт `externalId`, Excel — ИНН. Writer org получает helper `resolveOrganization({ externalId?, inn? })`: матч по `externalId`, при отсутствии — по `inn`; для новой org из Excel `externalId` может быть `null` (ИНН — якорь). Защита от дубля при последующем API-синке: если приходит `externalId` для org, у которой уже есть запись по ИНН → дополняем `externalId`, не создаём вторую. (Закрывает риск рассинхрона идентичности.)

## 5. Изменения данных (Prisma)
- **Миграции схемы не требуется** для основного потока: `Payment.orderId` уже nullable; `Order.financialStatus/executionStatus/partnerId/lastSyncedAt` уже есть; `Organization.externalId/inn/kpp/partnerId` уже есть.
- Контракт-изменение `OneCPaymentSchema` (§4.2) — только zod, не БД.
- *(Проверить на этапе плана: уникальность `Organization.externalId` допускает NULL — иначе несколько Excel-org без externalId конфликтуют. Если constraint строгий — синтезировать `externalId` из ИНН в file-адаптере.)*

## 6. RBAC / scope (нельзя потерять)
API-синк — system, unscoped. Excel-загрузка — **инициируется пользователем и scoped** (менеджер пишет только свои орг, update-only; admin/leader unscoped — `importScope`). Поэтому общий writer принимает опциональный `scope` (default — unscoped для worker'а); file-import передаёт `importScope(session)`. Сохраняем текущую защиту: менеджер не может импортом тронуть чужую/новую организацию. `previewImport` (dry-run) обязателен перед `commitImport` — поведение сохраняется. Page-guard `requireAdmin/requireManager` + service `isStaff` остаются.

## 7. Отчёт об импорте (видимый, вместо тихого недоимпорта — F7)
Excel-UI (`/admin/import`, `/manager/import`) показывает результат на базе `BatchSummary` (`pulled/created/updated/skipped/invalid/failed` + списки причин по строкам). Это унифицирует «отчёт» с тем, что worker пишет в `SyncLog`. Preview = тот же прогон в dry-run без записи (`mode:'shadow'`-подобный путь или явный `dryRun`). Карантинные строки видны оператору с причиной (перевод не распознан / ИНН не сматчен / нет обязательного поля).

## 8. Тестовая стратегия
- **Unit:** `translate.ts` (русские статусы → enum, неизвестное → карантин); `FileOneCAdapter` (гибрид financialStatus: колонка vs вывод из сумм; payment с/без orderExternalId; isRefund из «Вид операции»/знака суммы); `resolveOrganization` (externalId ∨ inn, без дублей).
- **Integration (live-PG):** один файл прогоняется через file-адаптер → writer → проверяем, что заказы получают `financialStatus`/`partnerId`/даты (паритет с API-синком того же набора); оплаты линкуются к заказу при наличии ссылки; scope менеджера соблюдён; невалидные строки → карантин, валидные применены. **Инвариант паритета:** один логический набор, поданный как Excel и как API (fake-adapter), даёт идентичные строки в БД.
- **Guardrail:** тест, что после удаления `commit-import.ts` нет второго пути записи Order/Payment мимо общего writer'а.
- Прогон через WSL live-PG путь (см. roadmap), `npm run gate`.

## 9. Границы (что НЕ входит в T1)
- **F2** (видимость партнёра «через свои лиды») → **T3**. T1 сохраняет `partnerId` на заказе (как API-синк, от org) для полноты данных; *правила видимости* решает T3.
- **DOC-03** (download 1С-документов по внешнему URL) → **T2** (касается live-адаптера, не контракта).
- Включение live REST-адаптера и 3 «мины» 1С → **T2** (T1 даёт контракт+перевод, на которые T2 опирается).
- F8 (коллизия org в partner-deals) → **T3**.

## 10. Открытые вопросы (для этапа плана, не блокеры)
1. Точные русские значения статусов 1С для `translate.ts` — собираем по мере появления реальной выгрузки; до тех пор перевод покрывает ожидаемый набор + неизвестное → карантин (безопасный дефолт).
2. Уникальность `Organization.externalId` с NULL (см. §5) — подтвердить на плане.
3. Имя/формат колонки ссылки оплата→заказ и колонки статуса — параметризуемо в `column-map.ts` (blast radius = 1 файл).
