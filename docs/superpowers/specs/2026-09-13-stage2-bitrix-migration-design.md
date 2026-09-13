# Этап 2 — миграция из Битрикс24

**ТЗ:** [CRM для отдела продаж — замена Битрикс24](../../tz/2026-09-12-tz-crm-bitrix-replacement.md) (индекс, 12.09.2026), требования `У-188`…`У-203`; текст требований — [16_bitrix24_migration.md](../../specs/16_bitrix24_migration.md), задачи Task 5…10 в [15_claude_code_tasks.md](../../specs/15_claude_code_tasks.md); решения заказчика `Р-Б-1`, `Р-Б-2`, `Р-Б-11`.
**Дата:** 13.09.2026. **База:** `main` = `6225663f` (после закрытия этапа 1 и прогона сопровождения №27). **Статус:** ждёт подтверждения заказчика (подтверждение — мерж PR со спекой; умолчания §7 действуют, пока не отменены до кода соответствующего PR).

## 0. Коротко

Отдел продаж ведёт компании, контакты, лиды, сделки, задачи и файлы в Битрикс24. Чтобы Битрикс можно было выключить (критерий приёмки программы, `У-269`), всё это надо перенести в ЛК — так, чтобы после двух недель параллельной работы ничего не потерялось и ничего не задвоилось.

Механика — та же, что у импорта из 1С, которой команда уже пользуется: **предпросмотр → применение в фоне → отчёт сверки → откат**. Источников два (`Р-Б-1`): REST по входящему вебхуку (основной) и CSV/XLSX-выгрузки (запасной); оба прячутся за одним интерфейсом `BitrixSource`, третья реализация — фикстура для тестов и стенда. Ключ Битрикса хранится отдельной колонкой `bitrixId` (`Р-Б-11`); повторный запуск обновляет по нему и не трогает то, что уже поправили руками. Выигранные сделки переносятся и как история сделок, и как заказы — с защитой от дублей с 1С (`Р-Б-2`).

Что уже есть в коде: всё, во что переносить (этап 1 добавил контакты и заметки организации), и все образцы механики — пакет импорта с журналом записей для отката (`OneCImportBatch`/`OneCImportRow`, `PaymentImportWrite`), общий движок отката с конфликтами и частичным откатом (`import/rollback.ts`), fake-адаптер 1С с крутилками через env, сопоставление колонок по заголовкам (`column-map.ts`), единая точка записи файла с антивирусом (`upload-core.ts`), генерация XLSX через `exceljs` и выдача из S3 по подписанной ссылке, расписания из интерфейса (`У-125`).

Чего нет нигде: **прогресса фоновой задачи** (ни один процессор не пишет прогресс, все импорты применяются синхронно в server action), чтения **CSV** и кода миграции как такового (`grep -rli bitrix src` → 0). Это и есть новое в этапе.

## 1. Что показала сверка кода (§16)

Сверено на `6225663f`. Кода миграции нет — все шестнадцать требований остаются `⏳`, ниже для каждого записан образец, на который опирается решение.

