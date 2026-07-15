# Backend-Frontend Parity — дизайн (2026-07-15)

## Цель

Аудит трёх независимых разведок (orphan-эндпоинты; CRM-срезы; Prisma/джобы) показал: значимый пласт бэкенда отгружен без UI-поверхности. Эта программа закрывает разрыв «бэкенд впереди фронта» одним PR на ветке `claude/backend-frontend-parity-c44a4e`: 8 треков (A–H), коммиты по трекам, без изменений схемы Prisma (миграций нет).

Решения владельца (2026-07-15):
- Объём — «всё»: продуктовые пробелы + админ-поверхности.
- **Push лида в 1С подключаем ручной кнопкой** — это пересматривает решение T3 (`2026-06-14-t3-leads-partner-manager-order-design.md` §«Вне scope»: «оставить как есть»). Процесс изменился; фиксация здесь — новый канон.

## Разведка — ключевые факты

- Orphan server-actions (ни одного UI-импорта): `claimOrderAction`, `assignOrderManagerLeaderAction` ([orderAssignment.ts](../../../src/server-actions/manager/orderAssignment.ts)), `transitionOrderLifecycleAction`, `setOrderAccountingSignedAction` ([orderLifecycle.ts](../../../src/server-actions/manager/orderLifecycle.ts)), `leaderAssignManagerAction` ([team.ts](../../../src/server-actions/manager/team.ts)).
- `GET+PATCH /api/notifications` ([route.ts](../../../src/app/api/notifications/route.ts)) — scoped API без единого UI-потребителя; unread-счётчика нет.
- `POST /api/auth/reset-password/request` — готов (анти-enumeration, rate-limit), но во фронте нет ни ссылки, ни формы; `/reset-password` без `?token` — тупик «Ссылка недействительна».
- Очередь `oneCSync.pushLead`: сервис+воркер+нотификация о неудаче готовы, **продюсера нет нигде в `src/`**.
- `assignLead` ([leadLifecycle.ts:59-79](../../../src/lib/services/manager/leadLifecycle.ts)) **не валидирует `assignToUserId`** — роут пробрасывает как есть.
- Инбокс: вложения хранятся и сканируются, download-роута нет; статус `archived` рендерится, но никто его не пишет; email-reply гарантированно падает (`email_unsupported`), а форма показывается.
- `FunnelStage.color`/`TaskColumn.color`: сервисы принимают и отдают, экшены читают `fd.color` — в диалогах нет поля, доски не рендерят.
- Без UI: `OneCPendingRecord` (прикладной 1С dead-letter, replay dead-записей не существует), `AlertState`, построчные ошибки `SyncLog`, `OrganizationCommissionRateChange` (партнёрская история — выводится, орг — нет). Run-now нет для 4 cron-джобов вне 1С-реестра.

## Трек A — Заказы: распределение + жизненный цикл

1. **«Взять в работу»** (manager): кнопка на деталке заказа, когда `order.managerId == null` → `claimOrderAction({orderId})`. Ошибки: `already_assigned` → «Заказ уже взят другим менеджером», остальное через `errorMessageRu`. Клиентский компонент `claim-order-button.tsx` (`src/components/manager/`), монтаж в `ManagerOrderDetailView` (виден и на leader-деталке — лидер тоже менеджер).
2. **«Назначить менеджера»** (leader): sibling-форма `leader-assign-order-manager-form.tsx` по образцу [admin/assign-order-manager-form.tsx](../../../src/components/admin/assign-order-manager-form.tsx), но через `assignOrderManagerLeaderAction` (C8 внутри экшена). Кандидаты: `listCompanyManagers(prisma, session.companyId)` c фильтром `isActive` на leader-странице `/leader/orders/[id]`; передаются props'ом. Опция «— Без менеджера —» = `managerUserId:null`. Монтаж только на leader-деталке (не в общем `ManagerOrderDetailView`).
3. **Секция «Жизненный цикл»** в правой колонке `ManagerOrderDetailView` (рядом с `ManagerStatusChangeForm`, который двигает *executionStatus* — не путать, подписать обе секции): текущий `Order.status`, кнопки переходов по `ALLOWED_TRANSITIONS` ([orderLifecycle.ts:22-27](../../../src/lib/services/manager/orderLifecycle.ts)); `waiting_client` → `Dialog` c textarea причины (`reason_required`); отказ `completed` → рендер `unmet: CompletionCondition[]` человекочитаемым списком (документы/бухгалтерия/удостоверения); показ `returnReason` при `waiting_client`. Галочка **«Бухгалтерия подписана»** → `setOrderAccountingSignedAction` (питает условие завершения). Данные: расширить select `loadManagerOrderDetail` полями `status`, `accountingSignedAt`, `returnReason`, `serviceType`, если их нет.
4. **Фильтр «Без менеджера»** в `/manager/orders` и `/leader/orders`: `listOrders` получает опцию `unassigned` (`managerId: null`), UI — пункт в существующем фильтр-баре.

