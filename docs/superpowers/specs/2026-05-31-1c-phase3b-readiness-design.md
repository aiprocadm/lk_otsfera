# Дизайн: 1С Phase 3b Readiness — production-готовность sync-машинерии

**Дата:** 2026-05-31
**Версия:** 1.0
**Статус:** Approved (design) — готов к writing-plans
**Связано:** [1c-contract.md](../../integrations/1c-contract.md) (Draft 0.1) · [1c-meeting-agenda.md](../../integrations/1c-meeting-agenda.md) (10 вопросов) · [Phase 3 DONE](../plans/2026-05-21-partner-cabinet-phase3-DONE.md)

---

## 1. Контекст и проблема

Sync-«скелет» вокруг 1С полностью построен и покрыт тестами: очереди + cron ([src/lib/jobs/queues.ts](../../../src/lib/jobs/queues.ts), [scheduling.ts](../../../src/lib/jobs/scheduling.ts)), 6 процессоров ([src/worker/processors/](../../../src/worker/processors/)), мапперы DTO→Prisma, `SyncLog`, уведомления, alerting. Но сам клиент 1С — `FakeOneCAdapter` (in-memory фикстуры); `adapter-rest.ts`/`adapter-file.ts` бросают `"not implemented yet (Phase 3)"` ([index.ts:13-16](../../../src/lib/services/oneCSync/index.ts)).

