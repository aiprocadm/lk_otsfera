# История изменений

Все значимые изменения проекта **lk-otsfera** (личный кабинет Промтехносфера) фиксируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [Unreleased]

Программа backend-frontend parity (спека `docs/superpowers/specs/2026-07-15-backend-frontend-parity-design.md`):
UI для бэкенда, отгруженного без экранов, — 8 треков A–H.

### Добавлено

- **ТЗ программы развития (v1.0 от 23.07.2026).** Документ принят в репозиторий —
  `docs/tz/2026-07-23-tz-lk-otsfera-v1.md` (11 последовательных этапов, §9); заведён трекер
  прогресса `docs/tz/STATUS.md`; в CLAUDE.md §14 закреплён протокол «продолжай по ТЗ»
  (агент возобновляет работу с текущего этапа по spec-first циклу §8).
- **Распределение заказов (Трек A).** Кнопка «Взять в работу» на деталке заказа (менеджер и
  руководитель; guard `claimOrder` выровнен с видимостью leader-деталки), форма «Назначить
  менеджера» на leader-деталке (C8 внутри экшена), фильтр «Без менеджера» в списках заказов.
- **Панель «Жизненный цикл» заказа (Трек A).** Переходы по графу `Order.status`
  (new→in_progress→waiting_client/completed, reopen), диалог причины для «Ждём клиента»,
  список несоблюдённых условий завершения, галочка «Бухгалтерия подписана»; верхний блок
  переименован в «Операционный статус» для различения осей.
- **Лиды (Трек B).** Передача лида другому менеджеру (серверная валидация кандидата —
  новый код `invalid_manager`), возврат «в новые» из рассмотрения, ручная кнопка
  **«Отправить в 1С»** — первый продюсер очереди `oneCSync.pushLead` (timestamped jobId,
  идемпотентность через claim воркера) + строка статуса отправки в карточке. Решение T3
  «оставить пуш неподключённым» пересмотрено владельцем 2026-07-15.
- **Центр уведомлений (Трек C).** Колокольчик с бейджем непрочитанных в хедерах всех
  5 кабинетов (поллинг 30с), панель последних 50 с отметкой прочитанного и «Прочитать все»,
  deep-link по `meta.url`/типу (абсолютные URL продьюсеров конвертируются в локальный путь —
  внешний редирект исключён по построению); новый `GET /api/notifications/unread`; scope
  вынесен в сервис `notifications/scope.ts`.
- **«Забыли пароль» (Трек D).** Ссылка на входе + self-service форма запроса сброса
  (анти-enumeration: единый ответ), фокус-менеджмент success-состояния.
- **Инбокс обращений (Трек E).** Скачивание вложений входящих (presigned 600с, 410 для
  заражённых), архивация/восстановление обращений (архив unresolved закрепляет обращение
  за компанией архивирующего — записи не выпадают из видимости; CAS-guard от гонок),
  честное скрытие недоступного email-ответа; единый C8-scope-модуль `inbound/scope.ts`
  с тестом эквивалентности Prisma/in-memory форм.
- **Звонки (Трек E).** Фильтр журнала по организации (сохраняет направление и сбрасывает
  пагинацию).
- **Композер ленты сделки (Трек E, M1 §2.3.6).** Три режима: внутренняя заметка /
  комментарий клиенту (видит клиент; предупреждающий тон + aria-describedby) / ответ
  в канал последнего входящего (email честно скрыт); имя инициатора в строке звонка.
- **Цвета стадий и колонок (Трек F).** Пикер-свотчи в диалогах стадий воронки и колонок
  задач, цветовая полоска на досках (стабильная раскладка), hex-валидация в сервисах.
- **Админ-поверхности (Трек G).** Вьюер отложенных 1С-записей (прикладной dead-letter,
  без ПДн-payload) с возвратом dead-записей в очередь; секции «Алерты» (AlertState) и
  «Ошибки синхронизации» (без payload) на `/admin/health`; ручной запуск 4 фоновых задач
  (сертификаты, email-poll, mango-backfill, месячные комиссии) с индикатором выполнения
  и drift-guard тестом реестра; история ставок комиссии организации на карточке
  (nullable «сброс к ставке партнёра»).
- **UI-примитивы:** `ActionToastButton` (объединил 4 toast-кнопки), `ColorSwatchPicker`.

### Исправлено

- **Пагинация журналов звонков и инбокса**: страницы парсили `?page=`, тогда как `Paginator`
  строит ссылки в take/skip-конвенции — кнопки не переключали страницы.
- `bindInboundMessageAction` получил C8-scope-гейт: перепривязка чужой bound/archived-строки
  по cuid заблокирована.
- href-уведомлений: продьюсеры пишут абсолютные URL — резолвер принимает их через
  pathname-навигацию (ранее все org/partner-уведомления были бы некликабельны).
- Bogus-значения фильтров (`?direction=…`, `?status=…`, `?channel=…`) не увековечиваются
  в ссылках фильтр-баров calls/inbox.

### Изменено

- Комментарии флагов `inbound_messaging`/`telephony_mango` актуализированы (экраны построены).

## [0.10.0] — 2026-07-12

Крупный релиз укрепления после pre-release v0.9.0. Основные оси: обязательная 2FA сотрудников и
журнал доступа к ПДн (§25.7); серия release-hardening R0–R2 (fail-fast zod-валидация prod-env,
CSP и security-заголовки, rate-limits на вход/сброс пароля, хеширование reset/invite-токенов,
честная worker-liveness, readiness с учётом S3); омниканальный входящий инбокс и телефония Mango;
жизненный цикл и распределение заказов (Track B), позиции заявки с удостоверениями; миграция
хранилища под 152-ФЗ и каналы уведомлений (Track D); завершение программы 100%-покрытия (весь
`src/**` под порогом) и серверный CI на GitHub Actions. Версия сознательно остаётся в ряду
`0.x`: единственный жёсткий блокер `v1.0.0` — живая интеграция 1С (`ONE_C_MODE=live`) со
стабилизацией на проде — не закрыт (см. «Известные ограничения» релиза 0.9.0).

### Изменено

- Лимит загрузки документов поднят до 200 МБ (§11 ТЗ) из единого источника; добавлен формат .doc (§13).
- **Корректировка возврата после выплаты (§9.5, A6).** Возврат, чей `paidAt` попал в уже
  `approved`/`paid` период, авто-детектится в очередь корректировок (`CommissionCorrection`,
  идемпотентно по платежу), а не правит закрытую ведомость. Admin/руководитель вручную
  **Применяет** (удержание отрицательной строкой в следующей ведомости) или **Списывает**
  (с причиной); решения — в audit. Непокрытый остаток (если удержание > заработка месяца)
  переносится цепочкой в следующий период. Очередь: `/admin/commission-corrections` и
  `/leader/commission-corrections` (руководитель — в рамках своей компании). Месячный крон
  запускает детект перед расчётом.
