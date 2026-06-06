# Контракт интеграции с 1С — Партнёрский кабинет

**Дата:** 2026-05-21 (сверено с отгруженным кодом 2026-06-06)
**Версия:** 0.2 (Draft — сверено с кодом Phase 3b; → 1.0 после встречи с IT 1С)
**Связано:** [1c-meeting-agenda.md](1c-meeting-agenda.md) (10 вопросов) · [Phase 3b readiness](../superpowers/specs/2026-05-31-1c-phase3b-readiness-design.md) · Phase 0 партнёрского кабинета

> **v0.2 changelog:** сверено с `prisma/schema.prisma` + `src/lib/services/oneCSync/*`. Исправлено: ключ партнёра = `Partner.slug` (не GUID, колонки `externalId` нет); статусы приведены к фактическим enum; добавлены конвенции datetime/конверта/пагинации; `legalName` на Organization не хранится. Открытые вопросы перенумерованы под Q1–Q10 повестки.

## Цель

Документ фиксирует требования к API/интерфейсу 1С со стороны кабинета. Без согласования и реализации со стороны IT 1С Фаза 3 (включение реального 1С) невозможна.

## Запрашиваемые операции

### 1. GET Organizations (Контрагенты)

`GET /api/organizations?since=ISO_TS`

Возвращает контрагентов, у которых дата последнего изменения > `since`.

Response (JSON массив):
```json
[{
  "externalId": "string (GUID или внутр. ID 1С)",
  "name": "ООО Завод",
  "legalName": "...",
  "inn": "770000",
  "kpp": "770001",
  "partnerExternalId": "string (= slug партнёра в кабинете, см. «Ключ партнёра»)",
  "updatedAt": "2026-05-01T10:00:00Z"
}]
```

