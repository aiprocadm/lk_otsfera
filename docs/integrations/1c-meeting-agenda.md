# Встреча с IT 1С — разблокировка Phase 3b (real REST adapter)

**Цель встречи:** закрыть 10 открытых вопросов, чтобы можно было написать `adapter-rest.ts` и заменить `ONE_C_ADAPTER=fake` на `rest` на staging.
**Длительность:** 60-90 мин.
**Pre-read:** [1c-contract.md](1c-contract.md) (Draft 0.1) — техническое описание 5 операций (`GET Organizations/Orders/Payments/Documents` + `POST Lead`).

## Стейкхолдеры

| Роль | Кого приглашаем | Зачем |
|---|---|---|
| Тех. лид IT 1С | (имя) | Финальные решения по интерфейсу + auth |
| Разработчик 1С | (имя) | Понимание справочников + статусов |
| Бухгалтерия (gathering) | (имя) | Валидация маппинга статусов и документов |
| Со стороны кабинета | вы / @aiproc.adm | Контекст + приёмка |

## Что нужно решить (10 вопросов с decision-матрицей)

### Группа A — Транспорт и доступ (must-decide на этой встрече)

| # | Вопрос | Что предлагаем по умолчанию | Какой формат ответа нам нужен | Priority |
|---|---|---|---|---|
| **1** | **Какой именно интерфейс отдаёт 1С?** | REST HTTP-сервисы — наименьшее трение для backend. Альтернативы: OData (если 1С это умеет «из коробки»), CommerceML (только если уже есть рабочий pipeline), файловые выгрузки (последний выбор — добавляет ~1 нед на парсер). | Один из: REST / OData / CommerceML / file-export. Если file-export — указать формат (XML/CSV) + расписание выгрузки. | 🔴 P0 |
| **2** | **Аутентификация** | Bearer token в header `Authorization: Bearer <token>`. Альтернативы: mTLS (если есть PKI), IP-allowlist + basic auth (самое слабое). | Решение + кто генерит токен. Если mTLS — кто issues certs. | 🔴 P0 |
| **3** | **IP-allowlist** | Кабинет (worker) ходит из VPC с **одним** outbound IP. Нужен IP/CIDR для конфигурации в 1С (даже если auth = bearer, многие 1С-инстансы блокируют не-allowlisted IP). | IP/CIDR (или подтверждение «не нужен IP-allowlist»). | 🔴 P0 |
| **4** | **Rate limits 1С** | Кабинет уважает любые лимиты + умеет backoff. Нам нужно знать число, чтобы настроить BullMQ retry (`attempts: 5, backoff: exponential delay 1000ms`). | Число запросов/мин и/или /час. Что произойдёт при превышении (429? задержка? blocking?). | 🟡 P1 |

### Группа B — Структура данных (must-decide для адаптера)

| # | Вопрос | Что предлагаем по умолчанию | Какой формат ответа нам нужен | Priority |
|---|---|---|---|---|
| **5** | **Структура «партнёра» в 1С** | Поле `partnerExternalId` на контрагенте/реализации (GUID 1С-справочника партнёров). Кабинет хранит mapping `Partner.externalId = 1c-partner-GUID`. | Что является первичным ключом партнёра в 1С: GUID справочника / `ИНН` / `slug` / отдельное поле на договоре? Для какой сущности это поле живёт: контрагент-партнёр, контрагент-заказчик, реализация (сделка)? | 🔴 P0 |
| **6** | **Cursor для инкрементальных синков** | `since` параметр в query string — ISO timestamp последнего изменения. 1С возвращает записи с `updatedAt > since`. Кабинет хранит cursor в `SyncLog`. Альтернативы: version-number (sequence), event-log (push-only). | Тип cursor'а: timestamp / version / event-log / full-only-no-incremental. Если timestamp — поле на каких объектах. | 🔴 P0 |
| **7** | **Datetime-формат** | UTC ISO-8601 (`2026-05-29T10:00:00Z`). Большинство 1С v8 это умеет. | UTC vs МСК. Формат конкретный (с/без миллисекунд, с/без timezone suffix). | 🟡 P1 |

### Группа C — Outbound и события (можно отложить, но желательно)

