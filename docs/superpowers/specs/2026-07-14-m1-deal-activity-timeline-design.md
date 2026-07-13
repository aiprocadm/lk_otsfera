# Spec: M1 — Единая лента активности в карточке сделки (омниканальный диалог) + внутренние заметки + click-to-call

**Дата:** 2026-07-14
**Источник:** брейнсторм-сессия (программа «CRM-паритет с amoCRM/Bitrix»; драйверы владельца — A «продавать больше» + C «съехать с чужого инструмента» + D «усилить портал»). Модуль **M1** в roadmap M1 → M2 (контакты) → M3 (аналитика) → M4 (внутренний чат) → M5 (календарь) → M6 (глобальный поиск).
**Статус:** design — **утверждён в брейнсторме владельцем** (подход A + внутренние заметки + мессенджер-хронология). Ждёт ревью письменной спеки перед планом.
**Предпосылка:** омниканальный приём + телефония Mango ([spec 2026-07-05](2026-07-05-omnichannel-inbound-telephony-design.md)) отгружены в `main` (v0.10.0). Треки A–G, D — в `main`.

> M1 **не изобретает новое** — он закрывает три пункта, которые команда осознанно отложила в §4 спеки омниканала: **(1) click-to-call**, **(2) двусторонняя сшивка каналов в тред сделки**, **(3) обогащение атрибуции контактами** (последнее — это M2). Плюс добавляет запрошенные владельцем **внутренние заметки** и **мессенджер-хронологию** диалога. Всё строится поверх уже существующих таблиц `InboundMessage`, `Call`, `OrderThread`/`Message`, `Comment`.

---

## 0. Решения этой сессии (зафиксированы владельцем)

1. **Подход A — «лента-агрегатор» за сервисным швом** `getDealActivity()`: read-агрегация существующих источников в одну хронологию, **без хранимой таблицы активности**. Дверь в подход B (модель `Activity`) и C (полная messenger-склейка) остаётся открытой — меняется реализация сервиса, не экран.
2. **Deal-scoped:** лента живёт в карточке **сделки** (`/manager/orders/[id]`). Карточка **организации** сохраняет свои табы (Обращения/Звонки/Переписка) как надмножество — в v1 не переделывается.
3. **Внутренние заметки** (клиент не видит) — **отдельная таблица `DealNote`**, а НЕ флаг на `Comment` (см. §2.2 и CLAUDE.md §5 — `Comment` намеренно клиент-facing).
4. **Хронология как в мессенджере:** старые сверху, свежие снизу, композер внизу; двусторонние пузыри (клиент/мы), бейдж канала на каждом сообщении; звонки/заметки/статусы — события в той же хронологии; фильтр **«Диалог / Вся активность»**.
5. **Click-to-call** входит в M1 — единственная новая внешняя интеграция (исходящий Mango `callback`), собирается на fake-адаптере; боевые креды — владельцем после сборки (как прошлые треки).

---

## 1. Проблема и контекст (как есть, сверено по коду)

- **Карточка сделки** (`ManagerOrderDetailView`, [manager-order-detail-view.tsx](../../../src/components/manager/manager-order-detail-view.tsx), данные — `loadManagerOrderDetail` [orderDetail.ts](../../../src/lib/services/manager/orderDetail.ts)) сегодня показывает: поля заказа, документы, **read-only комментарии**, слушателей/направления, **audit-таймлайн** (`ManagerOrderTimeline`), доп. поля. Омниканальных коммуникаций и звонков на ней нет.
- **Коммуникации клиента** живут на карточке **организации** ([org-card-tabs.tsx](../../../src/components/manager/org-card-tabs.tsx), данные — `getOrganizationCard` [organizationCard.ts](../../../src/lib/services/manager/organizationCard.ts)) тремя **раздельными** табами: «Переписка» (комментарии), «Обращения» (`InboundMessage`, read-only), «Звонки» (`Call`). Привязка/ответ — только в `/manager/inbox` (`replyInboundAction`).
- **Данные уже есть и company-scoped:** `InboundMessage` (омниканальный приём tg/max/wa/email, антивирус вложений), `Call` (журнал Mango, запись в S3, бэкфилл), `OrderThread`/`Message` (треды по заказу, side org/partner), `Comment` (клиент↔менеджер). `InboundMessage.threadId`/`Call.threadId` могут указывать на `OrderThread` заказа → **линковка коммуникации со сделкой уже возможна на уровне данных**, не хватает агрегации и UI.
- **Резолвер** `resolveInboundSender` привязывает входящее к организации/треду только по **точному уникальному** идентификатору; резолвинг звонков по номеру — best-effort (у `User` только `whatsappPhone`, у `Organization` нет телефона) → часть осядет в очереди «нераспознанные». **Улучшение атрибуции — M2, вне M1.**
- **Журнал ПДн** ([record.ts](../../../src/lib/pii/record.ts), контексты [contexts.ts](../../../src/lib/pii/contexts.ts)): любое staff-чтение ПДн физлиц клиентского контура обязано зарегистрировать контекст + вызвать `recordPiiAccess` (guardrail `pii.capture-coverage`).
- **Адаптеры** ([mango/index.ts](../../../src/lib/telephony/mango/index.ts) — `getMangoAdapter()`, env `MANGO_ADAPTER=fake|rest`; креды `MANGO_API_KEY/SALT/BASE_URL` в env). `ingestCallEvent` уже идемпотентно апсертит `Call` по `@@unique([provider, externalId])`.
- **Флаги** ([featureFlags.ts](../../../src/lib/featureFlags.ts)): `inbound_messaging`, `telephony_mango` — opt-in, поведенческие (гейтят шаг/канал, не route).