> **Примечания (сверено с кодом):**
> - `partnerExternalId` матчится по `Partner.slug` ([sync-organizations.ts:18](../../src/worker/processors/sync-organizations.ts)) — см. раздел [«Ключ партнёра»](#ключ-партнёра-q5). Не совпало → орг сохраняется, но без привязки к партнёру (skip `partner_not_found` в `SyncLog`).
> - `legalName` для Organization **не сохраняется** (колонки нет; `mapOrgDto` его отбрасывает — `legalName` есть только у `Partner`). Можно не присылать.

### 2. GET Orders (Реализации/Сделки)

`GET /api/orders?since=ISO_TS`

```json
[{
  "externalId": "string",
  "orderNumber": "2410-15",
  "title": "Краткое описание",
  "organizationExternalId": "...",
  "totalAmount": 250000,
  "paidAmount": 250000,
  "paidAt": "2026-04-20T14:00:00Z",
  "contractSignedAt": "2026-04-12T10:00:00Z",
  "completedAt": "2026-05-10T18:00:00Z",
  "closedAt": "2026-05-12T10:00:00Z",
  "vatIncluded": true,
  "vatRate": 0.2,
  "executionStatus": "pending|in_progress|completed|cancelled|on_hold",
  "financialStatus": "not_billed|billed|partially_paid|paid|refunded",
  "productMix": ["training", "service", "supply"],
  "updatedAt": "2026-05-12T10:00:00Z"
}]
```

> **Статусы (Q10, сверено с `prisma/schema.prisma`).** `executionStatus ∈ {pending, in_progress, completed, cancelled, on_hold}`; `financialStatus ∈ {not_billed, billed, partially_paid, paid, refunded}`. Код валидирует через `z.enum([эти коды])` и кладёт значение **как есть** (`mapOrderDto`) — translation-слоя нет. ⮑ На встрече решить (Q10): 1С отдаёт **ровно эти коды**, или присылает родные стадии, а маппинг пишет кабинет (тогда A2 добавляет слой). Любое иное значение → запись в карантин (`invalid`).

### 3. GET Payments (Поступления)

`GET /api/payments?since=ISO_TS`

```json
[{
  "externalId": "...",
  "orderExternalId": "...",
  "amount": 250000,
  "paidAt": "2026-04-20T14:00:00Z",
  "method": "wire|card|cash",
  "isRefund": false,
  "updatedAt": "2026-04-20T14:00:00Z"
}]
```

### 4. GET Documents (Файлы по сделкам)

`GET /api/documents?since=ISO_TS`

```json
[{
  "externalId": "...",
  "orderExternalId": "...",
  "type": "contract|extra_agreement|invoice|act|waybill|certificate|report|other",
  "name": "Договор 245.pdf",
  "mimeType": "application/pdf",
  "size": 248000,
  "signedAt": "2026-04-12T10:00:00Z",
  "downloadUrl": "https://1c.example.com/files/abc123",
  "updatedAt": "2026-04-12T10:00:00Z"
}]
```

`downloadUrl` должен:
- Быть подписанным (signed URL с TTL ≥ 5 мин), либо
- Использовать Bearer-токен в Authorization header.

> **`type` (сверено).** Inbound-набор: `contract, extra_agreement, invoice, act, waybill, certificate, report, other` (8 значений). Prisma-enum `DocumentType` содержит ещё `commission_statement`, но это **внутренний** документ кабинета (генерится сам, 1С его не присылает) — намеренно вне inbound-схемы. Неизвестный `type` → карантин записи.

### 5. POST Lead (Заявка от партнёра в 1С)

`POST /api/leads`

```json
{
  "partnerSlug": "...",
  "cabinetLeadId": "cuid",
  "clientCompanyName": "...",
  "clientInn": "...",
  "clientContactName": "...",
  "clientContactPhone": "...",
  "clientContactEmail": "...",
  "subject": "...",
  "estimatedAmount": 100000,
  "productType": ["training"],
  "notes": "..."
}
```

Response:
```json
{
  "acceptedAt": "2026-05-21T10:00:00Z",
  "oneCRequestId": "..."
}
```

> `partnerSlug` здесь — тот же ключ, что и `partnerExternalId` на inbound (оба = `Partner.slug`). Имена полей разные **намеренно временно**; выравнивание — решение Q5 (см. ниже).

## Ключ партнёра (Q5)

**Текущее состояние кода (сверено 2026-06-06):** общий ключ партнёра между 1С и кабинетом — это **`Partner.slug`** кабинета. Колонки `Partner.externalId` в схеме нет.

| Направление | Поле в JSON | Как используется в коде |
|---|---|---|
| inbound (Organizations/Orders) | `partnerExternalId` | `findUnique({ where: { slug: partnerExternalId } })` — трактуется как slug |
| outbound (POST Lead) | `partnerSlug` | `lead.partner.slug` |

**Развилка для встречи:**
- **(A) slug как общий ключ** — 1С хранит slug каждого партнёра кабинета и эхо-ит его. Кабинетная работа A2: только выровнять имена полей. Операционно: кто-то заводит slug'и в 1С и держит их стабильными.
- **(B) GUID 1С как ключ** — заводим `Partner.externalId String? @unique` (аддитивная миграция), `resolvePartnerId`/push переходят на него. Чище (GUID неизменен; slug human-facing и может меняться), но это код+миграция в A2.

## Форматы и конвенции (Q1/Q6/Q7)

- **Конверт ответа (Q1).** Кабинет принимает либо голый JSON-массив, либо `{ "items": [...] }` (`unwrapEnvelope`). Иной конверт → ошибка job'а → BullMQ retry.
- **Datetime (Q7).** Все timestamp'ы — **с явным offset/`Z`** (UTC ISO-8601 `2026-05-29T10:00:00Z` или `+03:00`). ⚠️ Строка без зоны (`2026-05-29 10:00:00`) парсится `Date.parse` как **локальное время сервера** → молчаливый сдвиг. Если 1С отдаёт МСК без суффикса — зафиксировать, A2 нормализует.
- **Полнота / пагинация (Q6).** Сейчас один `since`-запрос должен вернуть **все** изменённые записи: адаптер `pull*(): Promise<Dto[]>`, пагинации нет (non-goal спека при неизвестном объёме). Если 1С пагинирует — взять надо все страницы, иначе молчаливый обрыв; это работа A2.

## Аутентификация

Один из вариантов на выбор IT 1С:
- Bearer token в header (предпочтительно)
- Mutual TLS
- IP-allowlist + basic auth

## Идемпотентность

**Pull (inbound).** Кабинет может повторно запрашивать тот же `since` (например, после рестарта или в пределах safety-overlap инкрементального курсора). 1С должна возвращать стабильные `externalId` — повторные запросы не должны порождать «дубли с другим ID».

**Push (outbound leads).** 1С **обязана дедуплицировать заявки по `cabinetLeadId`**: повторный `POST /api/leads` с тем же `cabinetLeadId` не должен создавать второй объект — возвращается результат исходного приёма (тот же `oneCRequestId`). Это контрактная гарантия: кабинет ретраит push при сбоях сети/таймаутах (BullMQ + request-level retry), поэтому один и тот же `cabinetLeadId` может прийти более одного раза. На стороне кабинета есть быстрый guard (`Lead.pushedToOneCAt`), но он не покрывает гонку «push прошёл — запись в БД упала», поэтому окончательная защита от дубля — на стороне 1С.

## Расписание запросов

Кабинет будет опрашивать с частотой:
- Orders: каждые 15 мин
- Payments: каждые 15 мин
- Documents: каждый час
- Organizations: каждые 6 часов
- Reconcile (полный с last 30 дней): раз в сутки в 03:00

Если 1С может **push-ить webhook** — фиксируем endpoint:
`POST {cabinet_url}/api/integrations/1c/webhook`
- Auth: HMAC-signature header `X-1C-Signature` (SHA-256 от body с shared secret)

## Открытые вопросы

Нумерация = Q1–Q10 в [1c-meeting-agenda.md](1c-meeting-agenda.md) (единый источник; здесь — короткое зеркало).

- [ ] **Q1** Интерфейс 1С: REST / OData / CommerceML / file-export? + конверт ответа (массив / `{items}`).
- [ ] **Q2** Аутентификация (Bearer / mTLS / IP+basic); кто генерит токен.
- [ ] **Q3** IP/CIDR кабинета для allowlist 1С (или подтверждение «не нужен»).
- [ ] **Q4** Rate limits 1С (запросов/мин·час) + поведение при превышении (429?).
- [ ] **Q5** Ключ партнёра: **(A)** slug кабинета как ключ или **(B)** `Partner.externalId`=GUID 1С (см. [«Ключ партнёра»](#ключ-партнёра-q5)).
- [ ] **Q6** Cursor (timestamp / version / event-log / full-only) **+ пагинация** (всё в одном ответе?).
- [ ] **Q7** Datetime: UTC vs МСК, обязателен offset/`Z` (см. [«Форматы»](#форматы-и-конвенции-q1q6q7)).
- [ ] **Q8** Push leads: URL endpoint'а, обязательные поля, формат attachments.
- [ ] **Q9** Webhook 1С→кабинет (есть/нет; HMAC-secret + список событий).
- [ ] **Q10** Стадии 1С → коды кабинета **+ кто применяет маппинг** (1С или кабинет).

## Стейкхолдеры

- [ ] IT 1С — реализация эндпоинтов
- [ ] Бухгалтерия — валидация маппинга статусов и документов
- [ ] PM партнёрского кабинета — приёмка