| Требование | Что в коде сейчас | Образец |
|---|---|---|
| `У-188` раздел хаба | Раздела `integrations.bitrix` нет в [settings.ts](../../../src/lib/navigation/settings.ts) | `integrations.messengers` (admin-only, `legacyHrefs: []`); «Проверить подключение» — [testIntegration.ts](../../../src/lib/services/admin/testIntegration.ts) (`INTEGRATION_TEST_KEYS`, `probe*`, результат в `SyncState`), панель [integration-settings-form.tsx](../../../src/components/admin/integration-settings-form.tsx) |
| `У-189` адаптеры | Нет | Интерфейс и фабрика 1С — [adapter.ts](../../../src/lib/services/oneCSync/adapter.ts), [index.ts](../../../src/lib/services/oneCSync/index.ts) (кэш по `kind\|url\|token`), [adapter-fake.ts](../../../src/lib/services/oneCSync/adapter-fake.ts) (`FAKE_ONEC_*`); заголовки — [column-map.ts](../../../src/lib/services/import/column-map.ts) + [normalize.ts](../../../src/lib/services/import/normalize.ts); чтение книги — [workbook.ts](../../../src/lib/services/import/workbook.ts) (`exceljs`; ветка `.xls` через `xlsx` — дефект `Д-49`, новый код её не трогает) |
| `У-190` модели | Ни `BitrixImportBatch`, ни `bitrixId`, ни `LeadSource.bitrix` | `OneCImportBatch`/`OneCImportRow`, `PaymentImportBatch`/`PaymentImportWrite` (журнал `entity`/`entityId`/`action`/`before`/`reverted`) |
| `У-191` сопоставление | Есть все кирпичи: ИНН → [resolve-org.ts](../../../src/lib/services/oneCSync/resolve-org.ts), `nameKey` → [counterparty-key.ts](../../../src/lib/services/import/oneCAccountCard/counterparty-key.ts) (`organizationNameKey`), канал → [resolveContactByChannel.ts](../../../src/lib/services/contacts/resolveContactByChannel.ts), стадии → [deals/stages.ts](../../../src/lib/services/deals/stages.ts), колонки → [tasks/columns.ts](../../../src/lib/tasks/columns.ts), файлы → [upload-core.ts](../../../src/lib/services/documents/upload-core.ts) | «пустое не затирает» — `nonEmptyOnly` в [writers.ts](../../../src/lib/services/oneCSync/writers.ts) (`У-171`) |
| `У-192` пользователи | `User.email @unique` глобально; [team.ts](../../../src/lib/services/manager/team.ts) `listCompanyManagers` | — |
| `У-193` предпросмотр | Нет dry-run в воркере | Один код на предпросмотр и применение — `run(mode: 'shadow' \| 'live')` в [import/index.ts](../../../src/lib/services/import/index.ts); сводка — `BatchSummary` в [record-batch.ts](../../../src/lib/services/oneCSync/record-batch.ts) |
| `У-194` применение в воркере | Очереди `bitrix.import` и процессора нет; `job.updateProgress` в проекте не используется | Регистрация — `startWorker(queue, processor)` в [worker/index.ts](../../../src/worker/index.ts); страж `worker.processor-coverage` требует интеграционный тест на процессор |
| `У-195` идемпотентность | Только `nonEmptyOnly` у 1С; сравнения с «последней записью журнала» нигде нет | `PaymentImportWrite.before` |
| `У-196` откат | Готовый движок [rollback.ts](../../../src/lib/services/import/rollback.ts): `CHANNEL_OPS`, `computeConflicts`, частичный откат, аудит в той же транзакции; словарь `action` там — `created\|updated` | — |
| `У-197` заказы из сделок | `winDeal` в [convert.ts](../../../src/lib/services/deals/convert.ts) создаёт заказ «Черновик заявки» без `externalId` — для истории не годится; «завершённый» статус — `findByAnchor(prisma, 'closed')` в [definitions.ts](../../../src/lib/services/orderStatuses/definitions.ts), запись `OrderStatusChange` обязательна (хотфикс №19); [08_1c_integration.md](../../../docs/specs/08_1c_integration.md) §9 закрепляет `externalId = bitrix:deal:<id>` | — |
| `У-198` отчёт | Нет | XLSX в воркере → S3 → путь в модели → `createSignedUrl(path, 600, {download:true})` + 307: [generate-commission-xlsx.ts](../../../src/worker/processors/generate-commission-xlsx.ts), [xlsx route](../../../src/app/api/partner/finance/statements/[id]/xlsx/route.ts); многолистовая книга — [exportPackage.ts](../../../src/lib/services/oneCSync/exportPackage.ts); `safeText` — [export/xlsx.ts](../../../src/lib/services/export/xlsx.ts) |
| `У-199` безопасность | Секреты — `SETTING_SPECS` с `isSecret` в [integrationSettings.ts](../../../src/lib/config/integrationSettings.ts), шифрование [secrets.ts](../../../src/lib/crypto/secrets.ts); маскировка — [scrub.ts](../../../src/lib/logging/scrub.ts); ПДн — [pii/contexts.ts](../../../src/lib/pii/contexts.ts) (32 контекста) | — |
| `У-200` объём | Лимит файла импорта — `IMPORT_MAX_FILE_BYTES` (25 МБ, [import-limits.ts](../../../src/lib/config/import-limits.ts)); лимит документа — 200 МБ ([upload.ts](../../../src/lib/config/upload.ts)) | — |
| `У-201` документация | `docs/integrations/` — только `1c-contract.md`, `1c-meeting-agenda.md`, `supabase-storage-rls.md` | — |
| `У-202` флаг | Флага нет; образец поведенческого opt-in — `contacts`, `inbound_messaging` | стражи `featureFlags.route-gated`, `docs.feature-flags-matrix`, `config.env-example` |
| `У-203` тесты | Контрактный тест адаптера — [oneCSync.adapter-contract.test.ts](../../../src/__tests__/oneCSync.adapter-contract.test.ts) | — |

**Расхождения пакета с кодом (пути, имена, допущения).**

| Пакет пишет | На самом деле |
|---|---|
| `src/lib/server-actions/bitrix.ts` | server actions живут в **`src/server-actions/`**; админские с секретами — в `src/server-actions/admin/*` и в списке `SECRET_ACTION_FILES` стража `security.settings-matrix` → **`src/server-actions/admin/bitrix.ts`** |
| страж `settings.sections-registry` | такого файла нет; реестр держат **`lib.navigation.settings`** и **`security.settings-matrix.guardrail`** (`ADMIN_ONLY_SECTIONS`) |
| `csv-parse` для CSV | пакета нет в зависимостях; CSV читает **`exceljs`** (`workbook.csv.read`, уже в зависимостях) — новый пакет не заводим (`В-2-1`) |
| `BitrixImportWrite.action = create \| update \| link` | существующие журналы и движок отката фильтруют по **`created`/`updated`** — словарь: **`created \| updated \| linked`**, чтобы движок переиспользовать |
| «прогресс в `counts.progress`» | прецедента нет — механизм новый (§3.4): воркер пишет прогресс в строку пакета, экран опрашивает раз в 3 с |
| «комментарий сделки → `DealNote`, автор «импорт из Битрикс24»» | `DealNote.authorId` **NOT NULL** — колонка становится nullable (как у `OrganizationNote`), пустой автор показывается как «Импорт из Битрикс24» |
| «`won`-сделка → заказ» | `Order.organizationId` **NOT NULL** — сделка без компании заказа не даёт: строка предпросмотра «заказ: нет организации» |
| `Lead` изолирован по компании | у `Lead` **нет `companyId`** (single-tenant, скоуп через `assignedManagerId`/`organizationId`) — лид из Битрикса всегда получает ответственного (сопоставленного или «менеджера по умолчанию»), иначе он невидим |
| «конкурентность 1» у очереди | это умолчание BullMQ; опция `concurrency` в проекте не используется — не передаём, закрепляем комментарием |

**Попутные находки вне объёма (не чиним в этом этапе):** ветка `.xls` импорта 1С и чтение выписки по-прежнему идут через уязвимый `xlsx` (`Д-49` → `У-267`, этап 9); legacy-адреса `/admin/import` и `/admin/payments-import` живы параллельно хабу (`legacyHrefs`) — новый раздел заводится только под хабом.

## 2. Модели

Две миграции, обе аддитивные и обратимые. Новое значение enum нельзя использовать в той же транзакции, где оно добавлено (урок, записанный в схеме у `OneCPushStatus`), поэтому `LeadSource.bitrix` — отдельным файлом, кодом он используется только с PR-3.