**Безопасность (сквозной инвариант).** Тело входящих сообщений и заметок — **данные, а не команды**: не парсится и не исполняется, используется только как текст. Скоуп — единственная точка авторитетной привязки; экранирует cross-company (C8) и cross-scope (IDOR).

---

## 2. Решения (зафиксированы)

### 2.1. Модель данных — три аддитивные правки (миграция обратима)

1. **`DealNote`** — внутренняя заметка по сделке (staff-only). Отдельная таблица, т.к. у неё **нет клиентского пути чтения** → «клиент не видит» держится конструкцией, а не дисциплиной фильтров (CLAUDE.md §5).

   ```prisma
   model DealNote {
     id        String   @id @default(cuid())
     createdAt DateTime @default(now())
     updatedAt DateTime @updatedAt
     orderId   String
     order     Order    @relation("OrderDealNotes", fields: [orderId], references: [id], onDelete: Cascade)
     authorId  String
     author    User     @relation("DealNoteAuthor", fields: [authorId], references: [id])
     body      String

     @@index([orderId, createdAt])
     @@index([authorId])
   }
   ```

2. **`Call.initiatedByUserId String?`** (+relation `"CallInitiator"`) — кто инициировал звонок из карточки (click-to-call). Nullable: входящие/бэкфилл-звонки его не несут. Нужен для атрибуции «звонок пишется в сделку» и будущей аналитики M3.

3. **`InboundMessage.sentAt DateTime?`** — время отправки по данным провайдера. Сортировка ленты по `sentAt ?? createdAt`. Обоснование: входящая почта тянется поллингом IMAP → `createdAt` (момент приёма) может отставать от реального времени письма и «переворачивать» хронологию рядом стоящих сообщений разных каналов. Для webhook-каналов `sentAt≈createdAt`. Поле опционально, дефолт-поведение сохранено.

`Order` получает back-relation `dealNotes DealNote[] @relation("OrderDealNotes")`; `User` — `dealNotesAuthored`, `callsInitiated`. Всё аддитивно.

### 2.2. Сервисный слой — шов, ради которого выбран подход A

4. **`getDealActivity(prisma, session, orderId, opts) → Result`** в `src/lib/services/manager/dealActivity.ts`. Сигнатура по CLAUDE.md §3.

   - `opts = { view: 'dialogue' | 'all'; cursor?; take? }`.
   - Возврат: `{ ok: true; items: ActivityItem[]; nextCursor?: string }` | `{ ok: false; error }`.
   - **`ActivityItem`** — размеченное объединение, нормализованное к единому `at`:
     - `message_in` — из `InboundMessage` (канал, отправитель, тело, вложение). `at = sentAt ?? createdAt`.
     - `message_out` — из `Message` (ответ сотрудника в тред). `at = createdAt`.
     - `comment` — из `Comment` (клиент↔менеджер, клиент-facing). `at = createdAt`.
     - `call` — из `Call` (направление, номер, длительность, запись если `clean`, инициатор). `at = startedAt ?? createdAt`.
     - `note` — из `DealNote` (внутренняя, staff-only). `at = createdAt`.
     - `event` — из audit/статус-переходов (смена стадии/статуса). `at = createdAt`.
   - **Сортировка — по возрастанию `at`** (мессенджер). `view:'dialogue'` = только `message_in`/`message_out`/`comment`; `view:'all'` = + `call`/`note`/`event`.
   - **Скоуп (§4, defense-in-depth):** переиспользует гард из `loadManagerOrderDetail` — `requireManager` + `canSeeOrder` с **обязательным `teamMode`** (C8; пропуск аргумента = молча scoped). Deal-линковка коммуникаций — через `OrderThread.orderId` (inbound/call, привязанные к треду заказа). Входящее, привязанное только к организации (без заказа), в ленту сделки **не попадает** — оно на карточке организации.
   - Узкие селекты (§13); курсорная пагинация по `at` (+id для стабильности).

