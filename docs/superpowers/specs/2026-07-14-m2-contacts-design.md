# Spec: M2 — Контакты (первоклассная сущность `Contact` + каналы связи, атрибуция, триаж, директория)

**Дата:** 2026-07-14
**Источник:** брейнсторм-сессия (программа «CRM-паритет с amoCRM/Bitrix»; драйверы владельца — A «продавать больше» + C «съехать с чужого инструмента» + D «усилить портал»). Модуль **M2** в roadmap M1 (лента активности) → **M2 (контакты)** → M3 (аналитика) → M4 (внутренний чат) → M5 (календарь) → M6 (глобальный поиск).
**Статус:** design — **утверждён в брейнсторме владельцем** (первоклассная `Contact`+каналы, объём Package A, org опционален, ручное создание из неопознанных). Ждёт ревью письменной спеки перед планом.
**Предпосылка:** M2 стоит **стеком поверх M1** ([spec 2026-07-14 M1](2026-07-14-m1-deal-activity-timeline-design.md)) — реюзит click-to-call, ленту сделки `getDealActivity`, и **закрывает открытый вопрос M1 #2** (`User.internalPhone` вместо env-маппинга для исходящего звонка). Омниканальный приём + телефония Mango ([spec 2026-07-05](2026-07-05-omnichannel-inbound-telephony-design.md)) — в `main` (v0.10.0).

> M2 **не изобретает новую поверхность коммуникаций** — он даёт коммуникациям недостающий **субъект**: человека, с которым мы говорим. Сегодня «человек» размазан между `User` (у кого есть логин), free-text полями `Lead` и разрозненными телефонными колонками. M2 делает контакт первоклассной сущностью, к которой резолвятся входящие и звонки, и вокруг которой собираются директория, карточка контакта, блок на сделке и вкладка «Люди» на орг-карточке.

---

## 0. Решения этой сессии (зафиксированы владельцем)

1. **Первоклассная модель `Contact` + `ContactChannel`**, `Contact` **опционально** связан с порталь­ным `User` (`userId?`). Контакт ≠ пользователь: человек, которому мы звоним, может не иметь логина. Это amoCRM/Bitrix-модель.
2. **Объём v1 = Package A** (связный модуль): rewire атрибуции на каналы, **триаж неопознанных звонков** (сейчас его нет), директория «Контакты», вкладка «Люди» на орг-карточке, блок контакта на карточке сделки, `User.internalPhone`. Отложены: merge/dedup, CSV-импорт, multi-org, admin-зеркало.
3. **`Contact.organizationId` опционален.** Граница изоляции — **`companyId` (C8)** всегда; org — уточнение. Org-less контакты видны **company-wide** как триаж-очередь; после привязки к орг — обычный org-scope.
4. **Ручное создание** контактов из неопознанных коммуникаций (без авто-черновиков) — директория чистая, номер уже хранится на `Call`/`InboundMessage`.
5. **Бэкфилл** контактов из `User` роли `organization` + `Lead.clientContact*` (дедуп по каналам).
6. **Единый нормализатор телефонов** — объединяем три расходящихся (`inbound/resolve.ts`, `telephony/resolveCaller.ts`, `notifications/preferences.ts`), чиним латентный баг атрибуции (`8…`→`+8…` vs `+7…`).
7. **Промоушен лида Lead→Order** авто-проставляет `order.primaryContact` из контакта лида.

---

## 1. Проблема и контекст (как есть, сверено по коду)

