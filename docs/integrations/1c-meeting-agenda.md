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
| **5** | **Ключ партнёра 1С↔кабинет** (⚠️ см. callout «Реальность кода») | **Код матчит по `Partner.slug` в обе стороны** (inbound `partnerExternalId → Partner.slug`; outbound push шлёт `partnerSlug`). Колонки `Partner.externalId` **нет**. Дефолт: 1С хранит и эхо-ит slug кабинета. | Развилка: **(A)** 1С везде использует slug кабинета как ключ (A2 без миграции) — или **(B)** заводим `Partner.externalId = GUID 1С` (A2: миграция + правка resolver). Плюс: на какой сущности живёт ключ (контрагент-партнёр / реализация)? | 🔴 P0 |
| **6** | **Cursor + полнота ответа** | `since` параметр в query string — ISO timestamp последнего изменения. 1С возвращает записи с `updatedAt > since`. Кабинет хранит watermark в `SyncState` (high-water mark − 5 мин overlap). Альтернативы: version-number (sequence), event-log (push-only). | Тип cursor'а: timestamp / version / event-log / full-only-no-incremental. Если timestamp — поле на каких объектах. **Плюс полнота: один `since`-ответ отдаёт ВСЕ изменённые записи или пагинация (page/limit)?** Если пагинация — A2 обязан её реализовать (сейчас адаптер берёт только первую страницу → немой обрыв, см. callout). | 🔴 P0 |
| **7** | **Datetime-формат** | UTC ISO-8601 (`2026-05-29T10:00:00Z`). Большинство 1С v8 это умеет. | UTC vs МСК. Формат конкретный (с/без миллисекунд, с/без timezone suffix). | 🟡 P1 |

### Группа C — Outbound и события (можно отложить, но желательно)

| # | Вопрос | Что предлагаем по умолчанию | Какой формат ответа нам нужен | Priority |
|---|---|---|---|---|
| **8** | **Push leads: endpoint в 1С** | `POST /api/leads` на стороне 1С. Body — фактические поля DTO (см. [1c-contract.md §5](1c-contract.md)): `partnerSlug`, `cabinetLeadId`, `clientCompanyName`, `clientInn`, `clientContactName`, `clientContact{Phone,Email}`, `subject`, `estimatedAmount`, `productType`, `notes`. **Attachments пока НЕ шлём** (в DTO их нет). Auth — тот же что Q2. | URL endpoint'а + список обязательных полей + подтверждение дедупа по `cabinetLeadId` (контрактная гарантия идемпотентности). Если 1С НЕ принимает push — alt: 1С опрашивает наш `GET …/leads-outbound?since=…`. Attachments — отдельная будущая фича. | 🟡 P1 |
| **9** | **Webhook от 1С → кабинет** | Идеально: 1С шлёт `POST {cabinet_url}/api/integrations/1c/webhook` при изменении заказа/платежа/документа. HMAC-signature header `X-1C-Signature` (SHA-256 от body с shared secret). Это снимает poll-нагрузку и улучшает latency. | Умеет ли 1С слать webhook'и? Если да — HMAC-secret + список событий, которые шлёт. Если нет — ОК, опрос по cursor продолжится. | 🟢 P2 |
| **10** | **Бизнес-стадии заказа: маппинг** (⚠️ см. callout) | Коды кабинета (источник истины — `prisma/schema.prisma`): `executionStatus`: `pending`/`in_progress`/`completed`/`cancelled`/`on_hold`; `financialStatus`: `not_billed`/`billed`/`partially_paid`/`paid`/`refunded`. Нужна таблица соответствия с 1С-стадиями. | Полный список стадий 1С (`Состояние реализации` / `Статус оплаты`) + маппинг от бухгалтерии. **И ключевое: кто маппит** — 1С отдаёт уже наши коды, или присылает родные стадии, а сворачиваем мы (тогда A2 пишет translation-слой)? Если стадий больше — сворачиваем; меньше — расширяем enum (миграция). | 🟡 P1 (без неё нельзя go-live) |

## ⚠️ Реальность кода (сверено с `origin/main` 2026-06-06) — прочитать ведущему до встречи

Три пункта, где «дефолт» расходился с уже отгруженным кодом. Не закрыть на встрече → go-live ломается **молча**.

