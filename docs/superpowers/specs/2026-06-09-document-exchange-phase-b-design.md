# Обмен документами — Фаза B: общие документы вне заказа — design

**Дата:** 2026-06-09 · **Статус:** согласовано (companyId-якорь order-less + partner order-less только outgoing + org order-less двусторонний + единая «Общие документы» поверхность у менеджера — выбор пользователя) · **Тип:** **additive миграция (nullable `orderId` + новый `companyId`) + поведение-расширяющий RBAC** (НЕ backfill-меняющий: существующие доки видимости не меняют) · **Происхождение:** отложенная Фаза B из [document-exchange Фаза A](2026-06-07-document-exchange-design.md) §5.

Аналоги-предшественники, паттерны которых наследуем:
- [document-exchange Фаза A](2026-06-07-document-exchange-design.md) (PR #101) — counterparty-якорь, `documentChannelPolicy.ts` как единый источник правды канала, изоляция-инвариант. **Фаза B — прямое продолжение; не меняем правила Фазы A, добавляем order-less ось.**
- [C8 manager company-wide](2026-06-05-c8-manager-company-wide-design.md) (PR #93) — company-уровень изоляции, cross-company инвариант-тест, `teamMode`-прокидывание. **Берём принцип «company как граница» и формат инварианта.**
- [C4 Result-contract](2026-06-05-arch-debt-result-contract-design.md) (PR #91) — boundary try/catch при storage-откате внутри write-пути.

---

## 1. Цель и не-цели

**Цель.** Снять ограничение Фазы A «документ обязан принадлежать заказу» и открыть **общие (order-less) документы** — относящиеся к отношению `counterparty ↔ компания`, а не к конкретному заказу (договоры, прайсы, регистрационные документы, NDA). Изоляция каналов из Фазы A сохраняется; добавляется ось «order-bound vs order-less».

- **`orderId` → nullable.** Заказ становится опциональным контекстом документа. Order-less документ якорится парой `(counterparty, company)`.
- **`company` как якорь изоляции order-less.** У order-less дока нет заказа → нет однозначной компании из `order.companyId`. Поэтому company фиксируется явным полем `Document.companyId` **при загрузке**. Это разрешает открытый вопрос §6.2 Фазы A (у партнёра нет прямого `companyId`; он размазан по компаниям через organizations/orders).
- **Направления order-less:**
  - org-канал — **двусторонний** (менеджер→орг и орг→менеджеры; у организации компания однозначна — `organization.companyId`);
  - partner-канал — **только outgoing** (менеджер→партнёр); партнёр order-less не грузит (входящие от партнёра всегда order-bound, заказ даёт компанию — снимает ambiguity).
- **Менеджерская поверхность order-less — единая.** Секция «Общие документы» на `/manager/documents` с counterparty-пикером (нет партнёрской entity-страницы в кабинете менеджера, и не вводим её).

**Не-цели (явно вне объёма):**
- **НЕ меняем видимость существующих документов.** Все текущие доки order-bound; `companyId=NULL`; их канал/видимость не трогаются (в отличие от backfill Фазы A). Бэкфилл не требуется.
- **НЕ ЭДО** (Контур.Диадок/СБИС/статус подписания) — отдельная будущая фича, как и в Фазе A.
- **НЕ саб-роль-гейт на загрузку** — любой активный пользователь стороны (наследуем Фазу A).
- **НЕ partner order-less upload** — партнёр грузит только order-bound (решение по company-ambiguity).
- **НЕ меняем** scan/storage-контракт (бакет `documents`, signed-URL 600s, 20 МБ, MIME allow-list, ClamAV `pending→clean|infected`, 410 на infected).
- **НЕ teamMode для order-less.** `teamMode` (C8) партиционирует **заказы**; у order-less дока заказа нет → order-less для менеджера всегда company-level.

---

## 2. Ключевые решения

1. **`orderId` → `String?` + `companyId String?` (additive).** Одна миграция: `ALTER COLUMN orderId DROP NOT NULL`; `ADD COLUMN companyId` (nullable, FK на `Company`); `CREATE INDEX (companyId)`. Без backfill — существующие строки остаются order-bound с `companyId=NULL`. Инвариант данных (на уровне приложения, не БД-констрейнт): документ либо order-bound (`orderId != null, companyId = null`), либо order-less (`orderId = null, companyId != null`). XOR обеспечивают write-пути, не схема (Prisma не выражает условный NOT NULL без CHECK-констрейнта; добавляем CHECK-констрейнт в SQL миграции для жёсткости).

2. **`companyId` — якорь изоляции order-less, проставляется при загрузке.** outgoing (менеджер→клиент) → `session.companyId`; org-incoming → `organization.companyId`. Для order-bound `companyId` не используется (компания берётся из `order.companyId`). Это разрешает §6.2 Фазы A: партнёрский order-less док жёстко привязан к компании-отправителю, а не к union-множине компаний партнёра.

3. **`documentChannelPolicy.ts` расширяется осью order-bound/order-less — остаётся единым источником правды.** Не инлайнить `{ orderId: null }`/`{ companyId }` фильтры в сервисах (CLAUDE.md §4, урок C8 о молчаливом разъезде scope-правил).

4. **Order-less для менеджера = company-level всегда (не teamMode-aware).** `document.companyId === session.companyId`. Leader (C8) — та же company-множина. Обоснование: order-less не имеет заказа, а `teamMode` партиционирует заказы; per-manager 3-way scope для order-less не определён. Это сознательное company-level правило, согласованное с решением №2.

5. **Менеджерский counterparty-пикер (write-side деривация).** Орг — из `managedOrgIds` (teamMode-aware, существующее). Партнёры — у кого company-множина (`organizations[].companyId ∪ orders[].companyId`) содержит `session.companyId`. При загрузке `companyId` пишется = `session.companyId` (read-side фильтр симметричен: `companyId === session.companyId`).

6. **Order-less partner — outgoing-only; партнёрский upload order-less → `forbidden`.** `assertCanUpload` для партнёра отвергает order-less (партнёр грузит только order-bound). Партнёр видит order-less partner-channel доки в read-only вкладке «Общие документы».

7. **Sibling write-paths (§11/§4 CLAUDE.md).** Орг грузит order-less через server-action `uploadOrganizationDocument` (`orderId` опционален). Менеджер — через обобщённый `createCounterpartyDocument` (API-роут менеджера, `orderId?`). Формы — sibling `organization-*`/менеджерская, не общий компонент.

8. **Нарушение канала/компании = `not_found` (молча).** Чужой counterparty ИЛИ чужой company при list/download отдаёт `not_found` без утечки существования (паттерн Фазы A). Заражённый → `410 Gone`.

9. **Аудит на загрузку/скачивание** (§12) — реюз кодов Фазы A (`document_uploaded` с `counterpartyType`/`direction`/`source`; `document_download_signed_url`). Для order-less в `after`/метаданных фиксируется `companyId` и `orderId=null`.

---

## 3. Дизайн по компонентам

### 3.1 Схема + миграция (additive, без backfill)
```prisma
model Document {
  // ... существующие поля ...
  orderId    String?           // БЫЛО String → nullable (order-less)
  order      Order?  @relation(fields: [orderId], references: [id])
  companyId  String?           // НОВОЕ — company-якорь order-less; NULL у order-bound
  company    Company? @relation(fields: [companyId], references: [id])
  counterpartyType CounterpartyType   // из Фазы A
  counterpartyId   String             // из Фазы A
  @@index([companyId])                // НОВОЕ
  // существующие индексы остаются
}
```
**Порядок миграции** (одна миграция через `--create-only`, авто-SQL заменить безопасной последовательностью; применённые миграции не править, §11):
1. `ALTER TABLE "Document" ALTER COLUMN "orderId" DROP NOT NULL`.
2. `ADD COLUMN "companyId" TEXT` (nullable) + FK `Document_companyId_fkey → Company(id)`.
3. `CREATE INDEX "Document_companyId_idx"`.
4. CHECK-констрейнт XOR: `CHECK (("orderId" IS NOT NULL AND "companyId" IS NULL) OR ("orderId" IS NULL AND "companyId" IS NOT NULL))` — жёстко запрещает «ни заказа, ни компании» и «и заказ, и компания».
5. `npm run prisma:generate`. Backfill НЕ нужен (существующие строки order-bound, проходят CHECK).

**Следствие nullable `orderId`:** Prisma-тип `Document.order` становится `Order | null` → null-каскад `d.order?.…` по read-путям (см. §3.5).

### 3.2 `documentChannelPolicy.ts` (расширение единой точки решения)
Существующие `organizationChannelWhere`/`partnerChannelWhere`/`documentInChannel` — **без изменений** (counterparty-привязка). Добавляем ось order-bound/order-less и менеджерский order-less where:
```ts
// Клиентская ось внутри канала:
orderBoundWhere(): Prisma.DocumentWhereInput   // { orderId: { not: null } }
orderLessWhere(): Prisma.DocumentWhereInput    // { orderId: null }
// Композиция: { ...organizationChannelWhere(orgId), ...orderLessWhere() } и т.п.

// Менеджер order-less (оба канала, company-level):
managerOrderLessWhere(companyId: string): Prisma.DocumentWhereInput
  // { orderId: null, companyId, ...INFECTED_HIDDEN_WHERE }

// Upload-гейт order-less:
assertCanUploadOrderLess(session, channel): boolean
  // менеджер: channel.id в его scope (org ∈ managedOrgIds; partner — company-union содержит session.companyId)
  // организация: session.role==='organization' && activeOrgId===channel.id && channel.type==='organization'
  // партнёр: ВСЕГДА false (partner order-less — только outgoing от менеджера)
```
Реюз `INFECTED_HIDDEN_WHERE` (admin видит всё — Model A). Чистые функции — тестируемо без Postgres.

### 3.3 Потоки записи (order-less ветка ядра §10)
Общее ядро как в Фазе A (`createCounterpartyDocument`): MIME allow-list + magic-bytes + 20 МБ → Supabase (`counterparty/{type}/{id}/...` для order-less) → `Document.create` (orderId=null, companyId=...) → enqueue `docs.scanDocument` → `recordAudit` → fan-out. Откат storage-объекта при сбое БД — boundary try/catch (C4). Контракт §3: `{ ok:true, documentId } | { ok:false, error: 'forbidden'|'too_large'|'invalid_mime'|'storage'|'not_found' }`.

| Поток | Точка входа | counterparty | companyId | direction | уведомление |
|---|---|---|---|---|---|
| Менеджер → орг (общий) | `createCounterpartyDocument` (orderId=null) | выбранная орг ∈ scope | `session.companyId` | outgoing | `notifyOrgUsers` |
| Менеджер → партнёр (общий) | то же | выбранный партнёр ∈ scope | `session.companyId` | outgoing | `notifyPartner` |
| Орг → менеджеры (общий) | `uploadOrganizationDocument` (orderId=null) | self `activeOrgId` | `organization.companyId` | incoming | `notifyManagers` |

Менеджерский counterparty-пикер: орг из `managedOrgIds`; партнёры — company-union содержит `session.companyId` (реш. №5). Если у заказа `partnerId=null` — к order-less это неприменимо (order-less не имеет заказа), но partner-выбор пикера ограничен партнёрами в company-scope.

### 3.4 Уведомления (реюз Фазы A, degrade gracefully §3)
Новых типов **не требуется** — order-less использует существующие:

| Событие | Канал | Тип |
|---|---|---|
| Менеджер → орг (общий) | `notifyOrgUsers` | `document_published` |
| Менеджер → партнёр (общий) | `notifyPartner` | `document_published` |
| Орг → менеджеры (общий) | `notifyManagers` | `document_uploaded_by_org` |

Email-шаблоны ветвят «№ заказа {n}» vs «Общий документ» (Фаза A уже сделала orderNumber nullable-safe — расширяем на полностью order-less). Notification-таргетинг остаётся scoped (C8 не-цель). Получатели менеджеров — `resolveManagerRecipients`, но для order-less нет заказа → таргетинг по company (менеджеры компании = `companyId`); используем company-scoped резолвер менеджеров (assigned-by-order не применим).

### 3.5 Чтение + кабинеты (null-каскад + вкладки)
- **Организация** `/organization/documents` — две вкладки: **«Документы»** (`{...organizationChannelWhere(orgId), ...orderBoundWhere()}`) и **«Общие документы»** (`...orderLessWhere()`). Order-less вкладка **с загрузкой** (двусторонний org-канал).
- **Партнёр** `/partner/documents` (+ портфолио) — вкладка **«Общие документы»** (`...partnerChannelWhere(partnerId), ...orderLessWhere()`) **read-only** (без загрузки).
- **Менеджер** `/manager/documents` — секция **«Общие документы»** (`managerOrderLessWhere(session.companyId)`, оба канала, сгруппировано по counterparty) + форма с counterparty-пикером. Order-bound секция — без изменений (`managerDocumentWhere(session, teamMode)`).
- **Admin** `/admin/documents` — то же order-less, unscoped (Model A).
- **Null-каскад** (`d.order?.…`): затрагивает list-сервисы 3 кабинетов (org/partner/manager documents) + презентационный `documents-list.tsx` (колонка «заказ» опциональна; order-less строка показывает «Общий документ» вместо orderNumber/title). Per-order-detail embeds (`getOrgOrder`/`getPartnerDealDetail`/dashboard) **не затрагиваются** — они по определению order-bound (фильтруют по конкретному orderId, order-less туда не попадает).
- Download во всех кабинетах: signed-URL 600s, 410 на infected, audit; channel+company-проверка из policy; чужой → `not_found`. Для order-less download-гард дополнительно сверяет `companyId` (менеджер: `===session.companyId`; клиент: канал-привязка достаточна, companyId косвенно гарантирован).

### 3.6 UI
- **Вкладки «Документы» / «Общие документы»** у org (обе с/без загрузки) и partner (общие read-only). Презентационный `documents-list.tsx` (domain-agnostic, исключение §4) — колонка «заказ» опциональна.
- **Менеджерская секция «Общие документы»** на `/manager/documents` — список по counterparty + inline-форма (sibling существующей, карточка не модалка — живой паттерн Фазы A): селектор `DocumentType`, counterparty-пикер (тип org/partner + сущность из scope), live-сообщения `role="alert"/"status"`, клиентские подсказки MIME/размер.
- **Org order-less форма** — sibling `organization-document-upload-form` с `orderId` опциональным (на вкладке «Общие документы» orderId не передаётся).

### 3.7 Ошибки
Коды Result существующие; роут/экшен только мапит (§3). Channel/company-violation → `not_found`. Партнёр order-less upload → `forbidden`. Infected → `410`. Enqueue скана/уведомления → лог + проглот. Невалидный `DocumentType` → коэрс в `other`.

---

## 4. Тестовая стратегия (четырёхслойно, §6)

- **Unit:**
  - channel-policy order-less ось: `orderBoundWhere`/`orderLessWhere` композиция; `managerOrderLessWhere(companyId)` (company-фильтр + INFECTED_HIDDEN); `assertCanUploadOrderLess` для каждой роли (партнёр → `false`; орг → только свой org-channel; менеджер → org ∈ managedOrgIds, partner ∈ company-union).
  - upload-сервисы order-less: каждое разрешённое направление ставит верные `counterparty`+`companyId`+`orderId=null`+`direction`; партнёрский order-less путь возвращает `forbidden`.
  - counterparty-пикер деривация партнёров по company-union.
  - null-каскад: row-тип/презентация для order-less строки (нет orderNumber → «Общий документ»). `import React` обязателен (vitest classic JSX).
- **Integration (L3):** **company-isolation инвариант (линчпин)** — менеджер компании B НЕ видит/не скачивает order-less документ с `companyId=A` (org И partner каналы); прямой аналог cross-company инварианта C8. Плюс: org-incoming order-less end-to-end (орг грузит → менеджеры компании видят + уведомлены); менеджер→партнёр order-less end-to-end (партнёр видит read-only); партнёрский order-less upload → `forbidden`; signed-URL + 410 на order-less. CHECK-констрейнт XOR проверяется (попытка создать «ни заказа, ни компании» → ошибка БД).
- **e2e (визуально, опц.):** вкладка «Общие документы» по кабинетам; counterparty-пикер у менеджера.
- Worker processor-coverage guardrail не затрагивается (новых процессоров нет). `sync-documents.ts` (1С) создаёт order-bound доки — не меняется (companyId=NULL остаётся валидным по CHECK).

---

## 5. Поставка (одной фазой)

Фаза B едет целиком (она сама — отложенный хвост document-exchange):
1. Миграция: `orderId` nullable + `companyId` + индекс + CHECK XOR.
2. `documentChannelPolicy.ts`: order-bound/order-less ось + `managerOrderLessWhere` + `assertCanUploadOrderLess`.
3. Write: `createCounterpartyDocument` `orderId?`; `uploadOrganizationDocument` `orderId?`; counterparty-пикер деривация.
4. Null-каскад по list-сервисам 3 кабинетов + `documents-list.tsx`.
5. UI: вкладки «Общие документы» (org с загрузкой, partner read-only); менеджерская/admin секция + пикер.
6. Уведомления: company-scoped резолвер менеджеров для order-less incoming; email ветвление «Общий документ».
7. Тесты: company-isolation инвариант + order-less unit/integration.
→ Едет: order-less «общие документы» с company-изоляцией, без изменения видимости существующих доков.

---

## 6. Открытые вопросы и риски

1. **CHECK-констрейнт XOR vs гибкость.** Жёсткий XOR ловит баги write-путей на уровне БД, но запрещает гипотетический «order-less + всё же привязанный к компании заказа» документ. Принято: XOR соответствует инварианту реш. №1; если позже понадобится «order-less в контексте заказа» — отдельная миграция. Риск низкий.
2. **Company-scoped резолвер менеджеров для order-less incoming.** `resolveManagerRecipients` Фазы A опирается на заказ (assigned + org-managers + commenters). Для order-less заказа нет → нужен company-вариант (все активные менеджеры компании организации). Уточнить при плане: переиспользовать org-managers ветку (`OrganizationManager` для `organization.companyId`) — она не требует заказа.
3. **Менеджерский partner-пикер при multi-company партнёре.** Партнёр в company-union нескольких компаний попадёт в пикеры менеджеров **каждой** этой компании, но загруженный док жёстко получит `companyId` отправителя → видим только своей компании. Это by design (реш. №2/№5), не утечка. Документируем в плане как ожидаемое поведение + тест.

---

## 7. Что НЕ делаем

- ЭДО / Контур.Диадок / СБИС / статус подписания (отдельная будущая фича).
- Partner order-less upload (только order-bound от партнёра).
- Backfill существующих документов (остаются order-bound).
- Изменение видимости существующих документов (в отличие от Фазы A).
- Партнёрская entity-страница в кабинете менеджера (order-less у менеджера — единая секция + пикер).
- teamMode-партиционирование order-less (company-level всегда).