- **Нет первоклассной сущности «контакт».** Люди клиентского контура — это `User` роли `organization` ([schema.prisma:136-198](../../../prisma/schema.prisma)), присоединённые к орг через `OrganizationUser` ([schema.prisma:543-558](../../../prisma/schema.prisma)); у `Lead` контакт — **free-text** `clientContactName/Phone/Email` ([schema.prisma:217-253](../../../prisma/schema.prisma)); у `Student` — свой контур (учащиеся, не `User`). У **`Organization` нет ни телефона, ни email, ни поля контактного лица** ([schema.prisma:503-541](../../../prisma/schema.prisma)) — только `name/inn/kpp/externalId`.
- **Единственный телефон человека — `User.whatsappPhone`** (`@unique`, [schema.prisma:190](../../../prisma/schema.prisma)); общего `phone`/`internalPhone` нет; `name` — одно поле (без имя/фамилия). `whatsappPhone` при этом используется для **адресации исходящих** в WhatsApp-агрегаторе — значит поле не «свободно», каналы аддитивны к нему.
- **Атрибуция — exact-match, best-effort, и молча роняет в unresolved на неоднозначности:**
  - `resolveInboundSender` ([inbound/resolve.ts:26-43](../../../src/lib/services/inbound/resolve.ts)) матчит `User` по `telegramChatId`/`maxChatId`/`whatsappPhone`/`email` (exactly-one), орг/компания — транзитивно из `User.organization`.
  - `resolveCaller` ([telephony/resolveCaller.ts:19-45](../../../src/lib/services/telephony/resolveCaller.ts)) матчит номер звонка по `User.whatsappPhone`, затем fallback на `Lead.clientContactPhone` (только `orgId`, без `userId`). Звонок **никогда не может привязаться к орг напрямую** — у орг нет телефона.
  - **Три расходящихся нормализатора телефонов:** `normalizePhone` ([inbound/resolve.ts:21](../../../src/lib/services/inbound/resolve.ts), стрип+`+`, без валидации), `canonicalizeRuPhone` ([telephony/resolveCaller.ts:8](../../../src/lib/services/telephony/resolveCaller.ts), RU `8`→`+7`), `normalizePhone` ([notifications/preferences.ts:103](../../../src/lib/services/notifications/preferences.ts), `string|null`). Из-за расхождения whatsapp-номер `+8…` и канонизированный звонок `+7…` **не матчатся** — латентный баг.
- **Неопознанные входящие** попадают в **общую cross-company триаж-очередь** ([inbound/listInbox.ts:66-68](../../../src/lib/services/inbound/listInbox.ts)) и имеют **UI ручной привязки** (`/manager/inbox` → `InboxBindForm` → `bindInboundMessageAction` [inbound.ts:31-106](../../../src/server-actions/inbound.ts)), но форма требует **вручную ввести ID заказа** (без пикера).
- **Неопознанные звонки — мёртвые записи.** `/manager/calls` ([calls-list.tsx](../../../src/components/manager/calls-list.tsx)) **строго read-only** — **нет** bind-формы и нет `bindCallAction`. Звонок с `resolvedOrgId=null` не виден ни на одной орг-карточке ([organizationCard.ts:140](../../../src/lib/services/manager/organizationCard.ts) фильтрует по `resolvedOrgId`) и **не может быть привязан пост-фактум**.
- **Резолверы не доходят до сделки.** `ResolveResult` объявляет `orderId/threadId` ([resolve.ts:10](../../../src/lib/services/inbound/resolve.ts)), но функция их **никогда не ставит** — линковка со сделкой (`OrderThread.orderId` через `InboundMessage.threadId`/`Call.threadId`) всегда ручная и только для входящих.
- **Орг-карточка** ([org-card-tabs.tsx:14-33](../../../src/components/manager/org-card-tabs.tsx)) имеет 8 вкладок (История/Заявки/Документы/Оплаты/Переписка/Обращения/Звонки/Реквизиты), но **нет вкладки «люди»** — только счётчики `Пользователи`/`Сотрудники`. **Карточка сделки** ([manager-order-detail-view.tsx](../../../src/components/manager/manager-order-detail-view.tsx), шапка [manager-order-header.tsx:44-53](../../../src/components/manager/manager-order-header.tsx)) показывает имя орг и менеджера, но **никакого контактного лица/телефона/email**.
- **Скоуп и ПДн — устоявшиеся паттерны, которым M2 обязан следовать:** `managerOrgScope(session, teamMode)`/`managedOrgIds`/`getCompanyTeamVisibility` ([managerPolicy.ts](../../../src/lib/auth/managerPolicy.ts)), профиль-first слой ([accessProfile.ts](../../../src/lib/auth/accessProfile.ts)), `requireManager`/`requireManagerForOrg` ([requireRole.ts](../../../src/lib/auth/requireRole.ts)); журнал ПДн — реестр контекстов ([pii/contexts.ts](../../../src/lib/pii/contexts.ts)) + `recordPiiAccess` ([pii/record.ts](../../../src/lib/pii/record.ts)), guardrail `pii.capture-coverage`. Эталон list-страницы с поиском+курсором+ПДн — `listStudents` ([students.ts:44-83](../../../src/lib/services/manager/students.ts)); эталон фильтр-страницы — orders ([orders/page.tsx](../../../src/app/manager/orders/page.tsx)).