**Миграция 1 `stage2_bitrix_batches`:**

```prisma
model BitrixImportBatch {
  id            String   @id @default(cuid())
  companyId     String              // компания-исполнитель, в которую льём (из формы; admin выбирает)
  importedById  String
  importedBy    User     @relation("BitrixImportedBy", fields: [importedById], references: [id])
  source        String              // 'rest' | 'file'
  mode          String   @default("initial") // 'initial' | 'resync' (еженедельный повтор, У-195)
  status        String              // preview_pending | preview | applying | applied | rolling_back | rolled_back | rollback_partial | failed
  settings      Json                // период, «вся история / только открытые», файлы да/нет, defaultManagerId, userMap, stageMap, taskColumnMap, fileKeys (file-источник)
  counts        Json                // { organizations: {create,update,skip,conflict}, contacts: …, …, progress: {step, done, total, updatedAt}, stagesFound: [...], usersFound: [...] }
  errors        Json?               // построчные ошибки и конфликты, первые 500
  reportPath    String?             // XLSX сверки в S3
  createdAt     DateTime @default(now())
  startedAt     DateTime?
  appliedAt     DateTime?
  rolledBackAt  DateTime?
  writes        BitrixImportWrite[]
  @@index([companyId, createdAt])
  @@index([status])
}

model BitrixImportWrite {
  id        String   @id @default(cuid())
  batchId   String
  batch     BitrixImportBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  entity    String   // organization | organization_manager | contact | contact_channel | lead | deal | deal_note | organization_note | task | task_assignee | document | order
  entityId  String
  bitrixId  String   // ключ строки в Битриксе ('' у производных строк: канал, исполнитель, заказ)
  action    String   // created | updated | linked
  before    Json?    // снимок изменённых полей до записи (updated/linked) — для отката
  after     Json?    // что записали — для правила «правленное в ЛК не перезаписываем» (У-195)
  reverted  Boolean  @default(false)
  createdAt DateTime @default(now())
  @@index([batchId, entity])
  @@index([entity, entityId])
}
```

Плюс колонки `bitrixId String? @unique` на `Organization`, `Contact`, `Lead`, `Deal`, `Task`, `Document` (`Р-Б-11`; портал на платформу один — настройки интеграций общие, риск `Р-2` пакета, — поэтому уникальность глобальная) и `DealNote.authorId String?` с `onDelete: SetNull` (заметка «от импорта» без автора — как у `OrganizationNote`). У `Order` новой колонки нет: заказ из Битрикса узнаётся по `externalId = bitrix:deal:<id>` ([08_1c_integration.md](../../../docs/specs/08_1c_integration.md) §9).

**Миграция 2 `stage2_lead_source_bitrix`:** `ALTER TYPE "LeadSource" ADD VALUE 'bitrix'`.

**Настройки** (`SETTING_SPECS`, таблица `IntegrationSetting`): `bitrix.portalUrl` (домен портала, не секрет), `bitrix.webhookUrl` (**`isSecret: true`**, шифрование `APP_ENCRYPTION_KEY`; на странице — `SecretsKeyNotice`), `bitrix.defaultManagerId`, `bitrix.userMap` (JSON «id пользователя Битрикса → id `User`», заполняется из формы). Переменных окружения у ключей нет (`envVar: null`) — подключение задаётся только из интерфейса (§0 ТЗ «ничего не включается на сервере»). Флаг `bitrix_migration` — `FEATURE_BITRIX_MIGRATION` в `.env.example`, строка в матрице флагов. Фикстура — `FAKE_BITRIX=1` (реестр тестовых переменных `helpers/envRegistry.ts`, рядом с `FAKE_ONEC_*`).

## 3. Ключевые решения

### 3.1. Один интерфейс источника, три реализации (`У-189`, `Р-Б-1`)

`src/lib/services/bitrix/source.ts` объявляет нормализованные типы (`BitrixUser`, `BitrixCompany` с ИНН из реквизитов, `BitrixContact` с телефонами и e-mail, `BitrixLead`, `BitrixDeal`, `BitrixStage`, `BitrixTask`, `BitrixComment`, `BitrixFile`) и интерфейс:

```ts
interface BitrixSource {
  check(): Promise<{ ok: true; portal: string; user: string } | { ok: false; message: string }>;
  users(): AsyncIterable<BitrixUser>;
  stages(): Promise<BitrixStage[]>;                 // все направления и стадии сделок портала
  companies(f: SourceFilter): AsyncIterable<BitrixCompany>;
  contacts(f: SourceFilter): AsyncIterable<BitrixContact>;
  leads(f: SourceFilter): AsyncIterable<BitrixLead>;
  deals(f: SourceFilter): AsyncIterable<BitrixDeal>;
  tasks(f: SourceFilter): AsyncIterable<BitrixTask>;
  comments(entity: 'deal' | 'company' | 'contact', ids: string[]): AsyncIterable<BitrixComment>;
  files(entity: 'deal' | 'company', ids: string[]): AsyncIterable<BitrixFile>;
  download(file: BitrixFile): Promise<Buffer>;
}
```

Списки — `AsyncIterable`, страница за страницей: сущности не собираются в памяти целиком (`У-200`). `SourceFilter` — период по дате создания и «только открытые» (сделки, задачи).

