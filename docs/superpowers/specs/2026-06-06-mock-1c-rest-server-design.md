# Дизайн: Mock-REST 1С — запускаемый контрагент + shadow-репетиция

**Дата:** 2026-06-06
**Версия:** 1.0
**Статус:** Approved (design) — готов к writing-plans
**Связано:** [1c-phase3b-readiness-design.md](2026-05-31-1c-phase3b-readiness-design.md) · [1c-contract.md](../../integrations/1c-contract.md) (v0.2) · [1c-meeting-agenda.md](../../integrations/1c-meeting-agenda.md) (10 вопросов) · [completion-roadmap.md](2026-06-02-completion-roadmap.md) (Трек A)

---

## 1. Контекст и проблема

Sync-машинерия вокруг 1С полностью построена (Phase 3b, PR #87) и **выключена** (`ONE_C_ADAPTER=fake`). `RestOneCAdapter` ([adapter-rest.ts](../../../src/lib/services/oneCSync/adapter-rest.ts)) — **не заглушка**: реальный `fetch` + `withTimeout`/`withRetry` + `unwrapEnvelope` + zod-валидация push'а. Вся спекуляция изолирована в [rest-wire.ts](../../../src/lib/services/oneCSync/rest-wire.ts) под `// DECISION Q#`. Свап адаптера — чисто через env (`ONE_C_ADAPTER=rest`, `ONE_C_API_URL`, `ONE_C_API_TOKEN`, `ONE_C_MODE=shadow`).

**Текущее состояние main (после PR #96):** контракт поднят до v0.2; `rest-wire.ts` несёт `PARTNER_KEY_FIELD='partnerSlug'` (Q5 pre-stage); существует [oneCSync.adapter-rest.test.ts](../../../src/__tests__/oneCSync.adapter-rest.test.ts) — он мокает `fetch` **in-process** (изолированно проверяет логику адаптера: Bearer+since, `{items}`-конверт, `OneCHttpError`, push, Q5).

**Чего нет:** адаптеру не с кем разговаривать. Невозможно:
- прогнать **полный pipeline** (cron → BullMQ → `adapter-rest` → shadow → `/admin/sync`) против HTTP-контрагента;
- сделать осязаемыми **3 «мины»** из подготовки к встрече ([1c-meeting-prep](../../integrations/1c-meeting-agenda.md)): Q10 (1С шлёт русские стадии → нет слоя перевода → 100% карантин), Q6 (пагинация → адаптер молча берёт первую страницу), Q7 (datetime без TZ → тихий сдвиг времени + дрейф курсора);
- отрепетировать cutover-runbook (A3) на безопасном стенде до боевой 1С.

**Решение:** запускаемый **mock-REST 1С** — standalone-сервер, который говорит ровно на диалекте `rest-wire.ts` и умеет намеренно вызывать каждую мину и каждую транспортную аномалию. Он превращает встречу с 1С из «гадать» в «подтвердить», а боевой запуск — из «надеяться» в «отрепетировано».

### Почему это разблокировка кодом, а не обход внешнего блокера

Сами ответы 1С (Q1–Q10) остаются за встречей. Но mock переводит риск из «неизвестное неизвестное» в «проверенное поведение»: для каждой развилки мы **заранее видим**, что произойдёт при каждом исходе, и какой код придётся тронуть. Дефолты mock'а = текущие допущения `rest-wire.ts`; переключатели = альтернативные исходы встречи.

---

## 2. Цели и non-goals

### Цели (в объёме спека)

1. **Запускаемый mock-сервер** (`npm run mock:1c`), реализующий 5 операций контракта (`GET organizations/orders/payments/documents` + `POST leads`) на диалекте `rest-wire.ts`.
2. **Stateful по курсору** — отдаёт `updatedAt > since`; `POST /__control` умеет «тронуть» запись (демо инкрементальности); `POST /api/leads` дедуплицирует по `cabinetLeadId`.
3. **Каталог сценариев** — переключаемые форки нерешённых решений (Q1/Q6/Q7/Q10) + транспортные аномалии (429/Retry-After, timeout, malformed, auth, дубли) + push (dedup, failure, наблюдение Q5).
4. **Поверхность управления** — env (`MOCK1C_*`) + рантайм `POST /__control` + интроспекция `GET /__state`.
5. **Runbook shadow-репетиции** — пошаговый локальный прогон полного pipeline против mock'а с наблюдением `/admin/sync`; репетиция cutover A3.
6. **Тесты** — unit на `core` + **server-backed контракт-тест** `adapter-rest` (реальный сокет, дополняет существующий fetch-stub тест) + опционально gate-tier integration shadow-sync.
7. **Изоляция** — mock вне `src/`-рантайма и вне Next-сборки; направление зависимостей `mock-1c → src/...` одностороннее, закреплено ESLint-guardrail'ом.

### Non-goals (осознанно отложено)

- **Верный симулятор 1С** — нет бизнес-логики 1С, нет OData/CommerceML/file-export. Только REST под текущий `adapter-rest`.
- **Персистентность** — in-memory, сброс на рестарте; своей БД у mock'а нет.
- **Деплой / прод** — dev/test-only. Никаких mock-роутов в приложении.
- **Фикс пагинации в адаптере** — mock её *вскрывает* (Q6), но обработка пагинации остаётся non-goal Phase 3b (отдельный спек при доказанном объёме).
- **Решение Q-вопросов** — mock делает их проверяемыми; решает встреча.
- **Load / perf-тестирование** — не цель.

### Зафиксированные решения (из брейнсторма)

| Решение | Значение | Обоснование |
|---|---|---|
| Форма | standalone `tsx`-сервер (не Docker, не Next route) | нулевой prod-blast-radius; конвенция `tsx`-оркестратора ([gate.ts](../../../scripts/gate.ts)); core юнит-тестируем |
| Источник данных | переиспользовать `fixtures/*` fake-адаптера | «одна правда»: контент mock ≡ fake → сравнения shadow-vs-fake осмысленны, seed уже schema-valid |
| Богатство | resilience-риг **+ форки решений** | прямое попадание по 3 минам; ради этого и затевается |
| Stateful | да (since-фильтр + dedup) | гоняет cursor advance/overlap (P1) и push-идемпотентность (P4/C6) end-to-end |
| Q7-сценарий | приоритет 🔴 (хотя в агенде P1) | «тихая» мина опаснее «громкой» Q10 — самодиагностики нет |

---

## 3. Архитектура — файлы

Направление зависимостей (CLAUDE.md §2): строго `mock-1c → src/lib/services/oneCSync/{schemas,dto,fixtures}`. `src/` **никогда** не импортирует `mock-1c`.

```
mock-1c/                          [НОВЫЙ top-level — вне src/, вне Next build]
  core/
    dataset.ts      in-memory store, seeded из src/lib/services/oneCSync/fixtures/*.
                    since-фильтр (updatedAt > since), touch(entity, externalId).
    scenarios.ts    Scenario-модель: конверт, диалект статусов, datetime-формат,
                    пагинация, malformed-инъекция, HTTP-аномалии. Импортит zod-схемы.
    serialize.ts    применяет конверт + datetime-формат + диалект к записям.
    leads.ts        приём lead'ов: dedup по cabinetLeadId, наблюдение partner-ключа (Q5).
  config.ts         MOCK1C_* env → Scenario config (fail-fast на кривом значении).
  server.ts         тонкий Node http: 5 ENDPOINTS + POST /__control + GET /__state +
                    GET /__health; проверяет Bearer; делегирует в core. Без бизнес-логики.
  README.md         как запускать + таблица сценариев + примеры curl.

package.json        [ПРАВКА] + "mock:1c": "tsx mock-1c/server.ts"
vitest.config.ts    [ПРАВКА] include += "mock-1c/**/*.test.ts" (unit-слой — нет PrismaClient)
eslint.config.mjs   [ПРАВКА] + no-restricted-imports: src/** не импортит mock-1c/**
                              (прецедент — C3-guardrail services↛app/components)
.env.example        [ПРАВКА] блок MOCK1C_* + пример shadow-репетиции
tsconfig.json       [ПРАВКА] include += "mock-1c" → typecheck покрывает; Next (src/app) не бандлит

src/__tests__/
  oneCSync.adapter-rest.contract.test.ts  [НОВЫЙ] server-backed: реальный RestOneCAdapter
                    против поднятого server.ts на эфемерном порту (дополняет fetch-stub тест).
```

**Почему отдельный top-level, а не `scripts/mock-1c/`:** mock — это самостоятельный долгоживущий артефакт (свой README, тесты, каталог сценариев), а `scripts/` в проекте — про одноразовые оркестраторы (`gate.ts`, `gate-precheck.ts`). Top-level чётче выражает «это контрагент, не утилита сборки».

---

## 4. Компоненты

### 4.1 `core/dataset.ts` — in-memory store

Сидируется из тех же `FAKE_ORGS / FAKE_ORDERS / FAKE_PAYMENTS / FAKE_DOCUMENTS` ([fixtures](../../../src/lib/services/oneCSync/fixtures/)). Хранит записи с `updatedAt`. API:

```ts
getOrganizations(cursor: SyncCursor): OneCOrgDto[]   // updatedAt > since (зеркало afterCursor)
getOrders(cursor): OneCOrderDto[]
getPayments(cursor): OneCPaymentDto[]
getDocuments(cursor): OneCDocumentDto[]
touch(entity, externalId): void                      // bump updatedAt = now → следующий sync подхватит
```

Логика since-фильтра идентична `afterCursor` из [adapter-fake.ts:14](../../../src/lib/services/oneCSync/adapter-fake.ts) — переиспользуем поведение. Дубли (`MOCK1C_DUPLICATES`) добавляются на этом слое (одна запись с `updatedAt` на границе окна — попадёт в overlap).

### 4.2 `core/scenarios.ts` — модель сценариев

Читает `ScenarioConfig` (из env или из `POST /__control`) и трансформирует ответ перед сериализацией. Импортирует `OneC*Schema` из [schemas.ts](../../../src/lib/services/oneCSync/schemas.ts) — чтобы (а) на happy-path данные были валидны **по построению**, (б) знать, что именно «ломать» для malformed.

```ts
type ScenarioConfig = {
  envelope: 'array' | 'items' | 'other';      // Q1
  statusDialect: 'app' | 'russian';           // Q10
  datetime: 'utc-z' | 'no-offset';            // Q7
  pageSize: number;                            // Q6 (0 = без пагинации)
  malformedRate: number;
  failMode: 'none' | 'transient' | 'permanent';
  failRate: number;
  latencyMs: number;
  duplicates: boolean;
  pushFailRate: number;
};
```

### 4.3 `core/serialize.ts`

Применяет к массиву записей: `statusDialect` (маппинг наших кодов → русские стадии для orders), `datetime` (переформат всех ISO-полей в no-offset), `envelope` (обернуть в `[]` / `{items}` / `{data}`), `pageSize` (срезать первую страницу, добавить `nextCursor`). Чистая функция — основной объект unit-тестов.

**Маппинг диалекта Q10** (orders): `pending→Новый`, `in_progress→Выполняется`, `completed→Выполнен`, `cancelled→Отменён`, `on_hold→Приостановлен`; финстатусы аналогично. Точные русские строки — иллюстративны (намеренно НЕ из нашего enum), цель — гарантированный zod-fail.

### 4.4 `core/leads.ts` — приём push'а

`POST /api/leads`: дедуп по `cabinetLeadId` (повторный → тот же `oneCRequestId`, контракт §«Идемпотентность»); регистрирует, **какое поле партнёра** пришло (`partnerSlug` по дефолту `PARTNER_KEY_FIELD`) для `__state` (наблюдение Q5); `pushFailRate` → 500 (триггерит BullMQ retry + C6 atomic-claim/rollback). Возврат `{ acceptedAt, oneCRequestId }` — валиден по `OneCLeadPushResultSchema`.

### 4.5 `server.ts` — тонкий HTTP

Node встроенный `http` (без фреймворка). Роуты: 5 `ENDPOINTS` (значения берём из [rest-wire.ts](../../../src/lib/services/oneCSync/rest-wire.ts), не хардкодим) + `POST /__control` (рантайм-флип `ScenarioConfig`) + `GET /__state` (активный сценарий, счётчики, последний push, Q5-поле) + `GET /__health`. Проверяет `Authorization: Bearer <MOCK1C_TOKEN>` → 401 при несовпадении. Аномалии (`latencyMs`, `failMode`, `Retry-After`) применяются **до** делегирования в core. Никакой бизнес-логики.

### 4.6 `config.ts`

`MOCK1C_*` → `ScenarioConfig` с **fail-fast**: неизвестное значение enum-флага (например `MOCK1C_ENVELOPE=foo`) → бросаем на старте, не «молча дефолтим». `MOCK1C_PORT` (дефолт 4010), `MOCK1C_TOKEN` (дефолт `mock-token`).

---

## 5. Каталог сценариев

🔴 must / 🟡 nice. Флаг → на проводе → что доказывает.

### Группа A — форки нерешённых решений встречи

| Сценарий | Флаг | На проводе | Доказывает / форсит решение |
|---|---|---|---|
| 🔴 **Q10 диалект** | `MOCK1C_STATUS_DIALECT=app\|russian` | `Выполняется` вместо `in_progress` | `z.enum` отбраковывает → **100% карантин**; `/admin/sync` красный по `invalid`. Кто мапит стадии: 1С шлёт наши коды vs слой перевода в [mappers.ts](../../../src/lib/services/oneCSync/mappers.ts) |
| 🔴 **Q7 datetime** | `MOCK1C_DATETIME=utc-z\|no-offset` | `...T10:00:00` без TZ | `isoDate` (мягкий refine) **проходит**, parse → server-local → **тихий сдвиг**; watermark дрейфует. Зафиксировать UTC+offset vs нормализация |
| 🔴 **Q6 пагинация** | `MOCK1C_PAGE_SIZE=N` | `{items, nextCursor}`, только стр.1 | адаптер не пагинирует → **молча первая страница**; mock логирует «стр.1 из 3, клиент не спросил далее». Подтвердить «1С не пагинирует» vs снять non-goal |
| 🟡 **Q1 конверт** | `MOCK1C_ENVELOPE=array\|items\|other` | `[]` / `{items}` / `{data}` | первые два — `unwrapEnvelope` ок; `other` → throw → envelope-failure → job retry |

### Группа B — транспортные аномалии (гоняют [resilience.ts](../../../src/lib/services/oneCSync/resilience.ts) через реальный HTTP)

| Сценарий | Флаг | Доказывает |
|---|---|---|
| 🔴 **malformed** | `MOCK1C_MALFORMED_RATE` | per-record карантин (`runRecordBatch`) через границу HTTP+JSON+конверт |
| 🔴 **transient+Retry-After** | `MOCK1C_FAIL_MODE=transient` | 429 c `Retry-After:2` / 503 → `withRetry` уважает заголовок (resilience.ts:50) |
| 🔴 **timeout** | `MOCK1C_LATENCY_MS=20000` | latency > `ONE_C_HTTP_TIMEOUT_MS` (15с) → AbortController → abort → transient → retry |
| 🔴 **auth** | `MOCK1C_TOKEN` mismatch | 401 → `isTransient=false` → не ретраит request → job retry. Проводка Bearer |
| 🟡 **permanent** | `MOCK1C_FAIL_MODE=permanent` | 500/400 → bubble → job retry. Двухслойность retry (request vs job) |
| 🟡 **дубли** | `MOCK1C_DUPLICATES=1` | идемпотентный upsert (нет дублей) + смысл cursor-overlap 5мин (P1) |

### Группа C — push (outbound)

| Сценарий | Флаг | Доказывает |
|---|---|---|
| 🔴 **dedup** | (всегда) | повторный `POST /api/leads` → тот же `oneCRequestId`; связка с C6 atomic-claim |
| 🔴 **Q5 ключ** | (наблюдение) | `GET /__state` показывает пришедшее поле (`partnerSlug` по дефолту) — подтвердить на встрече |
| 🟡 **push-failure** | `MOCK1C_PUSH_FAIL_RATE` | 500 → BullMQ retry → C6 claim + откат `pushedToOneCAt` → нет дубля |

---

## 6. Поток данных + runbook shadow-репетиции

```
cron/enqueue → BullMQ job → sync*Processor
  ├─ cursor = getCursor(db, entity)                  // { since }
  ├─ raw = adapter.pullX(cursor)                     // REST: withTimeout+withRetry+fetch → MOCK
  │     └── mock: auth → аномалия? → since-фильтр → диалект/datetime/конверт/пагинация
  ├─ validate(raw) → russian/malformed уходят в invalid (карантин)
  ├─ runRecordBatch: shadow → count-only | live → create/update
  ├─ advanceCursor(maxUpdatedAt − overlap)
  └─ writeSyncLog({ status, payload: {wouldCreate, wouldUpdate, invalid, failed} })
```

**Runbook (локально, расширяет cutover §4.7 Phase 3b):**

```
1. npm run prisma:seed        # Partner/Org со slug/externalId, совпадающими с фикстурами
2. npm run mock:1c            # :4010
3. ONE_C_ADAPTER=rest ONE_C_API_URL=http://localhost:4010 \
   ONE_C_API_TOKEN=mock-token ONE_C_MODE=shadow  npm run worker:dev
4. триггер синков (cron-тик или ручной enqueue)
5. /admin/sync: watermark, cursor-lag, invalid/failed на сущность (shadow → 0 строк в БД)
6. матрица: флип MOCK1C_* (или POST /__control) → повтор → сверка SyncLog
              russian → all invalid; PAGE_SIZE → недосчёт; no-offset → сдвиг
7. cutover: shadow (чисто) → live → строки пишутся
```

---

## 7. Обработка ошибок

Mock **не добавляет** error-handling в `src/` — лишь триггерит существующие пути (`resilience.ts`, `runRecordBatch`, push-claim). Сводка соответствий:

| Mock-сценарий | Существующий обработчик | Ожидаемое наблюдаемое |
|---|---|---|
| 429/503 + Retry-After | `withRetry` / `isTransient` | задержка по заголовку, затем успех |
| latency > timeout | `withTimeout` (AbortController) | abort → transient → retry |
| 401 / 500 / `other`-конверт | bubble → job fail | BullMQ job retry; SyncLog `error` |
| russian / malformed | `parseRecords` / `runRecordBatch` | карантин, `invalid++`, SyncLog issue, батч идёт |
| push 500 | C6 atomic-claim + откат | retry без дубля в mock |

Новый error-handling — только **внутри mock'а**: кривой `MOCK1C_*` / тело `POST /__control` → fail-fast / 400 (не молча), чтобы битый сценарий не выглядел как «прошло».

---

## 8. Тесты (ложатся на §6 CLAUDE.md)

- **Unit** (`mock-1c/**/*.test.ts`, без `PrismaClient` → авто-unit; добавить в `include` vitest): `serialize` (конверт/диалект/datetime/пагинация), `dataset` since-фильтр + touch + дубли, `leads` dedup, `config` fail-fast на кривом env.
- **Server-backed контракт-тест** (`oneCSync.adapter-rest.contract.test.ts` — НОВЫЙ): поднять `server.ts` на эфемерном порту, навести **реальный** `RestOneCAdapter` → инварианты через настоящий сокет: pull валиден по схемам, уважает `since`, конверт `[]`/`{items}`, 429+Retry-After ретраится, push → `acceptedAt`. **Дополняет**, не заменяет существующий fetch-stub [oneCSync.adapter-rest.test.ts](../../../src/__tests__/oneCSync.adapter-rest.test.ts) (тот проверяет логику адаптера изолированно; новый — реальный HTTP + сам mock). Без Postgres → unit-слой.
- **Integration 🟡** (gate L2.5, есть `PrismaClient`): один shadow-синк против mock → SyncLog `'check'` присутствует, строк в БД 0. Автоматизирует шаг 5 runbook'а; ручной runbook это уже покрывает.
- **Vitest-gotcha**: если добавим unit-тест React-компонента `/admin/sync` — `import React` обязателен (classic JSX transform, [[project-vitest-classic-jsx]]).
- Подход — TDD по `serialize`/`dataset`/`leads`/`config`.

---

## 9. Порядок реализации (черновик для writing-plans)

Ранние шаги ничего в `src/` не меняют; mock автономен.

1. `core/dataset.ts` (seed из фикстур + since-фильтр) + unit.
2. `core/serialize.ts` (конверт/диалект/datetime/пагинация) + unit (сердце).
3. `core/leads.ts` (dedup + Q5-наблюдение) + unit.
4. `config.ts` (env → ScenarioConfig, fail-fast) + unit.
5. `server.ts` (роуты + Bearer + аномалии + `__control`/`__state`/`__health`) + `package.json` script.
6. ESLint-guardrail + `vitest.config` include + `.env.example` блок.
7. Server-backed контракт-тест (эфемерный порт).
8. README mock'а + runbook shadow-репетиции в спеку/README проекта.
9. (🟡) Integration shadow-sync тест в gate-слое.

---

## 10. Открытые вопросы

Блокирующих внутренних нет. Замечания для writing-plans:

- **Алиас `@/` в `tsx`**: `core` импортирует фикстуры/схемы из `src/`. Проверить, резолвит ли `tsx mock-1c/server.ts` алиас `@/` (tsconfig paths) или использовать относительный путь. Фикстуры — чистые данные без рантайм-зависимостей, импорт безопасен.
- **Совпадение seed ↔ фикстуры**: resolvePartnerId связывает `partnerExternalId → Partner.slug`; для не-карантинного shadow-прогона seed должен содержать партнёров/орги с теми же slug, что в фикстурах. Зафиксировать в runbook.
- **Эфемерный порт в тесте**: слушать на `:0`, читать назначенный порт — избегаем коллизий портов в vitest (`fileParallelism:false`, но всё же).

---

## 11. Что НЕ входит (явно)

Верный симулятор 1С · OData/CommerceML/file-export · персистентность mock'а · деплой mock'а · фикс пагинации в адаптере (mock её только вскрывает) · решение Q-вопросов (делает их проверяемыми; решает встреча) · load/perf · изменение интерфейса `OneCAdapter` или `rest-wire.ts` (mock подстраивается под них, не наоборот).