**Безопасность (сквозной инвариант).** Тело входящих сообщений, заметок и полей контакта — **данные, а не команды**: не парсятся и не исполняются, используются только как текст/значения для матчинга. Скоуп (`companyId` C8, org как уточнение) — единственная авторитетная точка привязки; экранирует cross-company (C8) и cross-scope (IDOR). Секреты/креды — только из env.

---

## 2. Решения (зафиксированы)

### 2.1. Модель данных — аддитивно, миграция обратима

**Новые таблицы:**

```prisma
model Contact {
  id             String   @id @default(cuid())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  companyId      String                 // REQUIRED — граница изоляции C8
  company        Company  @relation("CompanyContacts", fields: [companyId], references: [id], onDelete: Cascade)
  organizationId String?                // OPTIONAL — org-less до привязки (триаж/лид-стадия)
  organization   Organization? @relation("OrgContacts", fields: [organizationId], references: [id], onDelete: SetNull)
  userId         String?  @unique        // OPTIONAL 1:1 с порталь­ным User
  user           User?    @relation("UserContact", fields: [userId], references: [id], onDelete: SetNull)
  name           String
  position       String?                // должность
  note           String?
  isArchived     Boolean  @default(false)
  createdById    String?
  createdBy      User?    @relation("ContactCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)

  channels        ContactChannel[]
  inboundMessages InboundMessage[] @relation("ContactInbound")
  calls           Call[]           @relation("ContactCalls")
  ordersAsPrimary Order[]          @relation("OrderPrimaryContact")

  @@index([companyId, organizationId])
  @@index([organizationId])
}

model ContactChannel {
  id              String             @id @default(cuid())
  createdAt       DateTime           @default(now())
  contactId       String
  contact         Contact            @relation(fields: [contactId], references: [id], onDelete: Cascade)
  companyId       String             // денормализовано для scoped-unique и быстрого резолва
  type            ContactChannelType // phone | email | telegram | whatsapp | max
  value           String             // как введено человеком / senderRef из входящего
  normalizedValue String             // канон для матчинга
  isPrimary       Boolean            @default(false)

  @@unique([companyId, type, normalizedValue])   // PER-COMPANY, не глобально (см. ниже)
  @@index([type, normalizedValue])                // индекс резолва по значению
  @@index([contactId])
}

enum ContactChannelType {
  phone
  email
  telegram
  whatsapp
  max
}
```

