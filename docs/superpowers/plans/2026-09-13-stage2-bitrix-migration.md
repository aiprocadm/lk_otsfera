# Этап 2 «Миграция из Битрикс24» — план

Спека — [2026-09-13-stage2-bitrix-migration-design.md](../specs/2026-09-13-stage2-bitrix-migration-design.md)
(предъявлена 13.09.2026, PR [#596](https://github.com/aiprocadm/lk_otsfera/pull/596);
подтверждена мержем спеки; девять умолчаний §7 действуют, пока заказчик не
отменил). Требования `У-188`…`У-203` действующего
[ТЗ «CRM для отдела продаж — замена Битрикс24»](../../tz/2026-09-12-tz-crm-bitrix-replacement.md),
тексты — пакет [16_bitrix24_migration.md](../../specs/16_bitrix24_migration.md), порядок задач —
[15 Task 5…10](../../specs/15_claude_code_tasks.md).

REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Цель.** Перенести из Битрикс24 компании, контакты, лиды, сделки, задачи, комментарии и файлы так, чтобы после двух недель параллельной работы Битрикс можно было выключить: предпросмотр → применение в фоне → отчёт сверки → откат.

**Архитектура.** Один интерфейс источника `BitrixSource` (постраничные `AsyncIterable`) с тремя адаптерами (`rest`, `file`, `fake`); один конвейер `runPipeline(mode: 'shadow' | 'live')` в воркере (очередь `bitrix.import`, задачи `preview`/`apply`/`rollback`) с прогрессом в строке пакета; чистые функции сопоставления по сущностям; журнал записей `BitrixImportWrite` в одной транзакции со строкой; отчёт XLSX в S3.

**Стек.** Next.js 15, Prisma 6, BullMQ, `exceljs` (XLSX и CSV), `fetch` без новых пакетов, Vitest, Playwright.

**Глобальные ограничения (из спеки):** только `admin`; секрет `bitrix.webhookUrl` шифруется, в логах — домен портала; сырые ответы API не хранятся; `xlsx` (SheetJS) из `services/bitrix/**` не импортируется; новых npm-зависимостей нет; лимит 2 запроса/с к порталу; `bitrixId String? @unique` на шести моделях; `externalId = bitrix:deal:<id>` у заказов; словарь журнала `created | updated | linked`; статусы пакета `preview_pending | preview | applying | applied | rolling_back | rolled_back | rollback_partial | failed`; журнал записей пишется в той же транзакции, что и строка; покрытие новых файлов 100 %, стражи проверены мутацией; русские строки — через `errorMessageRu` и словари компонентов.

## Разбивка

| PR | Что | Требования | Статус |
|---|---|---|---|
| PR-1 «основа» | Миграции (модели пакета, `bitrixId` ×6, `DealNote.authorId` nullable; отдельно `LeadSource.bitrix`); `SETTING_SPECS` `bitrix.*`; флаг `bitrix_migration`; `services/bitrix/{source,client,adapter-rest,adapter-fake,factory}.ts` + фикстура; `probeBitrix`; раздел хаба `integrations.bitrix` со страницей подключения и «Проверить подключение»; `server-actions/admin/bitrix.ts`; аудит; `FAKE_BITRIX` в реестре env; стражи | `У-188`, `У-189` (rest), `У-190`, `У-202` | ⏳ |
| PR-2 «файловый источник» | `POST /api/admin/bitrix/upload`; `adapter-file.ts` + `column-map.ts` (CSV/XLSX через `exceljs`); форма файлов; фикстура CSV; тест равенства с fake | `У-189` (file) | ⏳ |
| PR-3 «сопоставление и предпросмотр» | `mapping/*` (чистые функции); `pipeline.ts` (`shadow`); очередь `bitrix.import`, процессор `bitrix-import.ts` (`preview`); форма «Новый пакет», страница пакета с таблицами стадий/пользователей/колонок, прогрессом и предупреждением 50 000 | `У-191`, `У-192`, `У-193`, `У-200` | ⏳ |
| PR-4 «применение» | `pipeline.ts` (`live`): writer'ы с журналом, правила идемпотентности, заказы из `won` (`wonDealToOrder.ts`), файлы через `upload-core`, прогресс и ошибки, `applied`; «Это тот же заказ, что …» (`mergeExternal.ts`) | `У-194`, `У-195`, `У-197` | ⏳ |
| PR-5 «откат, отчёт, история, безопасность» | `rollback.ts` (задача `rollback`), `report.ts` (XLSX → S3), история пакетов, роут отчёта с `recordPiiAccess('bitrix_report')`, аудит `bitrix_import_*`, стражи | `У-196`, `У-198`, `У-199` | ⏳ |
| PR-6 «расписание, документация, close-out» | `bitrix.resync` в расписаниях, `scheduleResync`; `docs/integrations/bitrix24-migration.md` + runbook; глоссарий; `AUDIT.md`, `STATUS.md` (этап 2 ✅, «Текущий этап» → 3), CHANGELOG, close-out | `У-201`, `У-203` (финал) | ⏳ |

**Порядок обязателен:** PR-1 → PR-2 → PR-3 → PR-4 → PR-5 → PR-6. PR-2…PR-6
читают модели и интерфейс PR-1, PR-4 — план предпросмотра PR-3, PR-5 — журнал
PR-4. Если PR-3 или PR-4 разрастутся — делятся по сущностям (3a «пользователи,
компании, контакты», 3b «лиды, сделки, задачи, заметки, файлы»).

Гейты на каждый PR: `npm run typecheck` · `npm run lint` · полный `npm run test:unit`
(в фоне, код выхода в файл) · интеграционные тесты затронутых сервисов против
живого Postgres · покрытие новых файлов 100 % (`npx vitest run --coverage.enabled=true
--coverage.include=<файл>` адресно) · `npm run boundaries` · `npm run deadcode` ·
`npm run dup:check` · `npm run format:check` · `npm run tz:status` · `npm run build` ·
запись в `CHANGELOG.md`. Каждый новый страж проверен мутацией (сломать → красный →
вернуть → зелёный) и упомянут в PR. Стражи, которые видны только полному прогону:
`services.no-test-only-modules` (у сервиса должен быть боевой потребитель),
`server-actions.session-guard` (`requireSession(`/`require*(` литералом в теле каждого
действия), `services.stable-pagination-order`, `ui.empty-states`,
`security.settings-matrix`, `worker.processor-coverage`, `config.env-registry`,
`config.env-example`, `config.settings-from-ui`, `pii.contexts`, `lib.audit.labels`,
`docs.feature-flags-matrix`, `docs.tz-program`.

## PR-1 «основа» — модели, флаг, источник, раздел подключения

- [x] `prisma/schema.prisma`: `BitrixImportBatch` (`companyId`, `importedById` → `User` `"BitrixImportedBy"`, `source`, `mode @default("initial")`, `status`, `settings Json`, `counts Json`, `errors Json?`, `reportPath String?`, `createdAt`, `startedAt?`, `appliedAt?`, `rolledBackAt?`, `writes`, `@@index([companyId, createdAt])`, `@@index([status])`), `BitrixImportWrite` (`batchId` Cascade, `entity`, `entityId`, `bitrixId`, `action`, `before Json?`, `after Json?`, `reverted @default(false)`, `createdAt`, `@@index([batchId, entity])`, `@@index([entity, entityId])`); `bitrixId String? @unique` у `Organization`, `Contact`, `Lead`, `Deal`, `Task`, `Document`; `DealNote.authorId String?` + `author User?` с `onDelete: SetNull`; обратная связь `bitrixImports BitrixImportBatch[]` у `User`
- [x] миграция `stage2_bitrix_batches` (аддитивная; комментарий «зачем» и обратный SQL в комментарии): две таблицы, шесть колонок с уникальными индексами, `ALTER TABLE "DealNote" ALTER COLUMN "authorId" DROP NOT NULL` + перевод FK на `SET NULL`; миграция `stage2_lead_source_bitrix` **отдельным файлом**: `ALTER TYPE "LeadSource" ADD VALUE 'bitrix'` (значение кодом не используется до PR-3); `npx prisma migrate status` чисто; страж `prisma.migrations-plain-sql` зелёный
- [x] `DealNote.authorId` nullable — три места чтения: `services/deals/notes.ts` (`authorName: n.author?.name ?? 'Импорт из Битрикс24'`), `services/manager/dealNotes.ts`, `components/deals/deal-dialog.tsx` (тип `DealNoteRow` не меняется — подпись подставляет сервис); `addNoteToDeal` по-прежнему пишет `session.sub`
- [x] `src/lib/config/integrationSettings.ts` — `SETTING_SPECS`: `bitrix.portalUrl` (`envVar: null`), `bitrix.webhookUrl` (`envVar: null`, `isSecret: true`), `bitrix.defaultManagerId` (`envVar: null`), `bitrix.userMap` (`envVar: null`); `src/lib/services/bitrix/settings.ts`: `loadBitrixConnection(prisma): Promise<{ portalUrl: string | null; webhookUrl: string | null; defaultManagerId: string | null; userMap: Record<string, string> }>`, `portalHost(url: string): string` (только домен — для логов и аудита), `parseUserMap(raw: string | null): Record<string, string>`
- [x] `src/lib/featureFlags.ts`: `bitrix_migration` в `FEATURE_FLAGS` с комментарием точек чтения (раздел хаба через `flag` реестра → `requireSettingsSection` → `notFound`; `server-actions/admin/bitrix.ts` → `forbidden`; роуты `/api/admin/bitrix/*` → `notFoundIfDisabled`; процессор `bitrix-import` → пакет `failed`; расписание `bitrix.resync` → пропуск) и в `OPT_IN_FLAGS`; **не** в `FEATURE_PREFIXES`; `.env.example`: `FEATURE_BITRIX_MIGRATION=` и `FAKE_BITRIX=`; `docs/feature-flags-matrix.md`: строка в таблице opt-in + счётчики в шапке; `src/__tests__/helpers/envRegistry.ts`: `FAKE_BITRIX` в `ENV_ONLY` с причиной (тестовая фикстура, как `FAKE_ONEC_*`)
- [x] `src/lib/services/bitrix/source.ts`: типы `BitrixUser { id, email, name, active }`, `BitrixCompany { id, title, inn, kpp, assignedById, createdAt, comments }`, `BitrixContact { id, name, lastName, post, companyId, phones: string[], emails: string[], assignedById, createdAt }`, `BitrixLead { id, title, name, companyTitle, phones, emails, inn, statusId, assignedById, opportunity, createdAt, comments }`, `BitrixDeal { id, title, categoryId, stageId, opportunity, companyId, contactId, leadId, assignedById, createdAt, closeDate, closed, comments }`, `BitrixStage { entity: 'deal' | 'lead'; categoryId: string | null; id; name; semantics: 'process' | 'success' | 'failure' | 'apology' }`, `BitrixTask { id, title, description, status: 2|3|4|5|6, responsibleId, createdById, deadline, createdAt, closedAt, crmLinks: { kind: 'company'|'deal'|'lead'|'contact'; id: string }[] }`, `BitrixComment { id, entity, entityId, authorId, text, createdAt }`, `BitrixFile { id, entity, entityId, name, size, downloadUrl }`, `SourceFilter { from?: Date; to?: Date; openOnly?: boolean }`, интерфейс `BitrixSource` (§3.1 спеки: `check`, `users`, `stages`, `companies`, `contacts`, `leads`, `deals`, `tasks`, `comments`, `files`, `download`)
- [x] `src/lib/services/bitrix/client.ts`: `createBitrixClient({ webhookUrl, transport = fetchTransport, now = Date.now, sleep })` → `{ call(method, params): Promise<BitrixResponse>; list(method, params): AsyncIterable<Record<string, unknown>>; batch(cmds: Record<string, string>): Promise<Record<string, unknown>> }`; ограничитель 2 запроса/с (token bucket по `now`), повтор 3 раза с паузой 1/2/4 с на HTTP 503 + `error: 'QUERY_LIMIT_EXCEEDED'` и на сетевую ошибку, таймаут 30 с (`AbortController`), пагинация `start`/`next`, `batch` до 50 команд с `halt: 0`; ошибки — `BitrixClientError { code: 'auth' | 'limit' | 'network' | 'timeout' | 'api'; message }` без URL; `fetchTransport` — единственное место с `fetch`
- [x] `src/lib/services/bitrix/adapter-rest.ts`: `class RestBitrixSource implements BitrixSource` поверх клиента: `profile` (проверка), `user.get`, `crm.company.list` + `crm.requisite.list` (`ENTITY_TYPE_ID: 4`, поле `RQ_INN`, `RQ_KPP`), `crm.contact.list` (`select` с `PHONE`, `EMAIL`), `crm.lead.list`, `crm.deal.list`, `crm.dealcategory.list` + `crm.dealcategory.stage.list` + `crm.status.list` (`ENTITY_ID: 'STATUS'` для лидов), `crm.timeline.comment.list` через `batch` по 50 сущностей, `tasks.task.list` (`UF_CRM_TASK` → `crmLinks`), `disk.attachedObject.get` + `disk.file.get` (`DOWNLOAD_URL`), `download` через транспорт; нормализация дат ISO, телефонов/почт из мультиполей `{ VALUE }`
- [x] `src/lib/services/bitrix/adapter-fake.ts` + `src/lib/services/bitrix/fixtures/*.ts`: `class FakeBitrixSource implements BitrixSource` с фикстурой из спеки §3.1 (5 компаний — 2 с ИНН организаций сида `Organization` из `prisma/seed.ts`, 1 совпадающая по названию, 2 новые; 8 контактов, один с общим телефоном; 6 лидов; 6 сделок — 2 `won`, 1 `lost`; 4 задачи; 3 файла; 10 комментариев; 3 пользователя, один с e-mail менеджера сида), `download` отдаёт маленький PDF-буфер; `check` → ok
- [x] `src/lib/services/bitrix/factory.ts`: `getBitrixSource(prisma, batch: { source: string; settings: unknown }): Promise<BitrixSource>` — `file` (PR-2, пока `throw` с кодом `source_not_ready`), иначе `process.env.FAKE_BITRIX === '1'` → fake, иначе `rest` из `loadBitrixConnection` (без вебхука → ошибка `not_configured`)
- [x] `src/lib/services/admin/testIntegration.ts`: ключ `bitrix` в `INTEGRATION_TEST_KEYS`, `probeBitrix(prisma)` → `source.check()` (домен в сообщении, без URL); карточка «Миграция из Битрикс24» в `integrations.ts`/`integrationsHealth.ts` (статус `not_configured` без вебхука)
- [x] `src/lib/navigation/settings.ts`: раздел `integrations.bitrix` (`group: 'integrations'`, `title: 'Миграция из Битрикс24'`, описание одной строкой, свой значок, `path: 'integrations/bitrix'`, `capability: 'settings.integrations.manage'`, `flag: 'bitrix_migration'`, `cabinets: ['admin']`, `legacyHrefs: []`); `src/__tests__/security.settings-matrix.guardrail.test.ts` → `ADMIN_ONLY_SECTIONS` с причиной (`Р-22`: секреты платформы), `SECRET_ACTION_FILES` → `src/server-actions/admin/bitrix.ts`; `config.settings-from-ui.guardrail` → страница подключения в списке страниц с секретами
- [x] страницы `src/app/admin/settings/integrations/bitrix/{layout,page}.tsx` (`requireSettingsSection('integrations.bitrix', 'admin')`, `PageHeader` «Миграция из Битрикс24» с подзаголовком, `dynamic = 'force-dynamic'`, `metadata.title` «… · Настройки»), вкладки `src/components/settings/bitrix-tabs.tsx` (по образцу `one-c-tabs.tsx`: «Подключение», «Пакеты» — история появится в PR-5, до неё вкладка ведёт на заглушку «Пакетов пока нет» через `EmptyState`), компонент `src/components/bitrix/connection-form.tsx` (домен портала, вебхук как секрет «задан/не задан», менеджер по умолчанию из `listCompanyManagers`, `SecretsKeyNotice` + `isSecretsKeyConfigured`, панель `IntegrationCheckPanel` с `testIntegrationAction.bind(null, 'bitrix')`)
- [x] `src/server-actions/admin/bitrix.ts`: `saveBitrixConnectionAction(fd)` (`requireSettingsSection('integrations.bitrix','admin')` литералом; `notFoundIfDisabled('bitrix_migration')` → `forbidden`; `saveSettings` для четырёх ключей; домен из URL нормализуется; аудит через `integration_settings_updated`), `testBitrixConnectionAction()` (делегирует `testIntegration(prisma, session, 'bitrix')`)
- [x] `src/lib/auth/audit.ts` + `src/lib/audit/labels.ts`: сущность `bitrix_import_batch` («Пакет миграции из Битрикс24»), действия `bitrix_import_previewed` («Предпросмотр миграции из Битрикс24»), `bitrix_import_applied` («Применение миграции из Битрикс24»), `bitrix_import_rolled_back` («Откат миграции из Битрикс24»), `bitrix_import_report_downloaded` («Скачивание отчёта миграции из Битрикс24»), `order_merged_into` («Объединение заказа с заказом 1С») — заводятся здесь, используются в PR-3…PR-5
- [x] глоссарий (`docs/glossary.md` + `src/lib/help/glossary.ts`): «Миграция из Битрикс24», «Пакет миграции»; страж `help.glossary` (список `REQUIRED_BY_TZ` — дописать оба термина)
- [x] тесты: `services.bitrix.client.test.ts` (мок-транспорт: пагинация, лимит с фейковыми таймерами, backoff 1/2/4 с и три повтора на `QUERY_LIMIT_EXCEEDED`, таймаут, `batch` по 50, ошибка без URL), `services.bitrix.adapter-rest.test.ts` (нормализация: реквизиты → ИНН, мультиполя, `UF_CRM_TASK`, семантика стадий), `services.bitrix.adapter-fake.test.ts` (контракт: связность фикстуры — все `companyId` контактов есть среди компаний, две `won`), `services.bitrix.factory.test.ts`, `services.bitrix.settings.test.ts` (`portalHost`, `parseUserMap`), `services.admin.testIntegration` (ветка `bitrix`), `pages.admin-settings-integrations-bitrix.test.tsx`, `components.bitrix-connection-form.test.tsx`, `server-actions.admin.bitrix.test.ts`, `lib.navigation.settings` (новая запись), правки `pii.contexts`/`docs.feature-flags-matrix` не нужны до PR-5; стражи с мутацией: «`webhookUrl` не попадает в `log.*` в `services/bitrix/**`» (`bitrix.no-secret-logging.guardrail`), «`services/bitrix/**` не импортирует `xlsx`» (`bitrix.no-sheetjs.guardrail`), «`bitrixId` есть у шести моделей» (`prisma.bitrix-id-columns.guardrail`)
- [x] `CHANGELOG.md` (Unreleased → Добавлено), `docs/tz/STATUS.md` (строка этапа 2: спека подтверждена мержем #596, PR-1 открыт; журнал), план — галочки

## PR-2 «файловый источник» — CSV/XLSX через exceljs

- [x] `src/lib/services/bitrix/column-map.ts`: карты алиасов заголовков выгрузки Битрикса по сущностям (русские и английские шапки: «ID», «Название компании»/«Company name», «Реквизит: ИНН», «Ответственный», «Телефон», «E-mail», «Стадия сделки», «Сумма», «Дата создания», «Крайний срок» …), обязательные колонки, `detectEntityByHeaders(headers)` → сущность **или** ближайший кандидат с перечнем недостающих колонок, `normalizeLabel` из `import/normalize.ts`. Сами карты не экспортируются (knip) — наружу `resolveBitrixColumns`, `detectEntityByHeaders`, `BITRIX_FILE_ENTITIES`, `BITRIX_ENTITY_LABELS`
- [x] общие помощники рядом: `cells.ts` (текст, дата «ДД.ММ.ГГГГ ЧЧ:ММ», суммы «120 000,00», мультиполя, «Да/Нет»), `crm-links.ts` (`CO_/D_/L_/C_`, общий с REST-адаптером), `filter.ts` (период, общий с фикстурой)
- [x] `src/lib/services/bitrix/adapter-file.ts`: `class FileBitrixSource implements BitrixSource` — конструктор принимает `{ entity, buffer, fileName }[]`; XLSX через `loadXlsxWorkbook`, CSV через `new ExcelJS.Workbook().csv.read(...)` с разделителем `;`/`,`/таб, BOM и Windows-1251; `diagnostics()`; `users()` — из колонок «Ответственный»/«Постановщик» (без e-mail → в предпросмотре «не сопоставлен»); `stages()` — стадии и статусы из файлов сделок и лидов (семантика `process`, кроме «Сделка успешна»/«Сделка провалена»/«Качественный лид»/«Некачественный лид» и их английских аналогов); связи без ID — по названию и имени из соседних файлов; `comments`/`files` → пусто; `download` → `throw source_no_files`
- [x] `src/app/api/admin/bitrix/upload/route.ts`: `notFoundIfDisabled('bitrix_migration')` → `requireAdmin()` → `readMultipart` → до 5 файлов `files`, каждый ≤ `IMPORT_MAX_FILE_BYTES`, расширение `.csv|.xlsx`; разбор шапки ДО записи в S3; ключи `bitrix-import/uploads/<uuid>/<n>-<safeName>`; ответ `{ ok: true, files: [{ key, name, entity, candidate, rows, unmatchedHeaders, missing }] }`; ошибки 400/413/415/422/502 картой `STATUS` (сам приём — `services/bitrix/upload.ts`, роут только мапит коды)
- [x] `src/components/bitrix/upload-form.tsx`: `useFetchSubmit`, подсказка лимита из `IMPORT_MAX_FILE_MB` и числа файлов из `BITRIX_UPLOAD_MAX_FILES`, таблица «файл → сущность → строк → нераспознанные колонки»; результат (ключи S3) уезжает в `settings.fileKeys` пакета (форма «Новый пакет» — PR-3; до неё форма показывает диагностику)
- [x] `factory.ts`: ветка `file` собирает `FileBitrixSource` из `settings.fileKeys` (буферы читаются из S3 `download`; мусор в настройках отбрасывается, пусто → `source_no_files`, сбой чтения → `source_not_ready`)
- [x] фикстуры `src/__fixtures__/bitrix/{companies,contacts,leads,deals,tasks}.csv` — та же выборка, что fake; тест равенства: нормализованные записи файлового источника `toEqual` записям fake по сущностям (без комментариев и файлов)
- [x] тесты: `services.bitrix.column-map.test.ts`, `services.bitrix.cells.test.ts`, `services.bitrix.crm-links.test.ts`, `services.bitrix.filter.test.ts`, `services.bitrix.adapter-file.test.ts` (CSV с BOM и `;`, Windows-1251 с `,`, XLSX, неизвестная колонка → предупреждение, отсутствующая обязательная → отказ распознать), `services.bitrix.upload.test.ts`, `api.admin.bitrix.upload.test.ts` (флаг, роль, лимит, расширение, S3-мок), `components.bitrix-upload-form.test.tsx`, обновлённые `services.bitrix.factory.test.ts`, `lib.api.multipart.test.ts`, `pages.admin-settings-integrations-bitrix.test.tsx`; страж `security.api-route-guard` зелёный без исключений; новый страж «содержимое выгрузок не попадает в логи» (мутация)
- [x] `CHANGELOG.md`, STATUS, план — галочки

## PR-3 «сопоставление и предпросмотр» — dry-run в воркере

- [x] `src/lib/services/bitrix/mapping/types.ts`: `Plan<T> = create | update (с `before`, где `null` значит «поля не было») | skip(reason) | conflict(reason)`, `MappingContext`, словари русских причин, порядок сущностей
- [x] `mapping/users.ts`: `mapUsers(bitrixUsers, companyUsers, userMap)` — по почте, сохранённая таблица сильнее (но запись на уволенного игнорируется), `assigneeFor` даёт менеджера по умолчанию
- [x] `mapping/organizations.ts`: `bitrixId` → ИНН → `nameKey`; ИНН в другой компании → `conflict('inn_other_company')`; без ИНН — пометка «ИНН не указан»; пустое не затирает
- [x] `mapping/contacts.ts`: `bitrixId` → канал у контакта без `bitrixId` → это он; канал у чужого контакта остаётся хозяину и попадает в `skippedChannels`; каналы сотрудников не заводятся; имя пустое → «Без имени»
- [x] `mapping/stages.ts`: `proposeStageMap`/`proposeLeadStageMap`/`proposeTaskColumnMap` (успех → выиграна, провал → проиграна, дальше по названию), `persistStageId` (`default:*` → `null`), `unmappedStages`/`stageMapComplete`
- [x] `mapping/leads.ts`: `source: 'bitrix'`, статус из якоря выбранной стадии, умолчания обязательных строк, лид без ответственного → `conflict('no_manager')`
- [x] `mapping/deals.ts`: стадия по таблице `направление:стадия`, статус по якорю, даты закрытия в `wonAt`/`lostAt`/`expectedCloseAt`, связи по `bitrixId`, `wantsOrder` у выигранной
- [x] `mapping/orders.ts`: заказ 1С той же организации (сумма ±1 %, дата ±30 дней) → `link`; нет организации → `skip`; иначе `create` с `externalId = bitrix:deal:<id>`, `closed`-якорем, `completed` и `not_billed`
- [x] `mapping/notes.ts`: `planDealNote`, `planOrganizationNote` (контакт → его организация с префиксом «О контакте …», без организации → `skip`, тело ≤ 4000, автор по почте или `null`)
- [x] `mapping/tasks.ts`: колонка по таблице, статус по якорю, «отложено» в описании, исполнители и постановщик, привязки CRM по `bitrixId`
- [x] `mapping/files.ts`: организация из сделки или компании, `skip('no_organization')`, `skip('too_large')` по пределу документа
- [x] `mapping/lookup.ts` и `mapping/registry.ts` (сверх плана): состояние ЛК читается пачкой на страницу, а реестр помнит ещё не созданные записи — иначе предпросмотр считал бы «нет организации» там, где при применении связь будет
- [x] `src/lib/services/bitrix/pipeline.ts`: `runPipeline(prisma, { batch, source, mode, onProgress })` — порядок сущностей, постраничное чтение, сводка `counts` по сущностям, строки причин (первые 500), предупреждение при пакете больше 50 000; `preview.ts`: `createBitrixBatch`, `getBitrixBatch`, `listBitrixBatches`, `getBitrixBatchState`, `saveBatchMapping`, `filterOf`
- [x] `src/lib/jobs/queues.ts`: `bitrix.import`; `src/lib/jobs/types.ts`: `BitrixImportJobPayload`; `CLAUDE.md` §7 и `src/worker/README.md` (в `queueStats` правок не нужно — он выводится из `QUEUE_NAMES`)
- [x] `src/worker/processors/bitrix-import.ts`: флаг выключен → пакет `failed`; `preview` → `runPipeline(shadow)` → статус `preview`; `apply`/`rollback` пока честно отвечают «появится следующим шагом»; прогресс раз в 50 строк; аудит `bitrix_import_previewed`; регистрация без `concurrency`
- [x] `src/server-actions/admin/bitrix.ts`: `createBitrixBatchAction`, `getBitrixBatchStateAction`, `saveBatchMappingAction` — каждое с литералом раздела и флагом
- [x] страницы: вкладка «Пакеты» (форма загрузки + «Новый пакет» + список), карточка пакета `history/[batchId]` (сводка, таблицы сопоставления, «нужно решение / пропустим», прогресс, честная подпись про применение). Отклонения от плана: карточка живёт ПОД «Пакетами» (`.../history/<id>`), чтобы вкладка оставалась подсвеченной; вместо собственных крошек — ссылка «К пакетам» (крошки в хабе рисует оболочка, свои дали бы дубль); `applyBitrixBatchAction` перенесён в PR-4 — без писателей он либо врал бы, либо ронял пакет
- [x] тесты: табличные unit по каждому `mapping/*`, `services.bitrix.pipeline`, `services.bitrix.preview`, `services.bitrix.mapping-lookup`, `worker.bitrix-import.integration` (живая база: сводка по фикстуре, «сухой прогон ничего не пишет», выключенный флаг), страницы и компоненты; страж `worker.processor-coverage` зелёный
- [x] `CHANGELOG.md`, STATUS, план — галочки

## PR-4 «применение» — запись с журналом, идемпотентность, заказы

- [x] `src/lib/services/bitrix/writers/{journal,entities,orders,files}.ts`: писатель принимает план и транзакцию строки, пишет сущность **и** `BitrixImportWrite` (`entity`, `entityId`, `bitrixId`, `action`, `before`, `after`) в одной транзакции; `created` — снимок `after`, `updated` — `before`/`after` только по изменённым полям, `linked` — что связали; `default:*` не пишутся; файлы — своя запись `Document` (`generatedBy: 'system'`, `direction: 'incoming'`, `type: 'other'`, контрагент-организация) + очередь антивируса; заметки — прямой `create` с `createdAt` оригинала и `authorId | null`; заказы — `create` + `OrderStatusChange` (якорь `closed`, автор `null`, причина «Перенесено из Битрикс24»). Отклонения: файлы пишутся вне общей транзакции (скачивание и хранилище — сеть), пометка «ИНН не указан» уехала в `OrganizationNote` (скалярного поля у модели нет), штатный `persistUploadedDocument` не используется (не принимает транзакцию, пишет свой аудит, не знает `bitrixId`)
- [x] `src/lib/services/bitrix/idempotency.ts`: `mergeUpdate(current, incoming, lastAfter)` → `{ data, before, after, keptManual }` — пустое не затирает; поле, чьё значение разошлось с `after` прошлого прогона, не трогается и уходит в отчёт строкой «оставлено ручное значение»; `lastAfter` читается пачкой (`loadLastAfter`), а не по строке
- [x] заказы из выигранных сделок (`writers/orders.ts`): связь с заказом 1С (`linked`, откат снимет связь) или заказ-история; занятые заказы не достаются двум сделкам
- [x] `pipeline.ts` режим `live`: те же правила и порядок, транзакция на строку, построчные ошибки (`errors`, продолжение), прогресс, статус `applied` с `appliedAt`, аудит `bitrix_import_applied`; заметки защищены от повторного переноса журналом (колонки `bitrixId` у них нет)
- [x] `src/lib/services/orders/mergeExternal.ts`: `mergeExternalOrderInto(prisma, session, { sourceOrderId, targetOrderId })` — только `admin`/`leader` своей компании; источник — заказ `bitrix:*`, цель — заказ 1С той же организации; переносит `Deal.orderId`, `Document.orderId`, `Task.linkedOrderId`, `DealNote.orderId`, `CalendarEvent.linkedOrderId`, `Lead.promotedOrderId` и контакт заказа (если у цели пуст); удаляет источник; аудит `order_merged_into`; `listMergeTargets`. Отклонение: отказов больше, чем в плане — `has_activity` (переписка, загрузки, треды, строки ведомости) и `target_has_deal`: эти связи держат заказ жёстким внешним ключом, и без проверки удаление упало бы на уровне базы
- [x] `src/components/orders/merge-external-order-button.tsx` (диалог с выбором заказа и русскими отказами) в карточках заказа `admin` и `leader` только у заказов `bitrix:*`; `src/server-actions/orders/mergeExternal.ts`; кнопка «Применить» с подтверждением на карточке пакета (`components/bitrix/apply-batch-button.tsx`) и действие `applyBitrixBatchAction`
- [x] тесты: `services.bitrix.idempotency`, писатели на мок-транзакции (журнал в той же транзакции), `worker.bitrix-import.integration` дополнен применением по критериям приёмки 16 §10 и **двойным прогоном** (0 создано, ручные правки целы), `services.orders.mergeExternal.integration`, действия и компоненты
- [x] `CHANGELOG.md`, STATUS, план — галочки

## PR-5 «откат, отчёт, история, безопасность»

- [x] `src/lib/services/bitrix/rollback.ts`: `requestRollback(prisma, session, batchId)` (окно 30 дней от `appliedAt`, статусы `applied`/`rollback_partial`, иначе коды `expired`/`already_rolled_back`/`not_applied`; статус `rolling_back`, задача `rollback`), `runRollback(prisma, batchId, onProgress)` — строки журнала в обратном порядке порциями по сущности (каждая порция — транзакция): `updated` → вернуть `before` (белый список полей), `created` → удалить, если нет новых ссылок (`computeRollbackConflicts`: заказ с оплатами/строками/документами не из пакета, организация с новыми заказами/документами/контактами, контакт с диалогами/звонками, сделка с новыми заметками) — иначе строка конфликта, `linked` → снять связь; `reverted = true`; итог `rolled_back` или `rollback_partial` (+ `errors`), `rolledBackAt`, аудит `bitrix_import_rolled_back`
- [x] `src/lib/services/bitrix/report.ts`: `buildBitrixReport(prisma, batchId): Promise<Buffer>` — `exceljs`, листы «Организации», «Контакты», «Лиды», «Сделки», «Задачи», «Заметки», «Файлы», «Заказы» (id Битрикса, id ЛК, действие, поля), «Конфликты», «Пропущено», «Оставлено ручное»; `safeText`; `storeBitrixReport(prisma, batchId)` → S3 `bitrix-import/<batchId>/report-<stamp>.xlsx`, `reportPath`; вызывается в конце `apply` и `rollback`
- [x] `src/app/api/admin/bitrix/[batchId]/report/route.ts`: `notFoundIfDisabled` → `requireAdmin` → пакет своей компании → `recordPiiAccess(prisma, { session, context: 'bitrix_report', subjectIds: [batchId] })` → `createSignedUrl(reportPath, 600, { download: true })` → 307; `src/lib/pii/contexts.ts`: `bitrix_report { subjectType: 'contact', action: 'export', labelRu: 'Миграция из Битрикс24: отчёт сверки', callSite: 'src/app/api/admin/bitrix/[batchId]/report/route.ts' }`; `pii.contexts.test.ts` (33 ключа); аудит `bitrix_import_report_downloaded`
- [x] `src/lib/services/bitrix/history.ts`: `listBitrixBatches(prisma, session)` (компания, 50 последних, `rollback: 'available' | 'expired' | 'rolled_back' | 'not_applied'` с причиной); страница `.../bitrix/history/page.tsx` + `src/components/bitrix/batch-history.tsx` («Отчёт», «Откатить» с подтверждением и объяснением неактивности — образец `import-history.tsx`, `DISABLED_HINT`); вкладка «Пакеты» ведёт сюда; server action `rollbackBitrixBatchAction(batchId)`
- [x] стражи (мутацией): `bitrix.write-journal-transactional.guardrail` (каждый writer зовёт `tx.bitrixImportWrite.create` в той же функции, что и запись сущности), `bitrix.report-matches-journal` (integration: число строк отчёта по сущности = число строк журнала), `bitrix.no-secret-logging` (расширить на `history.ts`/`report.ts`)
- [x] тесты: `services.bitrix.rollback.integration.test.ts` (снимок до/после совпадает; заказ с новым платежом блокирует; частичный откат), `services.bitrix.report.test.ts` (листы и `safeText`), `api.admin.bitrix.report.test.ts` (флаг, роль, чужая компания → 404, ПДн-запись, 307), `services.bitrix.history.test.ts`, страница истории и компонент; `pii.capture-coverage` зелёный
- [x] `CHANGELOG.md`, STATUS, план — галочки

> **Отступления PR-5 от плана (записаны при исполнении).**
> 1. **`listBitrixBatches` уже был** (PR-3, `preview.ts`), поэтому `history.ts`
>    не дублирует выборку, а надстраивает над ней состояние отката:
>    `listBitrixHistory` (50 последних + счётчик неоткаченных строк ОДНИМ
>    `groupBy` на страницу) и `getBitrixBatchWithRollback` для карточки пакета.
> 2. **Отдельного экрана истории не понадобилось** — вкладка «Пакеты»
>    (`.../bitrix/history`) и есть история; в неё добавлены колонки «Отчёт
>    сверки» и «Откат», в карточку пакета — тот же блок. Плодить второй список
>    того же самого значило бы нарушить правило зеркала (§0.2).
> 3. **В отчёт добавлен лист «Сводка»** (пакет, кто запустил, даты, состояние):
>    книга без него не отвечает на вопрос «что это за файл» (§15).
> 4. **Лист «Конфликты» общий** для конфликтов переноса и отката, с колонкой
>    «Этап»: два отдельных листа с одинаковыми колонками читаются хуже.
> 5. **Индексы журнала** (`[batchId, entity, createdAt]`, `[batchId, reverted]`)
>    — аддитивная миграция `20260913150000_stage2_bitrix_journal_indexes`: без
>    них порционное чтение в обратном порядке и счётчик неоткаченных строк
>    уходили в сортировку по куче.
> 6. **Заметки удаляются из обеих таблиц** (`DealNote` и `OrganizationNote`):
>    в журнале обе записаны сущностью `note`, идентификаторы уникальны, и
>    лишний `deleteMany` дешевле хрупкого разбора снимка.
> 7. **Конфликты считаются по ЖИВЫМ связям, а не «наш ли ребёнок по журналу»**
>    (план предполагал второе). Порядок отката идёт от детей к родителям,
>    поэтому к проверке родителя всё, что пакет сумел убрать, уже удалено, а
>    всё оставшееся честно мешает. Первая редакция роняла откат сырым
>    исключением внешнего ключа; переписано после интеграционных тестов.
> 8. **Порция при сбое повторяется по одной строке** — иначе одна
>    непредвиденная строка отменяла возврат сотни соседних.
> 9. **Файл в хранилище при откате остаётся** — удаляется только строка
>    документа: стереть вложение навсегда откат не вправе.

## PR-6 «расписание, документация, close-out»

- [x] `src/lib/jobs/scheduling.ts`: `BITRIX_SCHEDULES = [{ queueName: 'bitrix.import', schedulerId: 'bitrix.resync', pattern: '0 3 * * 1', tz }]` в `ALL_SCHEDULES` с `editable: true`, `SyncScheduleQueueName` расширен; воркер регистрирует; задача по расписанию → `createResyncBatch(prisma)` (настройки последнего `applied`, `mode: 'resync'`, сразу `apply`; новая стадия без сопоставления → останов в `preview` с конфликтом `new_stage`); по умолчанию расписание на паузе (`SyncSchedulePause`), кнопка «Повторять еженедельно» (`scheduleResyncAction`) снимает паузу; редактор cron `SyncScheduleEditor` на странице подключения; флаг выключен → задача пропускается
- [x] `docs/integrations/bitrix24-migration.md`: создание входящего вебхука (права `crm`, `tasks`, `disk`, `user`), домен и токен, методы и лимиты (2 запроса/с, `batch`, страницы по 50), как снять выгрузки CSV/XLSX для файлового источника, таблица «что переносится / что нет», критерии приёмки §10 пакета как чек-лист на стенде (`FAKE_BITRIX=1`); runbook параллельного периода (день 0 — полный пакет; две недели — еженедельный повтор; критерий отключения — неделя без правок в Битриксе и пустой повтор; финальный пакет; выключение)
- [x] `docs/glossary.md`/`src/lib/help/glossary.ts` — сверить термины; `docs/feature-flags-matrix.md` — строка `bitrix_migration` со всеми точками чтения
- [x] `docs/tz/AUDIT.md`: `У-188`…`У-203` → `✅` с якорями и датой, сводка; `docs/tz/STATUS.md`: этап 2 ✅, «Текущий этап» → 3 «Коммуникационный центр v2» (шаг — спека), журнал; `CLAUDE.md` §14 снимок; close-out `2026-09-13-stage2-bitrix-migration-DONE.md`; `CHANGELOG.md`; `npm run tz:status`
- [ ] полные прогоны при закрытии этапа (§9 индекса): `С-1`…`С-10` — прогон сопровождения №28 (**отдельной работой после этапа**: это не PR, а процедура реестра `MAINTENANCE.md` со своим лимитом хотфиксов)

> **Отступления PR-6 от плана (записаны при исполнении).**
> 1. **`bitrix.resync` заведён в общем `SYNC_SCHEDULES`, а не отдельным
>    реестром `BITRIX_SCHEDULES`** (план предполагал второе). Причина: паузу
>    умеют только расписания этого списка (`setSchedulePaused` ищет именно в
>    нём), а повтор без паузы включался бы сам сразу после первого переноса.
>    В `ALL_SCHEDULES` с `editable: true` он попадает автоматически.
> 2. **Повтор идёт через предпросмотр, а не сразу в запись.** План говорил
>    «сразу `apply`», но тогда новая стадия портала записалась бы «куда-нибудь».
>    Готовый предпросмотр повтора сам переходит к применению; не готовый —
>    ждёт человека.
> 3. **Отдельного `scheduleResyncAction` не понадобилось** сверх одного
>    действия: `setBitrixResyncPausedAction` и ставит, и снимает паузу.
> 4. **Пауза по умолчанию — миграцией** `20260913160000_stage2_bitrix_resync_paused`
>    (сида для этого в проекте нет).
> 5. **Попутно починено расхождение, общее с обменом 1С:** снятие паузы брало
>    паттерн из кода и затирало cron, поправленный в интерфейсе.
> 6. **Прогон сопровождения №28 вынесен из PR:** это процедура реестра со
>    своим лимитом в три хотфикса, а не часть закрывающего PR этапа.
