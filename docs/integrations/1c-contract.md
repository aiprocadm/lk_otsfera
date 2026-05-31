# Контракт интеграции с 1С — Партнёрский кабинет

**Дата:** 2026-05-21
**Версия:** 0.1 (Draft — для согласования с IT 1С)
**Связано:** Phase 0 партнёрского кабинета

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
  "partnerExternalId": "string (ID партнёра в 1С)",
  "updatedAt": "2026-05-01T10:00:00Z"
}]
```

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

### 5. POST Lead (Заявка от партнёра в 1С)

`POST /api/leads`

```json
{
  "partnerExternalId": "...",
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

- [ ] Какой именно интерфейс отдаёт 1С: HTTP-сервисы (REST), OData, CommerceML, файловые выгрузки?
- [ ] Domain/URL продукционной 1С
- [ ] IP-адреса для allowlist (production кабинета)
- [ ] Лимиты API (rate limits): запросов в минуту
- [ ] Структура «партнёра» в 1С — есть ли поле «партнёр» на контрагенте/реализации, или маппинг через справочник?
- [ ] TZ и формат datetime в API (UTC ISO 8601?)
- [ ] Идентификация партнёра при push-leads (`partnerExternalId` или `partnerSlug` — что в 1С первичный ключ?)
- [ ] Может ли 1С отдавать `since`-курсор по timestamp, или только полные выгрузки?
- [ ] Какие статусы есть в 1С и как они мапятся в наши `executionStatus`/`financialStatus`?

## Стейкхолдеры

- [ ] IT 1С — реализация эндпоинтов
- [ ] Бухгалтерия — валидация маппинга статусов и документов
- [ ] PM партнёрского кабинета — приёмка