- **`rest`** (`adapter-rest.ts` + `client.ts`): `fetch` к `https://<портал>/rest/<userId>/<token>/<метод>`; страницы по 50 (`start`/`next`/`total`); ограничитель **2 запроса в секунду** (token bucket); на HTTP 503 с `error: QUERY_LIMIT_EXCEEDED` и на сетевые ошибки — **3 повтора с экспоненциальной паузой** (1, 2, 4 с); таймаут запроса 30 с; комментарии и файлы — через `batch` по 50 команд с `halt: 0`. Методы: `profile` (проверка), `user.get`, `crm.company.list` + `crm.requisite.list` (`RQ_INN`, `ENTITY_TYPE_ID = 4`), `crm.contact.list` (мультиполя `PHONE`/`EMAIL` запрашиваются явно в `select`), `crm.lead.list`, `crm.deal.list`, `crm.dealcategory.list` + `crm.status.list` по `DEAL_STAGE`/`DEAL_STAGE_<id>` (семантика `success`/`failure`/`process` из `EXTRA.SEMANTICS`) и по `STATUS` (стадии лидов), `crm.timeline.comment.list` (`ENTITY_TYPE`/`ENTITY_ID`; вложения — из поля `FILES` тех же комментариев), `tasks.task.list` (`UF_CRM_TASK` → связи `CO_`/`D_`/`L_`/`C_`), `disk.attachedObject.get` (имя, размер, `DOWNLOAD_URL`). Транспорт — отдельная функция `transport(url, body)`, в unit-тестах подменяется моком (пагинация, лимит, backoff, таймаут, `batch` — без сети).
- **`file`** (`adapter-file.ts` + `column-map.ts`): выгрузки Битрикса по сущностям (компании, контакты, лиды, сделки, задачи) в XLSX или CSV; книга читается **`exceljs`** (XLSX — `loadXlsxWorkbook`, CSV — `workbook.csv.read` с разделителем `;` и BOM), сопоставление колонок по заголовкам с алиасами (русские и английские шапки выгрузки); сущность файла определяется набором заголовков; неизвестная колонка — предупреждение в диагностике, не ошибка. Стадии из файла — как есть (строки `STAGE_ID`/«Стадия»), ИНН — из колонки реквизитов. Файлы-вложения файловый источник не переносит (у выгрузки их нет) — счётчик «пропущено: источник не даёт файлов».
- **`fake`** (`adapter-fake.ts`): фикстура в памяти — 5 компаний (2 с ИНН существующих организаций сида, 1 совпадающая по названию, 2 новые), 8 контактов (один с общим телефоном), 6 лидов, 6 сделок (2 `won`, 1 `lost`), 4 задачи, 3 файла, 10 комментариев; та же фикстура в виде CSV — `src/__fixtures__/bitrix/*.csv` (тест равенства файлового и REST-источника). Включается `FAKE_BITRIX=1` (стенд, тесты) и подменяет `rest`.

Фабрика `getBitrixSource(prisma, batch)`: `source === 'file'` → файловый адаптер из ключей S3 пакета; иначе — `fake` при `FAKE_BITRIX=1`, иначе `rest` из настроек `bitrix.*` (кэш по домену и токену, как у 1С).

### 3.2. Пакет: один код на предпросмотр и применение, вся работа в воркере (`У-193`, `У-194`)

Пакет создаётся из формы раздела (источник, компания-исполнитель, период, «вся история / только открытые», файлы да/нет, менеджер по умолчанию) в статусе `preview_pending` и ставится в очередь **`bitrix.import`** задачей `preview`. Процессор `src/worker/processors/bitrix-import.ts` выполняет **тот же конвейер**, что и применение, в режиме `shadow` (образец — `run(mode)` импорта 1С): читает источник, строит план записи по каждой сущности, считает сводку «создать / обновить / уже есть / пропустить (причина)», собирает конфликты, **список стадий и пользователей портала** (в `counts.stagesFound`/`usersFound` — из них экран рисует таблицы сопоставления) и оценку объёма; ничего не пишет; статус → `preview`.

«Применить» доступно, когда все стадии сделок и лидов сопоставлены (`У-193`); таблицы стадий и пользователей уезжают в `settings` пакета и запускают задачу `apply` — тот же конвейер в режиме `live`: сущности пишутся **в порядке зависимостей** (пользователи → компании → контакты → лиды → сделки → заметки → задачи → файлы → заказы из выигранных сделок), каждая строка — своя короткая транзакция вместе со строкой журнала `BitrixImportWrite` (журнал **не** fail-open, в отличие от импорта 1С: без него нет отката, а откат — требование приёмки); ошибка строки → `errors` (первые 500), пакет продолжает; итог — `applied` + отчёт (§3.6). Повтор на том же портале (`mode: resync`) идёт тем же путём.

**Прогресс** (новый механизм): процессор раз в 50 строк и при смене шага пишет `counts.progress = { step, done, total, updatedAt }`; страница пакета — серверный компонент, а прогресс рисует клиентский `BatchProgress`, который опрашивает server action `getBitrixBatchStateAction(batchId)` раз в 3 с, пока статус `preview_pending`/`applying`/`rolling_back`, и затем `router.refresh()`. Очередь одна, задачи `preview`/`apply`/`rollback` различаются `job.name`, обрабатываются по одной (умолчание BullMQ; опцию `concurrency` не передаём).

Процессор в начале каждой задачи проверяет флаг `bitrix_migration` (снапшот настроек праймится воркером): выключен → пакет `failed` с причиной «миграция выключена» (`У-202`).

### 3.3. Сопоставление сущностей — чистые функции (`У-191`, `У-192`)

`src/lib/services/bitrix/mapping/*.ts`: вход — нормализованная сущность + состояние ЛК (найденные совпадения, таблицы сопоставления), выход — план `create | update | skip(reason) | conflict(reason)` с полями. Функции чистые — тесты табличные, без базы. Правила (таблица 16 §6 с уточнениями сверки):

