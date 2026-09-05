# Этап 8 «Выгрузка документов в 1С» — план

Спека — [2026-09-02-stage8-document-push-design.md](../specs/2026-09-02-stage8-document-push-design.md)
(предъявлена 02.09.2026, PR [#482](https://github.com/aiprocadm/lk_otsfera/pull/482);
**подтверждена 03.09.2026** мержем спеки владельцем; восемь умолчаний §6 действуют).
Требования `У-167`…`У-174` действующего
[ТЗ кабинетов, документов и интеграций](../../tz/2026-08-21-tz-cabinets-documents-integrations.md);
закрывает дефекты `Д-23`…`Д-26` и остаток `У-159` этапа 6 (события выгрузки в
1С и её повтора в журнале аудита).

REQUIRED SUB-SKILL: superpowers:subagent-driven-development

## Разбивка

| PR | Что | Требования | Статус |
|---|---|---|---|
| PR-1 «Контракт и модель» | Секция `POST /api/documents` и `GET /api/documents?externalId=` в контракте; перечисления `OneCPushStatus` (шесть значений сразу) и `OneCDocumentPushMode`; шесть полей `Document`, два поля `Company`, две проверки базы, одна миграция | `У-167` (контракт), `У-168` (модель) | ✅ [#483](https://github.com/aiprocadm/lk_otsfera/pull/483) |
| PR-2 «Адаптер и mock» | `OneCDocumentPushSchema` и результат, `pushDocument` в `OneCAdapter` (fake, rest, file), ключ `documentPush`, хранилище документов и обработчик в `mock-1c`, `/__state` показывает принятое, контрактный тест | `У-167`, `У-168` | ✅ [#484](https://github.com/aiprocadm/lk_otsfera/pull/484) |
| PR-3 «Очередь и процессор» | Очередь `oneCSync.pushDocument`, сборка тела (`externalId` — корень цепочки перевыпусков, `fileUrl` на час, `lines: null` у legacy), сервис выгрузки с идемпотентностью по версии и отказом КП, процессор с интеграционным тестом, события аудита | `У-168`, `У-167` (идемпотентность, `Р-14`), `У-159` (остаток) | ✅ [#485](https://github.com/aiprocadm/lk_otsfera/pull/485) |
| PR-4 «Правило компании» | `auto / manual / never` и набор типов в «Реквизитах исполнителя» у администратора и руководителя, автопостановка после выпуска best-effort | `У-169` (правило) | ✅ [#486](https://github.com/aiprocadm/lk_otsfera/pull/486) |
| PR-5 «Экраны выгрузки» | Блок «Выгрузка в 1С» на карточке документа с кнопками «Выгрузить в 1С» / «Повторить», фильтр по статусу выгрузки и массовое «Выгрузить выбранные» в списке документов сотрудников | `У-169` (экраны), `У-159` (повтор) | ✅ [#487](https://github.com/aiprocadm/lk_otsfera/pull/487) |
| PR-6 «Обратная связь» | Поиск входящего по трём ключам без дубля, обновление файла с повторным сканом, `direction` и `number` из DTO | `У-170` (`Д-24`, `Д-25`) | ✅ [#488](https://github.com/aiprocadm/lk_otsfera/pull/488) |
| PR-7 «Реквизиты контрагента» | Реквизиты в схеме, маппере и writer'е; пустое из 1С не затирает заполненное; фикстуры, набор данных mock и контракт | `У-171` (`Д-23`) | ✅ [#489](https://github.com/aiprocadm/lk_otsfera/pull/489) |
| PR-8 «Сверка» | `findDocument` в адаптере, поштучная сверка `pushed`, `failed: missing_in_1c`, зависшие лиды | `У-172` (`Д-26`) | ✅ [#490](https://github.com/aiprocadm/lk_otsfera/pull/490) |
| PR-9 «Файловый канал» | Вкладка «Выгрузка документов»: фильтр → Excel-реестр + ZIP, отметка `exported_file`, пакет в «Истории» | `У-173` | ✅ [#491](https://github.com/aiprocadm/lk_otsfera/pull/491) |
| PR-10 «Видимость ошибок» | Светофор «документов не выгружено: N», каждая попытка в истории, порог алерта по `У-126`, уведомление об окончательном отказе | `У-174` | 🔨 [#PRN](https://github.com/aiprocadm/lk_otsfera/pull/PRN) в ревью |

**Порядок обязателен:** PR-1 → PR-2 → PR-3 → PR-4 → PR-5: нельзя ставить в
очередь то, чего адаптер не умеет, и нельзя рисовать кнопку тому, чего очередь
не делает. PR-6, PR-7 и PR-8 не зависят друг от друга и от выгрузки — это
починка входящего потока, любой из них можно вести сразу после PR-1 (PR-8 —
после PR-2, ему нужен адаптер). PR-9 и PR-10 — последними: они показывают то,
что к тому времени уже работает. Каждый PR открывается от `main` с
`base: main` (§14): следующий ждёт мержа предыдущего.

**Два решения исполнителя, принятые при написании плана (спеке не
противоречат, но в ней не записаны):**

1. **Идентичность документа в 1С — первая версия цепочки перевыпусков.** В
   теле выгрузки `externalId` — это `id` первой версии (корень по
   `replacesDocumentId`), а не `id` строки. Перевыпуск (`У-151`) создаёт НОВУЮ
   строку `Document` с тем же номером и большей `version`; если бы в 1С уезжал
   `id` строки, перевыпуск выглядел бы вторым документом, и «повтор с новой
   версией — обновление» из `У-167` не работало бы никогда. Отсюда же:
   `oneCExternalId` не уникален (версии одной цепочки делят его), а заменённые
   строки (`supersededAt`) выгрузка и сверка пропускают.
2. **`exported_file` заводится сразу в PR-1**, а не в PR-9. Добавить значение в
   существующее перечисление Postgres — отдельная миграция, и использовать его
   в той же транзакции нельзя (урок этапа 7). Заведя все шесть значений одним
   `CREATE TYPE`, PR-9 обходится без второй миграции.

## PR-1 «Контракт и модель» — `У-167` (контракт), `У-168` (модель)

- [x] `docs/integrations/1c-contract.md`: секция **«6. POST Documents
      (выгрузка документов ЛК в 1С)»** — путь `/api/documents` (тот же, что у
      входящего `GET`, другой метод; ключ `documentPush` в `ENDPOINTS`), тело
      по `У-167` (`externalId`, `type` из четырёх значений, `number`, `date`,
      `version`, `counterparty`, `order | null`, `parentDocument | null`,
      `lines | null`, `totals | null`, `fileUrl`), ответ `{ "externalId" }`;
      правила: идемпотентность по паре `externalId` + `version`, `externalId` —
      первая версия цепочки, `fileUrl` живёт час, КП не приходит никогда
      (`Р-14`). Секция **«7. GET Documents по `externalId`»** для сверки
      (`У-172`): `GET /api/documents?externalId=…` → `[]` либо один элемент в
      формате секции 4. Абзац «Push (outbound documents)» в «Идемпотентности».
- [x] `prisma/schema.prisma`: `enum OneCPushStatus { none pending pushed failed
      skipped exported_file }` и `enum OneCDocumentPushMode { auto manual never }`
      с комментариями-«почему».
- [x] Шесть полей `Document`: `oneCExternalId String?`, `oneCPushStatus
      OneCPushStatus @default(none)`, `oneCPushedAt DateTime?`,
      `oneCPushAttempts Int @default(0)`, `oneCPushError String?`,
      `oneCPushedVersion Int?`; индексы `@@index([oneCPushStatus])` (фильтр
      списка, сверка) и `@@index([oneCExternalId])` (поиск входящего по второму
      ключу, `У-170`). Без `@unique` — см. решение 1 выше.
- [x] Два поля `Company`: `oneCDocumentPushMode OneCDocumentPushMode
      @default(manual)` и `oneCDocumentPushTypes DocumentType[]
      @default([invoice, act, contract, extra_agreement])`.
- [x] Миграция `20260903100000_stage8_document_push_model` — одна, аддитивная,
      ни одной существующей строки не меняет (новые перечисления создаются
      целиком, запрет Postgres касается только добавления значения в
      существующий тип). Две проверки базы:
      `Company_oneCDocumentPushTypes_pushable` — набор ⊆ {счёт, акт, договор,
      ДС}: КП не попадёт в набор даже мимо интерфейса (`Р-14`);
      `Document_oneC_pushed_has_version` — `pushed` только вместе с
      `oneCPushedAt` и `oneCPushedVersion`: «выгружен, но неизвестно какая
      версия» сломало бы идемпотентность 3.1.
- [x] Тесты: `schema.enums.test.ts` — состав обоих перечислений;
      `migrations.stage8-document-push-model.integration.test.ts` на живом
      Postgres — умолчания (`none`, `0`, `manual`, четыре типа), КП в наборе —
      отказ `23514`, `pushed` без версии — отказ, две версии с одним
      `oneCExternalId` — записываются обе.
- [x] Мутации: снять `Company_oneCDocumentPushTypes_pushable` → «КП в наборе»
      проходит; снять `Document_oneC_pushed_has_version` → «pushed без версии»
      проходит; убрать `exported_file` из перечисления → тест состава падает.
- [x] `STATUS.md` (заголовок, абзац «Идёт PR-1», строка таблицы, журнал),
      `AUDIT.md` (`У-167`, `У-168` — «контракт/модель готовы (PR-1)», вердикт
      остаётся `⏳`), `CHANGELOG.md`.

## PR-2 «Адаптер и mock» — `У-167`, `У-168`

- [x] `schemas.ts`: `ONE_C_PUSHABLE_TYPES = ['invoice', 'act', 'contract',
      'extra_agreement'] as const` — единственный источник «что уезжает»
      (страж: совпадает с умолчанием `Company.oneCDocumentPushTypes` и с CHECK
      миграции PR-1); `OneCDocumentPushSchema` — тело контракта, `type` из
      `ONE_C_PUSHABLE_TYPES`, `lines`/`totals`/`order`/`parentDocument`
      допускают `null`, `fileUrl` — `z.string().url()`;
      `OneCDocumentPushResultSchema = z.object({ externalId: z.string().min(1) })`.
      `dto.ts`: `OneCDocumentPushPayload`, `OneCDocumentPushResult`.
- [x] `adapter.ts`: `pushDocument(payload: OneCDocumentPushPayload):
      Promise<OneCDocumentPushResult>`. `rest-wire.ts`: `ENDPOINTS.documentPush
      = '/api/documents'`. `adapter-rest.ts`: POST через `doFetch` +
      `withRetry/withTimeout`, ответ через `OneCDocumentPushResultSchema`.
      `adapter-fake.ts`: `FAKE_ONEC_FAILURE_RATE` как у лидов, `externalId`
      детерминированный (`1c-doc-<externalId>`) — повтор с той же версией
      обязан дать тот же ответ. `adapter-file.ts`: файловый адаптер наружу не
      пишет — `pushDocument` бросает `FileOneCAdapter is read-only` (то же
      сообщение, что у его `pushLead`; текст из плана заменён на фактический,
      чтобы не плодить два разных сообщения об одном и том же).
- [x] `mock-1c/core/documents.ts`: `createDocumentStore()` по образцу
      `leads.ts` — `accept(body)` проверяет тело схемой, ключ хранения —
      `externalId`: та же версия → тот же ответ и без изменений (no-op), версия
      выше → запись обновляется, версия ниже → 409. `server.ts`: обработчик
      `POST ENDPOINTS.documentPush`, `/__state` отдаёт `documents`.
- [x] `adapter-rest.contract.test.ts`: выгрузка через `RestOneCAdapter` против
      живого mock-сервера → документ в `/__state`; повтор той же версии —
      документ один; новая версия — обновлён; тело без `counterparty` — 400.
- [x] Мутации: `OneCDocumentPushSchema` принимает `commercial_proposal` → тест
      схемы падает; mock заводит вторую запись на ту же версию → контрактный
      тест падает; `ONE_C_PUSHABLE_TYPES` разошёлся с CHECK миграции → страж
      падает. **Проверено 03.09.2026:** мутация 1 роняет 5 тестов (схема,
      mock, страж — все три рубежа), мутация 2 — 14 (контрактный тест и тест
      хранилища), мутации по `schema.prisma`, по массиву CHECK и по
      переименованию CHECK (шаблон «не нашёл») — по одному тесту стража.
- [x] Дополнительно к плану: фикстура тела выгрузки вынесена в
      `src/__tests__/helpers/oneCDocumentPush.ts` (один источник для тестов
      схем, адаптеров и `mock-1c`; jscpd-порог 3 %); страж
      `oneCSync.pushable-types.guardrail.test.ts` сверяет три места
      (`ONE_C_PUSHABLE_TYPES`, `@default` в `schema.prisma`, `ARRAY[...]` в
      CHECK миграции); в `RestOneCAdapter` POST-ветка вынесена в приватный
      `postJson` (лид и документ шли бы одинаковым кодом); контракт (секция 6,
      пункт `order`) уточнён: `order.externalId: null` при заполненном
      `orderNumber` — заказ заведён в кабинете и в 1С не бывал.
- [x] `STATUS.md`, `AUDIT.md`, `CHANGELOG.md`, `mock-1c/README.md`.


## PR-3 «Очередь и процессор» — `У-168`, `У-167` (идемпотентность, `Р-14`), `У-159` (остаток)

- [x] `queues.ts`: `'oneCSync.pushDocument'` в `QUEUE_NAMES`, данные задачи
      `{ documentId }`. Собственный `jobId` НЕ задаётся: BullMQ молча
      отбрасывает задачу с `jobId`, который ещё лежит среди завершённых
      (`removeOnComplete: { count: 1000 }`), и «Повторить» после успеха или
      отказа перестало бы работать. От двойной доставки защищает сравнение
      версий в самом процессоре, а от двойной постановки — статус `pending`
      (`already_queued` в PR-5).
- [x] `src/lib/services/oneCSync/pushDocument.ts`:
      `buildDocumentPushPayload(prisma, documentId)` — `externalId` = корень
      цепочки по `replacesDocumentId` (цикл с ограничением глубины);
      `counterparty` из `Organization`/`Partner` по `counterpartyType`;
      `order` из `Order.externalId`/номера или `null`; `parentDocument` —
      корень цепочки родителя + номер или `null`; `lines` из `DocumentLine`
      либо `null`, когда строк нет (3.5); `totals` из `amountNet/Vat/Gross`
      либо `null`; `fileUrl` через `createSignedUrl(path, 3600)` (3.4;
      константа `ONE_C_FILE_URL_TTL_SECONDS`); `date` — `createdAt`.
      `pushDocumentToOneC(prisma, documentId, { adapter })` по образцу
      `pushLeadToOneC`: КП или иной тип вне `ONE_C_PUSHABLE_TYPES` →
      `{ ok: false, error: 'not_pushable_type' }` (3.2); **схема PR-2 требует
      `counterparty.inn` и `number` непустыми** (по контракту 1С без ИНН и без
      номера документ не примет) — организация без ИНН (`Р-11`, `Organization.inn`
      nullable) → `{ ok: false, error: 'counterparty_without_inn' }`, документ
      без номера (`Document.number` nullable) → `{ ok: false, error:
      'no_number' }`; оба — окончательный отказ без retry, с русской строкой в
      `errors/messages.ts` («у организации не заполнен ИНН — заполните реквизиты
      и повторите»), а не падение на `OneCDocumentPushSchema.parse`; строка с
      `supersededAt` → `'superseded'` (уезжает действующая версия);
      `oneCPushStatus = pushed` и `oneCPushedVersion === version` → `{ ok:
      true, skipped: 'same_version' }` без вызова адаптера (3.1); иначе вызов,
      успех → `pushed`, `oneCExternalId`, `oneCPushedAt`, `oneCPushedVersion`,
      `oneCPushError: null`; отказ → `failed` + текст + `oneCPushAttempts + 1`,
      исключение пробрасывается ради retry BullMQ. `writeSyncLog({ entity:
      'document', direction: 'outbound', operation: 'create' | 'update' })` на
      каждую попытку — на ней держится «история — каждую попытку» PR-10.
      `enqueueDocumentPush(documentId)` — `pending` → постановка; постановка
      упала → вернуть прежний статус, `log.error`, проглотить (§3, 3.3).
- [x] Аудит (`У-159`): `document_pushed_to_1c`, `document_push_to_1c_failed`
      в `AUDIT_ACTIONS` и русские названия в `labels.ts`.
- [x] `src/worker/processors/push-document.ts` по образцу `push-lead.ts`
      (`primeIntegrationSettingsCache` → сервис); `worker/index.ts` —
      `startWorker`.
- [x] `worker.push-document.integration.test.ts` (страж полноты
      `worker.processor-coverage`), живой Postgres и подставной адаптер:
      выгрузка заполняет шесть полей; вторая задача той же версии — адаптер не
      вызван; перевыпуск — адаптер вызван с тем же `externalId` и `version + 1`;
      КП — `not_pushable_type`, поля не тронуты; адаптер бросил — `failed`,
      текст, счётчик, исключение наружу; документ без строк — `lines: null`,
      `totals: null`; постановка при недоступном Redis — статус прежний, ошибка
      в логе, вызов не бросил.
- [x] Мутации: убрать сравнение версий → «вторая задача» вызывает адаптер;
      разрешить КП; брать `id` строки вместо корня → перевыпуск уезжает под
      новым `externalId`; `enqueueDocumentPush` пробрасывает ошибку → тест
      «недоступный Redis» падает. **Проверено 03.09.2026** на интеграционном
      тесте: мутация 1 роняет 2 теста («вторая задача» и `same_version` у
      процессора), мутация 2 — 3 (КП у сервиса, у процессора и у продюсера),
      мутации 3 и 4 — по одному целевому тесту.
- [x] Решения исполнителя по ходу PR-3 (спеке не противоречат, в ней не
      записаны):
      1. **Сервис отдаёт Result, а не бросает.** Исключение наружу — только
         у процессора и только на `push_failed` (адаптер не смог — retry
         BullMQ). Окончательные отказы (`not_pushable_type`, `superseded`,
         `counterparty_without_inn`, `no_number`) задачу не роняют: повтор
         не поможет, пока человек не поправит документ, а `removeOnFail:
         false` копил бы «падения», которые падениями не являются.
      2. **Два вида отказа трогают поля по-разному.** КП и заменённая
         версия — выгружать нечего, поля не тронуты (только `pending → none`,
         если задачу успели поставить до перевыпуска). Нет ИНН / нет номера —
         `failed` + русский текст + `oneCPushAttempts + 1` + событие аудита:
         человек должен увидеть на карточке, что и почему.
      3. **Аудит — от актора, иначе от автора документа** (`actorUserId ??
         uploadedById`; `AuditLog.userId` обязателен). Ни того ни другого
         (импорт, задача без актора) — события нет, след остаётся в `SyncLog`.
         Падение аудита выгрузку не отменяет (`log.error`).
      4. **`SyncLog.operation`:** `create` — первая выгрузка цепочки, `update` —
         перевыпуск (корень ≠ id строки) или документ, который 1С уже знает
         (`oneCExternalId` заполнен). `externalId` в `SyncLog` — наш `id`
         строки (по нему PR-10 соберёт историю попыток документа).
      5. **Постановка — атомарный claim `pending`** (`updateMany` с `not:
         'pending'`; ноль строк → `already_queued`), без `jobId`; при сбое
         очереди статус возвращается прежний, вызов не бросает.
      6. **Основание без номера** (`parentDocument.number = null` — только
         загрузка или импорт) для 1С не адресуемо: `parentDocument: null`,
         бумага уезжает сама по себе.
      7. **Успешная выгрузка тоже увеличивает `oneCPushAttempts`** — счётчик
         означает «попыток всего», а не «неудач».
- [x] Отложено в PR-5/PR-6 (решить вместе с ключами поиска `У-170`): документ,
      пришедший ИЗ 1С (`Document.externalId` заполнен), обратно не выгружать —
      кнопка «Выгрузить» ему не нужна, а 1С получила бы свою же бумагу под
      чужим `externalId`.
- [x] `STATUS.md`, `AUDIT.md`, `CHANGELOG.md`.

## PR-4 «Правило компании» — `У-169` (правило)

- [x] `src/lib/services/admin/oneCDocumentPushRule.ts`:
      `getOneCDocumentPushRule(prisma, session)` и
      `updateOneCDocumentPushRule(prisma, session, { mode, types })` — только
      `admin` и `leader` своей компании (`Р-22`), остальным `forbidden`; `types`
      ⊆ `ONE_C_PUSHABLE_TYPES` (`invalid_types`); аудит
      `company_onec_push_rule_changed` с русским названием.
- [x] Server-action рядом с `companyRequisites`; блок «Выгрузка документов в
      1С» в `requisites-screen.tsx`: подзаголовок одной строкой, три варианта
      «автоматически при выпуске · только по кнопке · никогда», четыре
      флажка типов (подписи из глоссария), кнопка «Сохранить». Экран один и
      тот же у администратора и руководителя (правило зеркала).
- [x] `generate.ts`: после успешного выпуска и после перевыпуска — если
      `oneCDocumentPushMode = auto` и тип в наборе → `enqueueDocumentPush`
      (best-effort, вне транзакции выпуска).
- [x] `docs/glossary.md`: «Выгрузка в 1С», «Правило выгрузки».
- [x] Тесты: сервис (менеджер — `forbidden`; руководитель чужой компании —
      `forbidden`; КП в наборе — `invalid_types`; сохранение и чтение);
      компонент (три варианта, четыре флажка, ошибка по-русски);
      `services.documents.generate` — при `auto` ставится задача, при `manual`
      и `never` нет, тип вне набора не ставится, упавшая постановка не роняет
      выпуск и выпуск возвращает `ok: true`.
- [x] Мутации: убрать проверку роли → менеджер меняет правило; постановка
      бросает наружу → выпуск падает при недоступном Redis (спека 3.3);
      убрать проверку набора → КП сохраняется в правиле мимо CHECK (падает уже
      база, но код обязан ответить кодом, а не `500`).
- [x] Решения исполнителя по ходу PR-4 (спеке не противоречат, в ней не
      записаны):
      1. **Чтение правила — через `listCompaniesRequisites`**, как налоги и
         нумерация (`У-138`): в `CompanyRequisites` добавлены
         `oneCDocumentPushMode`/`oneCDocumentPushTypes`. Отдельный
         `getOneCDocumentPushRule` не заведён — у экрана уже есть выборка
         компаний, а неиспользуемый экспорт валит `deadcode`.
      2. **`updateOneCDocumentPushRule(prisma, session, companyId, input)`** —
         с `companyId`, а не «своя компания из сессии»: у администратора
         компаний несколько, экран показывает форму под каждой. Гард —
         `guardCompany` из `companyBranding.ts` (экспортирован, не скопирован):
         admin — любая, leader — только своя, остальным `forbidden`.
      3. **Два кода вместо `validation`:** `invalid_mode` и `invalid_types`
         с русскими текстами в `errors/messages.ts` — человек видит «в 1С
         выгружаются только счёт, акт, договор и доп. соглашение», а не
         «проверьте форму». Набор нормализуется в канонический порядок
         `ONE_C_PUSHABLE_TYPES` без повторов.
      4. **Server-action отдельным файлом** `server-actions/admin/oneCDocumentPushRule.ts`
         под гардом `requireSettingsSection('catalogs.requisites', cabinet)` —
         тот же раздел, что и реквизиты; `revalidatePath` на оба хаба.
      5. **Правило читается тем же select компании в `loadIssueContext`**
         (`IssueContext.oneCPush`), а не отдельным запросом после выпуска —
         выпуск и перевыпуск идут через один контекст, лишний запрос не нужен.
      6. **`try/catch` вокруг `enqueueDocumentPush` — страховка сверх
         контракта:** продюсер сам не бросает (PR-3), но выпуск обязан
         вернуть `ok: true` и при чужом исключении (спека 3.3); страж на это
         есть, мутация «голый `await`» его роняет.
- [x] Интеграционный тест `services.oneCDocumentPushRule.integration` на живом
      Postgres: умолчание `manual` + четыре типа, сохранение руководителем и
      чтение через `listCompaniesRequisites`, аудит с `before`/`after`,
      чужая компания не меняется, КП — `invalid_types` от кода, а прямой
      `update` с КП — отказ проверки базы `Company_oneCDocumentPushTypes_pushable`.
- [x] `STATUS.md`, `AUDIT.md`, `CHANGELOG.md`.

## PR-5 «Экраны выгрузки» — `У-169` (экраны), `У-159` (повтор)

- [x] `src/lib/services/documents/pushToOneC.ts`:
      `requestDocumentPush(prisma, session, documentId)` — сотрудники ЦО
      (`admin` или `isStaffManagerSide`), иначе `forbidden`; видимость через
      `canReadDocument` (тот же предикат, что у карточки и скачивания — отказ
      и отсутствие неотличимы, `not_found`); причина блокировки одной
      функцией `oneCPushBlockReason`: тип вне `ONE_C_PUSHABLE_TYPES` →
      `not_pushable_type`, `externalId` (пришёл из 1С) → `from_1c`, `never`
      или тип вне набора правила → `push_disabled`, `supersededAt` →
      `superseded`; `pending` → `already_queued`; иначе `enqueueDocumentPush`
      + аудит `document_push_to_1c_requested` (повтор после `failed` — то же
      действие с `after.retry = true`, `У-159`).
      `requestDocumentPushMany` — по списку без повторов, итог
      `{ queued, skipped: [{ documentId, error }] }`.
- [x] `src/lib/documents/oneCPushStatus.ts`: `ONE_C_PUSH_STATUS_LABEL`,
      `ONE_C_PUSH_STATUS_TONE`, `ONE_C_PUSH_STATUS_ORDER`, `parseOneCPushStatus`
      — единственный источник подписей и цветов для карточки, бейджа в списке
      и фильтра. `isOneCPushableType` вынесен в `oneCSync/schemas.ts`
      (локальная копия в `pushDocument.ts` убрана).
- [x] Server-action `src/server-actions/documents/pushToOneC.ts`
      (`requestDocumentPushAction`, `requestDocumentPushManyAction`;
      `revalidatePath` на список и карточку всех трёх кабинетов). Карточка:
      `DocumentDetail.oneCPush` (статус, время, ошибка, попытки, номер в 1С,
      `blocked`) и клиентский блок `document-onec-push-block.tsx` в
      `staff-document-detail.tsx` и зеркале админа — статус, время, текст
      ошибки; кнопка «Выгрузить в 1С» при `none`/`skipped`/`exported_file`,
      «Повторить выгрузку» при `failed`, «В очереди…» (неактивна) при
      `pending`, при `pushed` кнопки нет; при `blocked` — русская причина из
      `errors/messages.ts`, для `push_disabled` — ссылка «Изменить правило»
      (админ, руководитель) или «попросите руководителя» (менеджер).
- [x] Списки сотрудников: `listDocuments`, `listManagerOrderLessDocuments`,
      `listGeneralDocuments` принимают `oneCPushStatus` и отдают колонку;
      общий `DocumentsList` — бейдж «1С: …» (кроме `none`) и флажки по пропу
      `selection`; клиентская обёртка `staff-documents-push-list.tsx` —
      «Выбрано N · Выгрузить выбранные в 1С · Выбрать все доступные · Снять
      выбор», итог «Поставлено в очередь: N. Пропущено: M.» с причинами;
      фильтр `one-c-push-status-select.tsx` на обеих вкладках менеджера и
      руководителя и на «Общих документах» админа. Пустой результат фильтра —
      «По этому фильтру документов нет» + «Сбросить фильтр» (`У-74`).
- [x] Тесты: сервис (`forbidden` заказчику, `not_found` чужому,
      `not_pushable_type`, `from_1c`, `push_disabled`, `superseded`,
      `already_queued`, проброс `queue_unavailable`, массовое с частичным
      отказом, страж `select` `type`+`status`); `DocumentDetail.oneCPush`;
      server-action; блок карточки (кнопка по статусу, ссылка на правило);
      `DocumentsList` (бейдж, флажки); обёртка (выбор, итог, сброс фильтра);
      select фильтра; словарь статусов; страницы трёх кабинетов; страж
      зеркала `documents.send-button-mirror.guardrail` (блок и список — у
      сотрудников, не у заказчика/партнёра).
- [x] Мутации: убрать `not_pushable_type` → КП ставится в очередь мимо экрана
      (3 теста); убрать `canReadDocument` → менеджер выгружает чужой документ
      (2); убрать `push_disabled` (3); фильтр общих без `supersededAt = null`
      → заменённые версии в списке (3); `listDocuments` игнорирует фильтр (1);
      админ без списка выгрузки / партнёр с ним → страж зеркала (по 1);
      `canSelectForPush` пускает `pending` (1); бейдж и для `none` (1).
- [x] Решения исполнителя по ходу PR-5 (спеке не противоречат, в ней не
      записаны):
      1. **Блок карточки — отдельный клиентский компонент**, смонтированный
         children-ом в `staff-document-detail.tsx` и в странице админа, а не
         внутри общего `DocumentDetailView`: тот общий с заказчиком и
         партнёром, которым 1С исполнителя не принадлежит.
      2. **Причина блокировки считается на сервере** (`oneCPush.blocked`) одной
         функцией `oneCPushBlockReason`, включая `superseded`; блок только
         показывает. Кнопка на экране правами не является (§4).
      3. **Набор типов правила компании ограничивает и ручную выгрузку** —
         `push_disabled`, как и `never`: иначе «правило» было бы только про
         автопостановку и врало бы названием.
      4. **Документ с `externalId` (пришёл из 1С) — `from_1c`**: выгружать
         обратно то, что 1С сама прислала, бессмысленно; код и текст новые.
      5. **При `pushed` кнопки нет** — «Документ уже в 1С. Новая версия после
         перевыпуска выгружается отдельно» (перевыпуск даёт новую строку).
      6. **Ссылка «Изменить правило» — через `settingsSectionHref('catalogs.requisites', cabinet)`**
         (новый помощник реестра настроек); у менеджера раздела нет — текст
         «попросите руководителя».
      7. **Аудит `document_push_to_1c_requested`** — новое действие в
         `AUDIT_ACTIONS` + подпись «Постановка документа в очередь на
         выгрузку в 1С»; `after: { retry, type, number, previousStatus }`.
      8. **Вкладка «По заказам» у админа остаётся на legacy `DocumentsPanel`**
         без фильтра и массовой выгрузки: у админа массовая выгрузка — на
         «Общих документах», поштучная — на карточке любого документа. Замена
         панели — отдельная работа, не этап 8 (записано в `AUDIT.md` как
         известный остаток).
      9. **Флажок доступен по типу и состоянию** (`canSelectForPush`: тип
         выгружаемый и не `pending`/`pushed`); правило компании, `from_1c`,
         права проверяет сервис и возвращает в «пропущено» с причиной —
         экран не дублирует серверную логику.
- [x] `STATUS.md`, `AUDIT.md`, `CHANGELOG.md`, `glossary.md` («Выгрузка в 1С»).

## PR-6 «Обратная связь» — `У-170` (`Д-24`, `Д-25`)

- [x] `schemas.ts`: `OneCDocumentSchema` + `direction:
      z.enum(['incoming', 'outgoing']).default('incoming')` и `number:
      z.string().optional()`; `mappers.ts` пробрасывает оба (`number`
      обрезается, пустой → `null`); `mock-1c/core/dataset.ts` (клон
      `FAKE_DOCUMENTS`) и фикстуры отдают `direction`/`number`; контракт
      (секция 4) дополнен. `runRecordBatch`/`parseRecords` принимают
      `ZodType<T, ZodTypeDef, unknown>` — иначе схема с `.default()` не
      подходит по типу входа.
- [x] `writers.ts`, `upsertDocumentRecord`: поиск по трём ключам по порядку —
      `externalId` → `oneCExternalId` (действующая версия, `supersededAt =
      null`, старшая `version`) → `type + number` в пределах `orderId`;
      найденный обновляется (`signedAt`, статус по `signedAt`, `oneCExternalId
      = dto.externalId`), файл изменился (другой `size`/`mimeType` или новая
      подпись) → новый `path`, `scanStatus: 'pending'`, повторная постановка в
      `docs.scanDocument`; не найден → создание с `direction` из DTO.
- [x] `oneCSync.writers.documents-dedup.integration.test.ts` (11 тестов на
      живом Postgres): тот же `externalId` — одна строка; выгруженный нами
      документ вернулся с тем же `oneCExternalId` — обновлён, не создан (и
      берётся действующая версия цепочки); тот же тип и номер в заказе —
      обновлён; тот же номер в другом заказе — новый документ без номера
      (индекс не нарушен); файл изменился — новый `path`, `pending`, задача
      скана; файл не забрался — пропуск без правки строки; подпись → «принят»
      через дверь с аудитом; подпись у аннулированного — статус не тронут;
      `direction: 'outgoing'` из DTO сохранён; DTO без `direction` — `incoming`.
      Unit (`oneCSync.writers.test.ts`, блок `У-170`): 15 тестов на ветки.
- [x] Мутации (7, все пойманы): `'incoming'` снова захардкожен; повторный скан
      снят; третий ключ убран; второй ключ убран; статус записан напрямую в
      обход двери (ловит и страж `security.document-status.guardrail`); пустая
      подпись из 1С стирает нашу; файл не забирается при смене.
- [x] Решения исполнителя по ходу PR-6 (спеке не противоречат, в ней не
      прописаны):
      1. **Признак «файл изменился»** — `size` ≠ или `mimeType` ≠ или в DTO
         есть `signedAt`, не равный нашему. `downloadUrl` в признак не входит:
         подписанная ссылка меняется при каждом ответе 1С, и по ней файл
         перекачивался бы всегда.
      2. **Пустой `signedAt` из 1С не стирает подпись**, которая у нас уже
         записана (`signedAt: dto.signedAt ?? existing.signedAt`).
      3. **Статус по подписи** — только `issued`/`sent` → `accepted`, через
         `setDocumentStatus` от имени `uploadedById ?? sentById` (приём из
         `expire-proposals`: у фоновой задачи своей сессии нет). Нет актора →
         подпись записана, статус не тронут, `log.info`. Отказ двери
         (`invalid_transition`, `not_found`) и её исключение → `log.warn`,
         пакет не падает; `not_lifecycle_type` — норма, не пишется.
      4. **Имя и тип** 1С меняет только у своей бумаги (ключ 1,
         `existing.externalId === dto.externalId`); нашему документу (ключи 2
         и 3) она не хозяин — имя и тип остаются, пока не сменился сам файл.
         `direction` найденного не меняется никогда.
      5. **Номер из 1С** дописывается только пустому `number` и только если
         `(companyId, type, number, version)` свободен; при создании занятый
         номер → документ без номера + `log.warn` (иначе частичный уникальный
         индекс `У-151` уронил бы весь батч из-за метаданных).
      6. **Уведомление `document_published`** — только при создании, как и
         было: «1С вернула нашу бумагу» — не новая публикация для заказчика.
      7. **Скан после смены файла** — тот же best-effort, что при создании:
         без `REDIS_URL` пропускается, сбой очереди → `log.warn`; вынесен в
         `enqueueDocumentScan`.
- [x] `STATUS.md`, `AUDIT.md`, `CHANGELOG.md`, контракт.

## PR-7 «Реквизиты контрагента» — `У-171` (`Д-23`)

- [x] `schemas.ts`: `OneCOrgSchema` + `ogrn`, `legalAddress`, `bankName`,
      `bankAccount`, `corrAccount`, `bic`, `signerName`, `signerPosition`,
      `signerBasis` (все необязательные строки); `mappers.ts`:
      `OrgUpsertInput` + `legalName` и девять полей; контракт (секция 1),
      фикстуры и `mock-1c/core/dataset.ts` дополнены.
- [x] `writers.ts`, `upsertOrgRecord`: одно правило на все реквизиты —
      пустое значение из 1С (`undefined`, `''`, пробелы) не перезаписывает
      непустое в базе (`nonEmptyOnly(patch)` перед `update`); при создании
      пишется как есть.
- [x] Тесты: маппер (unit); writer на живом Postgres — заполненный
      `legalAddress` остаётся при пустом DTO, заменяется при непустом,
      `legalName` доезжает до базы (сам `Д-23`), первый импорт заполняет всё.
- [x] Мутации: `nonEmptyOnly` заменён обычным присваиванием → «остаётся при
      пустом» падает; `legalName` выкинут из `OrgUpsertInput` → тест `Д-23`
      падает.

**Решения исполнителя по ходу PR-7** (спеке не противоречат, в ней не записаны):

1. **Правило «пустое не затирает» распространено на `inn` и `kpp`.** ТЗ
   перечисляет `kpp` среди реквизитов; `inn` — ещё и ключ сопоставления
   (`У-83`): пустой ИНН из 1С прежде записывал `null` поверх заполненного, и
   следующий обмен уже не нашёл бы организацию по ИНН. Один список
   `ORG_REQUISITE_KEYS` (двенадцать полей) держит схему, маппер и writer
   вместе — добавить тринадцатое поле значит дописать одну строку.
2. **Пустоту сводит к `null` маппер, writer проверяет только `null`.**
   Второй `trim` в writer'е был бы мёртвой веткой под гейтом покрытия 100%:
   через `mapOrgDto` пробелы до него не доходят. Мутация «маппер перестал
   чистить» ловится тестом маппера.
3. **Снимок «до» для истории импорта (Т-33) не расширен.** История и откат
   есть только у xlsx-импорта, а его колонки — имя, ИНН, КПП, ИНН партнёра:
   реквизиты по этому пути всегда пусты, и по правилу 1 в `update` не
   попадают, восстанавливать нечего. Сетевой обмен (воркер, карантин) истории
   не ведёт. Расширять список — когда в выгрузке появятся такие колонки.
4. **Фикстуры: одна организация с полным набором, одна с частичным, одна
   без.** Так mock-1c отдаёт все три случая, которые различает writer, и
   сквозной тест воркера проверяет реальный путь адаптер → схема → маппер →
   база, а не только unit.

## PR-8 «Сверка» — `У-172` (`Д-26`)

- [x] `adapter.ts`: `findDocument(externalId: string): Promise<OneCDocumentDto |
      null>`; rest — `GET /api/documents?externalId=` (пустой массив → `null`);
      fake — из своего состояния; file — `null`; mock — обработчик поверх
      `createDocumentStore`; контракт (секция 7) уже описан PR-1.
- [x] `sync-reconcile.ts`: рядом с прежним «термометром» (не удаляется) —
      `reconcilePushedDocuments`: все `pushed` с `supersededAt = null`
      поштучно (умолчание §6.6), отсутствующие → `failed`,
      `oneCPushError: 'missing_in_1c'`, `writeSyncLog(status: 'error',
      operation: 'check')`; `reconcileStuckLeads`: `pushedToOneCAt` старше
      суток и без `externalIdInOneC` — один повтор (признак повтора — запись
      `operation: 'check', status: 'warn'` в `SyncLog` за 48 часов), второй раз
      → `SyncLog` `error`, попадает в алерты.
- [x] Тесты: интеграционный на процессоре — пропавший документ помечен,
      присутствующий не тронут, заменённая версия не спрашивается, зависший
      лид переотправлен один раз и помечен на второй.
- [x] Мутации: сверка не помечает пропавшее; заменённые версии спрашиваются
      (лишние запросы к 1С — тест считает вызовы).

**Решения исполнителя по ходу PR-8** (спеке не противоречат, в ней не записаны):

1. **Логика сверки — в сервисе `lib/services/oneCSync/reconcile.ts`, процессор
   тонкий.** Так сверку можно вызвать с подставным адаптером и проверить
   unit-тестом без Redis и без живой 1С; процессор только праймит настройки,
   зовёт две функции и шлёт уведомления. Такое же разделение у выгрузки
   (`pushDocument.ts` ↔ `push-document.ts`).
2. **Фейковая 1С на `findDocument` всегда отвечает «есть», файловая —
   бросает исключение, а не `null`.** План писал «fake — из своего
   состояния; file — `null`». Память фейка живёт до рестарта воркера:
   «не помню — значит пропал» пометило бы на стенде все выгруженные
   документы `failed` после первого перезапуска. `null` у файлового
   адаптера значил бы «1С сказала: нет такого» — и сверка молча пометила бы
   всё пропавшим; исключение сверка честно считает ошибкой транспорта.
   Путь «в 1С нет» проверяют подставной адаптер в тестах и mock-1c.
3. **1С спрашивается по корню цепочки перевыпусков** — по тому же
   `externalId`, под которым бумага ушла (`reissueChainRootId` экспортирован
   из `pushDocument.ts`). Иначе каждая перевыпущенная версия «пропадала бы»
   при каждой сверке.
4. **Ошибка транспорта ≠ «пропал».** Исключение адаптера прерывает обход:
   ничего не помечается, остальные считаются `unchecked`, итоговая строка
   `reconcile`/`outbound` — `error` с текстом. Одна недоступная 1С ночью
   не должна утром заставлять людей перевыгружать всё, что на месте.
5. **Что пишется при пропаже.** `oneCPushError` — русский текст через
   `errorMessageRu('missing_in_1c')` (его видит человек на карточке рядом с
   «Повторить»), `SyncLog.errorMessage` — код `missing_in_1c` (его считает
   `У-174`). `oneCPushAttempts` не растёт (сверка — не попытка выгрузки),
   аудит не пишется (действовал не человек). `updateMany` с условием
   `oneCPushStatus = 'pushed'` не затирает `pending`, если документ успели
   поставить на повтор, пока шла сверка.
6. **«Зависший» лид — претензия старше суток без `externalIdInOneC` И без
   `success`-строки в истории.** 1С вправе принять заявку без своего номера
   (`oneCRequestId` в контракте необязателен) — такой лид отправлен честно.
   Повтор: сначала снимается претензия, потом ставится задача в
   `oneCSync.pushLead` (в обратном порядке задача могла бы выполниться до
   снятия и увидеть «уже отправлен»); 1С дедуплицирует по `cabinetLeadId`.
   Второй раз за 48 часов — `error` в истории и уведомление партнёру через
   `notifyPushLeadFinalFailure` из процессора (сервис в `lib` про
   уведомления воркера не знает). Само лечение отката в `push.ts` не
   меняется — сверка ловит именно тот случай, когда откат не удался.
7. **«Попадает в алерты» здесь = `failed` на документе и `error` в истории
   обмена.** Порог, светофор и сам алерт «документов не выгружено: N» — PR-10
   (`У-174`), как и записано в плане; PR-8 даёт ему данные.

## PR-9 «Файловый канал» — `У-173`

- [x] Вкладка `documents` «Выгрузка документов» в `one-c-tabs.tsx` и страница
      `src/app/admin/settings/integrations/1c/documents/page.tsx` (реестр
      `settings.ts`, `requireSettingsSection`): подзаголовок, фильтр «период ·
      тип · статус выгрузки», таблица найденного, главная кнопка «Скачать
      пакет»; пустой фильтр — объяснение и сброс.
- [x] `src/lib/services/oneCSync/exportPackage.ts`: выборка по фильтру (КП и
      заменённые версии исключены), Excel-реестр `exceljs` с листами
      «Документы» и «Строки» — колонки повторяют тело `У-167`; ZIP с PDF через
      `jszip` (явная зависимость — сейчас лишь транзитивная у `exceljs`);
      после сборки — `exported_file`, `oneCPushedAt`, запись пакета
      (кто, когда, сколько, фильтр) в историю обмена с новым каналом
      `ExchangeChannel = 'documents'` и подписью «Документы → 1С»; повторная
      выгрузка разрешена.
- [x] Роут скачивания `src/app/api/integrations/1c/documents/export/route.ts`
      (см. решение 7: адрес нейтральный, имя файла — латиницей).
- [x] Тесты: сервис (состав листов, `lines: null` → лист «Строки» без
      строк, КП не попадает, отметка `exported_file`, запись в историю);
      компоненты; страница.
- [x] Мутации: отметка не ставится; КП попадает в пакет; заменённая версия в
      пакете; `pushed` понижается; сбой скачивания роняет пакет; аудит
      ссылается не на пакет — все шесть пойманы.

**Решения исполнителя по ходу PR-9** (спеке не противоречат, в ней не записаны):

1. **Excel повторяет тело сетевой выгрузки буквально — через общий
   `buildDocumentRecord`.** Из `pushDocument.ts` вынесена сборка записи по
   контракту без `fileUrl` (`OneCDocumentRecord`); сетевой канал добавляет
   к ней подписанную ссылку, файловый — имя файла в архиве. Два канала не
   могут разъехаться по колонкам, потому что источник у них один. Цена —
   по два-три запроса на документ при сборке пакета; при лимите 500 это
   приемлемо. Список кандидатов на экране контрагентов грузит пачкой (два
   `findMany`), не поштучно.
2. **Что не попадает в пакет.** КП и типы вне четырёх (`Р-14`), заменённые
   версии (`У-151`), документы, пришедшие ИЗ 1С (`externalId`), — эти три
   отсекает `where`; без ИНН у контрагента и без номера — те же причины, что
   у сетевой выгрузки, они показываются на экране в колонке «Почему не
   войдёт» и на листе «Не вошли». Файл, которого нет в хранилище, —
   пропуск с причиной `file_unavailable` и `log.error`, а не отказ всего
   пакета: бухгалтер получает остальное. Если после отсева не осталось
   ничего — `empty` (роут отвечает 404), а не архив из одного пустого
   листа.
3. **Отметка `exported_file` не понижает `pushed`.** Документ, который 1С
   уже приняла по сети, в пакете — копия, а не новый канал:
   `updateMany … oneCPushStatus: { not: 'pushed' }`. `oneCPushedVersion`
   ставится группами по версии (одна `updateMany` на версию), `oneCPushError`
   очищается.
4. **История: одна запись `SyncLog` на пакет** — `entity: 'document'`,
   `operation: 'export'` (новое значение в `SyncLogInput`), `status: 'warn'`
   при пропусках, иначе `success`; в `payload` — `companyId` (у админа
   `null`), кто, сколько, список пропущенных с причинами, фильтр и
   `documentIds`. «История» показывает канал «Документы → 1С» админу (все
   пакеты) и руководителю (пакеты своей компании; глобальные пакеты админа
   ему не видны — `payload.companyId = null`); рядовому менеджеру канал не
   показывается вовсе, откат — `unsupported`.
5. **Аудит — одно событие на пакет, а не на документ.**
   `documents_exported_to_1c_file` («Выгрузка пакета документов для 1С
   файлом»), `entityId` — id записи `SyncLog` пакета: для этого
   `writeSyncLog` теперь возвращает `{ id }`. Пятьсот событий на одно
   нажатие затопили бы журнал.
6. **Вкладка — у администратора и руководителя (зеркало §15), плюс четвёртая
   карточка навигатора «Передать документы в 1С файлом».** Менеджеру не
   даётся — как и «Автообмен» (`only`). Экран один, презентационный, с
   view-моделью от сервиса (`Р-23`); страницы зеркальны и отличаются только
   кабинетом.
7. **Роут нейтральный — `/api/integrations/1c/documents/export`, а не
   `/api/admin/…`.** Одна дверь для admin и leader (`/admin/*` пускает
   только admin), как у экспорта каталога: гард — право раздела
   `integrations.oneC` через `canAccessSettingsSection`, граница компании —
   в сервисе (`importScope`: admin → все, leader → своя, иначе
   `forbidden`). Имя файла `1c-documents-<дата>.zip` — латиницей, поэтому
   помощник для русского `Content-Disposition` не понадобился; русские имена
   живут внутри архива.
8. **Третий лист «Не вошли».** Спека называла два листа; без третьего
   бухгалтер, открыв пакет, не узнал бы, каких документов в нём нет и
   почему. Причины — русским текстом через `errorMessageRu` (новые коды
   `file_unavailable`, `export_package_empty`).
9. **Русские названия типов — из одного места.** `documentTypeLabelRu` в
   `fileName.ts` (раньше словарь был приватным внутри
   `documentDownloadName`); его же берёт экран вкладки и select «Вид
   документа». Одинаковые имена файлов в архиве получают суффикс « (2)».

## PR-10 «Видимость ошибок» — `У-174`

- [x] `integrationsHealth.ts`: число `failed` документов → строка «документов
      не выгружено: N» в светофоре 1С; порог `alerts.oneCPushFailedMax` в
      `thresholds.ts` (по `У-126`, редактируется там же, где остальные
      пороги — см. решение 1); выше порога — светофор жёлтый («работает с
      ошибками»), алерт `onec_push_failed` через `evaluate-alerts`.
- [x] «История» обмена: записи `SyncLog` `entity: 'document', direction:
      'outbound'` показываются каждой попыткой с каналом «Документы → 1С»
      (тот же `ExchangeChannel = 'documents'`, что у пакетов PR-9); строка
      «Подробности» с текстом ошибки.
- [x] `notifyPushDocumentFinalFailure` в процессоре по образцу лидов: после
      последней попытки — уведомление руководителям компании и инициатору с
      номером документа и текстом ошибки (`handlePushDocumentJobFailed` на
      событии `failed` очереди; отказы без повтора — сразу из процессора).
- [x] Тесты: светофор считает только `failed` и только действующие версии
      (`oneCSync.pushFailures`, `services.admin.integrations-health`); порог
      меняет уровень (`monitoring.evaluate`, `worker.evaluate-alerts`); история
      показывает попытки отдельными строками с подробностями
      (`services.import.history`, `components.exchange-history`); уведомление
      один раз на окончательный отказ (`worker.push-document` unit +
      integration); форма порогов (`components.alert-settings-form` — новый,
      у формы своего теста не было).
- [x] Мутации: порог игнорируется (светофор и алерт — два места); попытки
      схлопываются в одну; скоуп руководителя не режет по компании;
      «Подробности» всегда пусты; уведомление на каждую попытку (`<` → `<=`
      и без проверки вовсе); уведомляют все отказы; руководители не в
      адресатах; счёт учитывает заменённые версии; тело попытки без
      `companyId` — все двенадцать пойманы.

**Решения исполнителя по ходу PR-10** (спеке не противоречат, в ней не записаны):

1. **Порог — `alerts.oneCPushFailedMax` (env `ALERT_ONEC_PUSH_FAILED_MAX`),
   по умолчанию 0**, а не `onec.pushFailedThreshold`, как назвал план:
   остальные пороги `У-126` живут в группе `alerts.*` и правятся одной
   формой «Оповещения» (`/admin/settings/system/health`) — новый порог стоит
   там же, полем «Документов не выгружено в 1С — предел». Ноль означает
   «любой непринятый документ — повод сказать»: 1С молчит не потому, что
   так надо, а потому что кто-то должен нажать «Повторить».
2. **Одна цифра на светофор и на алерт — `countFailedDocumentPushes`**:
   только `failed` и только действующие версии (`supersededAt: null`) —
   ошибка заменённой версии в 1С уже не поедет, это история, а не задача.
   Алерт `onec_push_failed` уровня `warning` (не `critical`, как
   dead-letter: документ ждёт человека, но обмен не сломан) считается по
   всей платформе, как остальные платформенные оповещения.
3. **Светофор — пятое состояние `degraded` («работает с ошибками», жёлтое):**
   подключение отвечает, но часть документов 1С не приняла. Ставится только
   поверх `ok` и только при `count > порога`; `error`/`not_configured` не
   маскируются. Строка «Документов не выгружено: N» показывается всегда,
   даже при нуле — молчание читалось бы как «не считаем». Ссылка строки —
   проп панели `failedDocumentsHref`: у администратора ведёт на вкладку
   «Общие» списка документов (фильтр «Выгрузка в 1С» живёт только там), у
   руководителя — на свой список. Руководителю цифра считается по его
   компании; без компании — 0 (C8: `null` → deny-all, а не «всё»).
4. **История — каждая попытка своей строкой `SyncLog`** (`entity:
   'document'`, `direction: 'outbound'`, `operation: create|update`); тело
   записи дополнено `companyId`, `type`, `number`, `attempt`, `actorUserId`
   (`attemptPayload` в `pushDocument.ts`). Заголовок «Акт А-7 → 1С · попытка
   N», колонка «Кто» — по `actorUserId` одним `user.findMany` на страницу
   истории, «Подробности» — текст ошибки (красным) или русская причина
   пропуска («Эта версия уже в 1С — повтор не нужен»). «Числа» у попытки
   пусты: версия и номер попытки уже в заголовке. Руководителю видны
   попытки своей компании; записи до PR-10 (без `companyId`) ему не
   показываются — лучше пропуск, чем чужая бумага.
5. **Кому и когда уведомлять.** Адресаты — руководители компании документа
   (они отвечают за обмен) плюс тот, кто нажал «Выгрузить», если это другой
   человек; документ без компании — только инициатору. Тип `sync_error` с
   `meta.kind: 'push_document_failed'` и `url` карточки в кабинете
   получателя (`/admin|leader|manager/documents/<id>`). Отказы, которые
   очередь не повторит и после которых документ уже в `failed`
   (`counterparty_without_inn`, `no_number`), уведомляют сразу из
   процессора русским текстом; сбой адаптера (`push_failed`) — один раз
   после последней попытки BullMQ через слушатель `failed`
   (`handlePushDocumentJobFailed`: `attemptsMade < attempts` → молчим).
   `not_pushable_type`/`superseded`/`not_found` не уведомляют — документ не
   в `failed`, извещать не о чем. Текст: «Акт А-7 не принят 1С после 5
   попыток: <ошибка>. Откройте документ и нажмите «Повторить» или
   исправьте его».
