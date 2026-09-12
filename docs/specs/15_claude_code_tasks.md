# Задачи для Claude Code

**Как пользоваться.** Задачи идут строго по порядку внутри этапа; этапы — по [14_implementation_roadmap.md](14_implementation_roadmap.md) §2. Одна задача = один PR (иногда два, где указано). Перед первой задачей этапа пишется спека этапа в `docs/superpowers/specs/` и **ждёт подтверждения заказчика** (CLAUDE.md §8, §16). Нумерация задач своя (`Task N`); требования — `У-N` из реестра `14` §3.

## Правила выполнения (обязательны для каждой задачи)

1. **Ветка от свежего `main`**, PR с описанием «что / зачем / как проверить», без прямых пушей в `main` (CLAUDE.md §16).
2. **Перед кодом — план в `docs/superpowers/plans/`** (или раздел спеки этапа) с перечислением файлов; заказчик подтверждает спеку этапа, план — не обязательно.
3. **Инварианты репозитория** (CLAUDE.md §2, §3, §4, §5, §10, §11): слои `app → server-actions → services → lib`; Zod только для форм; Result-тип с кодами и русские строки в `errors/messages.ts`; `teamMode` в менеджерских резолверах; загрузки файлов — только API-роуты; presigned 600 с; аудит — `AUDIT_ACTIONS` + `labels.ts`; fail-open для уведомлений; `revalidate()` всех экранов, где сущность видна.
4. **Миграции аддитивны и обратимы**; удаление таблиц — только в этапе 9 по `Р-Б-3`.
5. **Каждый новый экран**: `PageHeader` с подзаголовком, главная кнопка или пустое состояние с кнопкой, три вопроса, 390×844 (эталон Playwright), пункт меню через `SectionKey`, глоссарий, `docs/feature-flags-matrix.md` при флаге.
6. **Стражи**: новый страж проверяется мутацией (сломать → красный → починить → зелёный) и упоминается в PR; покрытие 100 % по логическим слоям не понижать.
7. **`AUDIT.md` и `STATUS.md`** обновляются тем же PR, что закрывает `У-N` (✅ + номер PR); `CHANGELOG.md` — по Keep a Changelog.
8. **Ничего не выдумывать**: если в коде чего-то нет — написать в PR «не найдено» и предложить, а не реализовать молча. Спорное — вопрос заказчику нумерованными вариантами.
9. **Не трогать** то, что вне задачи: переименования, «заодно»-рефакторинг, обновления зависимостей — отдельными PR по этапу 9 или по хотфиксам §9.4.
10. **Финиш задачи** — `npm run lint && npm run typecheck && npm run test -- --run` зелёные, `npm run tz:status` зелёный, PR ссылается на `У-N`.

---

## Этап 0 — ввод программы