**Q5 — ключ партнёра.** `Partner` не имеет колонки `externalId` (есть только `slug @unique`). Код связывает партнёра по `slug` в обе стороны:
- inbound: `resolvePartnerId` делает `db.partner.findUnique({ where: { slug: partnerExternalId } })` ([sync-organizations.ts:18](../../src/worker/processors/sync-organizations.ts)) — значение поля `partnerExternalId` из 1С трактуется как **slug кабинета**;
- outbound: lead-push шлёт `partnerSlug = lead.partner.slug` ([push.ts:33](../../src/lib/services/oneCSync/push.ts)); поле `partnerExternalId` в push **не отправляется**.
- ⮑ Несогласованность имён полей: inbound `partnerExternalId` vs outbound `partnerSlug` — значение одно (slug), имена разные. Решить **(A)** slug кабинета как общий ключ (A2 без миграции, выровнять имена) или **(B)** `Partner.externalId = GUID 1С` (A2: миграция + правка `resolvePartnerId` + push). При несовпадении ключа орг не привяжется → skip `partner_not_found` (видно в `SyncLog`, не молча, но партнёрская витрина пустая).

**Q10 — статусы и кто маппит.** Значения enum в повестке раньше расходились с кодом — теперь синхронизированы с `prisma/schema.prisma`. Критично: `mapOrderDto` кладёт `dto.executionStatus as ExecutionStatus` **как есть**, а zod — `z.enum([наши коды])`. Значит код сейчас ждёт, что **1С присылает ровно наши английские коды**. Если 1С будет слать родные стадии («Выполнен», «Оплачено») — каждая запись уйдёт в карантин (`invalid`), синк отдаст 0 строк. Ответ Q10 определяет A2: либо 1С маппит у себя, либо A2 добавляет translation-слой в `rest-wire.ts` и zod принимает сырые строки до маппинга.

**Q6 — пагинация.** Контракт адаптера — `Promise<Dto[]>`, пагинации нет (осознанный non-goal спека Phase 3b при неизвестном объёме). `unwrapEnvelope` принимает массив или `{ items: [] }`. Если боевая 1С пагинирует — возьмём только первую страницу, остальное потеряется молча. Подтвердить; если пагинация есть — это переводит non-goal в required для A2.

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
4. Обновить [.env.example](../../.env.example): `ONE_C_API_URL`/`ONE_C_API_TOKEN` уже есть (закомментированы) — раскомментировать; переключить `ONE_C_ADAPTER=fake → rest`.

### Куда ложится каждый ответ (A2 landing-карта)

Спека Phase 3b изолировала всю спекуляцию в `rest-wire.ts` (blast radius — 1 файл). Карта «ответ → код»:

| Ответ | Файл/изменение | Тип |
|---|---|---|
| Q1 (пути/конверт) | `rest-wire.ts` → `ENDPOINTS`, `unwrapEnvelope` | константа |
| Q2 (auth) | `rest-wire.ts` → `buildAuthHeader` (Bearer уже дефолт) | константа |
| Q5 = **(A)** slug | `PARTNER_KEY_FIELD='partnerSlug'` уже добавлен в `rest-wire.ts` (no-op для A); при желании выровнять имя inbound-поля на slug | константа (готово) |
| Q5 = **(B)** GUID | флип `PARTNER_KEY_FIELD='partnerExternalId'`; `prisma`: `Partner.externalId String? @unique` + аддитивная миграция; `resolvePartnerId` → match по `externalId`; `mapLeadToPayload` → `partnerExternalId` | **миграция + код** |
| Q6 (пагинация = да) | `adapter-rest.ts` → постраничный pull; меняет non-goal спеки | **код (структурный)** |
| Q7 (datetime без offset) | `rest-wire.ts` → `formatSince` + нормализация в `schemas.ts` (иначе `Date.parse` = локальное время сервера) | константа |
| Q10 = 1С шлёт родные стадии | `rest-wire.ts` → status-map; `schemas.ts` → ослабить `z.enum` до `string`, маппить до Prisma-enum | **код** |
| Q10 = 1С шлёт наши коды | ничего (zod уже валидирует наши коды) | — |
| Q8 (push body) | `rest-wire.ts` → `buildLeadBody` | константа |

## Связанные документы

- [1c-contract.md](1c-contract.md) — техническое описание операций (то, что показываем 1С-команде).
- [supabase-storage-rls.md](supabase-storage-rls.md) — отдельная storage-тема; на встрече не обсуждается.
- [Phase 3 DONE](../superpowers/plans/2026-05-21-partner-cabinet-phase3-DONE.md) — что у нас уже сделано (вся sync-инфра + leads + storage RLS).
- [Phase 3 plan §3](../superpowers/plans/2026-05-21-partner-cabinet-phase3.md) — оригинальный текст 10 вопросов с минимальной обвязкой.