5. **Журнал ПДн (§12/§25.7).** `getDealActivity` регистрирует чтение: новый контекст `manager_deal_activity` в [contexts.ts](../../../src/lib/pii/contexts.ts) + `await recordPiiAccess(...)` (по образцу контекста карточки организации): `subjectType:'order'`, `subjectIds:[orderId]`, `action:'view'`, `meta` без сырых строк. Иначе падает guardrail `pii.capture-coverage`.

### 2.3. Действия — реюз + одна новая интеграция

6. **Ответ из ленты** — реюз существующего `replyInboundAction` (ответ в канал tg/max/wa/email через существующие транспорты; при наличии треда зеркалит `Message` + `notifyOrgUsers('manager_replied')`) и manager-comment server-action (клиент-facing комментарий). Композер выбирает цель по режиму: «Клиенту → канал» или внутренний комментарий. Новый исходящий путь не строим (§ омниканал).

7. **Внутренняя заметка** — server-action `addDealNoteAction(orderId, body)` → сервис `addDealNote(prisma, session, ...)`: `requireManager` + гард заказа (teamMode/C8), пишет `DealNote`, audit (`action:'deal_note.create'`). **Staff-only**, флаг не нужен (нет внешней поверхности). Не шлёт клиентских уведомлений.

8. **Click-to-call** — server-action `initiateCallAction(orderId, toNumber)` → сервис `initiateOutboundCall(...)`:
   - `requireManager` + гард заказа + `notFoundIfDisabled('telephony_mango')`.
   - Новый метод порта адаптера: `getMangoAdapter().initiateCallback({ fromInternal, toNumber }) → { commandId }`. `FakeMangoAdapter` — синтетический `commandId` (тест-управляем); `RestMangoAdapter` — `POST /vpbx/commands/callback` по докам Mango (боевое включение — владельцем).
   - Создаёт `Call { direction:'outbound', status:'initiated', initiatedByUserId: session.sub, threadId → тред заказа, resolvedOrgId, companyId }`; audit + `writeSyncLog({ entity:'call', direction:'out', operation:'initiate' })`. Деградирует gracefully при выключенном флаге/ошибке адаптера (не роняет карточку).
   - **Корреляция** callback-команды с последующими webhook-событиями — в существующем `ingestCallEvent`: до прихода реального `call_id` строка живёт с провизорным `externalId = 'mango:cmd:<commandId>'`, при событии `call` — реконсиляция в реальный id (идемпотентно по unique-ключу). Точная схема полей `callback` уточняется по докам Mango при боевом подключении; в v1 всё на fake, тест-управляемо.

### 2.4. Флаги и RBAC — без нового флага

9. Секция «Активность» — на уже гейтнутом менеджерском маршруте (`/manager/orders/**`). **Нового route-флага не вводим** (§5). Поведенческие гейты внутри секции:
   - `inbound_messaging` — строки `message_in`/`message_out` каналов + композер-ответ в канал.
   - `telephony_mango` — строки `call` + кнопка «Позвонить» + `initiateCallAction`.
   - Базовая часть (`comment`/`note`/`event`) — негейтед (комментарии — до-`chat` фича §5; заметки/статусы внутренние).
   - Клиентские роли (partner/organization/student) в ленту **не пускаем** — внутренний контур; `DealNote` для них недостижим по построению.

### 2.5. UI