## Трек B — Лиды: переназначение + push в 1С

1. **Ужесточение бэкенда (пререквизит UI):** `assignLead` при `assignToUserId && assignToUserId !== managerId` проверяет кандидата: существует, `role='manager'`, `isActive` → иначе новый код `invalid_manager` (расширение `LeadResult`; PATCH-роут мапит в 400). Лиды остаются shared-queue (owner decision 2026-06-14) — company-проверку кандидату не навязываем, но кандидат обязан быть менеджером.
2. **«Передать менеджеру»**: в блоке «Действия» карточки лида — `Select` кандидатов (`listCompanyManagers(session.companyId)`, `isActive`, серверная страница передаёт props) + кнопка; шлёт PATCH `{action:'assign', assignToUserId}` (роут уже принимает).
3. **«Вернуть в новые»**: кнопка при `status==='in_review'` → `{action:'setStatus', status:'new'}` (матрица уже разрешает).
4. **«Отправить в 1С»**: новый server-action `pushLeadToOneCAction({leadId})` (`src/server-actions/manager/leads.ts`, новый файл): `requireManager` → лид существует и `pushedToOneCAt == null` (иначе `already_pushed`) → `getQueue('oneCSync.pushLead').add('push', { leadId }, { jobId: 'push-lead:'+leadId })` → `{ok:true}`; сбой enqueue → `{ok:false, error:'queue_error'}` (graceful, Redis может быть недоступен). Идемпотентность тройная: jobId + guard `pushedToOneCAt` в экшене + атомарный claim в сервисе. UI: кнопка в блоке «Действия» + строка «1С» в `<dl>` карточки: «не отправлялся» | «отправлено {дата}, №{externalIdInOneC}» (после enqueue до обработки — «в очереди» не показываем, просто дата появится после успеха воркера; `router.refresh()` по тосту). Кнопка скрыта при `pushedToOneCAt`.

## Трек C — Центр уведомлений (5 кабинетов)