- **Расчёт комиссии переведён на фактические платежи (§9.2).** База партнёра за период =
  Σ полученных платежей − Σ возвратов по дате `paidAt` (раньше — сумма заказа по `closedAt`);
  комиссия по ставке, действовавшей на дату платежа (`CommissionRateChange`, историческая ставка);
  НДС из базы **не вычитается** (решение владельца). Строка ведомости = один платёж
  (`CommissionStatementItem.orderId` стал nullable, добавлен `paymentId`); возвраты — отрицательные
  строки, отрицательный нетто-месяц не уходит в выплату. Админ может задать дату вступления ставки
  (`effectiveFrom`). Месячный крон выбирает партнёров по наличию платежей в периоде. ⚠️ Поведенческое
  изменение сумм выплат. Удалены env-рычаги `COMMISSION_TRIGGER` / `COMMISSION_VAT_MODE`.
  Корректировка возврат-после-выплаты (§9.5) — отдельный следующий sub-project.
- **Хранилище файлов: Supabase Storage → S3-совместимое (152-ФЗ).** Введён порт `ObjectStorage`
  (`StorageError`, `documentBucket`) + адаптер `S3Storage` (upload / download→Buffer / remove /
  createSignedUrl с тремя disposition-ветками, RFC 5987 Content-Disposition). На порт переведены
  app/api-роуты, `lib/services` и воркер-процессоры; модуль Supabase и зависимость удалены.
  Env: `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` /
  `S3_FORCE_PATH_STYLE` (см. `.env.example`, CLAUDE.md §10).
- **Track D — сквозная консистентность кабинетов** (6 семейств экранов × роли): заголовки и
  плюрализаторы выровнены, формат-хелперы дедуплицированы (`pluralizeRu`→`lib/format`,
  `ui/Paginator`). Заказы: единый search-параметр `q`→`search`, мобильный card-list для
  менеджера/руководителя, страница деталей заказа руководителя `/leader/orders/[id]`,
  confirm-диалог перед сменой статуса. Финансы / документы / сообщения / команда / заявки —
  выравнивание заголовков и авторизации (org через `requireOrganization()`).