| Битрикс24 | ЛК | Правило |
|---|---|---|
| Компания | `Organization` | по `bitrixId` → обновить; иначе ИНН из реквизитов → существующая (ИНН уникален **глобально**: тёзка в другой компании → `conflict` «ИНН у организации другой компании», строка не создаётся); без ИНН → `nameKey` в компании-исполнителе; иначе создать с пометкой «ИНН не указан»; `nameKey` считается всегда; `externalId` не трогаем; ответственный → `OrganizationManager` (сопоставленный пользователь, иначе менеджер по умолчанию) |
| Контакт | `Contact` + `ContactChannel` | по `bitrixId` → обновить; иначе совпадение любого канала (телефон/e-mail нормализуются как в справочнике) с контактом, у которого `bitrixId` пуст, → это он (`bitrixId` дописывается); канал, занятый контактом **с другим** `bitrixId`, пропускается со строкой «канал уже у контакта …», контакт создаётся с остальными каналами; каналы, совпадающие с `User.email`, не заводятся (`isUserOwnedChannel`); имя пустое → «Без имени»; `COMPANY_ID` → организация по `bitrixId`; должность → `position` |
| Лид | `Lead` | `source: bitrix`; статус портала → стадия воронки компании по таблице (`NEW`/`IN_PROCESS` → активная стадия из таблицы, `CONVERTED` → `promoted_to_deal` со связью по `bitrixId` сделки, `JUNK` → `rejected`); `clientCompanyName`/`clientContactName`/`subject` — из `TITLE`/`NAME`/`COMPANY_TITLE`, пустое → «Без названия» / «Лид из Битрикс24»; телефон и почта могут отсутствовать (история; штатный валидатор обращений не применяется); ответственный — сопоставленный или менеджер по умолчанию (лид без ответственного невидим — у `Lead` нет компании) |
| Сделка | `Deal` | стадия по таблице «направление:стадия → `DealStage` компании» (стадии с семантикой `success`/`failure` предлагаются в `won`/`lost` автоматически, остальные — обязательный выбор; синтетические `default:*` в базу не пишутся — `stageId = null` + якорь статуса); сумма, даты (`wonAt`/`lostAt`/`expectedCloseAt` из `CLOSEDATE`), ответственный, организация и контакт по `bitrixId`, лид по `LEAD_ID`; `won` → §3.5 |
| Комментарий таймлайна сделки | `DealNote` | автор по e-mail, иначе `authorId = null` («Импорт из Битрикс24»); `createdAt` — дата оригинала; пишется своим writer'ом (штатный `addNoteToDeal` дат не принимает) |
| Комментарий компании / контакта | `OrganizationNote` | организация комментария; для контакта — его организация с префиксом «О контакте <имя>: »; контакт без организации → `skip` «нет организации»; `authorId` по e-mail или `null`; `body` усекается до 4000 |
| Задача | `Task` | статус `2/3` → колонка «В работе», `4` → «На проверке», `5` → колонка `isDoneColumn` (`completedAt` из `CLOSED_DATE`), `6` → «К выполнению» с пометкой «отложено» в описании; таблица «статус → колонка» правится в предпросмотре; постановщик и исполнители по e-mail (исполнители только из той же компании), иначе менеджер по умолчанию; `UF_CRM_TASK` → `linkedOrganizationId`/`linkedDealId`/`linkedLeadId` по `bitrixId` (контакт — через его организацию: `linkedContactId` появится в этапе 4); `dueDate` из `DEADLINE` |
| Файл сделки / компании | `Document` | через `persistUploadedDocument`: `direction incoming`, `type other`, контрагент — организация сделки или компания; `orderId null`, без `number`; MIME и лимит 200 МБ проверяет `upload-core`, антивирус — очередь `docs.scanDocument`; файл без организации → `skip`; `bitrixId` файла дописывается после создания; имя файла сохраняется |
| Выигранная сделка → заказ | `Order` | §3.5 |
| Дела, лента, соцсеть, CRM-формы | — | не переносятся; счётчик «пропущено: не поддерживается» |

Пользователи (`У-192`): `user.get` → таблица «пользователь портала → `User` по e-mail (сотрудники компании-исполнителя)»; несопоставленные → менеджер по умолчанию; таблица показывается в предпросмотре, правится и сохраняется в `settings` пакета и в `bitrix.userMap` (умолчание для следующих пакетов). Новых пользователей миграция не создаёт.

### 3.4. Идемпотентность и параллельный период (`У-195`)

Повтор на том же портале обновляет по `bitrixId`. Три правила при `update`:

1. **Пустое не затирает**: поле из Битрикса пустое → не пишется (`nonEmptyOnly`, как у 1С, `У-171`).
2. **Правленное в ЛК не перезаписывается**: значение поля в ЛК сравнивается с `after` последней записи журнала по этой сущности; отличается → поле правили руками → пропускаем, в отчёте строка «оставлено ручное значение». Совпадает → пишем новое значение из Битрикса.
3. **Снимок `before`** пишется только по реально изменённым полям.

Еженедельный повтор — расписание `bitrix.resync` в реестре `SYNC_SCHEDULES` (`editable: true`, выключено, пока администратор не включит из раздела кнопкой «Повторять еженедельно», `scheduleResync`); задача создаёт пакет `mode: resync` с настройками последнего применённого пакета и сразу применяет его без предпросмотра (таблицы сопоставления уже есть; новая стадия портала без сопоставления → пакет останавливается в `preview` с конфликтом «новая стадия»). Runbook параллельного периода — §3.9.

### 3.5. Выигранные сделки → заказы (`У-197`, `Р-Б-2`)

Сделка со стадией семантики `success` пишется как `Deal` со статусом `won` (история: дата закрытия, сумма) **и** привязывается к заказу:

