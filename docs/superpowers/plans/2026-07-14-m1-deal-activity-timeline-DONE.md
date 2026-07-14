# M1 — Единая лента активности в карточке сделки — DONE

**Дата завершения:** 2026-07-14
**Branch:** `claude/m1-deal-activity-spec`
**Base commit:** `fb12cff` (`main`, merge PR #199 — release v0.10.0)
**Head commit (после Task 6):** см. «Коммиты серии» ниже (Task 6 коммитится сразу после этого файла)
**Spec:** [2026-07-14-m1-deal-activity-timeline-design.md](../specs/2026-07-14-m1-deal-activity-timeline-design.md)
**Plan:** [2026-07-14-m1-deal-activity-timeline.md](2026-07-14-m1-deal-activity-timeline.md)

## Что отгружено

### Task 1 — Схема
- `DealNote` (staff-only, отдельная таблица — «у заметки нет клиентского пути чтения» держится конструкцией, не флагом; см. модель-комментарий в `schema.prisma`), FK `orderId → Order` (`onDelete: Cascade`), `authorId → User`.
- `Call.initiatedByUserId` (nullable, `@relation("CallInitiator")`) — атрибуция исходящего звонка сотруднику.
- `InboundMessage.sentAt` — момент отправки клиентом (в отличие от `createdAt` = момент приёма нами); лента сортирует входящие по `sentAt ?? createdAt`.
- Индексы `Call.threadId` / `InboundMessage.threadId` под thread-scoped чтение ленты (были бы seq scan без них).
- Prisma client перегенерирован, `prisma migrate status` чист.

### Task 2 — `getDealActivity` + PII-контексты
- [`src/lib/services/manager/dealActivity.ts`](../../../src/lib/services/manager/dealActivity.ts) — агрегатор: `Comment` + `Message` (исходящие) + `InboundMessage` + `Call` + `DealNote` + status-change `AuditLog` события, слитые в единую хронологию по `at` (возрастание), `view: 'dialogue' | 'all'` (`dialogue` = только `message_in`/`message_out`/`comment`, т.е. `note`/`call`/`event` исключены).
- RBAC/C8 — переиспользован существующий гард `getOrder` (manager scope, `canSeeOrder`/`teamMode`/leader-same-company) — не «ещё один» скоуп-чек, а тот же самый, что и остальной manager-контур.
- Два новых PII-контекста в реестре ([`src/lib/pii/contexts.ts`](../../../src/lib/pii/contexts.ts)): `deal_activity_inbound` (`inbound_sender`/`list`) и `deal_activity_calls` (`caller`/`list`) — уточнение к спеке §2.2.5, где был ошибочно указан несуществующий `subjectType:'order'`; вместо этого зеркалим паттерн карточки организации (`org_card_inbound`/`org_card_calls`). Пишутся через `recordPiiAccessMany` одним round-trip, только когда `inbound.length`/`calls.length` > 0.

### Task 3 — Внутренние заметки
- [`src/lib/services/manager/dealNotes.ts`](../../../src/lib/services/manager/dealNotes.ts) — `addDealNote(prisma, session, { orderId, body })`: null-safe trim, `getOrder`-гард, `recordAudit('deal_note_created')`, без клиентских уведомлений (намеренно — заметка внутренняя).
- Server-action [`addDealNoteAction`](../../../src/server-actions/deal-activity.ts) — `requireManager()` перед вызовом сервиса (defense-in-depth §4: route/action-уровень поверх сервис-уровня).

### Task 4 — Click-to-call
- [`src/lib/services/telephony/initiateCall.ts`](../../../src/lib/services/telephony/initiateCall.ts) — `initiateOutboundCall`: вызывает Mango-адаптер `initiateCallback` (fake в dev/test), создаёт `Call{direction:'outbound', initiatedByUserId, threadId/companyId}`, audit + `SyncLog(entity:'call', direction:'out')`. P2002-safe (уникальный `externalId` от адаптера — коллизия маппится в `call_failed`, не 500); нестандартные (не-`Error`) реджекты адаптера/Prisma тоже покрыты (`String(err)`-ветка).
- Server-action `initiateCallAction` — гейт `telephony_mango` (`notFoundIfDisabled`, поведенческий флаг) + `requireManager()`.

### Task 5 — UI `DealActivityThread`
- [`src/components/manager/deal-activity/deal-activity-thread.tsx`](../../../src/components/manager/deal-activity/deal-activity-thread.tsx) — единая лента (feed) + композер заметки + click-to-call форма + переключатель «Диалог / Вся активность» (`view`).
- Вшито и в **manager**, и в **leader** карточку заказа: [`src/app/manager/orders/[id]/page.tsx`](../../../src/app/manager/orders/[id]/page.tsx), [`src/app/leader/orders/[id]/page.tsx`](../../../src/app/leader/orders/[id]/page.tsx) — обе читают `getDealActivity` напрямую (server component), поэтому C8/leader-same-company гард из Task 2 действует на обеих страницах без дублирования.
- Комментарии (`Comment`) объединены в общую ленту (не отдельная секция) — коммит `4413c21`; звонки в ленте скрыты за `telephony_mango`-флагом (секция всё равно рендерит `comment`/`note`/`event` при выключенном флаге, per спека §3).

### Task 6 — Финальные интеграционные регрессы (этот коммит)
Новый файл [`src/__tests__/services.deal-activity.idor.integration.test.ts`](../../../src/__tests__/services.deal-activity.idor.integration.test.ts) (6 тестов, живой Postgres, `new PrismaClient()` → авто-integration-режим):

1. **IDOR/C8** — менеджер компании A вызывает `getDealActivity` по заказу компании B → `{ ok: false, error: 'not_found' }` (переиспользованный гард `getOrder`/`canSeeOrder`).
2. **DealNote client-invisibility** — три угла:
   - владеющий менеджер видит `kind:'note'` с телом заметки в своей ленте (позитивный контроль — фильтр не вырожденный);
   - тело заметки отсутствует **в объекте, реально возвращаемом клиенту** — рантайм-проверка через `getOrgOrder` (organization-facing order-detail сервис) плюс `JSON.stringify(...)`-скан на отсутствие текста заметки (не просто «в типе нет поля», а «в фактической выдаче нет строки»);
   - структурная гарантия: ни один файл в `src/lib/services/organization/**` или `src/lib/services/partner/**` не содержит строки `dealnote`/`DealNote` (case-insensitive скан по исходникам). Партнёрский путь (`getPartnerDealDetail`) требует заказ, продвинутый из `Lead` — эта фикстура намеренно не такая, поэтому рантайм-проверка сделана только через `getOrgOrder`; структурный скан закрывает partner-ветку тем же инвариантом независимо от конкретного заказа.
3. **Dialogue filter** — заказ с заметкой + звонком (`Call`) + входящим сообщением (`InboundMessage`), оба привязаны к `OrderThread`: `view:'all'` содержит `note`/`call`/`message_in`; `view:'dialogue'` исключает `note`/`call`, но сохраняет `message_in` (входящее от клиента — часть диалога, не «служебное» событие).
4. **PII-журнал** — при флаге `pii_access_log=1` (тестовый env по умолчанию глушит флаг — включён явно в `beforeAll`, как в `pii.access-journal.integration.test.ts`) вызов `getDealActivity` на заказе с inbound+call пишет ровно две строки `PiiAccessEvent` (`deal_activity_inbound`, `deal_activity_calls`) с `subjectIds`, содержащими id входящего сообщения/звонка, для действующего пользователя.

Мёрджится в шаблон `security.idor-comments.integration.test.ts`: сиды через `prisma.*.create`, cleanup в `afterAll` в порядке, уважающем FK (`piiAccessEvent → auditLog → dealNote → inboundMessage/call → orderThread → order → organization → user → company`).

## Сознательно отложено (follow-up)

Из спеки §4 «Вне объёма» — без изменений, зафиксировано здесь для трассируемости:

- **Хранимая таблица `Activity`** (подход B, спека §2.2) — если понадобится под аналитику/роботов; кандидат M3.
- **Полная авто-склейка каждого входящего сообщения в тред сделки** (подход C) — после M2 и вызревания 2-way каналов; сейчас лента читает уже привязанные к `OrderThread` записи, авто-биндинг не расширялся.
- **Ответ во внешние каналы (WhatsApp/Telegram/…) из ленты сделки** — остаётся в `/manager/inbox` для v1; в композере ленты нет reply-в-канал, только заметка + звонок.
- **`@упоминания`** коллег в заметке → M4 (внутренний чат) + существующий `NotificationType.mention_in_comment`.
- **Атрибуция по контактам** (резолвинг звонков/сообщений по номеру телефона контакта, `User.contactPhone`/справочник) → M2 (спека §5.2). Сейчас `fromInternal` в click-to-call форме — жёстко захардкожен `''` в композере (см. [deal-activity-thread.tsx](../../../src/components/manager/deal-activity/deal-activity-thread.tsx)), поля ввода внутреннего номера сотрудника нет вообще (не placeholder — источника нет в v1); полноценное поле `User.internalPhone` — кандидат M2.
- **Клиентский номер для click-to-call** — источник тот же пробел (нет справочника контактов); v1 требует ручной ввод номера.
- **Admin-зеркало** (`/admin`) для ленты активности — не реализовано (Model A предполагает admin видит всё через `/admin/*`, но лента сделки туда не портирована в M1).
- **Боевое подключение Mango callback** (креды, включение исходящих, IP-whitelist) — `RestMangoAdapter.initiateCallback` остаётся стабом; переключение с fake на live — на владельце, вне объёма M1.
- **Редактирование/удаление заметки, вложения к заметке** — v1: только создание + чтение (append-only-стиль), как и было решено в спеке.
- **Курсорная пагинация / «показать старее»** (спека §2.2/§3) — не реализована в M1; объём активности одной сделки ограничен по природе, применён защитный cap `ACTIVITY_SOURCE_CAP=500` на источник (см. [dealActivity.ts](../../../src/lib/services/manager/dealActivity.ts)); полноценная курсорная пагинация — follow-up.
- **Реконсиляция click-to-call с webhook Mango** — спека §2.3.8 описывала это как уже покрытое существующим `ingestCallEvent`; фактически `ingestCallEvent` ключует по реальному `externalId` вебхука и НЕ связывает провизорную строку `mango:cmd:<commandId>` с приходящим событием звонка. При боевом подключении Mango это нужно реализовать (иначе исходящий звонок оставит осиротевшую `initiated`-строку + создаст вторую несвязанную `Call`). Follow-up к «Боевое подключение Mango callback».

## Верификация — статус по гейтам

Выполнено в этой (Task 6) сессии:

| Гейт | Команда | Результат |
|---|---|---|
| Integration-тест Task 6 | `npx vitest run src/__tests__/services.deal-activity.idor.integration.test.ts` | 1 файл, **6/6 passed** |
| Regression-набор M1 (unit+component) | `npx vitest run services.deal-activity.unit.test.ts services.deal-notes.unit.test.ts services.initiate-call.unit.test.ts server-actions.deal-activity.test.ts components.deal-activity-thread.test.tsx components.manager-order-detail-view.test.tsx pages.manager-orders-id.test.tsx pages.leader-orders-id.test.tsx pii.contexts.test.ts` | 9 файлов, **62/62 passed** |
| `npm run typecheck` | — | чисто, 0 ошибок |
| `npm run lint` | — | `No ESLint warnings or errors` |

**Не запускалось в этой сессии (осознанно, per задание) — остаётся на контроллере при финализации ветки:**
- `npm run test:coverage` (полный unit+integration прогон с coverage-инструментацией, 100%-порог на затронутых glob'ах — требует отдельного продолжительного прогона против живого Postgres);
- `npm run build` (финальный pre-release чек);
- живой browser visual pass (ручной smoke на `/manager/orders/[id]` и `/leader/orders/[id]` — лента, композер заметки, click-to-call, переключатель Диалог/Вся активность).

**Область IDOR-покрытия — уточнение.** Спека §3 упоминает «partner/organization/student не имеют доступа к ленте» как часть инварианта приёмки. `getDealActivity` вызывается только из `/manager/orders/[id]` и `/leader/orders/[id]` server components — обе страницы защищены существующим middleware `protectedPrefixes` (роль-барьер до захода в компонент) плюс `requireManager`/`requireManagerLeader`-семейство гардов на уровне страницы (CLAUDE.md §4, defense-in-depth). Эта часть инварианта — не новый код M1, а переиспользование общей RBAC-инфраструктуры, уже покрытой её собственными регрессами; Task 6 добавляет только специфичный для `getDealActivity` company-level IDOR (сценарий 1 выше), не дублируя существующие middleware/role-тесты.

## Коммиты серии (main..HEAD на момент старта Task 6)

```
6e0d82e spec: M1 — единая лента активности в карточке сделки (омниканальный диалог)
c5af64e plan: M1 — единая лента активности в карточке сделки (пошаговый план)
54973e0 feat(m1): schema — DealNote, Call.initiatedByUserId, InboundMessage.sentAt
806d07d perf(m1): index Call/InboundMessage.threadId for deal-activity reads
2f0acb7 feat(m1): getDealActivity aggregator + PII contexts
38a9307 test(m1): cover getDealActivity empty-thread + call-mapping branches
b3eff65 refactor(m1): message_out attachment flag + cover message_out/event branches
49b7213 feat(m1): internal deal notes (DealNote, staff-only)
13c83c0 fix(m1): null-safe body trim in addDealNote
cdaaed4 feat(m1): click-to-call (Mango initiateCallback + outbound Call) + server-action tests
8dad9e1 fix(m1): handle Call persist failure (P2002) + cover non-Error rejection + synclog externalId
a94be79 feat(m1): deal activity thread UI (feed + note composer + click-to-call)
4413c21 fix(m1): unify comments into activity feed, wire leader page, gate call rows by flag
```

Task 6 коммитится поверх `4413c21` как `test(m1): IDOR/C8 + client-invisibility + PII integration regressions; M1 close-out`.

---

**Следующий шаг:** контроллер прогоняет `npm run test:coverage` + `npm run build` + live browser visual pass, затем решает про merge/PR (см. `superpowers:finishing-a-development-branch`).
