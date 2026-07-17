# M4 — Внутренний чат сотрудников — DONE

**Дата завершения:** 2026-07-17
**Branch:** `claude/m4-staff-chat`
**Base commit:** `2218414` (`main`, merge PR #205 — M3 leader analytics)
**Head commit (после Task 8):** см. «Коммиты серии» ниже (Task 8 коммитится сразу после этого файла)
**Spec:** [2026-07-17-m4-staff-chat-design.md](../specs/2026-07-17-m4-staff-chat-design.md)
**Plan:** [2026-07-17-m4-staff-chat.md](2026-07-17-m4-staff-chat.md)

## Что отгружено

### Task 1 — Схема + флаг `staff_chat`
- 5 моделей в [`prisma/schema.prisma`](../../../prisma/schema.prisma): `StaffConversation` (enum `kind: dm|general`, `dmKey String? @unique`), `StaffParticipant` (`@@unique([conversationId, userId])`), `StaffMessage`, `StaffMessageRead` (`@@unique([conversationId, userId])`), `StaffReaction` (`@@unique([messageId, userId, emoji])`) — отдельный домен от клиентского чата (`OrderThread`), не расширение существующих моделей (§4 sibling-rule).
- Партиальный unique-индекс `StaffConversation_one_general_per_company` (`WHERE "kind" = 'general'`) — «ровно один general на компанию», Prisma это не выражает нативно, добавлено вручную в сгенерированную миграцию (прецедент C-01).
- Флаг `staff_chat` в [`src/lib/featureFlags.ts`](../../../src/lib/featureFlags.ts) — поведенческий, opt-in (`OPT_IN_FLAGS`), точки чтения перечислены в комментарии рядом с флагом (секции «Чат команды» + все `/api/staff-chat/*` + бейдж непрочитанного).

### Task 2 — Policy + conversations-сервис
- [`src/lib/services/staffChat/policy.ts`](../../../src/lib/services/staffChat/policy.ts) — `isStaff` (admin|manager), `canSeeStaffConversation` (admin = Model A видит всё; dm = только участники; general = company-scoped через `NO_COMPANY_SENTINEL`).
- [`src/lib/services/staffChat/conversations.ts`](../../../src/lib/services/staffChat/conversations.ts) — `ensureGeneral` (ленивое создание + P2002-recovery на партиальном unique), `openDm` (dmKey-идемпотентность + P2002-recovery), `listConversations`, `staffUnreadCount`, `markStaffRead`, `dmKeyFor`.
- `conversationScopeWhere`: **general — company-scoped, dm — НЕ company-gated** (зеркалит `canSeeStaffConversation`: dm-ветка фильтруется только участием, без top-level `companyId`) — намеренная асимметрия, покрыта unit-регрессом «participant DM is not dropped by company mismatch».
- `openDm` hardening (коммит `1999a14`): companyless non-admin → deny-all (сентинел-философия «companyId=null режет в ноль, а не во всё»); companyId беседы у admin↔manager выводится из non-admin стороны.

### Task 3 — Сообщения, реакции, упоминания, уведомления
- [`src/lib/services/staffChat/messages.ts`](../../../src/lib/services/staffChat/messages.ts) — `sendStaffMessage` (forbidden/empty_body/too_large guards, IDOR-гард пути вложения, audit БЕЗ тела сообщения), `listStaffMessages`, `toggleReaction` (P2002-safe: конкурентный идентичный toggle не падает — реакция уже стоит).
- [`src/lib/services/staffChat/mentions.ts`](../../../src/lib/services/staffChat/mentions.ts) — `extractMentions` (жадный длинные-имена-первыми матч, регистронезависимо, дедуп), `listColleagues`.
- **First-unread правило**: ЛС-получатель уведомляется `staff_dm_message` только когда у него НЕТ уже непрочитанного сообщения в этой беседе (считается ДО вставки новой строки) — не «уведомление на каждое сообщение».
- **No-spam для упоминаний**: `body.includes('@')` — короткое замыкание до похода в БД за списком коллег (коммит `569bf94`), автора никогда не уведомляем о собственном упоминании.
- `AuditEntity` расширен `'staff_conversation'`.

### Task 4 — Вложения через AV-конвейер
- [`src/lib/services/staffChat/attachments.ts`](../../../src/lib/services/staffChat/attachments.ts) — `uploadStaffAttachment`/`getStaffAttachmentSignedUrl`, зеркало `chat/attachments.ts` (тот же MIME allow-list, `validateMagicBytes`, sanitize-функция), путь `staff-chat/<conversationId>/<uuid>-<safe>`.
- `ScanDocumentTarget` расширен `'staff_attachment'` ([`src/lib/jobs/types.ts`](../../../src/lib/jobs/types.ts)); ветки `loadTarget`/`persistResult` в [`src/worker/processors/scan-document.ts`](../../../src/worker/processors/scan-document.ts) (обновляет только `scanStatus` — у `StaffMessage` нет `scanReason`-колонки, зеркало `call_recording`); sweep в [`src/lib/services/scan/backfill.ts`](../../../src/lib/services/scan/backfill.ts).
- **Отличие от клиентского чата**: staff-вложения ИДУТ через AV-скан (клиентский чат скан отложил в v1.1 — M4 сознательно не наследует этот долг, спека §2.4).
- Path-prefix guard перед подписью URL (коммит `7a02afc`, sibling-parity с `chat/attachments.ts`): `attachmentPath` обязан начинаться с `staff-chat/` перед `createSignedUrl`.

### Task 5 — `/api/staff-chat/*`
- 8 route-файлов / **10 хендлеров**: `conversations`(GET), `messages`(GET+POST), `read`(POST), `reactions`(POST), `dm`(POST), `colleagues`(GET), `unread`(GET), `attachment`(GET+POST) — все в [`src/app/api/staff-chat/`](../../../src/app/api/staff-chat/).
- Единый порядок гейтов: `notFoundIfDisabled('staff_chat')` → `requireSession` → `requireRole(['admin','manager'])` → сервис → мапинг кодов (эталон `api/messages`).
- Мапинг: `forbidden→403`, `conversation_not_found/message_not_found/target_not_found→404`, `too_large→413`, `invalid_mime→415`, `empty_body/bad_request→400`, `not_ready→409`, `infected→410`, `storage→500/502`.

### Task 6 — UI
- 5 компонентов в [`src/components/staff-chat/`](../../../src/components/staff-chat/): `staff-unread-badge.tsx`, `staff-conversation-list.tsx`, `staff-thread-view.tsx`, `staff-composer.tsx`, `staff-chat-section.tsx`.
- Hook [`src/hooks/useStaffChatPolling.ts`](../../../src/hooks/useStaffChatPolling.ts) — сиблинг `useThreadPolling` (cursorRef/onNewRef, visibility-gate, 7с интервал); fix `64e9a50` — сбрасывает устаревшие batch'и при переключении беседы (stale-poll race).
- Секции «Чат команды» вшиты стековыми блоками (не табами) на [`src/app/manager/messages/page.tsx`](../../../src/app/manager/messages/page.tsx) и [`src/app/admin/messages/page.tsx`](../../../src/app/admin/messages/page.tsx), гейт `isFeatureEnabled('staff_chat')` независим от `chat`-секции той же страницы.

### Task 7 — @упоминания в заметках сделки (M1-долг)
- [`src/lib/services/manager/dealNotes.ts`](../../../src/lib/services/manager/dealNotes.ts) — `addDealNote` теперь уведомляет упомянутых staff (`deal_note_mention`), переиспользуя `extractMentions`/`listColleagues` из staff-chat домена. Закрывает явно отложенный пункт M1-close-out («`@упоминания` коллег в заметке → M4»).
- Best-effort (try/catch + `log.warn`, §3 degrade gracefully); admin-получатель — без `url` (у admin нет `/manager/orders/*`), in-app строка всё равно создаётся.

### Task 8 — Интеграционные регрессы + close-out (этот коммит)
Новый файл [`src/__tests__/services.staff-chat.isolation.integration.test.ts`](../../../src/__tests__/services.staff-chat.isolation.integration.test.ts) (7 тестов, живой Postgres, `new PrismaClient()` → авто-integration-режим):

1. **C8-изоляция general** — менеджер компании A видит в `listConversations` general своей компании и НЕ видит general компании B; `listStaffMessages` по чужому general-id → `forbidden`; admin видит **оба** general (Model A oversight).
2. **dmKey-гонка** — `Promise.all([openDm(m1→m2), openDm(m2→m1)])` реально конкурируют за партиальный unique: оба вызова `ok:true` с ОДНИМ и тем же `conversationId`; в БД ровно одна строка `StaffConversation` с этим `dmKey`.
3. **general-гонка** — для намеренно СВЕЖЕЙ компании (`companyRace`, без предварительного `ensureGeneral`) `Promise.all([ensureGeneral, ensureGeneral])` тоже конкурируют по-настоящему (не fast-path на уже существующей строке) → одна строка kind=`general`.
4. **Cross-company DM** — `openDm(m1 companyA → m9 companyB)` → `forbidden`.
5. **Клиентские роли** — partner/organization сессии: `listConversations` → `{ok:true, rows:[]}`; `sendStaffMessage` → `forbidden`, без похода в БД за реальным доступом.
6. **Reaction toggle** — реальный `@@unique([messageId,userId,emoji])`: два `toggleReaction(👍)` подряд → `reacted:true` затем `reacted:false`; после — 0 строк `StaffReaction` в БД.
7. **First-unread** — два сообщения подряд без `markStaffRead` между ними → ровно ОДНА `Notification` `type='staff_dm_message'`; после `markStaffRead` + новое сообщение → вторая (итого 2). Сценарий явно сбрасывает состояние (`notification.deleteMany` + `markStaffRead`) перед стартом, потому что предыдущий (reaction-toggle) сценарий уже отправил первое сообщение в тот же DM и тем самым создал свою собственную first-unread нотификацию — без сброса подсчёт был бы искажён общим состоянием беседы между тестами.

## Решения агента / отклонения от спеки (зафиксировать честно)

- **Размер вложения** — используется конфиг [`maxFileSizeBytes()`](../../../src/lib/config/upload.ts) (тот же источник, что у `chat`/`documents`), а НЕ литеральные «20 МБ» из текста спеки/плана — спека опиралась на устаревший захардкоженный факт; конфиг — единственный источник истины и уже параметризуется env.
- **`not_ready→409`** — HTTP-код сверх спеки для запроса подписанного URL на вложение, ещё не прошедшее скан (`pending`/`error`); спека явно не фиксировала этот код, добавлен по аналогии с остальным мапингом ошибок (пойман в Self-review плана, задокументирован там же).
- **UI — стековые секции, не табы** — «Чат команды» вшита как отдельный `<section>` под существующим содержимым `/manager/messages` и `/admin/messages`, сохраняя идиому страниц (мокап определял только содержимое секции, не общую раскладку).
- **`staffUnreadCount` на чистом Prisma, без raw-SQL зеркала** — в отличие от клиентского `chat/unreadCount` (который имеет raw-SQL путь под нагрузку), staff-объёмы малы; осознанный уход от scopeSql-ловушки клиентского чата (риск рассинхронизации Prisma-where и raw SQL при будущих правках policy).
- **`listConversations`: admin видит все general, но в списке только СВОИ dm** — oversight чужих ЛС административно всё ещё возможен по конкретному id через `canSeeStaffConversation`/`markStaffRead`/`listStaffMessages` (Model A, admin `canSee*` всегда `true`), но общий инбокс не засоряется чужими диалогами всех менеджеров компании.
- **Курсор поллинга — strict-gt по `createdAt` без вторичного id (зеркало клиентского чата)** — сообщения одной миллисекунды теоретически могут пропускаться поллером; спека упоминала `createdAt+id`, паритет с сиблингом (`useThreadPolling`/`api/messages`) выбран осознанно.
- **Бейдж непрочитанного живёт в заголовке страницы (как сиблинг `UnreadBadge`), а не в navigation** — nav-инфраструктуры бейджей в проекте нет; формулировка спеки «в навигации» реализована как page-heading badge.

## Известные хрупкости/edge-кейсы (не блокеры)

- **`extractMentions`** — матч по `@Имя` не проверяет левую границу перед `@`: строка вида `test@Имя.com` (email-подобный текст) может дать ложное срабатывание упоминания. Известно, отложено на полировку — риск низкий (сообщения команды, не произвольный внешний ввод).
- **Per-recipient notify-loop** (`sendStaffMessage`, mentions) — если создание уведомления для ПЕРВОГО получателя в цикле бросает, оставшиеся получатели в этом же вызове не будут уведомлены (весь блок обёрнут в один try/catch, ловящий на уровне всего цикла, а не по получателю). Это зеркалит уже существующий паттерн в остальном коде уведомлений репозитория — не новый риск, привнесённый M4.
- **Существование-oracle в порядке ошибок API-роутов** — там, где сервис возвращает и `not_found`, и `forbidden` в разных ветках одного эндпоинта (например `messages`/`reactions`), порядок проверок может дать наблюдателю сигнал о существовании ресурса до проверки доступа. Это соответствует уже принятой конвенции `api/messages` (клиентский чат) — не отдельная брешь M4, а унаследованное поведение sibling-домена.
- **Stale-poll race в КЛИЕНТСКОМ чате** (`useThreadPolling`, не `useStaffChatPolling`) остаётся непочиненной — M4 чинит её только в своём hook'е (`useStaffChatPolling`, коммит `64e9a50`). Отдельный тикет на клиентский чат создан отдельно от этой ветки (вне объёма M4).

## Сознательно отложено (follow-up)

- **Именованные каналы / группы >2 участников** — модель данных уже готова (`StaffParticipant` — M:N), но `openDm` создаёт ровно 2-участника dm; групповые беседы — будущая фича поверх той же схемы.
- **Realtime / SSE** — текущий механизм полностью на поллинге (7с интервал), как и клиентский чат; переход на push — отдельная инициатива, не специфичная для staff-чата.
- **Typing / presence-индикаторы** — не реализованы.
- **Поиск по сообщениям** — отложен до M6 (по дорожной карте CRM-паритета).
- **Edit / delete сообщений** — v1 staff-чата append-only, как и `DealNote` в M1.
- **Полный emoji-picker** — реакции ограничены фиксированным набором `STAFF_REACTION_EMOJI` (5 эмодзи), без свободного выбора.
- **Mobile push** — уведомления остаются in-app + существующие email/telegram/max/whatsapp каналы; отдельного push-канала нет.
- **Ретеншн / архивация старых бесед** — не реализована; вне объёма M4.

## Верификация — статус по гейтам

Выполнено в этой (Task 8) сессии:

| Гейт | Команда | Результат |
|---|---|---|
| Integration-тест Task 8 | `npx vitest run src/__tests__/services.staff-chat.isolation.integration.test.ts` | 1 файл, **7/7 passed** |
| M4 unit-регресс-набор (14 файлов) | `npx vitest run services.staff-chat.policy.unit.test.ts services.staff-chat.conversations.unit.test.ts services.staff-chat.messages.unit.test.ts services.staff-chat.mentions.unit.test.ts services.staff-chat.attachments.unit.test.ts api.staff-chat.routes.test.ts components.staff-chat.test.tsx hooks.useStaffChatPolling.test.ts pages.manager-messages.test.tsx pages.admin-messages.test.tsx services.deal-notes.unit.test.ts worker.scan-document.test.ts services.scan.backfill.test.ts featureFlags.test.ts` | 14 файлов, **327/327 passed** |
| `npm run typecheck` | — | чисто, 0 ошибок |
| `npm run lint` | — | `No ESLint warnings or errors` |

**Не запускалось в этой сессии (осознанно, per задание) — остаётся на контроллере при финализации ветки:**
- `npm run test:coverage` (полный unit+integration прогон с coverage-инструментацией, 100%-порог на затронутых glob'ах — требует отдельного продолжительного прогона против живого Postgres);
- `npm run build` (финальный pre-release чек);
- живой browser smoke (ручной проход `/manager/messages` и `/admin/messages` — секция «Чат команды», отправка сообщения, реакция, вложение, @-автокомплит, бейдж непрочитанного).

## Коммиты серии (main..HEAD на момент старта Task 8)

```
b510051 spec: M4 — внутренний чат сотрудников (ЛС + общий канал, упоминания, реакции, вложения)
7b403cf plan: M4 — внутренний чат сотрудников (8 задач, TDD)
759a4fd feat(m4): staff-chat schema (5 models, dmKey unique, partial general unique) + staff_chat flag
fe1ef55 feat(m4): staff-chat policy + conversations (ensureGeneral/openDm/list/unread/markRead)
1999a14 fix(m4): DM visibility not company-gated (scope helper) + openDm hardening + logged catches
5bcfa59 feat(m4): staff messages + reactions + mentions + no-spam notifications
569bf94 test(m4): mention+DM dedup guard; fix(m4): skip colleagues query without @, P2002-safe reaction toggle
f194aed feat(m4): staff attachments via AV pipeline (processor+backfill staff_attachment)
7a02afc fix(m4): staff attachment path prefix guard before signing (sibling parity)
1dc3b1b feat(m4): /api/staff-chat/* thin routes (staff-gated, flag-gated)
03da685 feat(m4): staff chat UI (list+thread+composer+reactions+badge) on messages pages
64e9a50 fix(m4): drop stale poll batches on conversation switch
0307b3f feat(m4): @mentions in deal notes notify staff (closes M1 deferral)
```

Task 8 коммитится поверх `0307b3f` как `test(m4): C8 isolation + dm/general races + first-unread integration; M4 close-out`.

---

**Следующий шаг:** контроллер прогоняет `npm run test:coverage` + `npm run build` + live browser smoke, затем решает про merge/PR (см. `superpowers:finishing-a-development-branch`).