1. ищется заказ **1С** той же организации (`externalId` не пустой и не начинается с `bitrix:`) с суммой ±1 % и датой закрытия/завершения ±30 дней от `CLOSEDATE` → `Deal.orderId` (запись `linked`, откатывается снятием связи); предпросмотр показывает «заказ: найден в 1С №…»;
2. не найден → создаётся `Order`: `externalId = bitrix:deal:<id>`, `title` сделки, `totalAmount` = сумма сделки, `statusId` = статус с якорем `closed` (+ строка `OrderStatusChange`, иначе статус без истории), `executionStatus completed`, `closedAt`/`completedAt` = `CLOSEDATE`, менеджер сделки, без строк заказа; оплата **не заполняется** (`financialStatus not_billed`, `paidAmount 0`) — деньги считает 1С (`В-2-3`); 1С-синк такие заказы не трогает (ключи не пересекаются);
3. сделка без организации → заказа нет, строка «заказ: нет организации».

**Ручное объединение** «Это тот же заказ, что …» — в карточке заказа из Битрикса (кабинеты администратора и руководителя, `В-2-4`): выбор заказа 1С той же организации → `services/orders/mergeExternal.ts` переносит `Deal.orderId`, документы, задачи, заметки и контакт заказа на заказ 1С и удаляет заказ Битрикса, если у него нет оплат и строк (иначе отказ с русской строкой); аудит `order_merged_into`.

### 3.6. Откат и отчёт сверки (`У-196`, `У-198`)

**Откат** — задача `rollback` в той же очереди (пакет может быть большим — не одна транзакция на всё): строки журнала в **обратном порядке** порциями по сущности; `updated` → вернуть `before`; `created` → удалить, если на строку нет новых ссылок (заказ с оплатой, организация с новыми заказами или документами не из пакета, контакт с новыми диалогами — конфликт «нельзя откатить: …» со строкой в отчёте, статус `rollback_partial`); `linked` → снять связь; каждая порция — транзакция; аудит `bitrix_import_rolled_back`. Откат разрешён 30 дней после применения (окно движка `rollback.ts`).

**Отчёт** строится в конце `apply` (и после отката — обновляется): книга `exceljs` с листами по сущностям (id Битрикса, id ЛК, действие, что записано/пропущено) + «Конфликты» + «Пропущено» + «Оставлено ручное» (правило §3.4); `safeText` против формульной инъекции; S3 `bitrix-import/<batchId>/report-<время>.xlsx`, путь в `reportPath`. Скачивание — `GET /api/admin/bitrix/[batchId]/report` → `recordPiiAccess` (контекст `bitrix_report`, субъект `contact`, действие `export`) → подписанная ссылка 307 на 10 минут.

**История пакетов** — `/admin/settings/integrations/bitrix/history`: дата, кто, источник, режим, итоги, статус, «Отчёт», «Откатить» (с объяснением, почему кнопка неактивна: окно, статус, ничего не откатывать).

### 3.7. Безопасность (`У-199`, `У-202`)

Только `admin` (`cabinets: ['admin']`, право `settings.integrations.manage`; раздел — в `ADMIN_ONLY_SECTIONS` стража матрицы; server actions — в `SECRET_ACTION_FILES`). Вебхук хранится зашифрованным, страница показывает только «задан/не задан»; в логах, аудите и `SyncState` — **домен портала** (`portalHost()`), сам URL с токеном не пишется никогда. Сырые ответы API не хранятся: адаптер отдаёт нормализованные записи, в `errors` попадает только `bitrixId` и текст причины. Файлы — MIME allow-list, magic bytes, антивирус (`upload-core`). Флаг `bitrix_migration` — поведенческий opt-in, точки чтения: раздел хаба (`flag` у записи реестра → `requireSettingsSection` → `notFound`), server actions `admin/bitrix.ts` (`forbidden`), роуты `/api/admin/bitrix/*` (`notFoundIfDisabled`), процессор (пакет `failed`), расписание `bitrix.resync` (пропуск). В `FEATURE_PREFIXES` не добавляется — иначе не включится из интерфейса.

### 3.8. Объём (`У-200`)

Предпросмотр считает сущности по `total` списков; больше 50 000 → предупреждение «разбейте по периодам» с предложением границ (по кварталам по `DATE_CREATE`), «Применить» остаётся доступным. Списки читаются постранично, файлы — по одному (буфер одного файла ≤ 200 МБ, потоковой записи в S3 у `upload-core` нет — `В-2-5`). `errors` и конфликты — первые 500, остальное считается.

### 3.9. Документация и runbook (`У-201`)

`docs/integrations/bitrix24-migration.md`: как создать входящий вебхук (права `crm`, `tasks`, `disk`, `user`), какие методы зовём, ограничения тарифов (лимит 2 запроса/с, `batch`), как снять выгрузки для файлового источника, что переносится, а что нет. Runbook параллельного периода: день 0 — полный пакет, две недели — еженедельный повтор, критерий отключения — неделя без правок в Битриксе и пустой повтор (0 создано/обновлено), финальный пакет, выключение. Глоссарий: «Миграция из Битрикс24», «Пакет миграции».

### 3.10. Границы этапа

Не делаем здесь: перенос дел, ленты, CRM-форм, соцсети (`01` §4); `linkedContactId` у задач (этап 4); потоковую загрузку файлов больше 200 МБ; создание пользователей по e-mail; замену `xlsx` в старых читателях (`У-267`); маппинг обращений (`ClientRequest`) — Битрикс их не различает от лидов; двусторонний обмен (только импорт).

## 4. Разбивка на PR

Шесть PR от `main`, каждый зелёный сам по себе; порядок нарушать нельзя (PR-2…PR-6 читают модели и интерфейс PR-1, PR-4 — план предпросмотра PR-3, PR-5 — журнал PR-4).