- **RU-переводы 36 незамапленных error-кодов.** Инвентаризация кодов ошибок по сервисам, server-actions, API-роутам и воркеру нашла 36 стабильных кодов без записи в `errorMessageRu` — на реальных, действенных сбоях (rate limit, заражённые загрузки, конфликты стадий воронки, лимиты команды, состояния sync control) пользователь видел generic-фолбэк «Произошла ошибка.». У всех 36 теперь конкретные русские строки; фолбэк остаётся для будущих кодов.
- **Индивидуальная ставка комиссии организации (Трек A, §6.2, #172).** Разворот раннего решения §6.2. Эффективная ставка платежа резолвится новой чистой `resolveEffectiveRate` с приоритетом (1) override организации (`organization.partnerCommissionRate`) → (2) историческая ставка партнёра (`resolveRateAt`) → (3) дефолт партнёра; `null`/`undefined` = «наследуем», любое заданное значение (включая `Decimal(0)`) — явный override. Единственная точка выбора ставки на платёж (`statement.ts`) и сторно позднего возврата (`corrections.ts`) переведены на неё. Cross-partner gate: override организации применяется только если `organization.partnerId` совпадает с партнёром ведомости — платёж может быть отнесён партнёру через `order.partnerId`, и скидка «чужой» организации не должна на него протекать. НДС из базы структурно не вычитается (`calculateCommission` не принимает `vatAmount`; подтверждено тестом). ⚠️ Поведенческое изменение сумм комиссии.

### Добавлено

- **Каналы уведомлений за единым интерфейсом (Трек D каналов, §9/§12.1/§25.3 ТЗ).** Введён
  `NotificationChannel` (`src/lib/notifications/channels/`) — email/telegram/max/whatsapp под
  общим контрактом `{ key, isEnabledFor, send }`. Email и Telegram перенесены без изменения
  поведения (те же письма, гейты, счётчики; регресс-тесты зелёные). Добавлены **Max** (нативно,
  по образцу Telegram: deep-link-привязка + webhook `POST /api/integrations/max/webhook`) и
  **WhatsApp через агрегатор** (Wazzup-подобный: подключение номера в сервисе, отправка по
  API-ключу из окружения) — оба за адаптером, мокабельны, под opt-in feature-флагами
  `max_channel`/`whatsapp_channel`. Пользовательские настройки каналов на `User`
  (`notificationChannels Json` + привязки `maxChatId`/`whatsappPhone`): email всегда включён,
  остальные — opt-in (привязка + не выключено); UI в «Настройках» всех 5 кабинетов
  (`NotificationChannelsCard`). Доставка через воркер (BullMQ, очередь `notifications.dispatch`,
  флаг `notif_queue` + Redis) с ретраями и идемпотентностью по jobId; без флага/Redis — inline
  (прежнее поведение). Ошибка одного канала изолирована и не роняет остальные; сбои канала в
  воркере пишутся в `SyncLog` и ретраятся. Добавление нового канала не требует правок в местах
  генерации событий (структурный тест приёмки).
- **Производный 6-стадийный рабочий статус заказа (§10 ТЗ).** Чистая функция `orderWorkingStage`
  в `lib/orders/humanStage.ts` выводит стадию из уже существующих полей заказа (без изменения
  enum `ExecutionStatus` и 1С-маппингов): 1 «Новая» → 2 «Договор» → 3 «Оплата» → 4 «Обучение» →
  5 «Документы» → 6 «Закрыт»; `cancelled`/`on_hold` — терминальные бейджи вне дорожки.
  Монотонная логика: берётся самая дальняя достигнутая веха. Компонент `OrderStageStepper`
  (`components/orders/`) встроен в карточку заказа во всех кабинетах (менеджер, руководитель
  через `ManagerOrderHeader`, организация, партнёр, admin). Метки вынесены в `WORKING_STAGE_LABELS`
  — переименование §10 без миграции. _Точные названия стадий предложены как дефолт — ожидается
  подтверждение владельца по §10._

- **Настраиваемые поля (§11 ТЗ).** Admin заводит доп-поля заказа (text/number/date/select/
  boolean) в справочнике `/admin/custom-fields`; значения редактируются в карточке заказа
  (менеджер/админ/руководитель), org/partner видят read-only. Модели `CustomFieldDefinition`
  (конфиг) + `CustomFieldValue` (значение, полиморфно по entityType, v1=order); деактивация
  вместо удаления; значения scoped по доступу к заказу (C8). Без feature-flag.
- **Telegram-уведомления пользователям (§18 ТЗ).** Пользователь привязывает Telegram через
  deep-link/код (бот-webhook `/api/integrations/telegram/webhook`, secret-token-гейт) на
  странице «Настройки» в своём кабинете; уведомления зеркалятся в Telegram во всех точках
  фан-аута (третий best-effort канал рядом с ЛК и e-mail). Graceful-enable через
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME` (фича дремлет, если не настроено) — не feature-flag.
- **Прод-упаковка и greenfield-runbook РФ.** `Dockerfile` (+`npm ci --ignore-scripts` против
  husky-prepare), `.dockerignore`, prod-compose, `.env.production.example`; `tsx`+`prisma`
  переведены в `dependencies`. Runbook РФ-инфраструктуры (provision → TLS → bring-up → hand-off)
  с design-spec и планом (SP1–SP3).
- **Bootstrap-вход в чистую БД.** CLI `db:create-admin` (env-driven, idempotent, runner-guard) —
  закрывает «замкнутый цикл» первого входа в не-демо БД; «демо» = demo-seed + `SHOW_DEMO_LOGINS`.
- **Self-healing нативный dev-stack** (`scripts/dev-stack.ps1`): портативные PG+Redis без
  Docker/WSL (идемпотентный запуск по свободному порту).
- **Обязательная двухфакторная аутентификация staff-ролей (admin/manager/leader) за opt-in флагом `staff_2fa` (`FEATURE_STAFF_2FA=1`).** После верного пароля staff-пользователю (`isStaff` ⟺ `role === 'admin' || role === 'manager'`, leader — это manager с `managerRole='leader'`) высылается одноразовый 6-значный код на email; сессия не выдаётся, пока код не подтверждён. Двухшаговый `LoginForm`: шаг 1 — email/пароль, шаг 2 — ввод кода с автофокусом, resend-кнопкой (cooldown 30с, ≤3 переотправки на challenge) и вводом backup-кода. Новые модели Prisma `TwoFactorChallenge` (`@unique userId`, challenge upsert по пользователю, TTL 10 мин, ≤5 попыток) и `TwoFactorBackupCode` (10 backup-кодов base32, одноразовые, транзакционная перегенерация) — миграция `20260710223120_staff_2fa`. Сервис `lib/services/auth/twoFactor.ts`; роуты `POST /api/auth/login` (ветка challenge + cookie `2fa_pending`, `502 EMAIL_SEND_FAILED` при сбое письма), `POST /api/auth/2fa/verify` (обмен кода на сессию, backup-fallback), `POST /api/auth/2fa/resend`. Backup-коды: self-service секция «Коды восстановления» в settings admin/manager/leader (server-action `regenerateBackupCodesAction`) + админ-перевыпуск чужому сотруднику из `/admin/users/[id]`. Email-шаблон `two-factor-code.tsx` (код в теле, не в теме). ⚠️ Поведенческий флаг: при `staff_2fa=1` вход всех staff требует второго шага; откат — `FEATURE_STAFF_2FA=0`. Включать только с рабочей почтой (`EMAIL_ENABLED=true` + `RESEND_API_KEY`), иначе логин staff вернёт 502.
- **Global-error boundary + error digest на всех экранах ошибок.** Краш root-layout раньше проваливался в дефолтный нестилизованный экран Next (`global-error.tsx` не существовал). Новый boundary рендерит собственные `<html>`/`<body>` с inline-стилями (при мёртвом root-layout Tailwind-таблица стилей может отсутствовать, классам доверять нельзя). Все экраны ошибок (root, 6 кабинетных boundary, global) теперь печатают Next error digest — пользователю есть что процитировать, оператору есть что грепнуть в серверных логах.
- **Единый инбокс входящих обращений (омниканальность, PR-A).** За opt-in флагом `inbound_messaging` добавлен приём входящих сообщений из email (IMAP), Telegram, Max и WhatsApp (Wazzup) в единую модель `InboundMessage` (аддитивная миграция `20260705104237_inbound_message`). Приём идемпотентен (`ingestInboundMessage` — `findUnique` + защита от гонки `P2002`), отправитель резолвится exact-match'ем (`resolveInboundSender`, C8/IDOR-safe, email — `mode:'insensitive'`), а `SyncLogEntity` расширен значением `inbound`. Менеджер работает с обращениями на экране `/manager/inbox` (список + company-scoped привязка к сущности и ответ через существующие исходящие транспорты), плюс read-only вкладка «Обращения» в CRM-карточке организации. Вложения проходят антивирус через ветвь `inbound_attachment` очереди `docs.scanDocument`. Ответ по email в v1 отключён (server-action маппит в `email_unsupported`) — исходящий email пока только шаблонный.
- **Журнал звонков через Mango Office VPBX (PR-B).** За opt-in флагом `telephony_mango` добавлена интеграция входящей телефонии: модель `Call` (`@@unique(provider, externalId)`), резолвер звонящего `resolveCaller` с RU-нормализацией (`canonicalizeRuPhone`, 8→7, локально в телефонии, C8/IDOR-safe) и идемпотентный `ingestCallEvent` (upsert, устойчивый к out-of-order событиям). Webhook Mango требует одновременно IP-allowlist И подпись `sha256(key+json+salt)` (timing-safe, иначе 401); записи разговоров кладутся в S3 через ветвь `call_recording` антивирус-конвейера, статистика подметается идемпотентным бэкфилл-воркером по `/vpbx/stats`. Менеджеру доступны экран `/manager/calls` (список + presigned-скачивание записи, clean-gated, `infected`→410) и вкладка «Звонки» в CRM-карточке. Адаптер `getMangoAdapter` env-keyed (fake/rest); боевой REST — заглушка до подключения `MANGO_VPBX_BASE_URL` + `api_key`/`api_salt`.
- **Универсальный тип услуги заказа (Track B / serviceType).** enum `ServiceType { training, document_development }` и поле `Order.serviceType @default(training)` (миграция `20260701130507_order_service_type`, аддитивная — существующие заказы не меняются). Тренинг-специфика централизована в `isTrainingOrder()`: теперь заказ может быть либо обучением, либо разработкой документов, а условие выдачи удостоверений применяется только к training-заказам.
- **Жизненный цикл заказа: завершение по всем условиям, переоткрытие и возврат клиенту (§21).** Активирована ранее спавшая ось `Order.status` — машина состояний `src/lib/services/manager/orderLifecycle.ts` с явной картой разрешённых переходов. Переход `→ completed` защищён чистым оценщиком `evaluateOrderCompletion` (`src/lib/orders/completion.ts`): `documents_uploaded` (≥1 чистый скан) · `accounting_signed` (`Order.accountingSignedAt`, галочка менеджера `setOrderAccountingSigned`) · `certificates_issued` (только для training: все `OrderItem.trainingStatus='certificate_issued'`). Переоткрытие `completed → in_progress` разрешено и аудируется (`order_lifecycle_changed`). Возврат клиенту `in_progress → waiting_client` требует непустую причину в `Order.returnReason` (очищается при выходе из статуса). Миграция `20260701131528_order_completion_and_return_fields`; `executionStatus`/логика комиссий не тронуты.
- **Распределение заказов между менеджерами (Track B / distribution).** `src/lib/services/manager/distribution.ts`: `resolveAutoManager` (уникальный активный `OrganizationManager` организации, иначе уникальный через организации партнёра) подключён в боевой путь — писатель заказов 1С (`oneCSync/writers.ts`) проставляет `managerId` при создании (best-effort: сбой резолвера не блокирует импорт). Ручное назначение `assignOrderManager` (общее для admin и leader, кандидат ограничен компанией для руководителя через `restrictToCompanyId`) и самоназначение `claimOrder` со scope-гардом `canSeeOrder`.
- **Лимиты пользователей команды (Track B / user limits).** `src/lib/config/teamLimits.ts`: `MAX_ORGANIZATION_USERS=10`, `MAX_PARTNER_USERS=5`. Проверка в `inviteMember` (`organization/team.ts`, `partner/team.ts`) и `admin/users/mutations.ts createUser` (партнёрская ветка); при переполнении — код ошибки `member_limit_reached`. ⚠️ Поведенческое изменение: приглашения блокируются при достижении лимита; учёт по активным членам — деактивированные не занимают слот (проверка count-then-create, допускается редкий +1 overshoot при строго конкурентных приглашениях).
- **Позиции заявки (слушатели), удостоверения и напоминания о сроке (§15.6/§12/§10/§19).** Модели `TrainingDirection`, `OrderItem` (позиция-слушатель), `Certificate`, `CertificateReminder` + enum `TrainingStatus`; `Student.email` → `@@unique([organizationId,email])` + `status`. Сервисы (Result-контракт): `directions` (справочник направлений, admin/leader; деактивация вместо удаления), `orderItems` (scoped, RBAC, dup-guard), `certificates` (`issueFromOrderItem` в транзакции). Очередь `notifications.certificateExpiry` + ежедневное расписание `0 7 * * *` и процессор `certificate-expiry` — напоминания на полосе 90/60/30/7 дней с fan-out орг→партнёр→менеджер→руководитель (ЛК+email, dedup через `@@unique`+P2002). UI: секция «Слушатели» в карточке заказа (manager/leader — добавление/смена статуса/выдача удостоверения; org/partner — read-only), карточки удостоверений с бейджем срока на `/manager/students/[id]`, admin-страница справочника направлений. Seed 4 направлений (Охрана труда/ПБ/ЭБ/Другое).
- **«Привязать»-flow ручного разбора «Карточки счёта 51» (§7.2, 1С импорт банковских платежей).** Загрузка выгрузки 1С «Карточка счёта 51» → платежи в кабинете. Формат-агностичный ридер (`.xls` через SheetJS, `.xlsx` через exceljs), классификатор (счёт 62 = платёж/возврат; 60/91/перемещение исключаются) и оркестратор preview/commit: точное сопоставление по счёту/ИНН пишется напрямую writer'ом, нечёткое по имени уходит в очередь ручного разбора (`PaymentImportBatch`/`PaymentImportRow`, миграция `20260624222600_payment_import_card51`). Диалог «Привязать» (resolve/dismiss с поиском организаций/заказов) на страницах `admin/payments-import` и `manager/payments-import` (company-scoped) + nav.

### Исправлено

- **Стабилизация запуска** (PR #147): утечка Prisma `Decimal` в RSC-границу (partner finance →
  DTO с `.toFixed(2)`), issuer student-bridge JWT, hydration-ошибка вложенного `<button>`
  в списке комиссионных ведомостей (toggle → `role="button"`).
- **Ограниченный graceful shutdown воркера (force-exit timeout).** `shutdown()` ждал `w.close()` без ограничения — зависшая задача блокировала SIGTERM навечно, и оркестратор в итоге SIGKILL'ил процесс без следа причины. Теперь закрытие гонится с таймером `WORKER_SHUTDOWN_TIMEOUT_MS` (по умолчанию 25с, под 30с grace-периодом Docker/K8s): по истечении воркер логирует таймаут и сам выходит с кодом 1. Повторные сигналы во время идущего shutdown игнорируются.
- **poll-inbound-email больше не теряет письма при сбое ingest.** Процессор двигал курсор `SyncState` даже при сбое ingest'а внутри батча — такое письмо больше никогда не выбиралось (тихая потеря данных). Теперь батч со сбоями удерживает курсор (и `lastSuccessAt`), пишет причину в `SyncState.lastError`, а следующий poll перечитывает батч: уже загруженные сообщения дедуплицируются по `externalId`, сбойные ретраятся. В результат добавлен счётчик `failed`, `processed` теперь считает успехи.
- **SQL-скоуп audit-фида на дашборде организации.** `recentEvents` выбирал ГЛОБАЛЬНЫЙ топ `fetchLimit*2` audit-строк `order_status_*` и пост-фильтровал их вторым запросом по заказам организации. На нагруженной multi-tenant-установке шумный сосед вытеснял события текущей организации из глобального окна (лента голодала до пустой), а приложение зря читало строки чужих арендаторов. У `AuditLog` нет связи с `Order` (`entityId` — простая строка), поэтому скоуп сделан raw-JOIN по `"Order"."organizationId"` (тот же идиом, что `scopeSql` для chat unreadCount); изоляцию пинит интеграционный регресс.
- **1С-курсор тихо терял out-of-order записи — store-and-replay (#170).** High-severity баг целостности данных: единственный high-water-mark курсор проходил мимо skipped/failed записей — inbound-строка, пришедшая раньше своей зависимости (напр. платёж до своей организации), безвозвратно терялась, как только более поздняя успешная запись батча двигала watermark. Наивное «не двигать курсор на skip» застопорило бы весь поток сущности на любой неразрешимой записи, поэтому выбран store-and-replay (Option A′, вместо re-pull by-externalId — адаптер bulk-pull-only): транзиентные skip'ы (`organization_not_found`/`order_not_found`/`document_fetch_failed`) и брошенные writer'ом ошибки (deadlock/P2002) сохраняются сырым DTO в новую модель `OneCPendingRecord` (миграция `20260629170428_one_c_pending_record`, status `pending`); permanent skip'ы (`partner_not_found`/`out_of_scope`) не захватываются. После каждого live-pull `replayPendingRecords` прогоняет DTO через идемпотентный writer (сначала перевалидация zod): успех → удаление строки, повторный транзиент → `attempts++`, permanent / `attempts>=maxAttempts` / возраст `>=maxAgeDays` / битый DTO → dead-letter (`status='dead'`) с critical-алертом `onec_dead_letters`. Курсор не трогали — capture/replay идут рядом, без риска stall; потеря теперь всегда громкая. Knobs env-override: `ONE_C_PENDING_MAX_ATTEMPTS`(50)/`ONE_C_PENDING_MAX_AGE_DAYS`(7)/`ALERT_ONEC_DEADLETTER_MAX`(0). Примечание: миграция попутно пересоздаёт `CommissionStatementItem_orderId_fkey` как `ON DELETE SET NULL` (реконсиляция pre-existing drift, поведенчески нейтрально).
- **1С-синк: P2002 на организации с уже существующим ИНН (#169).** `upsertOrgRecord` резолвил организации только по `externalId`, поэтому организация, уже существующая под своим ИНН (`Organization.inn @unique`), попадала в create-ветку и падала `P2002` на каждом прогоне синка. Теперь резолв по `externalId` ИЛИ `inn` (зеркалит `resolveOrganizationRef`), обновление in-place, backfill `externalId` только когда у найденной организации его нет. Shadow-режим остаётся write-free (оба lookup'а — чтения).
- **Инвертированный глоссарий под-ролей партнёра (#164).** Финальное холистическое ревью нашло инверсию в глоссарии под-ролей `jwt.ts` (и в его spec/plan/DONE-источниках): `partnerRole='admin'` — это администратор партнёра (`requirePartnerAdmin` проверяет `=== 'admin'`), а `partnerRole='manager'` — обычный scoped-партнёр (дефолт). Правка только в комментариях/доках — все guard'ы, middleware и app-shell уже использовали `'admin'` корректно, поведение не изменилось.

### Безопасность

- **Pre-auth JWT второго шага (`signTwoFactorPendingToken`) несёт claim `purpose:'2fa'` без `role` и не даёт доступа ни к одному маршруту.** `verifyToken`/`getSession` отвергают токен с `purpose` — подложенный в cookie `session`, он бесполезен (закреплено guard-тестом). Коды 2FA и backup-коды хранятся только как sha256 (`codeHash`), плейнтекст в БД отсутствует, дамп таблиц кодов не выдаёт; коды не логируются ни в каком виде (§12), audit-события пишутся без payload-кода (`2fa_code_sent`, `2fa_verified`, `2fa_failed`, `2fa_backup_used`, `2fa_backup_regenerated`). Компенсация краткости кода: TTL 10 мин, ≤5 попыток на challenge, per-IP rate-limit на verify. `buildSessionClaims` вынесен в общий хелпер, чтобы login и verify выдавали идентичный session-JWT.
- **Журнал доступа к ПДн (§25.7).** Append-only модель `PiiAccessEvent` (миграция `20260711095014_pii_access_event`, GIN-индекс по `subjectIds` + btree) фиксирует каждое чтение персональных данных сотрудником. Реестр `src/lib/pii/contexts.ts` описывает 12 инструментированных контекстов (списки и карточки студентов, лид, enrollments, карточка организации, inbox, звонки, сертификаты, orderItems, admin users list/view); запись идёт через awaited `recordPiiAccess`/`recordPiiAccessMany` (`src/lib/pii/record.ts`), которые сами отсекают не-staff, пустые выдачи и выключенный флаг. Просмотр — страница `/admin/pii-access` поверх сервиса `listPiiAccess`/`listPiiAccessFilters` (только индексируемые фильтры, GIN `has` по субъекту, батч-резолв имён без N+1, cursor-пагинация, graceful-баннер при kill-switch) + пункт навигации. Флаг `pii_access_log` — opt-out (в тестовом env заглушён `vitest.setup.ts`). Запись fail-open: never-throws через `log.error`, отказ журнала никогда не блокирует доступ к данным.
- **Fail-fast zod-валидация production-env на boot (§R0.2).** На старте обоих процессов (`instrumentation.register()` для Node-рантайма и `main()` воркера) `src/lib/env.ts` zod-валидирует обязательные в прод-режиме переменные: `DATABASE_URL`, `APP_URL`, `JWT_SECRET` (≥32 символа и не placeholder), `HEALTH_TOKEN` (≥32), `REDIS_URL`, S3 endpoint/креды/бакет (с отклонением `minioadmin` и placeholder-значений), плюс условные требования (`ONE_C_ADAPTER=rest`, `EMAIL_ENABLED=true`, `INBOUND_EMAIL_ADAPTER=imap`, `FEATURE_TELEPHONY_MANGO`) и жёсткий стоп при `SHOW_DEMO_LOGINS` в проде. No-op вне `NODE_ENV=production` — dev/test продолжают работать с минимальным `.env`. Сообщение об ошибке перечисляет только ИМЕНА переменных, никогда значения.
- **Rate-limit входа и сброса пароля на общем Redis-лимитере (§R0.6).** `reset-password/request` не имел лимитера (email-бомбинг жертвы + спам token-строк) — теперь per-IP 20/час и per-email 5/час, применяется единообразно, чтобы 429 не раскрывал существование аккаунта. `reset-password/confirm` не имел лимитера (неограниченный перебор токена с `bcrypt.hash` на каждый запрос) — теперь per-IP 10/мин. ⚠️ Поведенческое изменение: `login` переведён с приватной in-process `Map` (per-instance, сбрасывалась на cold start) на `isRateLimited` из `@/lib/rateLimit` — Redis-shared между инстансами с graceful in-memory деградацией; env `LOGIN_RATE_LIMIT_*` сохранены.
- **Минимальный nonce-free CSP (§R0.6).** `next.config.ts` отдаёт Content-Security-Policy без nonce-конвейера: `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` — директивы, безопасные без nonce (закрывают встраивание в iframe, object/embed-инъекции, подмену `<base>`, увод form action на чужой origin). Полный `script-src` требует middleware-issued nonce под App Router и остаётся в бэклоге R2; защита от clickjacking продублирована через `X-Frame-Options`.
- **Staff-gate сервиса воронки продаж (§R0.7).** `moveFunnelLead` опирался на `canSeeLead`, который без `accessProfile` возвращает `true` на всю команду и не проверял роль — сессия partner/organization с заполненным `User.companyId` могла двигать карточки воронки, а `getFunnelBoard` листал все лиды. Обе точки входа теперь гейтят роль `admin|manager` на уровне сервиса (зеркало `tasks/staffGate`), возвращая `forbidden` / пустую доску. Инвариант закреплён интеграционным регрессом `services.funnel.isolation.test.ts` и внесён в `security.suite.manifest` (наряду с idor-calls, idor-inbox, tasks.isolation).
- **Демо-seed отказывается запускаться в production (§R0.3).** `prisma/seed.ts` создаёт `admin@demo.local` с публичным паролем; раньше единственной защитой был чекбокс в runbook. ⚠️ Поведенческое изменение: при `NODE_ENV=production` seed завершается с кодом 1, если явно не выставлен `SEED_ALLOW_PROD=1`. Gate/dev/CI не затронуты (там `NODE_ENV` не production).
- **Сырые ошибки S3-провайдера не утекают клиенту (R1.5).** `uploadLeadAttachment` / `getLeadAttachmentDownloadUrl` клали `e.message` от storage-провайдера в `LeadAttachmentError`, API-роут возвращал его в теле 500, а UI партнёра рендерил как есть. Теперь детали провайдера идут только в серверный лог (по эталону documents/upload), клиент получает статичное русское сообщение.
- **Хеширование reset/invite-токенов + короткий TTL reset-ссылок.** `PasswordResetToken.token` теперь хранит только `sha256(token)` вместо открытого значения — дамп БД или read-only-утечка таблицы больше не даёт рабочих ссылок сброса пароля (открытый токен живёт лишь в письме получателя). Reset-ссылки по умолчанию действуют 2 часа (`RESET_TOKEN_TTL_HOURS`), инвайты сохраняют 7 дней (`INVITE_TOKEN_TTL_DAYS`); явный аргумент `ttlDays` перекрывает дефолт. ⚠️ Поведенческое изменение: деплой инвалидирует все ранее выданные (открытые) токены — незакрытые инвайты нужно перевыпустить.
- **Constant-time сравнение секретов integration-вебхуков.** Вебхуки `telegram`/`whatsapp`/`max` сравнивали заголовки shared-secret обычным `!==` (уязвимо к timing-пробам). Все три теперь идут через общий `secretEquals()` (`src/lib/security/secretCompare.ts`: обе стороны хешируются в фиксированные 32 байта sha256, затем `timingSafeEqual` — не бросает на разной длине). Инлайн-хелпер health-роута дедуплицирован на тот же примитив; Mango уже сравнивал подпись constant-time через `telephony/mango/sign`.
- **Прекращена утечка внутренностей zod-схем (400-ответы + server-actions).** Пять partner-роутов возвращали клиенту `details: parsed.error.flatten()`, раскрывая внутренние имена полей и формулировки валидации; adversarial-ревью нашло ту же утечку в 19 return'ах по 10 файлам `server-actions` (их возвраты сериализуются в браузер). Поле `details` убрано из ответов и из локальных `Failure`-типов (`details?: unknown`) — повторное добавление станет видимым изменением типа. Стабильные коды (`'Invalid payload'`/`'validation'`) не тронуты (контракт §3).
- **C8-граница компании при назначении менеджер↔организация (#185).** Cross-company строки `OrganizationManager` создавались обычным admin-flow: `createAndAssignManager` находил организацию только по id и создавал назначение безусловно, а login собирал `managedOrgIds` без фильтра по компании — это корневая причина inbound-message bind IDOR, ранее закрытого защитно в `src/server-actions/inbound.ts`. Компания — жёсткая граница изоляции (§4/§5), поэтому floor введён и на write, и на read (defense-in-depth): `services/manager/invite.ts` требует `user.companyId === org.companyId` (новый стабильный код `company_mismatch`), а свежеприглашённый менеджер (`mode=new`) штампуется `companyId` организации — раньше рождался с `companyId=null` и был deny-all в C8. `api/auth/login` фильтрует `managedOrgIds` по `organization.companyId`; менеджер без компании резолвит ноль организаций без запроса (deny-null), так что легаси cross-company строка не расширит scope. RU-строка для `company_mismatch` в `errors/messages.ts`.
- **C8-граница компании в 1С-импорте платежей руководителя (#192).** `importScope()` относил руководителя (manager-leader) в тот же `{unscoped:true}` бакет, что и admin, давая ему admin-уровневый cross-company доступ к импорту платежей из карточки счёта 1С — вопреки инварианту C8 (cross-company только admin, Model A), при том что все leader-примитивы (`companyWideOrderFilter`, `isLeaderSameCompany`, `managerOrgScope`) привязаны к `session.companyId`. В мультикомпанийном деплое руководитель Компании-A мог инжектить `Payment` на организацию/заказ Компании-B через `.xlsx` с публичным ИНН/номером заказа B (order-level путь даже слал уведомления пользователям B), привязать queue-строку к чужому org id и перечислять организации (имена+ИНН) и заказы всех компаний через resolve-пикеры. Фикс: `ImportScope` переделан в 3-way discriminated union `global` (admin) | `company` (leader, свой `companyId`) | `orgs` (обычный менеджер), руководитель без `companyId` fail-safe деградирует до назначенных заказов; `orgInScope` принимает `{id, companyId}` и держит company-floor, `upsertPaymentRecord` селектит и проверяет `order.companyId`, `searchResolveOrgs`/`listResolveOrders` фильтруют по `companyId`. Тем же PR floor распространён на оставшиеся два из четырёх 1С-writer'ов: `upsertOrgRecord` (`mayCreateOrg` — минтить организацию+`Company` может только admin/воркер) и `upsertDocumentRecord` (floor по `order.companyId`); сейчас достижимы лишь из headless-воркера (`scope=undefined`→global), правка защитная на будущее scoped-wiring. Регресс `security.import-leader-scope`.
- **IDOR очереди импорта платежей (#169).** `dismissQueueRow`/`resolveQueueRow` грузили `PaymentImportRow` по сырому id без scope по компании — менеджер одной компании мог менять статус queue-строк чужой компании. Добавлен `rowInCompanyScope`, зеркалящий `batch.companyId`-scope из `listQueue`, с fail-safe deny на `companyId=null` (C8); admin остаётся unscoped (Model A). Найдено адверсариальной верификацией в stabilization-аудите 2026-06-29 — зелёные тестовые наборы этот баг не ловили.
- **Комиссия: изоляция доступа и сокрытие (Трек C, #172).** На уровне API/выборки закрыт cross-tenant доступ к комиссионным данным. C1: статический guardrail — точки входа кабинета организации (`app/organization/**`, `app/api/organization/**`) не ссылаются на комиссионные данные и не импортируют комиссионный сервис/компонент. C2: мультироль-пользователь в контексте «организация» (`session.role='organization'` при заданном `partnerId`) получает 403 на комиссионных эндпоинтах — гейт по активному `session.role`, а не по объединению ролей (`requirePartner` отвергает до взгляда на `partnerId`). C3: кросс-доступ по чужому id отклоняется на `Order`/`Document`/`Payment`/`CommissionStatement` — на read-пути и в мутирующем `approveStatement`, с позитивными контролями на каждый ресурс.
- **Аудит-фиксы: flag-гейты manager-API и валидация JWT (#161).** Whole-repo аудит-follow-up. 4 manager-API-роута (`certificates`, `documents/[id]/upload`, `orders/[id]/items`, `order-items/[id]`) закрыты `notFoundIfDisabled('manager_cabinet')` — middleware не покрывает `/api/*`, поэтому флаг обязан читаться в хендлере (sibling-роут leads уже делал так). Верифицированные JWT-payload'ы валидируются zod в `lib/auth/jwt.ts` вместо слепых `as unknown as`-кастов (student-bridge доклеивает стандартные claim'ы). В `api/comments` динамический `import('managerPolicy')` переведён в статический; ExcelJS Buffer-каст дедуплицирован в единый `loadXlsxWorkbook`; локальный `ERROR_MAP` из user-invite-form свёрнут в центральный `errorMessageRu` (+коды `duplicate_email`/`admin_role_via_ui`).

### Инфраструктура и качество

- **Readiness-проба включает S3 (R1.1).** `/api/health` теперь гейтит 503 не только по DB и Redis, но и по объектному хранилищу: `checkS3()` оборачивает `s3HealthPing()` (переиспользует storage-singleton) в тот же 2-секундный `withTimeout`, что и db/redis, а `S3Storage.ping()` делает реальный сетевой round-trip `ListObjectsV2 MaxKeys=1` (локальная подпись `createSignedUrl` ничего не доказывает) и попадает в `checks`. Скачивание документов — ключевой flow и триггер отката из launch-runbook, поэтому без S3 у readiness была слепая зона.
- **Честная worker-liveness и устойчивость воркера (R0.3/R1.1/R1.4).** В `docker-compose.prod.yml` добавлен one-shot сервис `migrate` (`prisma migrate deploy`), на завершение которого web/worker ждут через `service_completed_successfully` — ручной шаг миграции из runbook больше нельзя забыть; healthcheck воркера переключён с недостижимого `http://localhost:3000` (перманентный unhealthy) на свежесть (<3 мин) heartbeat-файла, который `startHeartbeat()` трогает каждые 60 с (`WORKER_HEARTBEAT_FILE`, т.к. `evaluateAlerts` крутится внутри самого воркера и liveness должен быть наблюдаем снаружи). Добавлены `worker.on('error')` по очередям + process-level `unhandledRejection` (log+Sentry, продолжаем работу) и `uncaughtException` (log+Sentry+flush, exit 1 под `restart:unless-stopped`), так что blip Redis между задачами больше не убивает процесс молча. `startScanBackfillSweep()` (ежечасно и на старте, только cron-роль `ENABLE_SYNC_CRON=1`) наконец вызывает давно существовавший, но не запускавшийся в prod `runBackfill` для документов, застрявших в `scanStatus=pending`.
- **Устранение полных сканов и N+1 на горячих путях (R1.2).** `unreadCount` в чате перестал гонять `findMany` по всем тредам в scope (у admin — по всей системе) с материализацией строк в node на каждый 15-секундный опрос `UnreadBadge`: счёт переехал в один raw-SQL `LEFT JOIN ThreadReadState` по уникальному ключу `(threadId, userId)` с `COALESCE(to_timestamp(0))` (замер на 20 000 тредов: 1084 → 83 мс, 13x). Дашборд руководителя больше не тянет per-org ledger — новый opt-in `includePayments` (по умолчанию true) выключает оконный `ROW_NUMBER`-запрос топ-50 платежей по каждой орг (~840 мс на рендер), при этом финансовые страницы manager/leader сохраняют полный ledger. Scope уведомлений менеджера свернул per-order OR-ветки с JSONB-фильтром (тысячи веток на строку) в один candidate-query `meta->>'orderId' IN (...)` с сохранением контракта топ-50 по `createdAt` (замер на масштабе §16 ТЗ: 26 494 → 8.6 мс).
- **Зачистка мёртвого кода.** Удалена очередь `emails.send`: она числилась в `QUEUE_NAMES`, но не имела ни продюсера, ни процессора (письма шлются инлайн через `src/lib/email/send.ts`), а её единственным следом была вечно пустая строка в admin queue stats/DLQ и мёртвая запись во входе alert-эвалюатора. Также удалена env-переменная `NEXT_PUBLIC_APP_URL` — её никто не читал (абсолютные URL строятся из серверного `APP_URL`), но прод-шаблон и runbook требовали держать её в синхроне.
- **CI на GitHub Actions — серверное зеркало лестницы хуков.** Добавлен единственный workflow `.github/workflows/ci.yml`: на каждый PR и push в `main` прогоняет `typecheck → lint (--max-warnings=0) → test:unit`, а затем тот же оркестратор `scripts/gate.ts` (`prisma migrate deploy → seed → test:integration`) против service-контейнера `postgres:16-alpine` и `prisma migrate status`. Флаг `GATE_SKIP_DOCKER=1` пропускает compose-up/readiness-wait, когда Postgres подан извне (локальный путь без изменений); `engines.node` зафиксирован на 24.x под `setup-node`. Серверный гейт, переживающий обход `--no-verify`; локальный Husky остаётся первой линией.
- **Программа 100%-покрытия завершена (Phases 1–3) — весь `src/**` под порогом.** `npm run test:coverage` держит per-glob порог 100% (lines/branches/functions/statements) на всех логических и UI-слоях. Фаза 1 — `src/lib/**`, `src/server-actions/**`, `src/app/api/**`, `src/worker/**`, `src/middleware.ts` (восстановлен дрейф гейта ~98%→100% после слияния омниканальных треков). Фаза 2 — `src/hooks/**` (`useFormAction`/`useClientResource`/`useThreadPolling` через jsdom + `renderHook`/`act`) и `src/lib/email/**/*.tsx` (`renderToStaticMarkup`). Фаза 3 — `src/components/**` (167 компонентов, гибрид `renderToString`/jsdom + `@testing-library`, mock `HTMLDialogElement.prototype.showModal`) и `src/app/**/*.tsx` (90 серверных `page.tsx` через helper `renderServerComponent`). Итог full-прогона: 6094 теста, statements/branches/functions/lines = 100%. Гейт остаётся L3/ручной (полный ран + живой PG), в pre-push не включён.
- **Полировка производительности и денежной арифметики (PR #190).** Устранены N+1: пакетная выборка per-org payment ledgers (N запросов → 1), финансовый обзор manager/leader (3N+1 → N+3), агрегаты в admin-списке партнёров и партнёрском портфеле. Денежная арифметика приведена к канону `Prisma.Decimal` во всех display-агрегатах и в partner dashboard KPI. Типизирована граница `renderStatementXlsx` (`Promise<any>` → `Promise<Buffer>`). Удалён мёртвый код, найденный `knip`.

## [0.9.0] — 2026-06-18

Первый оформленный релиз — **боевой запуск (pre-release)** всех шести кабинетов сразу.
Версия `0.9.x` сознательно держится до закрытия единственного внешнего блокера — живой
интеграции с 1С (см. раздел «Известные ограничения»). После перевода 1С в `live` и стабилизации
на проде планируется `v1.0.0`.

### Кабинеты (роли)

- **Партнёр** — заказы (видимы только через собственные лиды партнёра), лиды, документы
  (исходящие), финансы и комиссионные ведомости (PDF/XLSX), уведомления, заявки на обучение.
- **Организация** — заказы, документооборот с менеджером, финансовый хаб (KPI + реестр платежей),
  команда, под-роль `leader` (видит комиссию и управляет командой).
- **Менеджер** — заказы и их видимость с учётом режима команды (C8), общая очередь лидов,
  документооборот с организациями и партнёрами, финансы, комментарии к заказам, командный чат.
- **Руководитель (`/leader`)** — company-wide представление через `teamModeOverride`, хаб команды,
  комиссия.
- **Администратор** — зеркало `/admin/*` для управления всем (Model A), синхронизация 1С,
  пользователи, аудит, финансы.
- **Слушатель** — bridge-вход наружу (`/student`) с жёстким серверным гейтом на выпуск токена.

### Интеграция с 1С

- Подключаемый `OneCAdapter` с тремя реализациями: `Fake` (по умолчанию), `File` (Excel),
  `REST` (живая 1С).
- Контракт обмена решается на нашей стороне: пагинация по `{items, nextCursor}`, перевод
  справочников статусов в кабинете (`translate.ts`), `Partner.slug` как ключ партнёра.
- Excel-импорт платежей/заказов/организаций/документов: единый контракт и writer'ы
  (`upsert{Order,Payment,Org,Document}Record`), org-by-ИНН (attach-only), dedup по номеру документа.
- Режимы `shadow` → `live`; fetch-and-store документов 1С в Supabase Storage.
- Идентичность организации по dual-key `externalId ∨ ИНН`.

### Документооборот

- Двунаправленный, channel-isolated обмен документами (менеджер↔организация / менеджер↔партнёр)
  через first-class `counterparty` у `Document`.
- Общие («order-less») документы на уровне компании (`orderId` nullable + `companyId` XOR anchor).
- Скачивание только через signed URL (TTL 600 сек, 302-redirect); ClamAV-скан
  (`pending → clean | infected`, заражённые отдают 410 Gone); MIME allow-list + лимит 20 МБ.

### Финансы и комиссии

- Финансовый хаб организации (KPI + реестр платежей всех участников; блок посреднической
  комиссии — только admin/leader, с field-level гейтом).
- Финансы менеджера/админа (платежи по организациям + комиссия с гейтом по роли).
- Генерация комиссионных ведомостей в PDF и XLSX (BullMQ-воркер), ежемесячный расчёт по cron.
- Partial-unique индекс на активные ведомости (`WHERE supersededBy IS NULL`) против дублей;
  pre-deploy gate `npm run dedupe:commission`.
- Уведомление партнёра о готовности ведомости (in-app + email).

### Лиды и заявки на обучение

- Жизненный цикл лида: `assign / setStatus / promote / reject` (общая очередь команды);
  promote создаёт локальный заказ; видимость заказов партнёром только через
  `promotedFromLead.partnerId` (F2 — поведенческий флип).
- Заявки на обучение (`EnrollmentRequest`): подача 5 ролями → утверждение общей очередью →
  ручной провижн в LMS с отметкой `provisioned` + `externalStudentId`.

### Коммуникации и наблюдаемость

- Уведомления: in-app + email + Telegram; fan-out менеджерам/пользователям организации.
- Алертинг (cron-воркер): пороги по очередям/DLQ/лагу синхронизации с дедупликацией (edge + cooldown).
- Чат команды (флаг `chat`) + комментарии к заказам (ungated, до-`chat` фича).
- Health-пробы: `/api/health/live` (публичная liveness) и `/api/health` (token-gated readiness,
  проверка БД + Redis, fail-closed).

### Платформа и UI

- Система feature-флагов с тремя точками чтения (middleware → 404, навигация, route-handler).
- UI-примитивы (`ui/`: Button/Input/Select/Textarea/Badge/Spinner/Field), доступные модалки
  поверх нативного `<dialog>` (focus-trap, Escape, aria-live), оранжевая палитра бренда,
  словарь ошибок `errorMessageRu`, toast-обёртка.
- PWA-installer.
- Хуки форм `useFormAction` / `useFetchSubmit`, клиентский `useClientResource`.

### Безопасность

- RBAC defense-in-depth в трёх местах (middleware → route/server-action → service scope).
- C8: company-scoped изоляция (cross-company граница в обоих режимах видимости команды).
- Student bridge JWT с контрактными claims + rate-limit (Redis + in-memory degrade).
- Аудит-лог как единственный канал расследования; signed URL для файлов; ClamAV-скан.
- `JWT_SECRET` минимум 32 символа (иначе редирект на `/login`).

### Тесты и качество

- Четырёхслойная дисциплина тестов (L1 pre-commit → L2 pre-push unit → L2.5 gate на
  Docker-Postgres → L3 integration на живом Postgres). GitHub Actions намеренно отключены —
  гейтинг в Husky-хуках.
- Coverage-гейт фазы 1: per-glob 100% (lines/branches/functions/statements) на логических
  слоях (`src/lib/**/!(*.tsx)`, `src/server-actions/**`, `src/app/api/**`, `src/worker/**`,
  `src/middleware.ts`) — валидирован на живом Postgres.
- Playwright visual regression (три проекта по ролям).

### Документация

- Runbook прод-деплоя ([docs/runbook-launch-deploy.md](docs/runbook-launch-deploy.md)) и
  staged-rollout кабинетов ([docs/runbook-staged-rollout-cabinets.md](docs/runbook-staged-rollout-cabinets.md)).
- QA staging-smoke чек-листы (менеджер / организация).
- Контракт и повестка интеграции 1С, RLS Supabase Storage.
- Коммуникация партнёрам по флипу видимости F2
  ([docs/launch-comms-f2-partners.md](docs/launch-comms-f2-partners.md)).

### Известные ограничения

- **Живая 1С (T2 / A1)** — единственный жёсткий внешний блокер: REST-адаптер готов в коде, но
  требует доступов 1С и shadow-rehearsal перед `ONE_C_MODE=live`.
- Прод-деплой — операторские шаги по [docs/runbook-launch-deploy.md](docs/runbook-launch-deploy.md).
  **Footgun:** `npm run dedupe:commission --apply` обязателен **до** `prisma migrate deploy`
  (иначе partial-unique индекс не построится); `ONE_C_MODE` дефолтит в `live` — репетиция
  требует явный `ONE_C_MODE=shadow`.
- 100%-покрытие UI-слоёв (`components/**`, `app/**/*.tsx`) — фазы 2–3, ещё не под порогом.

[Unreleased]: https://github.com/aiprocadm/lk_otsfera/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/aiprocadm/lk_otsfera/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/aiprocadm/lk_otsfera/releases/tag/v0.9.0