1. **Рефакторинг**: `buildScopeWhere` выносится из [route.ts](../../../src/app/api/notifications/route.ts) в сервис `src/lib/services/notifications/scope.ts`; оба роута импортируют оттуда (роуты остаются тонкими).
2. **Новый роут** `GET /api/notifications/unread` → `{count}` = `notification.count({where: AND[scope, {isRead:false}]})` (индекс `[userId,isRead]` уже есть). Без флага (как и существующий роут).
3. **`NotificationBell`** (`src/components/notifications/notification-bell.tsx`, `'use client'`) — строго презентационный и domain-agnostic (данные приходят из role-scoped API), поэтому общий компонент допустим (§4-исключение). Бейдж: `useClientResource('/api/notifications/unread', {intervalMs: 30_000})`, оранжевый пилл по образцу [unread-badge.tsx](../../../src/components/chat/unread-badge.tsx). Кнопка 🔔 → попап-панель (не модалка: `aria-expanded` + `aria-haspopup`, Escape и клик-вне закрывают; `Dialog`-примитив не используется — это dropdown, не dialog; `role="dialog"` не хардкодим).
4. **Панель**: `useClientResource('/api/notifications', {enabled: open})` — последние 50; непрочитанные выделены; клик по строке → `PATCH {id}` + переход по href; «Прочитать все» → `PATCH {ids: unreadIds}` (≤50 → один батч); после мутаций `refetch` обоих ресурсов.
5. **href-резолвер** (чистая функция + unit-тест): `meta.url` (org/partner пишут его) → иначе по `type`+`role`: manager-типы c `meta.orderId` → `/{manager}/orders/{id}`, `ops_alert` (admin) → `/admin/health`; нет маппинга (`certificate_expiring`, `sync_error` без url) → некликабельная строка.
6. **Монтаж**: хедеры всех 5 шеллов рядом с `LogoutButton`: [app-shell.tsx](../../../src/components/dashboard/app-shell.tsx) (partner, тёмный хедер — светлый вариант иконки), `manager-app-shell.tsx`, `leader-app-shell.tsx`, `org-app-shell.tsx`, `admin-app-shell.tsx`.

## Трек D — «Забыли пароль»

1. `/reset-password` без `?token` → вместо тупика рендерится `ForgotPasswordForm` (`src/components/auth/forgot-password-form.tsx`, `'use client'`, по образцу `reset-password-form.tsx`): email-input → `POST /api/auth/reset-password/request` → **всегда** success-текст «Если такой email зарегистрирован, мы отправили письмо со ссылкой» (анти-enumeration уже в бэкенде); 429 → «Слишком много запросов, попробуйте позже».
2. `LoginForm`: ссылка «Забыли пароль?» на шаге credentials (рядом с полем пароля) → `/reset-password`.

## Трек E — Инбокс, звонки, лента M1

1. **Download вложений**: `GET /api/manager/inbox/[id]/attachment` — скелет с [recording-роута](../../../src/app/api/manager/calls/[id]/recording/route.ts): `notFoundIfDisabled('inbound_messaging')` → `requireManager` → узкий select → scope зеркалит `listInbox` (`companyId === session.companyId` ИЛИ `status='unresolved'`) → нет `attachmentPath` → 404; `infected` → **410**; не-`clean` → 404 → presigned 600с, `download: attachmentName`, 302. Если recording-роут пишет `recordPiiAccess` — зеркалим контекст (`inbox_attachment_download`); иначе сверяемся с guardrail `pii.capture-coverage`. UI: в [inbox-list.tsx](../../../src/components/manager/inbox-list.tsx) имя вложения становится ссылкой при `scanStatus==='clean'`.
2. **Архивация**: в [server-actions/inbound.ts](../../../src/server-actions/inbound.ts) два экшена: `archiveInboundMessageAction({inboundMessageId})` → `status:'archived'`; `restoreInboundMessageAction` → `status: boundAt ? 'bound' : 'unresolved'`. Scope как у listInbox (своя компания или unresolved). Audit `inbound_message_archived`/`inbound_message_restored`. UI: кнопка «В архив» на unresolved/bound строках, «Вернуть» на archived (вместо «—»).
3. **Email-ответ**: в bound-строке при `channel==='email'` вместо `InboxReplyForm` — подсказка «Ответ по email пока недоступен — ответьте из почтового клиента». `ERROR_LABEL` reply-формы дополняется `email_unsupported`/`reply_failed`/`invalid` (на случай гонок).
4. **Фильтр звонков по организации**: `CallsFiltersBar` получает `orgs: ManagerOrgListRow[]` + текущий `orgId`; направление остаётся ссылками (сохраняют `orgId`), организация — маленький клиентский `Select` с `router.push` (сохраняет `direction`). Страница уже читает `sp.orgId` и умеет `listCalls({orgId})`; добавить `listOrganizations` в загрузку.
5. **Композер ленты M1 (по спеке M1 §2.3.6)**: `DealActivityThread` получает режим-переключатель: **«Заметка (внутр.)»** (текущее поведение, default) | **«Комментарий клиенту»** — `POST /api/comments {orderId, body}` через `useFetchSubmit` (manager-ветка роута готова и не используется из UI; подпись «увидит клиент»; `notifyOrgUsers('manager_replied')` уже внутри роута) | **«Ответ в канал ({channel})»** — виден при `inboundEnabled` и наличии `message_in` в items; шлёт `replyInboundAction({inboundMessageId: <id последнего message_in>, text})`. Канал/`id` берём из последнего элемента `kind==='message_in'` (это и есть `InboundMessage.id` — [dealActivity.ts:61,91](../../../src/lib/services/manager/dealActivity.ts)). Комментарий-отсрочка в `deal-activity-thread.tsx:14-16` удаляется.
6. **Мелочи**: `activity-item.tsx` case `'call'` рендерит `item.initiator` (пилл после направления); форма click-to-call получает опциональное поле «Внутренний номер» → `fromInternal` (сейчас захардкожен `''`).

