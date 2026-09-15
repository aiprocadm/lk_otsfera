# Этап 3 «Коммуникационный центр v2» — план

Спека — [2026-09-14-stage3-communication-center-design.md](../specs/2026-09-14-stage3-communication-center-design.md)
(предъявлена 14.09.2026, PR [#607](https://github.com/aiprocadm/lk_otsfera/pull/607);
подтверждена мержем спеки; девять умолчаний §7 действуют, пока заказчик не
отменил). Требования `У-204`…`У-217` действующего
[ТЗ «CRM для отдела продаж — замена Битрикс24»](../../tz/2026-09-12-tz-crm-bitrix-replacement.md),
тексты — пакет [07_messenger_integrations.md](../../specs/07_messenger_integrations.md).
База — спека мессенджеров 12.09.2026 (`Р-М-1`…`Р-М-10`), ничего из неё не переписывается.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Цель.** Превратить переписку в мессенджерах в рабочее место отдела продаж:
ответить на письмо, приложить файл, назначить ответственного, ответить
шаблоном, оставить внутреннюю заметку, принять заявку с сайта, увидеть
переписку в карточке, а клиенту — писать из кабинета.

**Архитектура.** Диалог перестаёт быть «только мессенджером»: рядом с
`MESSENGER_CHANNELS` (транспорты с исходящей отправкой) появляется
`DIALOG_CHANNELS = [...мессенджеры, 'email', 'cabinet']`. Статус диалога —
автомат в одном чистом модуле `dialogStatus.ts`, вызываемый ровно из двух
мест. Вложения — свой путь (не `upload-core`, он про документы заказа) с
девятой целью антивируса. Права — шкала `dialogs: ScopeLevel` по образцу задач.

**Стек.** Next.js 15, Prisma 6, BullMQ, Resend, Vitest, Playwright. Новых
npm-зависимостей нет.

**Глобальные ограничения (из спеки):** миграции аддитивны и обратимы (ни одной
удалённой колонки); `MESSENGER_CHANNELS` не меняется — его читают 12 файлов;
`channels.ts` остаётся чистым (страж `components.client-server-boundary`);
значения статуса только через `dialogStatus.ts`; вложение уходит клиенту
только после `clean`; заметка запрещена в двух местах, а не в одном; секреты
наружу не отдаются (`getSettingsView` → только `isSet`); ПДн формы сайта не
логируются; покрытие новых файлов 100 %, каждый страж проверен мутацией;
русские строки — через `errorMessageRu` и словари компонентов.

## Разбивка

| PR | Что | Требования | Статус |
|---|---|---|---|
| PR-1 «ответственный и статусы» | Миграция (`assigneeId`, `assignedAt`, `assignedById`, `waitingSince`, 2 индекса); `dialogStatus.ts` + автопереходы; «Взять себе»/«Назначить»; фильтры «мои · без ответственного · все»; таргетинг `messenger_message`; `sourceType: 'dialog'` в SLA-эскалации; подсветка просрочки; аудит | `У-206`, `У-207` | ✅ [#608](https://github.com/aiprocadm/lk_otsfera/pull/608) |
| PR-2 «вложения в диалогах» | Миграция (6 колонок сообщения); `attachment.ts`; цель `messenger_attachment`; разбор вложений в трёх вебхуках; `sendAttachmentToMessenger`; роуты загрузки и скачивания; лента со вложением | `У-204` | ✅ [#609](https://github.com/aiprocadm/lk_otsfera/pull/609) — исходящие файлы только Telegram (`В-3-10`) |
| PR-3 «почта — двусторонний канал» | `In-Reply-To`/`References`/`Reply-To` в транспорте; `messageId` у входящего; ветка `email` в `replyToInbound`; диалоги `channel:'email'` по нормализованному адресу; бэкфилл писем; `email_unsupported` исчезает | `У-205` | ✅ [#610](https://github.com/aiprocadm/lk_otsfera/pull/610) |
| PR-4 «заметки и шаблоны ответов» | `direction:'note'` + два запрета и два стража; `@упоминание`; модель `ReplyTemplate` + CRUD; раздел хаба «Шаблоны ответов»; подстановки; кнопки «Заметка» и «Шаблон» | `У-208`, `У-209` | ✅ [#611](https://github.com/aiprocadm/lk_otsfera/pull/611) |
| PR-5 «форма с сайта» | `POST /api/public/requests`; реестр `PUBLIC_API_ROUTES` + страж; раздел хаба «Сайт»; настройки `site.*`; выпуск токена с показом один раз; сниппет формы; обращение `source:'website'` | `У-211` | ⏳ |
| PR-6 «диалоги в карточках и связь с инбоксом» | Вкладка «Диалоги» в `orgCardTabs` (+ два стража); блок «Переписка с клиентом» в карточке заказа; ссылки инбокс ↔ диалог; бейдж «ждут ответа»; «Написать первым» из карточек с причиной недоступности | `У-210`, `У-215`, `У-216` | ⏳ |
| PR-7 «права, светофор, кабинет как канал» | Шкала `dialogs` + capability `communications.dialogs` + `dialogWhereForLevel` + страж `own`; `deliveryError` и «Повторить»; светофор каналов, «Тестовое сообщение», «Проверить вебхук»; канал `cabinet` (сервер) + клиентские API без `note` | `У-212`, `У-213`, `У-214` | ⏳ |
| PR-8 «флаг, стражи, close-out» | Флаг `comm_center` во всех точках + строка матрицы; мутационная проверка всех стражей этапа; глоссарий; drift-аудит `AUDIT.md`; close-out; `STATUS.md` → этап 4 | `У-217` | ⏳ |

**Порядок обязателен:** PR-1 → PR-6 (бейдж считает `waiting_staff`), PR-3 → PR-6
(«написать первым» по e-mail), PR-2 → PR-7 (вложения клиента в кабинете).
Остальные пары независимы, но идут по номерам: PR-4 и PR-5 читают `DIALOG_CHANNELS`
и статусы из PR-1. Если PR-2 или PR-7 разрастутся — делятся (2a «входящие
вложения», 2b «исходящие»; 7a «права», 7b «светофор и кабинет»).

Гейты на каждый PR: `npm run typecheck` · `npm run lint` · полный `npm run test:unit`
(в фоне, код выхода в файл) · интеграционные тесты затронутых сервисов против
живого Postgres · покрытие новых файлов 100 % (`npx vitest run --coverage.enabled=true
"--coverage.include=<файл>"` адресно, со своим `--coverage.reportsDirectory`) ·
`npm run boundaries` · `npm run deadcode` · `npm run dup:check` · `npm run format:check` ·
`npm run tz:status` · `npm run build` · запись в `CHANGELOG.md`. Каждый новый
страж проверен мутацией (сломать → красный → вернуть → зелёный) и упомянут в PR.
Стражи, которые видны только полному прогону: `services.no-test-only-modules`,
`server-actions.session-guard`, `services.stable-pagination-order`,
`ui.empty-states`, `security.settings-matrix`, `worker.processor-coverage`,
`config.env-registry`, `config.settings-from-ui`, `pii.contexts`,
`lib.audit.labels`, `notifications.registry`, `docs.feature-flags-matrix`,
`docs.tz-program`, `components.client-server-boundary`,
`guards.source-read-strips-comments`, `components.upload-size-hint`.

## PR-1 «ответственный и статусы» — `У-206`, `У-207`

- [x] `prisma/schema.prisma`: `MessengerDialog` — `assigneeId String?` + `assignee User? @relation("DialogAssignee", …, onDelete: SetNull)`, `assignedAt DateTime?`, `assignedById String?`, `waitingSince DateTime?`; комментарий к `status` переписать на `open | waiting_staff | waiting_client | closed`; индексы `@@index([companyId, assigneeId])`, `@@index([companyId, status, waitingSince])`; обратная связь `assignedDialogs MessengerDialog[] @relation("DialogAssignee")` у `User`
- [x] миграция `stage3_dialog_assignee_status` (аддитивная, обратный SQL в комментарии): четыре колонки, два индекса. **Данные не переносим**: существующие диалоги остаются в `open`/`closed`, `waitingSince` пуст — автомат расставит статусы по первому же событию. Это осознанно: задним числом «кто кого ждёт» не восстановить, а выдумывать нельзя
- [x] `src/lib/services/messengers/dialogStatus.ts` — **чистый** модуль: `DIALOG_STATUSES`, `DIALOG_STATUS` (именованные значения для запросов Prisma — там статус обычная строка и опечатка не ловится типами), `DialogStatus`, `DIALOG_STATUS_LABELS` (русские подписи), `MANUAL_DIALOG_STATUSES`, `isDialogStatus`, `nextStatusOnInbound()` → `'waiting_staff'` всегда (включая `closed` — новое входящее переоткрывает, `Р-М-1` сохраняем), `nextStatusOnOutbound()` → `'waiting_client'`, `waitingSinceFor(next, currentWaitingSince, now)` (ставит при входе в `waiting_staff`, если не стоял; сбрасывает в `null` при выходе), `dialogOverdueLevel(dialog, sla, now)`. Заметка (`note`) статуса **не меняет** — у неё вообще нет ветки в автомате, и это проверяется тестом
- [x] `appendInbound.ts`: статус и `waitingSince` считаются автоматом (сейчас жёсткое `'open'` в create и update); `send.ts`: после успешной отправки `direction:'out'` — `waiting_client` + сброс `waitingSince` (сейчас статус не трогается вовсе); `status.ts` (`setDialogStatus`) — ручные «Закрыть»/«Открыть снова» с теми же сбросами, значения берёт из `dialogStatus.ts`
- [x] `src/lib/services/messengers/assign.ts`: `assignDialog(prisma, session, { dialogId, assigneeId | null })` — скоуп, проверка что назначаемый в той же компании и в контуре ЦО (`role: { in: ['manager','leader'] }`), запись `assignedAt`/`assignedById`, аудит `dialog_assignee_changed`, уведомление новому ответственному; `takeDialog(prisma, session, { dialogId })` — «Взять себе» (делегирует `assignDialog` с `assigneeId: session.sub`); `listAssignableStaff(prisma, session)` — сотрудники компании для селекта
- [x] автоназначение в `send.ts`: рядом с существующим правилом первого ответившего (`Р-М-2`, компания) — «…и ответственный, если его нет». Одна транзакция со отправкой не нужна: назначение идёт после успешной отправки, как и запись сообщения
- [x] `list.ts`: фильтр `assignee: 'mine' | 'unassigned' | 'all'` (умолчание `all`), фильтр `status` расширяется четырьмя значениями; сортировка не меняется; `countUnreadDialogs` не трогаем (бейдж «ждут ответа» — PR-6)
- [x] `src/lib/notifications/manager.ts`: `notifyManagersMessengerMessage` — если у диалога есть `assigneeId`, уведомление уходит **ему** (`createNotification` на одного); иначе прежний `resolveOrgManagerRecipients`. Диалог без организации и без ответственного — по-прежнему молчит (он виден во «Входящих в работу»), это записано в спеке
- [x] `src/worker/processors/sla-escalation.ts`: источник `'dialog'` — диалоги в `waiting_staff` с `waitingSince` старше `Company.slaResponseHours`; эскалация руководителю компании (как у прочих источников); `SlaEscalation.sourceType` в схеме получает значение `dialog` (комментарий строки); дедупликация по существующему механизму `SlaEscalation`
- [x] UI: `src/components/manager/messengers/dialog-filters.tsx` — селект «Ответственный» (мои · без ответственного · все) и расширенный селект статуса; `dialog-assignee-panel.tsx` — «Взять себе» / «Назначить» (селект сотрудников) в шапке карточки; бейдж статуса и подсветка просрочки (`waitingSince` старше SLA → красный, старше `slaWarningHours` → жёлтый) в списке и в шапке; пустое состояние фильтра «мои» — с объяснением и кнопкой сброса (`У-74`)
- [x] `src/server-actions/messengers.ts`: `assignDialogAction`, `takeDialogAction` (оба с `requireManager()` литералом в теле — страж `server-actions.session-guard`)
- [x] `src/lib/auth/audit.ts` + `src/lib/audit/labels.ts`: действие `dialog_assignee_changed` («Смена ответственного за диалог»), `dialog_status_changed` («Смена статуса диалога») — если второго ещё нет
- [x] тесты: `services.messengers.dialogStatus.test.ts` (таблица переходов целиком + «заметка не двигает статус» + `waitingSince`), `services.messengers.assign.test.ts` (чужая компания → `forbidden`, назначение клиенту → `forbidden`, снятие ответственного, аудит и его `after`), `services.messengers.appendInbound` и `send` (обновлённые ожидания статуса), `services.messengers.list` (три значения фильтра), `notifications.manager.messenger-message.test.ts` (ответственному, иначе менеджерам, иначе молчание), `worker.sla-escalation` (диалог просрочен → эскалация; `waiting_client` не эскалируется), `components.dialog-filters`, `components.dialog-assignee-panel`, `pages.manager-messengers` (фильтры в URL); **страж с мутацией** `messengers.dialog-status-machine.guardrail` — литералы статусов вне `dialogStatus.ts` запрещены (`readSource`, иначе комментарий обманет страж)
- [x] `CHANGELOG.md` (Unreleased → Добавлено), `docs/tz/STATUS.md` (строка этапа 3: PR-1 открыт; журнал), план — галочки

## PR-2 «вложения в диалогах» — `У-204`

- [x] `prisma/schema.prisma`: `MessengerMessage` — `attachmentPath String?`, `attachmentName String?`, `attachmentMime String?`, `attachmentSize Int?`, `scanStatus String @default("none")`, `scanReason String?`; индекс `@@index([dialogId, scanStatus])`; миграция `stage3_message_attachment` (аддитивная)
- [x] `src/lib/services/messengers/attachment.ts`: `saveDialogAttachment(prisma, session, { dialogId, file })` — скоуп диалога → `validateUploadFile` (переиспользуем чистую функцию `upload-core`) → magic-bytes → S3 `messengers/<dialogId>/<uuid>-<safeName>` → `MessengerMessage.create({ direction:'out', scanStatus:'pending', deliveryStatus:'pending' })` → очередь `docs.scanDocument` c `kind:'messenger_attachment'`; `getDialogAttachmentForDownload(prisma, session, { dialogId, messageId })` → `ok | not_found | forbidden | infected | not_ready`
- [x] `src/worker/processors/scan-document.ts`: девятая цель `messenger_attachment` в `loadTarget`/`persistResult` (колонки `MessengerMessage.scanStatus`/`scanReason`); после `clean` у исходящего сообщения — отправка в транспорт и `deliveryStatus:'sent'`, при отказе транспорта — `failed` + `deliveryError`; `infected` — сообщение остаётся неотправленным с пометкой
- [x] `transport.ts`: `sendToMessenger(channel, peerRef, payload)` где `payload = { kind: 'text'; text } | { kind: 'attachment'; buffer; fileName; mime; caption? }`; ветки `sendTelegramDocument`/`sendPhoto` (`sendPhoto` для image/*, иначе `sendDocument`), MAX и WhatsApp — по их API; **сигнатура меняется у 12 потребителей `MESSENGER_CHANNELS`? нет** — `sendToMessenger` зовут только `send.ts` и `reply.ts`, остальные читают список каналов; проверить перед правкой
- [x] вебхуки: Telegram — `message.photo` (берём наибольший размер) и `message.document` → `getFile` → скачивание по `file_path`; MAX — ссылка медиа; WhatsApp — URL агрегатора, если есть, иначе текст со ссылкой; общий помощник `ingestInboundAttachment` кладёт файл тем же путём и ставит скан; **апдейт без текста и без вложения по-прежнему игнорируется, но теперь осознанно и с тестом** (сейчас он проваливается молча — находка сверки)
- [x] лимиты: `DEFAULT_MAX_FILE_SIZE_MB` из `config/upload.ts` и предел канала (`CHANNEL_ATTACHMENT_LIMITS_MB = { telegram: 50, max: …, whatsapp: … }`) — берётся минимум (`В-3-1`), подсказка в форме показывает фактический (страж `components.upload-size-hint`)
- [x] роуты: `POST /api/manager/messengers/[id]/attachment` (multipart через `readMultipart`/`readFile`, тонкий роут — только мапит коды; **не** server action, `bodySizeLimit` 25 МБ, CLAUDE.md §11) и `GET /api/manager/messengers/[id]/attachment/[messageId]` → 302 на presigned 600 с, `infected` → **410**, не готово → 409 с русской причиной
- [x] UI: кнопка «Прикрепить» в `dialog-reply-form.tsx` на `useFetchSubmit`; в ленте `dialog-thread.tsx` — карточка вложения (имя, размер, статус «проверяется» / ссылка / «файл заблокирован»)
- [x] тесты: `services.messengers.attachment.test.ts` (скоуп, MIME, размер, ключ S3, постановка скана), `worker.scan-document` (новая цель: clean → отправка, infected → не отправляется), `api.manager.messengers.attachment.test.ts` (загрузка: флаг, скоуп, лимит) и `…attachment-download.test.ts`, вебхуки ×3 (фото, документ, апдейт без текста), `components.dialog-thread` (три состояния вложения); **страж с мутацией** `messengers.attachment-idor.guardrail` (чужой `messageId` → не 302; заражённый → 410) и `messengers.no-send-before-clean.guardrail` (в `attachment.ts` нет вызова транспорта)
- [x] `CHANGELOG.md`, STATUS, план — галочки

## PR-3 «почта — двусторонний канал» — `У-205`

- [x] `src/lib/email/transport.ts`: `EmailMessage` получает `headers?: { inReplyTo?: string; references?: string[] }` и `replyTo?: string`; проброс в Resend (`headers`, `reply_to`); дефолты не меняются — существующие письма шлются как прежде
- [x] `src/lib/inbound/email/adapter.ts`: `InboundEmailDto` получает `messageId: string | null`; `adapter-imap.ts` берёт `parsed.messageId`; `adapter-fake.ts` — генерирует; `poll-inbound-email.ts` прокидывает дальше
- [x] `ingest.ts`: письмо сворачивается в диалог **канала `email`** — `peerRef` = нормализованный адрес (`normalizeEmail`: `trim().toLowerCase()`, тот же, что в поиске контакта по каналу), `MessengerMessage.externalId` = `Message-ID` письма; правило «одно письмо — одна реплика» держится существующим уникальным `inboundMessageId`
- [x] `src/lib/services/inbound/reply.ts`: ветка `email` — `sendEmailReply({ to, subject: 'Re: …', body, inReplyTo, references, replyTo })` через `email/send.tsx`; адрес отправителя — `getEmailFrom()`, `Reply-To` — адрес входящего ящика (`imap.user`, `В-3-8`); ответ пишется в диалог как `direction:'out'`
- [x] `sendReply.ts`: код `email_unsupported` удаляется; `reply_failed` остаётся общим кодом отказа транспорта; проверить `errorMessageRu` — русская строка для `reply_failed` должна существовать
- [x] `DIALOG_CHANNELS` в `channels.ts` (рядом с `MESSENGER_CHANNELS`, модуль остаётся чистым): `['telegram','max','whatsapp','email','cabinet']`, `DIALOG_CHANNEL_LABELS` («Telegram», «MAX», «WhatsApp», «Почта», «Кабинет»), `isDialogChannel`; `scope.ts`, `list.ts`, `get.ts`, фильтры UI переводятся на него; `availability.ts` — `email` доступен, когда `isEmailEnabled()`, `cabinet` — всегда (PR-7)
- [x] `backfill.ts`: расширение на письма — существующие `InboundMessage` канала `email` сворачиваются в диалоги по нормализованному адресу; идемпотентно (по `inboundMessageId`); `countPendingBackfill` учитывает письма; скрипт `npm run backfill:messengers` не меняет интерфейс
- [x] тесты: `lib.email.transport` (заголовки в вызове Resend), `lib.inbound.email.adapter-imap` (`messageId`), `services.inbound.reply.email.test.ts` (ответ уходит, `In-Reply-To` = `Message-ID` исходного, `Reply-To` = ящик IMAP), `services.inbound.ingest.email-dialog.test.ts` (`Ivan@Mail.RU` и `ivan@mail.ru` — один диалог; повторное письмо не плодит второй), `services.messengers.backfill` (письма), обновлённые тесты `sendReply`; **страж с мутацией** `messengers.email-unsupported-gone.guardrail` — кода `email_unsupported` нет в `src/**` (через `readSource`)
- [x] `CHANGELOG.md`, STATUS, план — галочки

## PR-4 «заметки и шаблоны ответов» — `У-208`, `У-209`

- [x] `direction: 'note'`: `send.ts` — ветка заметки не зовёт транспорт вовсе и не трогает статус; `get.ts` — заметки в ленте с признаком `isNote`; поиск по тексту в фильтре диалогов включает заметки (только для ЦО)
- [x] `@упоминание` в заметке → `note_mention` через **существующий** `src/lib/notifications/noteMention.ts` (один продьюсер на тип — требование стража реестра); разбор упоминаний — существующий помощник `mention-textarea`/парсер этапа 1
- [x] `prisma/schema.prisma`: модель `ReplyTemplate` (поля — §2 спеки), миграция `stage3_reply_templates`
- [x] `src/lib/services/replyTemplates/{crud,apply}.ts`: CRUD со скоупом компании; `ALLOWED_TEMPLATE_TOKENS` (`contact.name`, `organization.name`, `manager.name`, `manager.phone`, `order.number`); сохранение через `findUnknownPlaceholders` → `unknown_placeholder` (как `У-128`); `applyTemplate(prisma, session, { templateId, dialogId })` → готовый текст + перечень пустых подстановок (предупреждение до отправки, `applyPlaceholders` из `lib/templates/placeholders.ts`); `usageCount` инкрементится при вставке
- [x] раздел хаба: `src/lib/navigation/settings.ts` — `processes.replyTemplates` (`group: 'processes'`, «Шаблоны ответов», `path: 'processes/reply-templates'`, `capability` существующий для процессов, `flag: 'comm_center'`, `cabinets: ['admin','leader']`); страницы `src/app/{admin,leader}/settings/processes/reply-templates/page.tsx` с `requireSettingsSection(...)`; таблица, форма, «Проверить подстановки»; пустое состояние с кнопкой
- [x] `src/server-actions/replyTemplates.ts`: `save/archive/reorder` — `requireSettingsSection('processes.replyTemplates', cabinet)` литералом
- [x] UI диалога: кнопка «Заметка» (переключает форму в режим заметки, визуально отличается) и кнопка «Шаблон» (поиск по названию, предпросмотр подставленного текста, вставка с правкой до отправки)
- [x] тесты: `services.replyTemplates.crud` (чужая компания, неизвестная подстановка → отказ, архив), `services.replyTemplates.apply` (пустая подстановка предупреждает, `usageCount`), `services.messengers.send.note` (транспорт не зван, статус не изменился), `components.dialog-reply-form` (три режима), `pages.settings-reply-templates` ×2, `server-actions.replyTemplates`; **два стража с мутацией**: `messengers.note-not-leaked.guardrail` — (а) в `send.ts` ветка `note` не достигает `sendToMessenger`, (б) клиентские выборки сообщений фильтруют `direction in ('in','out')`
- [x] `CHANGELOG.md`, STATUS, план — галочки

## PR-5 «форма с сайта» — `У-211`

- [ ] `src/lib/config/integrationSettings.ts`: `site.enabled`, `site.formToken` (`isSecret: true`), `site.allowedOrigins`, `site.defaultManagerId` — все с `envVar: null` (§0.3 ТЗ: ничего не включается на сервере)
- [ ] `src/lib/api/publicRoutes.ts`: `PUBLIC_API_ROUTES` с причиной на каждый (форма сайта + три вебхука мессенджеров); **страж с мутацией** `security.public-api-routes.guardrail`: роут в `src/app/api/**` без `require*`/`getSession` обязан быть в реестре с непустой причиной, и наоборот
- [ ] `src/lib/services/clientRequests/website.ts`: `submitWebsiteRequest(prisma, { token, origin, ip, payload })` — `secretEquals` токена, `Origin` в списке, `isRateLimited('site-form:'+ip, { windowMs: 60_000, max: 10 })`, honeypot → `{ ok: true }` **без записи**, Zod-форма (имя, телефон, e-mail, организация, сообщение, согласие ПДн), тело ≤ 16 КБ; создаёт `ClientRequest` с `source: 'website'` (существующее значение enum) и уведомление `client_request_submitted` с пометкой «с сайта»; ПДн формы **не логируются**
- [ ] `src/app/api/public/requests/route.ts` — тонкий роут: 401 без токена, 403 чужой Origin, 429 лимит, 413 тело, 422 форма, 200 honeypot и успех
- [ ] раздел хаба «Сайт»: `settings.ts` — `integrations.website` (`cabinets: ['admin']`, `flag: 'comm_center'`); страница с формой (включение, домены до пяти (`В-3-6`), менеджер по умолчанию), блоком токена и сниппетом HTML-формы для WordPress; `security.settings-matrix` → `ADMIN_ONLY_SECTIONS` с причиной (`Р-22`), `config.settings-from-ui` → страница в списке страниц с секретами
- [ ] выпуск токена: `issueSiteTokenAction` возвращает открытое значение **в результате действия** (модалка «Скопировать», предупреждение «больше не покажется»), в БД — шифрованным; форма показывает только «задан»; перевыпуск отзывает прежний; аудит `site_form_token_issued`
- [ ] «Входящие в работу»: обращение с сайта отображается с источником «Сайт» (словарь подписей источников), `У-215`-ссылок у него нет (диалога нет)
- [ ] тесты: `services.clientRequests.website.test.ts` (шесть веток), `api.public.requests.test.ts` (коды), `components.site-form-settings`, `pages.admin-settings-integrations-website`, `server-actions.admin.site`, `lib.navigation.settings`; страж реестра публичных роутов (см. выше)
- [ ] `CHANGELOG.md`, STATUS, план — галочки

## PR-6 «диалоги в карточках и связь с инбоксом» — `У-210`, `У-215`, `У-216`

- [ ] `src/lib/navigation/orgCardTabs.ts`: вкладка `dialogs` («Диалоги», значок из `NAV_ICONS`, `cabinets: STAFF`, `flag: 'inbound_messaging'`) — место в порядке рядом с `inbound`/`calls`; стражи `navigation.org-card-tabs` и `navigation.org-card-tiles` обновляются (они держат точный список подписей); у партнёра и заказчика вкладки нет — **исключение зеркала записывается с причиной** (`У-121`)
- [ ] страница вкладки: диалоги организации (по `organizationId` и по контактам организации), ссылка на карточку диалога, пустое состояние с кнопкой «Написать первым»
- [ ] блок «Переписка с клиентом» в карточке заказа трёх кабинетов ЦО — по `Order.primaryContactId` и организации заказа; ссылки на диалоги; «Создать диалог с контактом заказа»
- [ ] связь инбокс ↔ диалог: `INBOX_SELECT` добавляет `dialogMessage: { select: { dialogId: true } }`, `inbox-list.tsx` — ссылка «Открыть диалог»; в карточке диалога — «Открыть в инбоксе» у сообщений с `inboundMessageId`
- [ ] бейджи: `getStaffBadges` — `dialogsWaiting` (диалоги в `waiting_staff` в скоупе + непривязанные); пункт меню «Мессенджеры» показывает его; `/api/staff/badges` и тип `StaffBadges` расширяются
- [ ] «Написать первым» из карточек организации и контакта: кнопка ведёт в `/manager/messengers?new=<contactId>` (существующий механизм `writeToContactHref`); список каналов строится по контакту, **недоступный канал показывается с причиной** («не нажал Start в боте», «почта не подключена») — сейчас `listDialogCandidates` просто не предлагает такие кандидаты, это меняется на «показать с причиной»
- [ ] тесты: `lib.navigation.orgCardTabs` (+ правки двух стражей), `pages.org-card-dialogs` ×3 кабинета, `components.order-dialogs-panel`, `services.intake.badges` (новый счётчик), `services.messengers.start` (причины недоступности), `components.inbox-list` (ссылка), `pages.manager-messengers-id` (обратная ссылка)
- [ ] `CHANGELOG.md`, STATUS, план — галочки

## PR-7 «права, светофор, кабинет как канал» — `У-212`, `У-213`, `У-214`

- [ ] `src/lib/auth/accessProfileSchema.ts`: capability `communications.dialogs` в `capabilitySchema`; шкала `dialogs: ScopeLevel` в `SessionAccessProfile`; `src/lib/auth/accessProfile.ts`: `dialogWhereForLevel(session, level, teamMode)` — `all` (компания + непривязанные), `assigned` (свои + `managedOrgIds` + непривязанные), `own` (свои + непривязанные, `Р-3-7`); `canSeeDialog(session, dialog, teamMode)`
- [ ] `scope.ts` диалогов переводится на профиль: нет профиля или нет размеченных кодов → прежнее поведение (legacy, CLAUDE.md §2b); есть → шкала; `teamMode` читается `getCompanyTeamVisibility` (как в `bind.ts`/`start.ts`)
- [ ] редактор профилей доступа (`components/access/role-editor.tsx`): строка «Диалоги» со шкалой — подпись из глоссария
- [ ] `deliveryError`: миграция `stage3_message_delivery_error` (одна колонка); `send.ts` и транспорт пишут текст провайдера **через `scrub()`** (без секретов); кнопка «Повторить» у `failed` (`retryMessageAction`, аудит), повтор из воркера не делаем
- [ ] светофор каналов на странице подключения: последний принятый вебхук (из `MessengerMessage` канала), последняя ошибка отправки с текстом, «Отправить тестовое сообщение себе» (в привязанный бот администратора), «Проверить вебхук» (Telegram `getWebhookInfo`, MAX — аналог); агрегаты берём из `MessengerMessage`, `SyncLog` не трогаем (он про 1С)
- [ ] канал `cabinet` (серверная часть, `У-212`): вопрос из кабинета (`cabinetQuestion.ts`) заводит/продолжает диалог `channel: 'cabinet'`, `peerRef` = `userId`; ответ сотрудника доставляется уведомлением в кабинет (существующий `replyToCabinetQuestion`) **и** в бот, если у пользователя привязан мессенджер; клиентские API (`/api/organization/messages`) отдают сообщения **без** `note` (второй запрет `Р-3-5`); экран «Переписка с менеджером» — этап 6 (`У-234`), здесь только сервер
- [ ] тесты: `lib.auth.accessProfile.dialogs` (три уровня × `teamMode`), `services.messengers.scope` (legacy-профиль не теряет доступ), `api.organization.messages` (заметка не отдаётся), `services.messengers.retry`, `components.channel-health-panel`, `services.inbound.cabinetQuestion` (диалог канала `cabinet`); **страж с мутацией** `security.dialogs-scope-own.guardrail` — профиль `own` не видит чужой диалог; ответ-заметка не уходит клиенту (второй сценарий стража PR-4)
- [ ] `CHANGELOG.md`, STATUS, план — галочки

## PR-8 «флаг, стражи, close-out» — `У-217`

- [ ] `src/lib/featureFlags.ts`: `comm_center` в `FEATURE_FLAGS` (комментарий с точками чтения) и в `OPT_IN_FLAGS`; **не** в `FEATURE_PREFIXES` (поведенческий); `.env.example`; `docs/feature-flags-matrix.md` — строка в таблице opt-in + счётчики в шапке (страж `docs.feature-flags-matrix`)
- [ ] проверка **всех** стражей этапа мутацией, по списку: `dialog-status-machine`, `attachment-idor`, `no-send-before-clean`, `email-unsupported-gone`, `note-not-leaked` (два сценария), `public-api-routes`, `dialogs-scope-own`, обновлённые `org-card-tabs`/`org-card-tiles`. Для каждого — запись в PR «сломал X → упал тест Y»
- [ ] глоссарий (`docs/glossary.md` + `src/lib/help/glossary.ts`): «Диалог», «Ответственный за диалог», «Шаблон ответа», «Внутренняя заметка», «Заявка с сайта» — и страж `help.glossary`
- [ ] мобильные эталоны (390×844): карточка диалога, «Шаблоны ответов», раздел «Сайт» — `npm run e2e:visual:update` на свежей seed-базе
- [ ] drift-аудит §16 по `У-204`…`У-217`: каждое требование проверяется **цепочкой** (гард на сервере, скоуп выборки, код ошибки и русская строка, пустой путь, обратный путь), `docs/tz/AUDIT.md` — вердикты и якоря, сводка пересчитана
- [ ] close-out `docs/superpowers/plans/2026-09-14-stage3-communication-center-DONE.md`; `docs/tz/STATUS.md`: этап 3 ✅, «Текущий этап» → 4 «Задачи и автоматизация»; CLAUDE.md §14 — абзац состояния
- [ ] по §9 индекса закрытие этапа сопровождается полным прогоном `С-1`…`С-10` (№29) — **отдельной работой**, со своим лимитом в три хотфикса