### Task 0: Ввод программы в действие (`У-177`)
**Цель.** Сделать пакет `docs/specs/` действующим ТЗ так, чтобы страж `src/__tests__/docs.tz-program.test.ts` остался зелёным, а прежнее ТЗ ушло в архив.
**Что изменить.**
1. Создать тонкое индексное ТЗ `docs/tz/2026-09-12-tz-crm-bitrix-replacement.md`: §0 критерии заказчика (из `01`), §2 решения `Р-Б-1`…`Р-Б-12` (из `14` §4), §4 требования — таблица `У-177`…`У-269` со ссылками на файлы `docs/specs/*`, §5 этапы 0–10 (из `14` §2). Не копировать тексты — ссылки.
2. Переключить четыре указателя на новый файл: `CLAUDE.md` §14, `docs/tz/STATUS.md` (шапка + новая первая секция «Текущий этап» с таблицей этапов 0–10, этап 0 ⏳), `docs/ARCHITECTURE.md` §7, `docs/tz/AUDIT.md` (шапка).
3. Добавить в `AUDIT.md` строки `У-177`…`У-269` со статусом «⏳ этап N» (по `14` §3), дефекты `Д-41`…`Д-49` в реестр дефектов, решения `Р-Б-1`…`Р-Б-12` рядом с `Р-27`.
4. Перенести ТЗ 21.08 в архив тем же способом, что ТЗ 16.08 (переименование `…-DONE.md`, ссылка «предыдущее ТЗ»); режим сопровождения `MAINTENANCE.md` остаётся действующим для хотфиксов.
5. Проверить страж `docs.tz-program` (пути, «## Текущий этап», все `У-N` из индекса есть в AUDIT); `docs/superpowers/specs/2026-09-12-messengers-dialogs-design.md` не трогать.
**Файлы.** `docs/tz/2026-09-12-tz-crm-bitrix-replacement.md` (новый), `CLAUDE.md`, `docs/tz/STATUS.md`, `docs/tz/AUDIT.md`, `docs/ARCHITECTURE.md`, `docs/specs/*` (сам пакет — в этом же PR), `CHANGELOG.md`.
**Критерии готовности.** `npm run tz:status` и `docs.tz-program` зелёные; в `STATUS.md` первая секция — таблица этапов новой программы; `У-177` ✅.
**Проверки.** `npm run test -- --run src/__tests__/docs.tz-program.test.ts`; мутация: убрать одну строку `У-2xx` из AUDIT → красный; вернуть → зелёный.

---

## Этап 1 — контакты и внутренние заметки (`04`)

### Task 1: Модель заметок, сервисы контактов, скоуп, стражи (`У-180`, `У-183` модель, `У-186`, `У-187`)
**Цель.** Серверная основа: `OrganizationNote`, `Contact.mergedIntoId`, capability-коды, сервисы списка/карточки/скоупа контактов, ПДн-контекст.
**Что изменить.** Миграция (`OrganizationNote`, `Contact.mergedIntoId`); `accessProfileSchema.ts` (+`crm.contacts`, `settings.*` новых разделов); `services/contacts/{list,get,scope,mutate,merge}.ts`; `services/organizationNotes.ts`; `pii/contexts.ts` (+`contact_card`); `notifications/registry.ts` (`note_mention` + миграция правил `deal_note_mention → note_mention`); стражи IDOR/`teamMode`/мутация.
**Файлы.** `prisma/schema.prisma`, `prisma/migrations/*`, `src/lib/auth/accessProfileSchema.ts`, `src/lib/services/contacts/*`, `src/lib/services/organizationNotes.ts`, `src/lib/pii/contexts.ts`, `src/lib/notifications/registry.ts`, `src/__tests__/security.contacts-*.test.ts`.
**Критерии.** Тесты: чужая компания → `not_found`; `own` без `managedOrgIds` не видит контакт; объединение переносит все связи в транзакции; упоминание шлёт `note_mention`.
**Проверки.** Интеграционные тесты на живом Postgres; `pii.capture-coverage` включает контекст.

### Task 2: Экраны «Контакты», карточка, форма, объединение, поиск (`У-178`, `У-179`, `У-181`, `У-185`)
**Цель.** Три зеркальных раздела ЦО с карточкой контакта и «Написать»/«Создать лид».
**Что изменить.** Страницы `/{manager,leader,admin}/contacts` и `/[id]`; компоненты `contact-*`, `merge-contacts-dialog`; server actions `contacts.ts`; `sectionLabels.ts`, `cabinet.ts`, `icons.ts`; `globalSearch.ts` + палитра; подсказка «канал занят» с кнопкой «Объединить»; редирект старого id на главного.
**Файлы.** `src/app/{manager,leader,admin}/contacts/**`, `src/components/contacts/*`, `src/lib/server-actions/contacts.ts`, `src/lib/navigation/*`, `src/lib/services/search/globalSearch.ts`, `e2e/*` эталоны.
**Критерии.** Страж зеркала зелёный; поиск по `+7 (921) …` находит контакт; «Написать» открывает новый диалог (`Р-М-8`); три вопроса и 390×844.
**Проверки.** `pages.subtitles.guardrail`, `navigation.same-section-same-name.guardrail`, Playwright-эталоны.

### Task 3: Вкладки «Контакты» и «Заметки» в карточке организации, лента «История» (`У-182`, `У-183` UI, `У-184`)
**Цель.** Заметки и контакты — внутри карточки организации у ЦО; «История» — единая лента.
**Что изменить.** `orgCardTabs.ts` (+`contacts`, `notes` с фильтром ролей и исключением зеркала с причиной); `components/org-card/{contacts-tab,notes-tab,note-composer}.tsx` (общий `mention-input` извлечь из заметок сделки); `organizationCard.ts` — состав ленты (заметки, диалоги, звонки, письма) с `total`; блок «Важное» в обзоре (закреплённые).
**Файлы.** `src/lib/navigation/orgCardTabs.ts`, `src/lib/navigation/mirrorExceptions.ts`, `src/components/org-card/*`, `src/lib/services/manager/organizationCard.ts`, `src/components/deals/*` (извлечение `mention-input`).
**Критерии.** У партнёра/заказчика вкладок нет (тест); руководитель удаляет чужую заметку, менеджер — нет; лента листается устойчиво.
**Проверки.** `orgCard.tabs-registry` страж; jscpd не выше порога после извлечения `mention-input`.

### Task 4: Флаг `contacts` → рычаг, документация, close-out этапа 1
**Цель.** Включаемость из UI и закрытие этапа.
**Что изменить.** `featureFlags.ts` (`contacts` — поведенческий, страница под `notFoundIfDisabled`), `docs/feature-flags-matrix.md`, глоссарий («Контакт», «Заметка (внутренняя)», «Объединение контактов»), `AUDIT.md` (`У-178`…`У-187` ✅), `STATUS.md` (этап 1 ✅, «Текущий этап» → 2), close-out `docs/superpowers/plans/…-stage1-DONE.md`, CHANGELOG.
**Критерии.** Флаг переключается из «Функций платформы» без env; при выключении — 404 и пункт меню скрыт.
**Проверки.** Тест флага, `tz:status`.

---

## Этап 2 — миграция из Битрикс24 (`16`)

### Task 5: Модели пакета, настройки подключения, интерфейс адаптера, fake и REST (`У-188`, `У-189` rest, `У-190`, `У-202`)
**Цель.** Скелет миграции: таблицы, секреты, флаг, раздел хаба с «Проверить подключение», адаптеры `rest` и `fake`.
**Что изменить.** Миграция (`BitrixImportBatch`, `BitrixImportWrite`, колонки `bitrixId` ×6, `LeadSource.bitrix`); `IntegrationSetting` ключи `bitrix.*`; `services/bitrix/{types,adapter-rest,adapter-fake,client}.ts` (пагинация, лимит 2 rps, backoff `QUERY_LIMIT_EXCEEDED`, `batch`); флаг `bitrix_migration`; раздел `/admin/settings/integrations/bitrix` (форма подключения, «Проверить»); `settings.ts` карточка; `requireSettingsSection`.
**Файлы.** `prisma/*`, `src/lib/services/bitrix/*`, `src/lib/featureFlags.ts`, `src/app/admin/settings/integrations/bitrix/page.tsx`, `src/lib/navigation/settings.ts`, `src/lib/server-actions/bitrix.ts`, `docs/feature-flags-matrix.md`.
**Критерии.** Unit-тесты REST-клиента на мок-транспорте (пагинация, лимит, backoff, таймаут); `FAKE_BITRIX=1` отдаёт фикстуру; раздел доступен только admin (leader → 403 на action, 404 на странице); секрет зашифрован, в логах — домен.
**Проверки.** `security.role-access-matrix`, `settings.sections-registry` стражи; `npm run test -- --run src/lib/services/bitrix`.

### Task 6: Файловый адаптер (`У-189` file)
**Цель.** Загрузка CSV/XLSX-выгрузок как второй источник.
**Что изменить.** `POST /api/admin/bitrix/upload` (`upload-core`, только admin, до 5 файлов по сущностям); `adapter-file.ts` с сопоставлением колонок по заголовкам (образец `import/column-map.ts`) и предпросмотром «колонка → поле»; чтение через `exceljs`/`csv-parse` (не `xlsx`).
**Файлы.** `src/app/api/admin/bitrix/upload/route.ts`, `src/lib/services/bitrix/adapter-file.ts`, `src/lib/services/bitrix/column-map.ts`, фикстуры `src/__fixtures__/bitrix/*.csv`.
**Критерии.** Фикстура CSV даёт тот же нормализованный набор, что fake-REST (тест равенства); неизвестная колонка — предупреждение, не ошибка.
**Проверки.** Интеграционный тест загрузки; MIME allow-list.

### Task 7: Сопоставление сущностей и предпросмотр (`У-191`, `У-192`, `У-193`, `У-200`)
**Цель.** Dry-run в воркере с полной сводкой и конфликтами.
**Что изменить.** `services/bitrix/mapping/{organizations,contacts,leads,deals,tasks,notes,files,users,stages}.ts` (чистые функции: вход — нормализованная сущность + состояние ЛК, выход — план записи); `services/bitrix/preview.ts`; очередь `bitrix.import` тип `preview`; процессор; экран пакета с таблицей стадий/пользователей и сводкой; лимит 50 000 с разбиением.
**Файлы.** `src/lib/services/bitrix/mapping/*`, `src/lib/services/bitrix/preview.ts`, `src/lib/jobs/queues.ts`, `src/worker/processors/bitrix-import.ts`, `src/app/admin/settings/integrations/bitrix/[batchId]/page.tsx`, `src/components/bitrix/*`.
**Критерии.** На фикстуре: 2 компании совпали по ИНН, 1 — по `nameKey`, 2 — новые; контакт с телефоном другой организации — в конфликтах; стадия без сопоставления блокирует «Применить»; сводка совпадает с ожидаемой таблицей.
**Проверки.** Unit-тесты маппинга (табличные); `worker.processor-coverage`.

### Task 8: Применение, идемпотентность, заказы из выигранных сделок (`У-194`, `У-195`, `У-197`)
**Цель.** Запись в базу в воркере с журналом, повтор без дублей, `Р-Б-2`.
**Что изменить.** `services/bitrix/apply.ts` (транзакции по сущности, `BitrixImportWrite` со снимком `before`, правило «пустое не затирает», защита правленных полей); `deals/won → order` (поиск заказа 1С ±1 %/±30 дн., связь или создание `bitrix:deal:<id>`); файлы через `upload-core` + `docs.scanDocument`; прогресс и построчные ошибки; кнопка «Это тот же заказ, что …» в карточке заказа для ручного объединения.
**Файлы.** `src/lib/services/bitrix/apply.ts`, `src/lib/services/bitrix/wonDealToOrder.ts`, `src/worker/processors/bitrix-import.ts`, `src/lib/services/orders/mergeExternal.ts`, компоненты прогресса.
**Критерии.** Повторный запуск → 0 create; поле, изменённое вручную после импорта, не перезаписано; `won` с совпадением → связь, без — заказ; сбой одной строки не роняет пакет; статус `applied`.
**Проверки.** Интеграционные тесты на живом Postgres с фикстурой fake; тест идемпотентности (двойной прогон).

### Task 9: Откат, отчёт сверки, история пакетов, безопасность (`У-196`, `У-198`, `У-199`)
**Цель.** Возврат к снимку и доказательство результата.
**Что изменить.** `services/bitrix/rollback.ts` (обратный порядок, блокировка при новых ссылках с отчётом); `services/bitrix/report.ts` (XLSX через `exceljs`, листы по сущностям, в S3, `reportPath`); `/…/bitrix/history` (таблица пакетов, «Отчёт», «Откатить»); просмотр отчёта → `recordPiiAccess(bitrix_report)`; аудит `bitrix_import_applied/rolled_back/report_downloaded`.
**Файлы.** `src/lib/services/bitrix/{rollback,report}.ts`, `src/app/admin/settings/integrations/bitrix/history/page.tsx`, `src/app/api/admin/bitrix/[batchId]/report/route.ts`, `src/lib/audit/labels.ts`, `src/lib/pii/contexts.ts`.
**Критерии.** Откат возвращает выборки к снимку (тест сравнивает до/после); заказ с новым платежом блокирует откат строкой «нельзя откатить: …»; отчёт совпадает с журналом записей.
**Проверки.** Интеграционный тест отката; `pii.capture-coverage`.

### Task 10: Документация, runbook, повторный импорт по расписанию, close-out этапа 2 (`У-201`, `У-203` финал)
**Цель.** Инструкция для владельца и закрытие этапа.
**Что изменить.** `docs/integrations/bitrix24-migration.md` (создание входящего вебхука, права `crm/tasks/disk/user`, тарифы, ограничения); runbook параллельного периода (еженедельный повтор из UI через механизм расписаний `У-125`, критерий отключения); `scheduleResync`; глоссарий; `AUDIT.md`/`STATUS.md`/CHANGELOG/close-out.
**Критерии.** Заказчик проходит инструкцию на стенде с fake-адаптером без помощи; `У-188`…`У-203` ✅.
**Проверки.** `tz:status`; ссылки документации живые (страж ссылок).

---

## Этап 3 — коммуникационный центр v2 (`07`)

### Task 11: Вложения в диалогах (`У-204`)
**Что изменить.** Поля `MessengerMessage.attachment*`, `scanStatus`; вебхуки Telegram/MAX/WhatsApp — скачивание файла → `upload-core` → `docs.scanDocument`; `POST /api/manager/messengers/[id]/attachment`; `GET …/attachment/[messageId]` (302 presigned, 410 infected); `transport.ts` — `sendDocument`/`sendPhoto`; UI вложений и «Прикрепить».
**Файлы.** `prisma/*`, `src/app/api/integrations/*/webhook/route.ts`, `src/lib/services/messengers/{appendInbound,transport,send,attachments}.ts`, `src/app/api/manager/messengers/[id]/attachment/**`, `src/components/messengers/*`, `src/lib/telegram/*`, `src/lib/max/*`.
**Критерии.** Фото из Telegram появляется после `clean`; PDF уходит клиенту; лимит размера по каналу с русской подсказкой; заражённый → 410.
**Проверки.** Тесты вебхуков с фикстурами файлов; `upload.core-usage` страж.

### Task 12: Email — двусторонний канал (`У-205`)
**Что изменить.** `inbound/sendReply.ts` — ветка `email` через `email/send.tsx` (`In-Reply-To`, `References`, `Re:`, `Reply-To` на IMAP-ящик, вложение); диалог канала `email` (`peerRef` = нормализованный адрес); `appendInbound` для писем; `backfill:messengers` расширить на письма; удалить код `email_unsupported`.
**Файлы.** `src/lib/services/inbound/sendReply.ts`, `src/lib/services/messengers/{channels,appendInbound,backfill}.ts`, `src/lib/email/send.tsx`, `scripts/backfill-messenger-dialogs.ts`, `src/lib/errors/messages.ts`.
**Критерии.** Ответ на письмо из инбокса и из диалога; ответ клиента с тем же адресом — в тот же диалог; `email_unsupported` не существует (grep).
**Проверки.** Тест транспорта с мок Resend; интеграционный тест сшивки.

### Task 13: Ответственный, статусы, SLA диалогов (`У-206`, `У-207`)
**Что изменить.** `MessengerDialog.assigneeId/assignedAt/assignedById`, статусы `open/waiting_staff/waiting_client/closed`; автопереходы в `appendInbound`/`send`; server actions `assignDialog`, `setDialogStatus`; фильтры списка; таргетинг `messenger_message`; расширение `monitoring.slaEscalation` на диалоги; подсветка в списке.
**Файлы.** `prisma/*`, `src/lib/services/messengers/*`, `src/lib/server-actions/messengers.ts`, `src/lib/monitoring/*`, `src/worker/processors/sla-escalation.ts`, `src/components/messengers/*`.
**Критерии.** Первый ответивший становится ответственным; уведомление уходит ему; диалог старше SLA — в эскалации руководителя; фильтр «мои» работает.
**Проверки.** Интеграционные тесты переходов; тест эскалации.

### Task 14: Шаблоны ответов и заметка в диалоге (`У-208`, `У-209`)
**Что изменить.** Модель `ReplyTemplate`; хаб `/{admin,leader}/settings/processes/reply-templates` (CRUD, подстановки, проверка неизвестных); кнопка «Шаблон» в форме ответа; `direction = 'note'` + UI; `note_mention` из диалога; фильтр заметок из клиентских выборок.
**Файлы.** `prisma/*`, `src/lib/services/replyTemplates/*`, `src/lib/server-actions/replyTemplates.ts`, `src/app/{admin,leader}/settings/processes/reply-templates/**`, `src/lib/navigation/settings.ts`, `src/components/messengers/{template-picker,note-composer}.tsx`, `src/lib/services/messengers/{send,get}.ts`.
**Критерии.** Неизвестная подстановка не сохраняется; руководитель видит только свои шаблоны; заметка не уходит клиенту (тест на транспорт и на клиентский API).
**Проверки.** `settings.sections-registry`; мутация теста утечки заметки.

### Task 15: Диалоги в карточках, связь с инбоксом, «написать первым» по любому каналу (`У-210`, `У-215`, `У-216`)
**Что изменить.** `orgCardTabs.ts` (+`dialogs`, ЦО); вкладка «Диалоги» в карточке контакта; блок «Переписка с клиентом» в карточке заказа; ссылки инбокс ↔ диалог; бейджи по `waiting_staff` (`intake/badges.ts`, `staff/badges`); выбор канала в «Написать первым» с причинами недоступности.
**Файлы.** `src/lib/navigation/orgCardTabs.ts`, `src/components/org-card/dialogs-tab.tsx`, `src/components/contacts/contact-dialogs-tab.tsx`, `src/components/orders/order-dialogs-block.tsx`, `src/lib/services/intake/badges.ts`, `src/lib/services/messengers/availability.ts`.
**Критерии.** Вкладка есть у ЦО, нет у партнёра/заказчика (исключение записано); бейдж считает `waiting_staff`; e-mail-канал доступен для «первым» после Task 12.
**Проверки.** Страж реестра вкладок; тест бейджей.

### Task 16: Форма с сайта и раздел «Сайт» (`У-211`)
**Что изменить.** `POST /api/public/requests` (без сессии: `X-Site-Token`, Origin из настроек, `lib/rateLimit` 10/мин/IP, honeypot → 200, Zod, тело ≤ 16 КБ) → `ClientRequest(source: website)` → Intake; раздел `/admin/settings/integrations/website` (токен `isSecret`, домен, вкл/выкл, HTML-сниппет для WordPress); уведомление `client_request_submitted` с пометкой «с сайта»; middleware — исключение публичного префикса.
**Файлы.** `src/app/api/public/requests/route.ts`, `src/middleware.ts`, `src/lib/services/clientRequests/createFromWebsite.ts`, `src/app/admin/settings/integrations/website/page.tsx`, `src/lib/server-actions/website.ts`, `src/lib/rateLimit/*`, `docs/integrations/website-form.md`.
**Критерии.** Без токена 401; чужой Origin 403; 11-й запрос 429; honeypot 200 без записи; обращение во «Входящих в работу».
**Проверки.** Тесты роута; страж «публичный роут в allow-list middleware с причиной».

### Task 17: Светофор, доступ по профилям, стражи этапа 3, close-out (`У-213`, `У-214`, `У-217`)
**Что изменить.** `deliveryStatus/deliveryError` + «Повторить» (server action `retryMessage`); светофор и «тестовое сообщение» в разделе подключения; capability `communications.dialogs` со скоупом в `scope.ts`; стражи; глоссарий; AUDIT/STATUS/CHANGELOG/close-out (без `У-212`, если он идёт после MVP).
**Файлы.** `src/lib/services/messengers/{scope,send,health}.ts`, `src/app/admin/settings/integrations/messengers/page.tsx`, `src/lib/auth/accessProfileSchema.ts`, стражи `src/__tests__/security.dialogs-scope-*.test.ts`.
**Критерии.** Профиль `own` не видит чужой диалог; ошибка доставки видна и повторяется; тест-сообщение приходит админу.
**Проверки.** Мутация стражей; `tz:status`.

### Task 18 (Важно): Кабинет как канал (`У-212`, серверная часть; UI — Task 31)
**Что изменить.** `MESSENGER_CHANNELS` + `cabinet`; `cabinetQuestion.ts` → создаёт/продолжает диалог `cabinet` по `userId`; `send.ts` — доставка сотрудникового сообщения в кабинет (`Notification` + `MessengerMessage`) и в бот, если привязан; клиентские API `/api/organization/messages`, `/api/partner/messages` (список диалогов пользователя без `note`, отправка); аудит.
**Критерии.** Сообщение из кабинета видно в диалоге; ответ виден в кабинете и в боте; заметки не отдаются.
**Проверки.** Интеграционные тесты каналов; IDOR клиентских API.

---

## Этап 4 — задачи и автоматизация (`11`)

### Task 19: Страница задачи, комментарии, чек-лист (`У-218`, `У-219`)
**Что изменить.** `TaskComment`, `TaskChecklistItem`; `/{manager,leader}/tasks/[id]`; server actions; уведомление `task_comment`; прогресс на доске; подтверждение завершения с незакрытыми пунктами.
**Файлы.** `prisma/*`, `src/lib/services/tasks/{comments,checklist,get}.ts`, `src/app/{manager,leader}/tasks/[id]/page.tsx`, `src/components/tasks/*`, `src/lib/notifications/registry.ts`.
**Критерии.** Комментарий уведомляет исполнителей; чек-лист «3/5»; страница проходит три вопроса; у админа задач нет (исключение сохранено).
**Проверки.** Тесты сервисов; зеркало manager/leader.

### Task 20: Задача откуда угодно, «Мой день» (`У-220`, `У-226`)
**Что изменить.** Поля `Task.linkedContactId/linkedDialogId/linkedDocumentId`; кнопка «Задача» и блок «Задачи» в карточках контакта, диалога, документа/КП; `listLinkedTasks` расширить; `myDay.ts` + диалоги `waiting_staff`, КП с истекающим сроком, чек-листы.
**Файлы.** `prisma/*`, `src/lib/services/tasks/linked.ts`, `src/components/{contacts,messengers,documents}/tasks-block.tsx`, `src/lib/services/manager/myDay.ts`.
**Критерии.** Задача из диалога предзаполняет ответственного; «Мой день» показывает новые блоки; существующие блоки не изменились (эталон).
**Проверки.** Тесты `myDay`; Playwright-эталон.

### Task 21: Правила автоматизации — модели, диспетчер, процессор (`У-222` модель, `У-223`, `У-227` стражи)
**Что изменить.** `AutomationRule`, `AutomationRun` (`@@unique([ruleId, eventId])`); `automation/{dispatch,rules,actions,templates}.ts`; `eventId`/`companyId` в вызовах реестра уведомлений (`Р-Б-6`); очередь `automation.run` (конкурентность 2), процессор; действия `create_task`, `notify`; правило «действия не порождают триггеры»; стражи (чужая компания, идемпотентность, fail-open).
**Файлы.** `prisma/*`, `src/lib/automation/*`, `src/lib/notifications/manager.ts`, `src/lib/jobs/queues.ts`, `src/worker/processors/automation-run.ts`, `src/__tests__/automation.*.test.ts`.
**Критерии.** Событие → ровно одна задача; повторная доставка — без дубля; ошибка действия не мешает бизнес-операции (тест на `updateOrderStatus`).
**Проверки.** `worker.processor-coverage`; мутация стражей.

### Task 22: Раздел «Автоматизация», правила из коробки, журнал (`У-222` UI, `У-224`)
**Что изменить.** `/{admin,leader}/settings/processes/automation` (список, форма «если → то», условия, предпросмотр подстановок, `testRule`), `/…/automation/log`; миграция с 5 правилами `isBuiltin` (выключены); «Создана правилом X» в карточке задачи; `settings.ts`; глоссарий.
**Файлы.** `src/app/{admin,leader}/settings/processes/automation/**`, `src/components/automation/*`, `src/lib/server-actions/automation.ts`, `prisma/migrations/*builtin-rules*`.
**Критерии.** Руководитель видит только свою компанию; включение правила из коробки работает на стенде; журнал показывает ошибку с текстом.
**Проверки.** `settings.sections-registry`; тесты server actions.

### Task 23: SLA задач, close-out этапа 4 (`У-225`)
**Что изменить.** `task_overdue` (исполнителям в день просрочки, руководителю на 3-й день через `monitoring.slaEscalation`); порог в хабе «SLA»; блок «Просроченные» на дашборде руководителя; AUDIT/STATUS/CHANGELOG/close-out (без `У-221`).
**Критерии.** Просроченная задача уведомляет по расписанию; дашборд показывает список.
**Проверки.** Тест процессора эскалации.

### Task 24 (Важно): Повторяющиеся задачи (`У-221`)
**Что изменить.** `Task.recurrence`, `recurrenceParentId`; очередь `tasks.recurrence` (ежедневно 06:00 МСК из UI-расписания); создание следующего экземпляра при завершении/по расписанию; «эта / все будущие»; отключение серии.
**Критерии.** Еженедельная серия создаёт следующий экземпляр с чек-листом; `until` в прошлом завершает серию.
**Проверки.** Тесты генератора дат (границы месяца, 31-е число), процессора.

---

## Этап 5 — центр уведомлений (`09`)

### Task 25: Страница «Уведомления» в шести кабинетах (`У-228`)
**Что изменить.** `services/notifications/list.ts` (фильтры, `total`); общий компонент страницы; страницы в шести кабинетах; пункт меню `notifications` `pinnedBottom`; «Показать все» в колокольчике; `GET /api/notifications` расширить.
**Критерии.** Зеркало шести кабинетов; фильтры и «отметить все»; пустое состояние.
**Проверки.** Страж зеркала; Playwright-эталоны ×6.

### Task 26: Личные настройки, дедуп, ссылки по ролям, стражи (`У-229`, `У-231`, `У-232`, `У-233`)
**Что изменить.** `UserNotificationPreference`; матрица «событие × канал» во вкладке личных настроек; пересечение с правилами компании в доставке; дедуп в `notifications.dispatch` с `dedupCount`; флаги `urgent`/`noDedup` в реестре; тест-таблица «тип × роль → маршрут»; стражи; глоссарий; close-out (без `У-230`).
**Критерии.** Пользователь не может включить запрещённый канал; 5 событий → одно уведомление «×5»; ни одна ссылка не ведёт в чужой кабинет.
**Проверки.** Мутация дедупа; `notifications.registry-completeness`.

### Task 27 (Важно): Дайджест (`У-230`)
**Что изменить.** Опция дайджеста для `organization`/`partner`; очередь `notifications.digest` по расписанию из UI; шаблон `daily_digest` в `У-128`; срочные типы уходят сразу.
**Критерии.** Одно письмо в сутки с событиями; без событий — не отправляется.
**Проверки.** Тест процессора и шаблона.

---

## Этап 6 — кабинеты заказчика и партнёра (`05`, `06`)

### Task 28: Ответ на обращение, «Ваш менеджер», `Partner.managerId` (`У-238`, `У-240`)
**Что изменить.** `ClientRequest.staffReply/staffRepliedAt/staffRepliedById`; форма ответа в деталке обращения у ЦО; блок «Ответ менеджера» у заказчика и партнёра; расширение шаблона `client_request_status_changed`; `Partner.managerId` (правка в `/admin/partners/[id]`); блок «Ваш менеджер» на главных заказчика и партнёра с кнопкой «Написать» (→ «Задать вопрос» до Task 31).
**Критерии.** Ответ виден клиенту и партнёру; письмо содержит текст; блок показывает активного менеджера или подсказку.
**Проверки.** Зеркало organization/partner; тесты сервисов дашборда.

### Task 29: Счета у заказчика, «Первые шаги» (`У-235`, `У-239`)
**Что изменить.** Блок «Счета» в `/organization/finance` (статус оплаты по `У-148`, «к оплате», фильтры, экспорт); `OrganizationUser.onboardingDismissedAt`, `PartnerUser.onboardingDismissedAt`; компонент «Первые шаги» с проверками по данным; «Закрыть».
**Критерии.** Признак оплаты совпадает с карточкой заказа; чек-лист исчезает при выполнении; закрытие — навсегда.
**Проверки.** Тесты `finance.ts`; эталоны 390×844.

### Task 30: Материалы для партнёров (`У-237`)
**Что изменить.** `PartnerMaterial`; хаб `/{admin,leader}/settings/processes/partner-materials` (загрузка через API-роут, категории, публикация, замена файла через `replacesDocumentId`); `/partner/materials` (пункт меню, исключение зеркала с причиной); уведомление `partner_material_published`; аудит скачиваний; scope «компании, где у партнёра есть организации».
**Критерии.** Партнёр видит только материалы «своих» компаний; заражённый файл не публикуется; снятый с публикации исчезает.
**Проверки.** IDOR партнёра; `upload.core-usage`; страж зеркала.

### Task 31 (Важно): «Переписка с менеджером» в кабинетах, `member` и видимость заказов, close-out этапа 6 (`У-234`, `У-236`, `У-241`)
**Что изменить.** Вкладки «Переписка с менеджером» / «По заказам» в «Сообщениях» заказчика и партнёра (на API Task 18); «Написать» из «Ваш менеджер» → диалог; `Organization.membersSeeOwnOrdersOnly` + настройка + скоуп в `services/organization/orders.ts`; стражи; глоссарий; AUDIT/STATUS/CHANGELOG/close-out.
**Критерии.** Сообщение из кабинета — у менеджера в диалоге; `member` при включённой настройке не видит чужой заказ (404).
**Проверки.** IDOR `member`; мутация.

---

## Этап 7 — отчёты и KPI (`12`)

### Task 32: `SalesTarget.metric`, реестр метрик, хаб KPI (`У-242`)
**Что изменить.** Миграция `metric` (+ уникальность); `kpi/metrics.ts` (10 метрик, расчёт через `groupBy`), `kpi/plan.ts`; хаб `/{admin,leader}/settings/processes/kpi` (активные метрики, планы, копирование); `Company.activeKpiMetrics`.
**Критерии.** Существующий план продаж работает как `revenue_paid`; планы копируются; таблица «Excel-показатель → метрика» из спеки реализована.
**Проверки.** Тесты каждой метрики на фикстуре; `settings.sections-registry`.

### Task 33: Вкладки аналитики, сервисы, индексы (`У-243`, `У-247`, `У-248`)
**Что изменить.** `/leader/analytics` с пятью вкладками (+ `/admin/finance` с выбором компании); `services/leader/{receivables,communications,partnersAnalytics,sources}.ts`; индексы по `EXPLAIN`; страж N+1 в `src/lib/reports/**` и `src/lib/kpi/**`; тест производительности с тайм-лимитом.
**Критерии.** Вкладки показывают данные фикстуры; отчёт за месяц на 100 000 заказов < 2 с.
**Проверки.** Интеграционный тест с генерацией фикстуры; страж N+1 мутацией.

### Task 34: Реестр отчётов, экспорт XLSX, права, стражи (`У-244`, `У-249`, `У-250`)
**Что изменить.** `reports/registry.ts` (6 отчётов), `GET /api/reports/[key]/export` (`exceljs`, лимит 50 000), вкладка «Экспорт»; права по ролям (менеджер 403; `see_commission`); страж реестр ↔ страница; тест колонок и скоупа на каждый отчёт.
**Критерии.** XLSX совпадает с экраном; чужая компания → пусто/404; лимит с подсказкой.
**Проверки.** Тесты на каждый ключ; `security.role-access-matrix`.

### Task 35: Дашборды менеджера и администратора, close-out этапа 7 (`У-245`, `У-246`)
**Что изменить.** «Мои KPI за месяц» в `manager-kpi-grid.tsx`; кросс-компанийные плитки админа (документы не выгружены, последний пакет миграции); глоссарий; AUDIT/STATUS/CHANGELOG/close-out.
**Критерии.** Менеджер видит только свои KPI; плитки кликабельны.
**Проверки.** Эталоны дашбордов; тест скоупа.

---

## Этап 8 — документы и 1С (`10`, `08`)

### Task 36: Версии загруженных файлов, журнал скачиваний (`У-251`, `У-254`)
**Что изменить.** `replacesDocumentId` в роутах загрузки; «Загрузить новую версию» + история версий; клиентам — последняя; `document_downloaded` в download-роутах; блок «Кто скачивал»; `Document.uploadedByRole` + бэкфилл.
**Критерии.** Старая версия скрыта у клиента; аудит скачивания пишется для всех ролей; блок у клиента отсутствует.
**Проверки.** Тесты download-роутов; IDOR.

### Task 37: ZIP выбранных документов (`У-252`)
**Что изменить.** `GET /api/documents/zip` (скоуп роли, `clean`, лимиты, потоковый `jszip`, имена `У-154`, суффиксы), чекбоксы и кнопка в списках (ЦО, заказчик, партнёр), аудит `documents_zip_downloaded`.
**Критерии.** Чужой id молча пропущен и посчитан; лимит 50/500 МБ; заражённый не попадает.
**Проверки.** IDOR партнёра/заказчика; тест имён.

### Task 38: Группировка, фильтры, источник, массовые действия, close-out части «Документы» (`У-253`, `У-258`)
**Что изменить.** Группировка/фильтры/поиск в карточке организации и экране «Документы»; фильтр «источник»; `sendDocumentsToClientAction` (одно письмо на организацию).
**Критерии.** Шесть источников различаются; массовая отправка группирует по организации; `total` есть.
**Проверки.** Тесты сервиса списка; эталоны.

### Task 39: Контакты контрагентов из 1С (`У-256`)
**Что изменить.** `OneCOrgSchema.contacts` (аддитивно), `mappers.ts`/`writers.ts` → `Contact` по нормализованным каналам; конфликт → `SyncLog warn` со ссылкой на объединение; фикстуры `mock-1c`; контракт §1; страж контракта (хотфикс №42).
**Критерии.** Контакты из фикстуры появляются; повтор без дублей; пустое не затирает.
**Проверки.** Интеграционный тест `pullOrganizations`; страж контракта.

### Task 40: Сверка дебиторки с 1С, close-out этапа 8 (`У-257`)
**Что изменить.** Контракт §8 `GET Debts` (+ §9 `GET Nomenclature` как «ожидает 1С», без кода); `oneCSync.reconcileDebts` (расписание из UI), сравнение, канал «Дебиторка» в истории, отчёт XLSX, алерт по порогу, кнопка повтора; `mock-1c` метод; `docs/integrations/1c-meeting-agenda.md`; AUDIT/STATUS/CHANGELOG/close-out (`У-255` остаётся ⏳ «Позже»).
**Критерии.** Искусственное расхождение фикстуры видно в истории и в отчёте; данные заказов не изменены.
**Проверки.** Тест процессора; `worker.processor-coverage`.

---

## Этап 9 — очистка (`13`) — после утверждения списка заказчиком

### Task 41: Логи и README RBAC (`У-259`, `У-260`)
**Что изменить.** `git rm` четырёх логов, `*.log` в `.gitignore`, страж «нет `*.log` под git»; таблица RBAC в README из `protectedPrefixes` + страж `docs.readme-rbac.guardrail`.
**Критерии.** Оба стража зелёные и проверены мутацией.

### Task 42: `xlsx` → `exceljs` (`У-267`)
**Что изменить.** Заменить импорт в `load-xlsx.ts` и всех местах чтения; прогнать фикстуры импорта и выписки, сравнить результаты; удалить `xlsx` из `package.json`.
**Критерии.** `npm audit --omit=dev` = 0; тесты импорта зелёные без изменений ожидаемых данных.

### Task 43 (два PR): Мёртвые модели и `roleInPartner` (`У-261`)
**PR-1.** Скрипт `report:dead-tables` (dry-run счётчиков) + страж «модель Prisma без обращений». **PR-2.** Миграция `DROP` с проверкой «0 строк» (иначе падение с текстом), удаление `Order.uploads`; `roleInPartner 'member' → 'manager'` в коде и бэкфилл.
**Критерии.** Стенд: dry-run показал 0 → миграция прошла; страж падает на добавленной пустой модели.

### Task 44: Страж стоп-слов и `docs/NOT_DOING.md` (`У-266`, `У-265`)
**Что изменить.** Тест собирает строки клиентских компонентов и падает на стоп-словах (список с исключениями и причинами); `docs/NOT_DOING.md` из `01` §9 + ссылки из `ARCHITECTURE.md` и `CLAUDE.md`.
**Критерии.** Страж зелёный после правки найденных строк; ссылки живые.

### Task 45: `partner_leads` и `partner_legacy` (`У-264`)
**Что изменить.** Dry-run числа лидов с `partnerId`; удаление флага и веток; enum-миграция при 0; матрица флагов.
**Критерии.** Партнёрский кабинет без веток подачи лидов; тесты флага удалены.

### Task 46 (по 3 флага в PR): Снятие «вечных» флагов (`У-262`)
**Что изменить.** Для каждого утверждённого флага: проверка «включён ≥ 30 дней» по аудиту; удалить три точки чтения + шлюзы (307 → 308); тест «страница без env»; матрица, `.env.example`, CHANGELOG.
**Критерии.** Страница открывается без переменной; матрица без строки; страж `feature-flags-matrix.sync` зелёный.

### Task 47: Легаси-шлюзы (`У-263`)
**Что изменить.** `introducedAt` в `legacyHrefs` + страж «старше 90 дней»; удаление по списку после проверки базы на старые пути; close-out этапа 9.
**Критерии.** Старый адрес → «раздел переехал» (404-страница), не редирект; `AUDIT.md` этап 9 ✅.

---

## Этап 10 — приёмка

### Task 48: Сценарная приёмка (`У-268`)
**Что изменить.** Спека этапа 10 с чек-листами шести сценариев `01` §5; стенд с fake-адаптером Битрикса и `mock-1c`; прогон заказчиком; дефекты — хотфиксами §9.4; эталоны 390×844; глоссарий; матрица флагов.
**Критерии.** Все шесть сценариев подписаны заказчиком.

### Task 49: Drift-аудит, close-out программы, режим сопровождения (`У-269`)
**Что изменить.** Прогон `AUDIT.md` по `У-177`…`У-269`; `MAINTENANCE.md` прогон С-N; close-out `docs/tz/…-DONE.md`; указатели → режим сопровождения; runbook параллельного периода закрыт записью «Битрикс24 отключён <дата>».
**Критерии.** `tz:status` зелёный; в close-out — дата отключения Битрикса и итог сверки.