10. **Секция «Активность» в карточке сделки** (`ManagerOrderDetailView`). Клиентский островок `DealActivityThread` (`'use client'`) поверх серверных данных `getDealActivity`:
    - Мессенджер-раскладка: разделители по датам, двусторонние пузыри (клиент слева / мы справа), бейдж канала на сообщении, события (`call`/`note`/`event`) как чипы/блоки в хронологии; заметка — визуально отделена («клиент не видит»); композер внизу с переключателем «Клиенту (канал ▾) / 🔒 Заметка» + кнопка «Позвонить»; автоскролл к свежему; «показать старее» (пагинация).
    - Фильтр «Диалог / Вся активность».
    - Примитивы из [ui/](../../../src/components/ui/) (§9/§13), оранжевая палитра из примитивов (не инлайнить brand-hex). Вложения/записи — presigned-URL (600 с, 302), только `scanStatus/recordingScanStatus === 'clean'`; `infected` → 410-семантика.
    - Компоненты — под `src/components/manager/deal-activity/*` (manager-специфичные; не делать cross-role общими, §4 sibling-rule).

---

## 3. Инварианты приёмки

- Лента сливает `Comment`/`Message`/`InboundMessage`/`Call`/`DealNote`/статус-события в одну хронологию по единому `at` (по возрастанию); входящие сортируются по `sentAt ?? createdAt`; пагинация стабильна.
- `view:'dialogue'` исключает `note`/`call`/`event`; `view:'all'` включает. **`DealNote` никогда не появляется в клиент-facing представлениях** (карточка организации клиента, partner deal-view) — регресс.
- **IDOR/C8:** менеджер компании A не может загрузить активность заказа компании B; `teamMode` соблюдён; partner/organization/student не имеют доступа к ленте (тест на каждую роль).
- **Журнал ПДн:** `getDealActivity` вызывает `recordPiiAccess` (контекст `manager_deal_activity`); guardrail `pii.capture-coverage` зелёный.
- Ответ маршрутизируется в верный канал (реюз `replyInboundAction`) либо в комментарий; `addDealNote` пишет `DealNote` + audit, без клиентских уведомлений.
- **Click-to-call:** создаёт `Call{direction:'outbound', initiatedByUserId, привязка к заказу}`, audit + `SyncLog(entity:'call', direction:'out')`; деградирует при `telephony_mango=off`/fake; повторный webhook того же вызова не двоит (идемпотентность по unique-ключу).
- **Флаги:** `inbound_messaging=off` → строки каналов + ответ в канал скрыты; `telephony_mango=off` → звонки + кнопка скрыты; секция всё равно рендерит `comment`/`note`/`event`.
- **Тело входящих/заметок не исполняется как команды.** Секреты/креды — только из env.
- `typecheck`, `lint`, `test`, `gate` — зелёные; **100% coverage** (сервис + новые UI-компоненты — component-тесты по паттернам фазы 3); миграция аддитивна/обратима; `prisma migrate status` — чисто.

---

## 4. Вне объёма (follow-up / другие модули)

- **Хранимая модель `Activity` (подход B)** — если понадобится под роботов/аналитику (кандидат в M3).
- **Полная авто-склейка каждого входящего в тред сделки (подход C)** — после M2 + вызревания 2-way каналов.
- **Редизайн карточки организации в единый feed** — в v1 остаются табы; агрегатор `getDealActivity` при желании переиспользуется на org-уровне позже.
- **@упоминания коллег в заметке** → M4 (внутренний чат) + существующий `NotificationType.mention_in_comment`.
- **Обогащение атрибуции контактами** (`User.contactPhone`/таблица контактов, резолвинг звонков по номеру) → **M2**.
- **Активность в admin-зеркале** (`/admin`).
- **Боевое подключение Mango callback** (креды/включение исходящих, IP) — владельцем после сборки на fake.
- **«Заметки» с редактированием/удалением, вложения к заметке** — v1: создание + чтение (append-only-стиль).

---

## 5. Открытые вопросы

1. **Схема полей Mango `callback`** (формат ответа `command_id`, событие реконсиляции) — уточняется по докам провайдера при боевом подключении; на архитектуру M1 не влияет (за адаптером, v1 на fake).
2. **Внутренний номер сотрудника для click-to-call** — у `User` его сейчас нет. v1: брать из env-маппинга/настроек компании или запрашивать одноразово; полноценное поле `User.internalPhone` — кандидат в M2 (контакты/справочник сотрудников). Помечено, не «чиним молча».