| PR | Что | Требования | Файлы (главное) |
|---|---|---|---|
| **PR-1 «основа»** (Task 5) | миграции (модели пакета, `bitrixId` ×6, `DealNote.authorId` nullable; отдельно `LeadSource.bitrix`); `SETTING_SPECS` `bitrix.*`; флаг `bitrix_migration` (+ матрица, `.env.example`); `services/bitrix/{source,client,adapter-rest,adapter-fake,factory}.ts`; фикстура; `probeBitrix` в `testIntegration.ts`; раздел `integrations.bitrix` в реестре хаба + страница с формой подключения и «Проверить подключение»; `server-actions/admin/bitrix.ts` (`saveConnection`, `testConnection`); аудит-действия и подписи; `FAKE_BITRIX` в реестре env; стражи матрицы/секретов | `У-188`, `У-189` (rest), `У-190`, `У-202` | `prisma/*`, `src/lib/config/integrationSettings.ts`, `src/lib/featureFlags.ts`, `src/lib/services/bitrix/*`, `src/lib/services/admin/testIntegration.ts`, `src/lib/navigation/settings.ts`, `src/app/admin/settings/integrations/bitrix/{layout,page}.tsx`, `src/components/settings/bitrix-tabs.tsx`, `src/server-actions/admin/bitrix.ts`, `src/lib/auth/audit.ts`, `src/lib/audit/labels.ts`, `docs/feature-flags-matrix.md`, `.env.example` |
| **PR-2 «файловый источник»** (Task 6) | `POST /api/admin/bitrix/upload` (multipart, до 5 файлов по сущностям, лимит `IMPORT_MAX_FILE_BYTES`, ключи S3 `bitrix-import/uploads/…`); `adapter-file.ts`, `column-map.ts` (алиасы шапок), CSV/XLSX через `exceljs`; форма выбора файлов на странице; фикстура CSV | `У-189` (file) | `src/app/api/admin/bitrix/upload/route.ts`, `src/lib/services/bitrix/{adapter-file,column-map}.ts`, `src/__fixtures__/bitrix/*.csv`, `src/components/bitrix/upload-form.tsx` |
| **PR-3 «сопоставление и предпросмотр»** (Task 7) | `mapping/{users,organizations,contacts,leads,deals,stages,tasks,notes,files,orders}.ts` (чистые функции); `preview.ts` — конвейер `run(mode)` в режиме `shadow`; очередь `bitrix.import` + типы задач; процессор `bitrix-import.ts` (`preview`); форма «Новый пакет», страница пакета `[batchId]` (сводка, конфликты, таблицы стадий/пользователей/колонок, прогресс, предупреждение 50 000); `createPreview`, `getBitrixBatchState`, `saveBatchMapping` | `У-191`, `У-192`, `У-193`, `У-200` | `src/lib/services/bitrix/mapping/*`, `src/lib/services/bitrix/{pipeline,preview}.ts`, `src/lib/jobs/{queues,types}.ts`, `src/worker/processors/bitrix-import.ts`, `src/worker/index.ts`, `src/app/admin/settings/integrations/bitrix/[batchId]/page.tsx`, `src/components/bitrix/*` |
| **PR-4 «применение»** (Task 8) | режим `live`: writer'ы по сущностям с журналом `BitrixImportWrite` (транзакция на строку), правила §3.4, заказы из `won` (`wonDealToOrder.ts`), файлы через `upload-core`, прогресс и построчные ошибки, статус `applied`; «Это тот же заказ, что …» в карточке заказа (`mergeExternal.ts`, кнопка у admin и leader) | `У-194`, `У-195`, `У-197` | `src/lib/services/bitrix/{apply,writers/*,wonDealToOrder}.ts`, `src/lib/services/orders/mergeExternal.ts`, `src/components/orders/merge-external-order-button.tsx`, карточки заказа admin/leader |
| **PR-5 «откат, отчёт, история, безопасность»** (Task 9) | `rollback.ts` (задача `rollback`, обратный порядок, конфликты, частичный откат), `report.ts` (XLSX → S3), история пакетов, роут отчёта с `recordPiiAccess('bitrix_report')`, ПДн-контекст, аудит `bitrix_import_*`; стражи: журнал не fail-open, отчёт совпадает с журналом | `У-196`, `У-198`, `У-199` | `src/lib/services/bitrix/{rollback,report}.ts`, `src/app/admin/settings/integrations/bitrix/history/page.tsx`, `src/app/api/admin/bitrix/[batchId]/report/route.ts`, `src/lib/pii/contexts.ts` |
| **PR-6 «расписание, документация, close-out»** (Task 10) | расписание `bitrix.resync` (+ `scheduleResync`, редактор cron из `У-125`), `docs/integrations/bitrix24-migration.md`, runbook, глоссарий, `AUDIT.md` (`У-188`…`У-203` ✅ с якорями), `STATUS.md` (этап 2 ✅, «Текущий этап» → 3), CHANGELOG, close-out плана, `tz:status` | `У-201`, `У-203` (финал) | `src/lib/jobs/scheduling.ts`, `src/lib/services/admin/syncSchedules.ts`, `docs/integrations/bitrix24-migration.md`, `docs/glossary.md`, `docs/tz/*` |

Если PR-3 или PR-4 разрастутся, делятся по сущностям (3a «пользователи, компании, контакты», 3b «лиды, сделки, задачи, заметки, файлы») — порядок и требования те же.

## 5. Тестовая стратегия

