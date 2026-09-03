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
| PR-3 «Очередь и процессор» | Очередь `oneCSync.pushDocument`, сборка тела (`externalId` — корень цепочки перевыпусков, `fileUrl` на час, `lines: null` у legacy), сервис выгрузки с идемпотентностью по версии и отказом КП, процессор с интеграционным тестом, события аудита | `У-168`, `У-167` (идемпотентность, `Р-14`), `У-159` (остаток) | 🔨 [#485](https://github.com/aiprocadm/lk_otsfera/pull/485) в ревью |
| PR-4 «Правило компании» | `auto / manual / never` и набор типов в «Реквизитах исполнителя» у администратора и руководителя, автопостановка после выпуска best-effort | `У-169` (правило) | ⏳ |
| PR-5 «Экраны выгрузки» | Блок «Выгрузка в 1С» на карточке документа с кнопками «Выгрузить в 1С» / «Повторить», фильтр по статусу выгрузки и массовое «Выгрузить выбранные» в списке документов сотрудников | `У-169` (экраны), `У-159` (повтор) | ⏳ |
| PR-6 «Обратная связь» | Поиск входящего по трём ключам без дубля, обновление файла с повторным сканом, `direction` и `number` из DTO | `У-170` (`Д-24`, `Д-25`) | ⏳ |
| PR-7 «Реквизиты контрагента» | Реквизиты в схеме, маппере и writer'е; пустое из 1С не затирает заполненное; фикстуры, набор данных mock и контракт | `У-171` (`Д-23`) | ⏳ |
| PR-8 «Сверка» | `findDocument` в адаптере, поштучная сверка `pushed`, `failed: missing_in_1c`, зависшие лиды | `У-172` (`Д-26`) | ⏳ |
| PR-9 «Файловый канал» | Вкладка «Выгрузка документов»: фильтр → Excel-реестр + ZIP, отметка `exported_file`, пакет в «Истории» | `У-173` | ⏳ |
| PR-10 «Видимость ошибок» | Светофор «документов не выгружено: N», каждая попытка в истории, порог алерта по `У-126`, уведомление об окончательном отказе | `У-174` | ⏳ |

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

- [ ] `src/lib/services/admin/oneCDocumentPushRule.ts`:
      `getOneCDocumentPushRule(prisma, session)` и
      `updateOneCDocumentPushRule(prisma, session, { mode, types })` — только
      `admin` и `leader` своей компании (`Р-22`), остальным `forbidden`; `types`
      ⊆ `ONE_C_PUSHABLE_TYPES` (`invalid_types`); аудит
      `company_onec_push_rule_changed` с русским названием.
- [ ] Server-action рядом с `companyRequisites`; блок «Выгрузка документов в
      1С» в `requisites-screen.tsx`: подзаголовок одной строкой, три варианта
      «автоматически при выпуске · только по кнопке · никогда», четыре
      флажка типов (подписи из глоссария), кнопка «Сохранить». Экран один и
      тот же у администратора и руководителя (правило зеркала).
- [ ] `generate.ts`: после успешного выпуска и после перевыпуска — если
      `oneCDocumentPushMode = auto` и тип в наборе → `enqueueDocumentPush`
      (best-effort, вне транзакции выпуска).
- [ ] `docs/glossary.md`: «Выгрузка в 1С», «Правило выгрузки».
- [ ] Тесты: сервис (менеджер — `forbidden`; руководитель чужой компании —
      `forbidden`; КП в наборе — `invalid_types`; сохранение и чтение);
      компонент (три варианта, четыре флажка, ошибка по-русски);
      `services.documents.generate` — при `auto` ставится задача, при `manual`
      и `never` нет, тип вне набора не ставится, упавшая постановка не роняет
      выпуск и выпуск возвращает `ok: true`.
- [ ] Мутации: убрать проверку роли → менеджер меняет правило; постановка
      бросает наружу → выпуск падает при недоступном Redis (спека 3.3);
      убрать проверку набора → КП сохраняется в правиле мимо CHECK (падает уже
      база, но код обязан ответить кодом, а не `500`).

## PR-5 «Экраны выгрузки» — `У-169` (экраны), `У-159` (повтор)

- [ ] `src/lib/services/documents/pushToOneC.ts`:
      `requestDocumentPush(prisma, session, { documentId })` — видимость через
      `canSeeDocument(…, teamMode)`, `never` у компании → `push_disabled`, тип
      вне `ONE_C_PUSHABLE_TYPES` → `not_pushable_type`, `pending` → `already_queued`;
      иначе `enqueueDocumentPush` + аудит `document_push_to_1c_requested`
      (повтор — то же действие с `after: { retry: true }`, `У-159`).
      `requestDocumentPushMany` — по списку, результат на каждый `id`.
- [ ] `src/lib/documents/oneCPushStatus.ts`: `ONE_C_PUSH_STATUS_LABEL` — русские
      подписи шести статусов, единственный источник для карточки, списка и
      фильтра.
- [ ] Server-action `src/server-actions/documents/pushToOneC.ts`. Карточка
      `staff-document-detail.tsx`: блок «Выгрузка в 1С» — статус, время,
      текст ошибки; кнопка «Выгрузить в 1С» при `none`/`skipped`/
      `exported_file`, «Повторить» при `failed`, «В очереди» (неактивна) при
      `pending`; у КП блока нет с пояснением «КП в 1С не выгружается».
- [ ] Список документов сотрудников (`generalList.ts` + страницы
      `/manager`, `/leader`, `/admin`): фильтр «Выгрузка в 1С» по статусу,
      флажки строк и кнопка «Выгрузить выбранные» с итогом «поставлено N,
      пропущено M (причина)». Пустой результат фильтра — с объяснением и
      кнопкой сброса (`У-74`).
- [ ] Тесты: сервис (`forbidden` чужому, `not_pushable_type`,
      `push_disabled`, `already_queued`, массовое с частичным отказом);
      компоненты карточки и списка (кнопка по статусу, подписи из
      `ONE_C_PUSH_STATUS_LABEL`); страницы трёх кабинетов.
- [ ] Мутации: убрать `not_pushable_type` → КП ставится в очередь мимо экрана;
      убрать `canSeeDocument` → менеджер выгружает чужой документ; фильтр
      без `supersededAt = null` → заменённые версии в списке.

## PR-6 «Обратная связь» — `У-170` (`Д-24`, `Д-25`)

- [ ] `schemas.ts`: `OneCDocumentSchema` + `direction:
      z.enum(['incoming', 'outgoing']).default('incoming')` и `number:
      z.string().optional()`; `mappers.ts` пробрасывает оба;
      `mock-1c/core/dataset.ts` и фикстуры отдают `direction`/`number`;
      контракт (секция 4) дополнен.
- [ ] `writers.ts`, `upsertDocumentRecord`: поиск по трём ключам по порядку —
      `externalId` → `oneCExternalId` → `type + number` в пределах `orderId`;
      найденный обновляется (`signedAt`, статус по `signedAt`, `oneCExternalId
      = dto.externalId`), файл изменился (другой `downloadUrl`/`size`/`mimeType`)
      → новый `path`, `scanStatus: 'pending'`, повторная постановка в
      `docs.scanDocument`; не найден → создание с `direction` из DTO.
- [ ] `oneCSync.writers.documents-dedup.integration.test.ts`: тот же
      `externalId` — одна строка; выгруженный нами документ вернулся с тем же
      `oneCExternalId` — обновлён, не создан; тот же тип и номер в заказе —
      обновлён; файл изменился — новый `path`, `pending`, задача скана;
      `direction: 'outgoing'` из DTO сохранён; DTO без `direction` — `incoming`.
- [ ] Мутации: `'incoming'` снова захардкожен; повторный скан снят; третий
      ключ убран → дубль.

## PR-7 «Реквизиты контрагента» — `У-171` (`Д-23`)

- [ ] `schemas.ts`: `OneCOrgSchema` + `ogrn`, `legalAddress`, `bankName`,
      `bankAccount`, `corrAccount`, `bic`, `signerName`, `signerPosition`,
      `signerBasis` (все необязательные строки); `mappers.ts`:
      `OrgUpsertInput` + `legalName` и девять полей; контракт (секция 1),
      фикстуры и `mock-1c/core/dataset.ts` дополнены.
- [ ] `writers.ts`, `upsertOrgRecord`: одно правило на все реквизиты —
      пустое значение из 1С (`undefined`, `''`, пробелы) не перезаписывает
      непустое в базе (`nonEmptyOnly(patch)` перед `update`); при создании
      пишется как есть.
- [ ] Тесты: маппер (unit); writer на живом Postgres — заполненный
      `legalAddress` остаётся при пустом DTO, заменяется при непустом,
      `legalName` доезжает до базы (сам `Д-23`), первый импорт заполняет всё.
- [ ] Мутации: `nonEmptyOnly` заменён обычным присваиванием → «остаётся при
      пустом» падает; `legalName` выкинут из `OrgUpsertInput` → тест `Д-23`
      падает.

## PR-8 «Сверка» — `У-172` (`Д-26`)

- [ ] `adapter.ts`: `findDocument(externalId: string): Promise<OneCDocumentDto |
      null>`; rest — `GET /api/documents?externalId=` (пустой массив → `null`);
      fake — из своего состояния; file — `null`; mock — обработчик поверх
      `createDocumentStore`; контракт (секция 7) уже описан PR-1.
- [ ] `sync-reconcile.ts`: рядом с прежним «термометром» (не удаляется) —
      `reconcilePushedDocuments`: все `pushed` с `supersededAt = null`
      поштучно (умолчание §6.6), отсутствующие → `failed`,
      `oneCPushError: 'missing_in_1c'`, `writeSyncLog(status: 'error',
      operation: 'check')`; `reconcileStuckLeads`: `pushedToOneCAt` старше
      суток и без `externalIdInOneC` — один повтор (признак повтора — запись
      `operation: 'check', status: 'warn'` в `SyncLog` за 48 часов), второй раз
      → `SyncLog` `error`, попадает в алерты.
- [ ] Тесты: интеграционный на процессоре — пропавший документ помечен,
      присутствующий не тронут, заменённая версия не спрашивается, зависший
      лид переотправлен один раз и помечен на второй.
- [ ] Мутации: сверка не помечает пропавшее; заменённые версии спрашиваются
      (лишние запросы к 1С — тест считает вызовы).

## PR-9 «Файловый канал» — `У-173`

- [ ] Вкладка `documents` «Выгрузка документов» в `one-c-tabs.tsx` и страница
      `src/app/admin/settings/integrations/1c/documents/page.tsx` (реестр
      `settings.ts`, `requireSettingsSection`): подзаголовок, фильтр «период ·
      тип · статус выгрузки», таблица найденного, главная кнопка «Скачать
      пакет»; пустой фильтр — объяснение и сброс.
- [ ] `src/lib/services/oneCSync/exportPackage.ts`: выборка по фильтру (КП и
      заменённые версии исключены), Excel-реестр `exceljs` с листами
      «Документы» и «Строки» — колонки повторяют тело `У-167`; ZIP с PDF через
      `jszip` (явная зависимость — сейчас лишь транзитивная у `exceljs`);
      после сборки — `exported_file`, `oneCPushedAt`, запись пакета
      (кто, когда, сколько, фильтр) в историю обмена с новым каналом
      `ExchangeChannel = 'documents'` и подписью «Документы → 1С»; повторная
      выгрузка разрешена.
- [ ] Роут скачивания `src/app/api/admin/integrations/1c/documents/export/route.ts`
      (поток, `Content-Disposition` по-русски через существующий помощник).
- [ ] Тесты: сервис (состав листов, `lines: null` → лист «Строки» без
      строк, КП не попадает, отметка `exported_file`, запись в историю);
      компоненты; страница.
- [ ] Мутации: отметка не ставится; КП попадает в пакет; заменённая версия в
      пакете.

## PR-10 «Видимость ошибок» — `У-174`

- [ ] `integrationsHealth.ts`: число `failed` документов → строка «документов
      не выгружено: N» в светофоре 1С; порог `onec.pushFailedThreshold` в
      `thresholds.ts` (по `У-126`, редактируется там же, где остальные
      пороги); выше порога — светофор жёлтый, алерт через `evaluate-alerts`.
- [ ] «История» обмена: записи `SyncLog` `entity: 'document', direction:
      'outbound'` показываются каждой попыткой с каналом «Документы → 1С»
      (тот же `ExchangeChannel = 'documents'`, что у пакетов PR-9).
- [ ] `notifyPushDocumentFinalFailure` в процессоре по образцу лидов: после
      последней попытки — уведомление администраторам компании с номером
      документа и текстом ошибки.
- [ ] Тесты: светофор считает только `failed` и только действующие версии;
      порог меняет уровень; история показывает две попытки одного документа
      отдельными строками; уведомление один раз на окончательный отказ.
- [ ] Мутации: порог игнорируется; попытки схлопываются в одну; уведомление
      на каждую попытку.