Реальный адаптер **заблокирован встречей с IT 1С** (10 вопросов в [1c-meeting-agenda.md](../../integrations/1c-meeting-agenda.md): транспорт, auth, IP, rate-limit, ключ партнёра, тип cursor'а, формат дат, push-endpoint, webhook, маппинг стадий). Однако вокруг «провода» есть критичная **transport-independent** работа, без которой happy-path против fake превратится в хрупкий sync против капризной боевой 1С.

### Пять проблем текущего кода (всё transport-independent)

| # | Проблема | Где | Последствие на реальной 1С |
|---|---|---|---|
| P1 | Каждый синк = полный pull (`pullOrders({})`, пустой cursor); модели `SyncState` нет | [sync-orders.ts:36](../../../src/worker/processors/sync-orders.ts) | растущая нагрузка, нет инкрементальности |
| P2 | DTO — голые TS-типы, **нет runtime-валидации** | [dto.ts](../../../src/lib/services/oneCSync/dto.ts) | кривой JSON 1С течёт прямо в Prisma |
| P3 | Цикл `for (const dto of dtos)` без per-record try/catch | [sync-orders.ts:39-120](../../../src/worker/processors/sync-orders.ts) | одна «ядовитая» запись валит весь job → retry перетягивает яд → застревание навсегда |
| P4 | Push-заявка не идемпотентен (push ок → `lead.update` упал → retry шлёт повторно) | [push.ts:76-83](../../../src/lib/services/oneCSync/push.ts) | дубли заявок в 1С |
| P5 | Контракт адаптера `pull*(): Promise<Dto[]>` не знает про пагинацию | [adapter.ts:11-17](../../../src/lib/services/oneCSync/adapter.ts) | немой обрыв на большом ответе |

---

## 2. Цели и non-goals

### Цели (в объёме спека)

1. **Персистентный инкрементальный курсор** — модель `SyncState` + high-water mark с safety-overlap (P1).
2. **Runtime-валидация** — zod-схемы DTO, двухуровневая политика отказов (P2).
3. **Per-record изоляция** — общий `runRecordBatch`, карантин ядовитых записей (P3).
4. **Идемпотентность push-заявок** — idempotency-ключ `cabinetLeadId` + DB-fast-path + `Lead.pushedToOneCAt` (P4).
5. **Resilience-хелперы** (transport-agnostic): timeout, request-level retry с уважением `Retry-After`, zod-обёртки.
6. **Конкретный REST-скелет** `adapter-rest.ts` (допущение REST+Bearer) со всей спекуляцией, изолированной в один файл `rest-wire.ts`.
7. **Shadow/dry-run режим** — `ONE_C_MODE=shadow`: полный pipeline против реальной 1С без записи в БД.
8. **Повышение fidelity fake-адаптера** + общий contract-тест адаптеров.
9. **Observability**: cursor-lag на сущность в alerting + дополнения к `/admin/sync` UI.

### Non-goals (осознанно отложено)

- **Пагинация с резюмированием среди страниц** — YAGNI: объём данных 1С неизвестен, при сотнях-тысячах записей инкрементальный `since` достаточен. Контракт `pull*` остаётся `Promise<Dto[]>`; пагинация — отдельный спек при доказанном объёме.
- **Circuit-breaker** — хватает BullMQ-backoff (`attempts:5, exponential delay 1000`) + request-level retry. Добавим при доказанной нужде.
- **File/OData адаптеры** — только REST-скелет; остальные транспорты — после ответа на Q1.
- **Фактические ответы на 10 вопросов** — внешний блокер; фиксируем как `// DECISION Q#:` константы.

### Зафиксированные решения (из brainstorming)

| Решение | Значение | Обоснование |
|---|---|---|
| Объём данных 1С | неизвестен → безопасный дефолт | инкрементальность + изоляция дёшевы и всегда корректны; пагинация отложена |
| Граница спека | hardening + конкретный REST-скелет + shadow | максимум готовности; спекуляция REST изолирована в 2 файла |
| `/admin/sync` UI (§9) | **включаем** | оператору нужно видеть здоровье синка при shadow-cutover |
| Трекинг push'а (§4) | **добавить `Lead.pushedToOneCAt`** | явный timestamp независимо от `externalIdInOneC` |
| Cursor overlap (§1) | **5 минут** | баланс: защита от clock-skew/boundary при малом повторном трафике |

---

## 3. Архитектура — новые и изменяемые файлы

Направление зависимостей (CLAUDE.md §2) сохраняется: `worker → services/oneCSync → lib`. Сервис `oneCSync` не импортирует Next/HTTP.

```
src/lib/services/oneCSync/
  schemas.ts          [НОВЫЙ]  zod-схемы на каждый DTO; dto.ts → z.infer
  dto.ts              [ПРАВКА] типы выводятся из schemas.ts (единый источник)
  cursor.ts           [НОВЫЙ]  getCursor / advanceCursor (SyncState)
  resilience.ts       [НОВЫЙ]  withTimeout / withRetry / parseRecords (transport-agnostic)
  record-batch.ts     [НОВЫЙ]  runRecordBatch — общий каркас изоляции + summary
  adapter.ts          [—]      интерфейс OneCAdapter без изменений
  adapter-fake.ts     [ПРАВКА] fidelity: malformed/latency/transient инъекции (env-gated)
  adapter-rest.ts     [НОВЫЙ]  RestOneCAdapter — композирует resilience + schemas
  rest-wire.ts        [НОВЫЙ]  ВСЯ спекуляция (DECISION Q#); blast radius = этот файл
  index.ts            [ПРАВКА] factory: case 'rest' поднимает RestOneCAdapter(config)
  push.ts             [ПРАВКА] idempotency-guard + pushedToOneCAt
  mappers.ts          [—]      без изменений (валидация выше по стеку)
  log.ts              [—]      writeSyncLog без изменений (operation 'check' уже есть)

src/worker/processors/
  sync-orders.ts        [ПРАВКА] cursor + runRecordBatch + commit-gate (shadow)
  sync-payments.ts      [ПРАВКА] то же
  sync-documents.ts     [ПРАВКА] то же
  sync-organizations.ts [ПРАВКА] то же
  sync-reconcile.ts     [ПРАВКА] cursor-lag в payload

prisma/schema.prisma   [ПРАВКА] + model SyncState; + Lead.pushedToOneCAt
prisma/migrations/     [НОВЫЙ]  аддитивная миграция (новая таблица + nullable колонка)

src/app/admin/sync/    [ПРАВКА] UI: watermark, lag, invalid/failed на сущность
src/app/api/admin/sync/summary/route.ts [ПРАВКА] cursor-lag в ответе

.env.example           [ПРАВКА] ONE_C_API_URL/TOKEN, ONE_C_MODE, ONE_C_HTTP_TIMEOUT_MS,
                                ONE_C_CURSOR_OVERLAP_MINUTES
```

---

## 4. Компоненты

### 4.1 `SyncState` — персист курсора (P1)

Аддитивная Prisma-модель (новая таблица — не трогаем применённые миграции, CLAUDE.md §11):

```prisma
model SyncState {
  entity        String    @id   // 'organization' | 'order' | 'payment' | 'document'
  cursor        String?         // ISO-watermark = `since` для следующего запроса
  lastRunAt     DateTime?
  lastSuccessAt DateTime?
  lastError     String?
  updatedAt     DateTime  @updatedAt
}
```

**Семантика watermark — high-water mark с safety-overlap 5 мин:**
- После успешного батча: `nextCursor = max(updatedAt по записям) − ONE_C_CURSOR_OVERLAP_MINUTES` (дефолт 5, env-override).
- Следующий run шлёт `{ since: cursor }`.
- Пустой батч → курсор **не двигаем** (`lastRunAt`/`lastSuccessAt` обновляются).
- Сбой батча → `lastError` записывается, курсор не двигается (BullMQ ретраит).

**Почему overlap:** две записи с одинаковым `updatedAt` на границе запроса + clock-skew 1С↔кабинет → ровный `max(updatedAt)` «перешагнёт» запись навсегда. Overlap перекрывает последние 5 мин; идемпотентный upsert по `externalId` гасит повторы.

**Хелпер** `src/lib/services/oneCSync/cursor.ts`:
```ts
export async function getCursor(db, entity): Promise<SyncCursor>      // { since?: string }
export async function advanceCursor(db, entity, maxUpdatedAt: Date | null): Promise<void>
export async function markCursorRun(db, entity, opts: { success: boolean; error?: string }): Promise<void>
```

### 4.2 zod-валидация DTO (P2)

Новый `src/lib/services/oneCSync/schemas.ts` — zod-схема на каждый DTO, зеркалит текущий [dto.ts](../../../src/lib/services/oneCSync/dto.ts). `dto.ts` переписывается на `export type OneCOrderDto = z.infer<typeof OneCOrderSchema>` — **единый источник истины**, тип и рантайм-проверка не разъедутся.

**Двухуровневая политика отказов:**
- **Сбой конверта** (ответ 1С не массив / тотально кривой) → `throw` → job падает → BullMQ retry. SyncLog `status: 'error'`.
- **Сбой записи** (`safeParse` не прошёл) → карантин: запись пропускаем, `invalid++`, в SyncLog best-effort `externalId` (`(raw as any)?.externalId`) + первый zod-issue. Батч продолжается.

Валидация исполняется **в процессоре первым шагом** — сразу после `pull*`, до маппинга, внутри `runRecordBatch` (§4.3). Так P2 (валидация) и P3 (изоляция) делят **один** `BatchSummary` и **один** итоговый SyncLog-entry. Интерфейс `OneCAdapter` остаётся `Promise<Dto[]>` (намеренная форма данных); рантайм-энфорс — обязанность процессора. Fake возвращает типизированные фикстуры; их контрактную валидность стережёт contract-тест (§4.8).

### 4.3 Per-record изоляция (P3)

Новый `src/lib/services/oneCSync/record-batch.ts` — каркас, объединяющий валидацию (P2) и изоляцию (P3):
```ts
export type BatchSummary = { pulled: number; created: number; updated: number;
  skipped: number; invalid: number; failed: number;
  skips: Array<{ externalId: string; reason: string }>;
  invalids: Array<{ externalId: string | null; issue: string }>;
  failures: Array<{ externalId: string; error: string }> };

export async function runRecordBatch<T>(
  raw: unknown[],                         // сырой выход adapter.pull*
  schema: ZodType<T>,                     // §4.2
  getExternalId: (r: T) => string,
  handler: (r: T, summary: BatchSummary) => Promise<void>
): Promise<BatchSummary>;
```
Каждый элемент: `schema.safeParse` → **invalid** → карантин (`invalid++`, best-effort externalId + issue, `continue`); **valid** → handler в try/catch (исключение → `failed++` + `failures`, `continue`). Одна запись не валит батч. Все 4 pull-процессора переходят на каркас (сейчас логика изоляции/summary копипастится). Статус итогового SyncLog: `success` (всё чисто) / `warn` (есть skipped/invalid/failed) / `error` (упал весь pull или конверт ответа).

### 4.4 Идемпотентность push-заявок (P4)

**Корневая гарантия** — idempotency-ключ: `cabinetLeadId` (уже в `OneCLeadPushPayload`) фиксируется в контракте как ключ дедупа на стороне 1С → двойной push безопасен. Добавить пункт в [1c-contract.md](../../integrations/1c-contract.md) «Идемпотентность».

**DB-сторона:**
- `Lead.pushedToOneCAt DateTime?` (новая nullable колонка) — явный timestamp успешного push'а.
- В `pushLeadToOneC` ([push.ts](../../../src/lib/services/oneCSync/push.ts)): читаем lead заново; если `pushedToOneCAt != null` → пропускаем вызов адаптера, лог `skip`, возврат ok (fast-path).
- При успехе пишем `pushedToOneCAt = now()` **и** `externalIdInOneC` в одном `update`.

DB-guard — оптимизация; настоящая гарантия от дубля — ключ на стороне 1С (т.к. между push и update job может упасть). Reassignment: lead читается в момент job'а → берётся текущий партнёр (корректно); риск был только в дубле, его закрывает ключ.

### 4.5 Resilience-хелперы (transport-agnostic)

`src/lib/services/oneCSync/resilience.ts` — чистые, юнит-тестируемые:
- `withTimeout<T>(fn: (signal) => Promise<T>, ms)` — `AbortController`; env `ONE_C_HTTP_TIMEOUT_MS` (дефолт 15000).
- `withRetry<T>(fn, { attempts, baseDelay })` — для transient (429/503/сеть), уважает `Retry-After`. **Только идемпотентные GET.** attempts низкий (дефолт 3) — иначе перемножается с BullMQ (5×3=15 реальных попыток).
- `parseRecords<T>(schema, raw): { valid: T[]; invalid: Array<{raw; issue}> }` — zod-обёртка из §4.2.

Двухслойный retry: BullMQ ретраит **весь job**; `withRetry` ретраит **один HTTP-запрос** внутри run'а.

### 4.6 Конкретный REST-скелет — ответственно (§6)

`adapter-rest.ts` реализует `OneCAdapter`, **композируя** resilience-хелперы + схемы. Вся спекуляция — в **одном** `rest-wire.ts`, каждая зависимость от нерешённого вопроса = именованная константа с `// DECISION Q#:`:

| Константа в `rest-wire.ts` | Вопрос встречи |
|---|---|
| `ENDPOINTS` (пути) | Q1 (транспорт/пути) |
| `buildAuthHeader()` (Bearer дефолт) | Q2 (auth) |
| `SINCE_PARAM` + `formatSince()` | Q6 (cursor), Q7 (datetime) |
| `unwrapEnvelope()` (массив vs `{items:[]}`) | Q1 |
| `PARTNER_KEY_FIELD` | Q5 (ключ партнёра) |
| `LEAD_PUSH_ENDPOINT` + `buildLeadBody()` | Q8 (push) |

**Blast radius спекуляции = 2 файла.** Если 1С ответит «не REST» → выбрасываем `rest-wire.ts` + `adapter-rest.ts`; §4.1–4.5, §4.7–4.8 целы. Factory [index.ts](../../../src/lib/services/oneCSync/index.ts): `case 'rest'` поднимает `RestOneCAdapter(config)` (config из `ONE_C_API_URL`/`ONE_C_API_TOKEN`). Свап адаптера — только env, процессоры не трогаем.

### 4.7 Shadow / dry-run режим (§7)

`ONE_C_MODE=shadow` (env: `live` | `shadow`, дефолт `live`): процессоры гоняют полный pipeline (read → validate → map → resolve → вычислить намеренные записи) против **реального** адаптера, но **не коммитят**. Вместо записи — SyncLog `operation: 'check'` (enum уже поддерживает), payload `{ wouldCreate, wouldUpdate, invalid, failed, samples }`.

Механизм — тонкий `commit`-гейт в процессоре: в shadow пропускаем `db.*.create/update`, всё остальное (резолв org, lookup existing, валидация формата против живых данных 1С, подсчёт) исполняется. Опц.: для `wouldUpdate` логируем какие поля отличаются от текущей строки (ограниченный sample).

**Cutover-runbook:** `ONE_C_ADAPTER=rest` + `ONE_C_MODE=shadow` на staging → наблюдаем `/admin/sync` несколько циклов → чисто → `ONE_C_MODE=live` → smoke на pilot-партнёре → prod.

### 4.8 Fidelity fake-адаптера + contract-тест (§8)

`FakeOneCAdapter` ([adapter-fake.ts](../../../src/lib/services/oneCSync/adapter-fake.ts)) начинает симулировать реальность (env-gated, дефолт off — существующие тесты зелёные):
- `FAKE_ONEC_MALFORMED_RATE` — эмитит запись, бьющую zod (проверяет карантин §4.2).
- `FAKE_ONEC_LATENCY_MS` + инъекция transient-ошибок (проверяет timeout/retry §4.5).
- `FAKE_ONEC_FAILURE_RATE` (push) — оставляем.

Общий **contract-тест** `src/__tests__/oneCSync.adapter-contract.test.ts`: инварианты любого адаптера — выход `pull*` проходит схемы, уважает `since`, `pushLead` возвращает `acceptedAt`. Fake проходит сейчас; REST-адаптер — позже против mock-сервера (`undici` MockAgent / nock).

### 4.9 Observability (§9)

- `sync-reconcile.ts` + `/api/admin/sync/summary`: **cursor-lag** на сущность = `now − SyncState.cursor`. Кормит существующий порог `ALERT_SYNC_LAG_MAX_HOURS` (уже в .env.example) — лаг теперь от персистентного курсора, не от «последнего success в SyncLog».
- `/admin/sync` UI ([src/app/admin/sync/page.tsx](../../../src/app/admin/sync/page.tsx)): на сущность — watermark курсора, лаг (green/yellow/red как существующие freshness-индикаторы), последние `invalid`/`failed`. RBAC: admin-only (как сейчас); page-level canSee-чек сохраняется.

---

## 5. Поток данных (pull, после изменений)

```
cron → BullMQ job → syncOrdersProcessor
  ├─ cursor = getCursor(db, 'order')              // { since }
  ├─ raw = adapter.pullOrders(cursor)             // REST: withTimeout+withRetry+fetch
  ├─ { valid, invalid } = validate(raw)           // zod на границе адаптера
  ├─ summary = runRecordBatch(valid, dto => {     // per-record изоляция
  │     resolve org; lookup existing;
  │     if (ONE_C_MODE==='shadow') count-only     // commit-gate
  │     else db.order.create/update               // owned-by-1C поля
  │  })
  ├─ advanceCursor(db, 'order', maxUpdatedAt − 5min)   // только при успехе
  └─ writeSyncLog({ entity:'order', status, payload:{...summary, invalid, failed} })
```

---

## 6. Обработка ошибок (сводка)

| Уровень | Сценарий | Поведение |
|---|---|---|
| Конверт | ответ не массив / кривой JSON | `throw` → job fail → BullMQ retry → SyncLog `error` |
| Запись | zod не прошёл | карантин: skip + `invalid++` + SyncLog issue; батч идёт |
| Запись | исключение в handler (Prisma и т.п.) | `failed++` + `failures`; батч идёт |
| Запрос | timeout / 429 / 503 | `withRetry` (≤3, `Retry-After`); исчерпан → bubble до job |
| Курсор | сбой батча | курсор не двигается; `lastError` записан |
| Push | дубль (retry после частичного сбоя) | idempotency-ключ 1С + `pushedToOneCAt` fast-path |

Degrade gracefully (CLAUDE.md §3): уведомления/fan-out в процессорах остаются best-effort (try/catch, не валят основной путь).

---

## 7. Тесты

- **Unit:** schemas (valid/invalid edge) · resilience (timeout, retry, Retry-After parse) · cursor advance (overlap-математика, пустой батч, сбой) · `runRecordBatch` (1 яд среди N, все ок, все падают) · idempotency-guard (повторный push → skip) · shadow = no-write · `rest-wire` форматтеры.
- **Integration (live PG, gate L2.5):** персист курсора между двумя run'ами · карантин пишет SyncLog с issue · shadow vs live (число строк в БД) · `pushedToOneCAt` ставится атомарно. Guardrail [worker.processor-coverage.guardrail.test.ts](../../../src/__tests__/worker.processor-coverage.guardrail.test.ts) уже требует интеграционный тест на каждый процессор.
- **Contract:** `oneCSync.adapter-contract.test.ts` — fake сейчас, rest (mock-сервер) позже.
- **Vitest gotcha:** unit-тестируемые React-компоненты `/admin/sync` должны `import React` — у vitest.config нет react-plugin (classic JSX transform), иначе `renderToString` бросит «React is not defined».
- Подход — TDD (RED→GREEN→REFACTOR) по каждому модулю.

---

## 8. Порядок реализации (черновик для writing-plans)

Каждый шаг независимо тестируем; ранние шаги не меняют поведение.

1. `SyncState` модель + миграция + `cursor.ts` (фундамент, поведение не меняется).
2. `schemas.ts` + рефактор `dto.ts` на `z.infer` (поведение не меняется).
3. `resilience.ts` (чистые функции, изолированы).
4. `record-batch.ts` + рефактор 4 pull-процессоров: cursor + изоляция + валидация (поведение: инкрементальность + карантин).
5. `Lead.pushedToOneCAt` миграция + idempotency-guard в `push.ts` + пункт в контракте.
6. Fidelity fake + contract-тест.
7. `rest-wire.ts` + `adapter-rest.ts` + factory + `.env.example`.
8. Shadow-режим (commit-gate) + cutover-runbook в спеке/README.
9. cursor-lag в summary/reconcile + `/admin/sync` UI.

---

## 9. Открытые вопросы

Блокирующих внутренних — нет. Внешний блокер один: **10 вопросов встречи с IT 1С** ([1c-meeting-agenda.md](../../integrations/1c-meeting-agenda.md)). До встречи `adapter-rest.ts` компилируется и юнит-тестируется против mock-сервера, но не включается на staging (`ONE_C_ADAPTER` остаётся `fake`). После встречи: заполнить `rest-wire.ts` константами → shadow на staging → live.

---

## 10. Что НЕ входит (явно)

Пагинация-резюмирование · circuit-breaker · file/OData адаптеры · изменение интерфейса `OneCAdapter` (остаётся `Promise<Dto[]>`) · код-качество вне 1С (dashboard-типы в сервисах, error-contract drift, раздутые сервисы — отдельный трек improvement-backlog).