- **Unit (без базы):** REST-клиент на мок-транспорте — пагинация `start`/`next`, ограничитель 2 запроса/с (фейковые таймеры), `QUERY_LIMIT_EXCEEDED` → backoff и три повтора, таймаут, `batch` по 50; файловый адаптер — CSV из фикстуры даёт тот же нормализованный набор, что fake (тест равенства), неизвестная колонка — предупреждение; **маппинг — табличные тесты** по каждой сущности (ИНН чужой компании → конфликт, канал чужого `bitrixId` → пропуск канала, стадия без сопоставления → блокировка, `won` с совпадением → `linked`, без — `create` заказа, `default:*` → `stageId null`); правила §3.4 (пустое не затирает, правленное сохраняется, `before` только по изменённым полям).
- **Integration (живой Postgres):** процессор на fake-источнике — предпросмотр ничего не пишет и даёт ожидаемые счётчики; применение создаёт 5 организаций (2 совпали по ИНН и обновились без затирания), контакты с каналами, лиды и сделки на стадиях, задачи в колонках, заметки с датами оригинала и пустым автором, файлы `pending` с задачей в очереди (`getQueue` мокается); две `won`-сделки — одна к заказу 1С в допуске, вторая — новый `bitrix:deal:<id>` со строкой `OrderStatusChange`; **двойной прогон** — 0 создано, обновления только по изменившимся полям, правленное руками не перезаписано; **откат** — выборки до/после совпадают, заказ с новым платежом блокирует откат строкой; отчёт совпадает с журналом; чужая роль → `forbidden`/404; интеграционный тест процессора называется `worker.bitrix-import.integration.test.ts` (страж `worker.processor-coverage`).
- **Стражи (каждый проверяется мутацией):** журнал пишется в одной транзакции со строкой (снять — красный); в логах нет URL вебхука (страж по исходнику: `webhookUrl` не попадает в `log.*`); `bitrixId` ни у одной из шести моделей не пропал; раздел в `ADMIN_ONLY_SECTIONS`; действия `admin/bitrix.ts` начинаются с `requireAdmin`/`requireSettingsSection`; флаг во всех точках; `xlsx` не импортируется из `services/bitrix/**`; `SyncScheduleQueueName` содержит `bitrix.import`.
- **Компоненты и страницы (RTL, `renderServerComponent`):** форма подключения (секрет показывается как «задан», `SecretsKeyNotice` без ключа), таблицы сопоставления блокируют «Применить», прогресс опрашивает и останавливается, история с объяснением неактивной кнопки, кнопка «Это тот же заказ» только у admin/leader.
- **Playwright-эталоны:** раздел, страница пакета в статусе `preview` на fake-источнике, история — 1280×800 и 390×844.
- **Гейты каждого PR:** `typecheck` · `lint` · полный `test:unit` (в фоне, код выхода в файл) · интеграционные тесты затронутых сервисов · покрытие новых файлов 100 % адресно · `boundaries` · `deadcode` · `dup:check` · `format:check` · `build` · `tz:status`.

## 6. Риски

1. **`Lead` без `companyId`.** Лиды Битрикса видны через ответственного; при двух компаниях-исполнителях на одной платформе изоляция держится только назначением. Записано в §3.3; архитектурное изменение — вне объёма (вопрос заказчику `В-2-6`).
2. **Дубли организаций по ИНН между компаниями** — глобальный `@unique`; конфликт показывается в предпросмотре, не чинится молча (`Р-4` пакета).
3. **Общий телефон у нескольких контактов** (частый случай — номер фирмы): канал достаётся первому, остальные получают строку в отчёте; при включении справочника дубли разбираются объединением (`У-181`).
4. **Объём одного портала.** Постраничное чтение и строчные транзакции держат память ровной; оценка времени в предпросмотре — по `total` списков и 2 запросам/с (10 000 сущностей ≈ 15–20 минут).
5. **Прогресс — новый механизм**: опрос раз в 3 с одной короткой выборкой пакета; при обрыве воркера пакет остаётся `applying` — кнопка «Запустить заново» ставит задачу повторно (идемпотентность §3.4 делает повтор безопасным).
6. **Изменение `DealNote.authorId` на nullable** трогает три места чтения (`deals/notes.ts`, `manager/dealNotes.ts`, диалог сделки) — `typecheck` не даст пропустить.
7. **Расхождение семантики стадий** (в портале несколько направлений сделок с одинаковыми названиями стадий) — таблица сопоставления ведётся по паре «направление : стадия».
8. **Файлы через буфер**: файл больше 200 МБ пропускается со строкой в отчёте; потоковая запись — отдельный объём (`В-2-5`).

## 7. Вопросы заказчику (умолчания действуют, если не отменены до кода)

| № | Вопрос | Умолчание |
|---|---|---|
| В-2-1 | CSV-выгрузки читать имеющимся `exceljs` (без нового пакета `csv-parse`, который называет пакет ТЗ)? | да, `exceljs` — новых зависимостей не заводим |
| В-2-2 | Тариф Битрикс24 и есть ли REST и выгрузка файлов (`В-Б-3`)? | REST есть; файлы переносятся, если `disk.*` доступен, иначе счётчик «пропущено: файлы недоступны» |
| В-2-3 | Заказ из выигранной сделки: сумма — сумма сделки, а оплата **не заполняется** (`not_billed`, 0 ₽), деньги считает 1С — так? | да; если нужен «оплачен» — одна строка в writer'е |
| В-2-4 | «Это тот же заказ, что …» — кнопка у администратора и руководителя (менеджеру не даём: операция объединяет сущности)? | да, admin и leader |
| В-2-5 | Файлы больше 200 МБ (лимит документа) пропускаем со строкой в отчёте, потоковую загрузку не делаем? | да, пропускаем |
| В-2-6 | Переносить всю историю или только открытые сделки и задачи плюс год истории (`В-Б-4`)? | вся история; период и «только открытые» — переключатели формы |
| В-2-7 | Еженедельный повтор после первого пакета включать сразу или только по кнопке администратора? | по кнопке; до нажатия расписание выключено |
| В-2-8 | Комментарии контактов без организации — пропускать (в ЛК заметка живёт у организации) или создавать организацию-заглушку? | пропускать со строкой в отчёте |
| В-2-9 | Стадии лидов портала (`NEW`, `IN_PROCESS`, свои) сопоставлять с воронкой компании вручную в предпросмотре, как стадии сделок? | да, той же таблицей; `CONVERTED`/`JUNK` — автоматически |