## Трек F — Цвета стадий/колонок

1. `StageDialog`/`ColumnDialog`: группа пресет-свотчей `name="color"` (8 цветов + «без цвета» `''`); экшены уже читают `fd.color`.
2. Ужесточить zod в [funnelStages.ts:21](../../../src/lib/services/access/funnelStages.ts) и `tasks/columns.ts:22`: `color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish()` (сейчас любая строка ≤20; существующие данные не мигрируем — рендер терпим к любой строке).
3. Доски (`funnel-board.tsx`, `task-board.tsx`): цветная полоска сверху колонки `style={{background: color}}` при наличии (data-driven цвет — не инлайн brand-hex, правило §13 не нарушается).

## Трек G — Админ-поверхности

1. **Сервисы** (все admin-only, Result-контракт):
   - `src/lib/services/admin/pendingRecords.ts`: `listPendingRecords` → до 100 строк `{id, entity, externalId, reason, attempts, status, firstSeenAt, lastTriedAt}` (dead первыми) — **без `dto`** (там сырые ПДн из 1С; не показываем — и потому `recordPiiAccess` не требуется); `requeueDeadRecord(id)`: `dead→pending`, `attempts:0`, audit `one_c_pending_requeued` (подберёт ближайший replay при live-sync).
   - `src/lib/services/admin/alerts.ts`: `listAlertStates` → все строки, `firing` первыми, потом по `updatedAt desc`, до 100.
   - `listSyncErrors` (в [syncSummary.ts](../../../src/lib/services/syncSummary.ts) или рядом): последние 50 `SyncLog` c `status='error'`: `{entity, externalId, direction, operation, errorMessage, durationMs, createdAt}` — **без `payload`** (ПДн).
   - `src/lib/services/commission/rateHistory.ts`: `listOrgRateHistory(prisma, session, organizationId)` — близнец `listRateHistory`; `newRate:null` → отображение «сброс (ставка партнёра)».
2. **Run-now**: реестр [`SYNC_ENTITIES`](../../../src/lib/services/admin/syncControl.ts) расширяется 4 записями: `certificateExpiry`→`notifications.certificateExpiry`, `emailPoll`→`inbound.email.poll`, `mangoBackfill`→`telephony.mango.backfill`, `monthlyCommissions`→`docs.calculateMonthlyCommissions` (`hasCursor:false`). Пауза для них — вне объёма (реестр `setSchedulePaused` не трогаем). Проверить, что процессоры терпят manual-payload `{triggeredAt, reason:'manual'}` (обычно игнорируют payload; иначе — адаптировать enqueue per-entity).
3. **UI**:
   - `/admin/sync`: секция «Прочие фоновые задачи» (таблица: задача, cron, `SyncTriggerButton`) + секция «Отложенные записи 1С» (таблица pending/dead; requeue-кнопка — клиентский компонент по образцу `SyncTriggerButton`).
   - `/admin/health`: секция «Алерты» (severity-бейджи; firing выделены) + секция «Ошибки синхронизации (последние 50)».
   - `/admin/organizations/[id]`: под `AdminRateOverrideForm` — инлайн-таблица «История ставок» по образцу [admin/partners/[id]/page.tsx:36-62](../../../src/app/admin/partners/[id]/page.tsx).