| # | Вопрос | Что предлагаем по умолчанию | Какой формат ответа нам нужен | Priority |
|---|---|---|---|---|
| **8** | **Push leads: endpoint в 1С** | `POST /api/leads` на стороне 1С. Body: `{partnerExternalId, customerName, customerInn, customerPhone, customerEmail, comment, attachments[]}`. Auth — тот же что в Q2. | URL endpoint'а + полный список обязательных полей + формат attachments (URL? base64? multipart?). Если 1С НЕ принимает push — alternative: 1С опрашивает наш `GET /api/integrations/1c/leads-outbound?since=…`. | 🟡 P1 |
| **9** | **Webhook от 1С → кабинет** | Идеально: 1С шлёт `POST {cabinet_url}/api/integrations/1c/webhook` при изменении заказа/платежа/документа. HMAC-signature header `X-1C-Signature` (SHA-256 от body с shared secret). Это снимает poll-нагрузку и улучшает latency. | Умеет ли 1С слать webhook'и? Если да — HMAC-secret + список событий, которые шлёт. Если нет — ОК, опрос по cursor продолжится. | 🟢 P2 |
| **10** | **Бизнес-стадии заказа: маппинг** | `executionStatus`: `new`/`in_progress`/`paused`/`completed`/`cancelled`. `financialStatus`: `unbilled`/`billed`/`partial`/`paid`/`refunded`. Нужна таблица соответствия с 1С-стадиями. | Полный список стадий 1С (`Состояние реализации` / `Статус оплаты`) + предложение маппинга от бухгалтерии. Если стадий больше чем у нас — мы их сворачиваем; если меньше — добавим (или расширим enum). | 🟡 P1 (но без неё нельзя go-live) |

## Структура встречи (60-90 мин)

| Минуты | Блок | Кто ведёт |
|---|---|---|
| 0-5 | Контекст: какая цель, что у нас уже работает на fake-адаптере | PM кабинета |
| 5-10 | Pre-read check: все читали [1c-contract.md](1c-contract.md)? Краткое прохождение по 5 операциям. | PM |
| 10-25 | **Группа A** (Q1-Q4) — транспорт + auth + IP + rate limits | Тех. лид 1С |
| 25-50 | **Группа B** (Q5-Q7) — структура партнёра + cursor + datetime | Разработчик 1С |
| 50-70 | **Группа C** (Q8-Q10) — push leads + webhook + маппинг стадий | Разработчик 1С + Бухгалтерия |
| 70-85 | **Action items** — что-кто-когда. Срок ответа по «отложенным» вопросам. | PM |
| 85-90 | Wrap. Когда следующий sync? | All |

## Action items template

Заполнить по итогам:

| # | Item | Owner | Due | Status |
|---|---|---|---|---|
| 1 | Решение по интерфейсу 1С (Q1) | IT 1С | <дата> | open |
| 2 | Выдать staging API token (Q2) | IT 1С | <дата> | open |
| 3 | Подтвердить IP кабинета (Q3) | Кабинет devops | <дата> | open |
| 4 | Прислать список стадий 1С (Q10) | Бухгалтерия | <дата> | open |
| ... | ... | ... | ... | ... |

## После встречи — что делает кабинет

1. Обновить [1c-contract.md](1c-contract.md): закрыть «Открытые вопросы», поднять версию до 1.0.
2. Создать новый план [docs/superpowers/plans/YYYY-MM-DD-partner-cabinet-phase3b-real-1c-rest.md](../superpowers/plans/) — поэтапная замена `adapter-fake.ts` на `adapter-rest.ts`, миграция fake → rest на staging, smoke на pilot-партнёре.
3. Если ответ Q1 = «file-export» — отдельная разработка парсера (~1 неделя), отразить в плане.
4. Обновить [.env.example](../../.env.example): раскомментировать `ONE_C_API_URL` и `ONE_C_API_TOKEN`, добавить описание.

## Связанные документы

- [1c-contract.md](1c-contract.md) — техническое описание операций (то, что показываем 1С-команде).
- [supabase-storage-rls.md](supabase-storage-rls.md) — отдельная storage-тема; на встрече не обсуждается.
- [Phase 3 DONE](../superpowers/plans/2026-05-21-partner-cabinet-phase3-DONE.md) — что у нас уже сделано (вся sync-инфра + leads + storage RLS).
- [Phase 3 plan §3](../superpowers/plans/2026-05-21-partner-cabinet-phase3.md) — оригинальный текст 10 вопросов с минимальной обвязкой.