**Правки существующих (все nullable/аддитивно, дефолт-поведение сохранено):**
- `Order.primaryContactId String?` + `primaryContact Contact? @relation("OrderPrimaryContact")` — контакт сделки для блока «кому звонить».
- `User.internalPhone String?` — внутренний номер сотрудника для click-to-call (**закрывает открытый вопрос M1 #2**; M1 брал номер из env-маппинга).
- `InboundMessage.contactId String?` + relation `"ContactInbound"` — резолвнутый контакт (в дополнение к `resolvedUserId`/`resolvedOrgId`).
- `Call.contactId String?` + relation `"ContactCalls"` — резолвнутый контакт.
- Back-relations: `Organization.contacts Contact[] @relation("OrgContacts")`; `Company.contacts Contact[] @relation("CompanyContacts")`; `User.contact Contact? @relation("UserContact")`, `User.contactsCreated Contact[] @relation("ContactCreatedBy")`.

**Уникальность канала — per-company, а НЕ глобально (осознанное C8-решение).** Глобальное `@@unique([type, normalizedValue])` (как нынешний `User.whatsappPhone @unique`) при попытке компании B завести номер, уже существующий у компании A, падало бы с **P2002 — это утечка C8** (B узнаёт о существовании номера в чужой компании). Per-company уникальность закрывает утечку. Кросс-компанийная неоднозначность при резолве (номер встречается в контактах двух компаний) трактуется как **`≥2 матча → unresolved`** — безопасно, ровно как сегодня в `resolve.ts`/`resolveCaller.ts`.

**Миграция + бэкфилл.** Миграция добавляет таблицы + nullable-колонки (аддитивно/обратимо; `prisma migrate status` — чисто). Бэкфилл — **идемпотентный** data-шаг (интегрирован в seed / отдельный скрипт), с **дедупом на посеве** по ключу `(companyId, type, normalizedValue)`:
- из каждого `User` роли `organization`, у кого есть любой из `whatsappPhone`/`telegramChatId`/`maxChatId`/`email` → `Contact{ userId, organizationId: user.organizationId, companyId }` + каналы (`whatsapp`←whatsappPhone, `telegram`←telegramChatId, `max`←maxChatId, `email`←email);
- из каждого `Lead` с `clientContact*` → `Contact{ organizationId: lead.organizationId (может быть null → org-less), companyId }` + каналы (`phone`←clientContactPhone, `email`←clientContactEmail); дедуп против уже посеянных user-контактов по нормализованному значению канала.

### 2.2. Сервисный слой + атрибуция (шов ради которого выбрана первоклассная сущность)

Сигнатуры по CLAUDE.md §3 (`Result`), узкие селекты (§13).

1. **`src/lib/services/manager/contacts.ts`:**
   - `listContacts(prisma, session, opts)` — директория. Scope: `companyId` (C8) всегда; внутри — `teamMode ON` → все контакты компании, `OFF` → `organizationId ∈ managedOrgIds` **∪ org-less (`organizationId=null`) company-wide** (триаж). Поиск `q` по `name` и `ContactChannel.normalizedValue`. Курсорная пагинация. **ПДн-лог** (`manager_contacts_list`).
   - `getContact(prisma, session, contactId)` — карточка: каналы, орг, связанный `User` (бейдж «есть логин»), недавняя активность по сделкам контакта, сделки где он primary. **ПДн-лог** (`manager_contact_view`).
   - `createContact` / `updateContact` (имя/должность/заметка/орг + каналы: add/remove/setPrimary) / `archiveContact` / `linkContactToOrganization`. C8+scope-гард, валидация уникальности канала per-company, audit.

2. **`src/lib/services/contacts/resolveContactByChannel.ts`** — единый резолвер, переиспользуемый входящими и звонками:
   - `resolveContactByChannel(prisma, { type, value }) → { contactId, organizationId?, companyId, userId? } | null`. Нормализует, ищет `ContactChannel` **exactly-one** (по индексу `[type, normalizedValue]`); `≥2` (в т.ч. кросс-компанийно) → `null` (безопасно).
   - Для **голосового звонка** ищет по phone-подобным типам `{ phone, whatsapp }` (оба — номера в одном нормализованном пространстве).

3. **Rewire атрибуции** (не гейтится флагом — чистое улучшение, degrade gracefully):
   - `resolveInboundSender` и `resolveCaller` пробуют **сначала `resolveContactByChannel`**; при промахе — существующие fallback (`User.whatsappPhone` / `Lead.clientContactPhone`). При успехе проставляют `contactId` + деривят `organizationId`/`companyId`. `InboundMessage.contactId`/`Call.contactId` пишутся в `ingest.ts`/`ingestCall.ts`.

4. **Learn-on-link.** Привязка неопознанного входящего/звонка к контакту **захватывает `senderRef`/`callerNumber` как канал** контакта (если такого канала нет). Это (а) даёт компаундящуюся авто-атрибуцию будущих коммуникаций, и (б) **решает telegram/max**: их надёжный match-ключ — `chatId` (`senderRef`), который мы узнаём только из входящего; вручную введённый `@username` — только для отображения, не для матчинга.

5. **Единый нормализатор телефонов** — новый `src/lib/phone/normalize.ts` (канон RU-номеров → E.164, один для хранения канала и для всех резолвов). Заменяет `normalizePhone` (inbound), `canonicalizeRuPhone` (telephony) и `normalizePhone` (notifications) вызовами общего; чинит расхождение `8…`/`+7…`. Существующие юнит-регрессы этих функций переносятся на общий.

6. **Click-to-call staff-номер.** `initiateOutboundCall` (M1, [initiateCall.ts](../../../src/lib/services/telephony/initiateCall.ts)) берёт `fromInternal` из **`User.internalPhone`** сессии (было — env-маппинг). Деградирует gracefully, если у сотрудника номер не задан.

### 2.3. Действия (server-actions) — реюз + недостающий триаж звонков

**`src/server-actions/contacts.ts`** (тонкие адаптеры Result→toast):
- `createContactAction` / `updateContactAction` / `archiveContactAction` / каналы (`addContactChannelAction`/`setPrimaryChannelAction`/`removeContactChannelAction`);
- `linkContactOrgAction` (привязать org-less к орг); `setOrderPrimaryContactAction` (primary-контакт сделки);
- **`bindCallAction`** — **новьё**: привязка неопознанного звонка к орг/контакту/сделке (зеркалит `bindInboundMessageAction`, C8-гард, learn-on-link захватывает номер);
- `createContactFromInboundAction` / `createContactFromCallAction` — предзаполненная форма создания из коммуникации.
- **Inbox bind** ([inbound.ts](../../../src/server-actions/inbound.ts)) дополняется опцией attach/create контакта.
- **Промоушен лида.** `promoteLead` ([leadLifecycle.ts:108](../../../src/lib/services/manager/leadLifecycle.ts)) при создании заказа создаёт/привязывает контакт из `Lead.clientContact*` и ставит его `order.primaryContactId`.

### 2.4. Флаги и RBAC

- **Новый флаг `contacts`** (opt-in по умолчанию, как `manager_cabinet`/`organization_cabinet` — staged rollout). **Новый route `/manager/contacts` требует все три точки §5:** (1) middleware — `protectedPrefixes` + флаг-гейт (404 после auth); (2) nav — пункт «Контакты» с `flag: 'contacts'`; (3) route/page — `notFoundIfDisabled('contacts')`/`requireFeature`. Блок контакта на карточке сделки и вкладка «Люди» на орг-карточке — **поведенческий гейт** тем же `contacts` (рендерятся условно). **Rewire атрибуции — вне флага** (ядро резолва).
- **RBAC — внутренний контур:** только `manager`/`leader`; `partner`/`organization`/`student` **не имеют доступа** к директории и contact-API (как M1). Admin — по Model A через `/admin`-зеркало, которое в v1 **вне объёма** (см. §4).
- **Scope defense-in-depth:** middleware (флаг+роль) → server-action/route (`requireManager`, для контакта в контексте орг — `managerOrgScope`) → сервис (фильтрация по `companyId` C8 + org-scope/teamMode; **`teamMode` обязателен**, пропуск = молча scoped). Org-less контакты — company-wide (триаж).

### 2.5. UI (компоненты под `src/components/manager/contacts/*` — manager-specific, sibling-rule §4)

Примитивы из [ui/](../../../src/components/ui/) (§9), оранжевая палитра из примитивов (не инлайнить brand-hex, §13), UI на русском.

1. **Директория** `/manager/contacts` (меню «Контакты») — по паттерну orders/students: поиск (имя/канал) + фильтр (организация, архив) + курсорная пагинация + таблица/моб-карточки; строка → карточка контакта.
2. **Карточка контакта** `/manager/contacts/[id]` — шапка (имя, должность, ссылка на орг, бейдж «есть логин»); каналы с primary и кнопками **«Позвонить»** (M1 click-to-call) / **«Написать»** (реюз `replyInboundAction`); недавняя активность по сделкам контакта; сделки где он primary; edit/archive.
3. **Орг-карточка** — новая вкладка **«Люди»** ([org-card-tabs.tsx](../../../src/components/manager/org-card-tabs.tsx)): контакты организации + «добавить контакт» + inline-редактирование (закрывает дыру — сейчас списка людей нет, только счётчики).
4. **Карточка сделки** — **блок контакта** у шапки ([manager-order-detail-view.tsx](../../../src/components/manager/manager-order-detail-view.tsx)): primary-контакт сделки (имя + primary-каналы + «Позвонить»/«Написать»), пикер выбора/смены (из контактов орг или создать новый).
5. **Триаж звонков** `/manager/calls` — у **неопознанных** звонков появляется bind-форма (орг/контакт/сделка, либо «создать контакт из номера»); опознанные — read-only.
6. **Inbox bind** ([inbox-bind-form.tsx](../../../src/components/manager/inbox-bind-form.tsx)) — форма привязки дополняется attach/create контакта (learn-on-link).

**ПДн.** Новый `PiiSubjectType 'contact'` в [pii/contexts.ts](../../../src/lib/pii/contexts.ts); контексты `manager_contacts_list`/`manager_contact_view` (+ чтения на триаже звонков/вкладке «Люди», если раскрывают ПДн физлиц); `recordPiiAccess`/`recordPiiAccessMany` в чтениях; `subjectIds` — только id, в `meta` без сырых поисковых строк. Guardrail `pii.capture-coverage` — зелёный.

---

## 3. Инварианты приёмки

- **Модель/бэкфилл:** миграция аддитивна/обратима, `prisma migrate status` чисто; бэкфилл идемпотентен и дедуплицирует по `(companyId,type,normalizedValue)`; каналы уникальны **per-company**.
- **C8 (cross-company):** контакт/канал компании A не резолвится, не листится и не редактируется в компании B; **добавление канала со значением, существующим в другой компании, НЕ падает P2002** (нет утечки) — регресс.
- **Атрибуция:** входящее/звонок резолвятся **сначала по `ContactChannel`** (exactly-one), безопасны на неоднозначности (`≥2 → unresolved`); звонок матчится по phone-подобным `{phone,whatsapp}`; при успехе проставлен `contactId` + орг/компания; fallback на `User`/`Lead` сохранён.
- **Learn-on-link:** привязка неопознанного входящего/звонка к контакту захватывает канал; следующее сообщение с того же `senderRef`/номера авто-резолвится — регресс.
- **Триаж звонков:** неопознанный звонок **можно привязать** к орг/контакту/сделке (раньше было нельзя); привязка идемпотентна; audit пишется.
- **Нормализатор:** единый нормализатор; номер, введённый как `8XXXXXXXXXX`, и тот же номер в формате `+7…`/`8XXX` из разных каналов **матчатся** (регресс на прежний баг).
- **org-опциональность/scope:** org-less контакт виден company-wide, после привязки к орг — только в org-scope; `teamMode` соблюдён; partner/organization/student доступа не имеют (тест на каждую роль); IDOR — менеджер не видит/не правит контакт вне scope.
- **Сделка:** `order.primaryContact` проставляется вручную и **авто при промоушене лида**; click-to-call с карточки берёт `User.internalPhone`; блок контакта деградирует, если контакта нет.
- **Флаг `contacts`:** `off` → route `/manager/contacts` 404 (после auth), пункт меню скрыт, блок на сделке и вкладка «Люди» не рендерятся; атрибуция работает независимо от флага.
- **ПДн:** чтения директории/карточки вызывают `recordPiiAccess` (контексты `manager_contacts_*`); guardrail `pii.capture-coverage` зелёный.
- **Тело коммуникаций/полей контакта не исполняется как команды.** Секреты — только из env.
- `typecheck`, `lint`, `test`, `gate` — зелёные; **100% coverage** (сервисы + новые UI-компоненты — component-тесты по паттернам фазы 3; server-page — `renderServerComponent`).

---

## 4. Вне объёма (follow-up / другие модули)

- **Merge/dedup UI** дублей контактов (в v1 — только дедуп на посеве бэкфилла).
- **CSV-импорт** контактов.
- **Multi-org контакт** (один человек в нескольких организациях) — в v1 `organizationId` одиночный.
- **Admin `/admin`-зеркало** контактов (Model A) — v1 только manager-кабинет.
- **Авто-провижн** контактов из неопознанных коммуникаций (осознанно ручное).
- **Консолидация `User.whatsappPhone` в каналы** (сейчас поле остаётся для адресации исходящих в агрегаторе; каналы аддитивны).
- **Партнёрский контур контактов** (бэкфилл только org-role Users + Leads).
- **Активность контакта как отдельная лента** сверх простого «недавнее по сделкам» (кандидат при `Activity`-модели M3).
- **GDPR-экспорт/удаление** контакта; редактирование/удаление каналов с историей.
- **Боевое подключение Mango callback** (креды/включение исходящих) — владельцем (наследие M1).

---

## 5. Открытые вопросы

1. **telegram/max матчатся по `chatId` (learn-on-link)** — вручную введённый `@username` только для отображения. **Принято владельцем** для v1.
2. **Внутренний номер сотрудника** — теперь поле `User.internalPhone` (закрывает открытый вопрос M1 #2). Заполнение — в настройках сотрудника (staff settings); UI-точка ввода уточняется на шаге плана.
3. **Схема полей Mango `callback`** — по-прежнему за адаптером на fake (наследие M1), на архитектуру M2 не влияет.
4. **Разбиение на планы.** Объём тянет на **два стек-плана** (как omnichannel PR-A/PR-B): **PR-A** — модели + миграция/бэкфилл + единый нормализатор + rewire атрибуции + триаж звонков + learn-on-link; **PR-B** — директория + карточка контакта + вкладка «Люди» + блок контакта на сделке + промоушен-лида. Финальное решение — на шаге writing-plans.