## Трек H — Гигиена

- Комментарии флагов `inbound_messaging`/`telephony_mango` в [featureFlags.ts:39-42](../../../src/lib/featureFlags.ts): «(экран придёт отдельной задачей)» → актуальное «Гейтит /manager/inbox|/manager/calls (экран построен)».

## Сквозные требования

- Направление зависимостей §2; сервисы — Result-контракт §3, роуты/экшены только мапят коды; строки ошибок — `errorMessageRu`; фидбек — `toast`/aria-live; примитивы `ui/` без инлайн brand-hex; sibling-pattern §4 (leader-форма назначения — отдельный компонент; bell — узаконенное презентационное исключение).
- RBAC/C8 не ослабляются ни в одной точке; новые экшены — `requireManager`/`requireManagerLeader`/`requireAdmin` + сервисные scope-проверки.
- Graceful degradation: enqueue-сбои (push в 1С, run-now) не роняют страницу — стабильный код ошибки в тост.
- Миграций Prisma нет; `prisma migrate status` остаётся чистым.

## Тестовая стратегия

- Новые/изменённые сервисы — integration (живой Postgres): pendingRecords (requeue dead→pending), alerts, syncErrors (payload не отдаётся), listOrgRateHistory (nullable newRate), assignLead-валидация (`invalid_manager`), archive/restore (scope: чужая компания — deny; unresolved — allow), listOrders `unassigned`.
- Роуты — unit по эталону `api.manager.documents.upload.test.ts` (vi.hoisted-моки): notifications/unread (scope per role), inbox attachment (404/410/302, чужая компания), push-lead action (already_pushed, queue_error при падении enqueue, jobId).
- Компоненты — jsdom + `@testing-library`: bell (поллинг-хук мокается, mark-read, «прочитать все», href-резолвер), lifecycle-секция (reason-диалог, unmet-список), claim-кнопка, leader-assign-форма, композер M1 (3 режима, видимость канального режима), формы forgot-password, свотчи цвета, фильтр организации в звонках, requeue/run-now кнопки.
- Страницы — `renderServerComponent` для изменённых `page.tsx`.
- Итог перед PR: `typecheck` → `lint` → `npm run test:coverage` (100% на весь denominator) → `gate`.

## Вне объёма

- Удаление мёртвых `*FormAction`-обёрток и модели `SavedView` — отдельная задача-гигиена (не фронт).
- M2-контакты, авто-распределение (round-robin) — нет бэкенда, треки программы CRM-parity.
- Пауза расписаний для новых run-now сущностей; email-send для reply (v1.1 омниканала); `assignTaskAction` (дублирует `updateTask` — UI не строим).
- Пагинация/веха «отметить все» сверх 50 в bell-панели (текущий API отдаёт 50 — достаточно v1).

## Приёмка

- Все 6 orphan-экшенов из разведки либо получили UI-триггер, либо явно записаны «вне объёма» (только `assignTaskAction`).
- `oneCSync.pushLead` имеет продюсер; кнопка идемпотентна; статус виден в карточке лида.
- Колокольчик виден во всех 5 кабинетах; счётчик соответствует scope роли; mark-read работает.
- «Забыли пароль» проходит end-to-end на dev (запрос → письмо в лог/локальный SMTP → сброс).
- Вложение инбокса скачивается при `clean`, 410 при `infected`; email-строки не показывают форму ответа; архив/восстановление работают.
- Композер M1: три режима, комментарий доходит до клиента (`notifyOrgUsers`), ответ в канал — до транспорта.
- Админ видит pending/dead 1С-записи и может вернуть dead в очередь; алерты и ошибки синка читаемы; 4 джобы запускаются вручную.
- `typecheck`/`lint`/`test:coverage`/`gate` — зелёные; 100% coverage сохранён.
