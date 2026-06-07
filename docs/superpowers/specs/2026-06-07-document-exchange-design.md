# Двусторонний обмен документами с изоляцией каналов — design

**Дата:** 2026-06-07 · **Статус:** согласовано (двусторонний + counterparty-якорь + изоляция каналов + upload без саб-роль-гейта + структура A + company-wide scope Фазы B — выбор пользователя) · **Тип:** **поведение-меняющий RBAC** + миграция с бэкфиллом (НЕ move-only) · **Происхождение:** brainstorm 2026-06-07 (вопрос «как менеджеру передавать партнёру/организации документы»).

Аналоги-предшественники, из которых наследуем паттерны:
- [C8 manager company-wide](2026-06-05-c8-manager-company-wide-design.md) (PR #93) — централизованный mode-aware policy-модуль ([managerPolicy.ts](../../../src/lib/auth/managerPolicy.ts)), `teamMode`-прокидывание, cross-company инвариант-тест. **Берём структуру и принцип «правило изоляции — в одном месте».**
- [C1 org finance + leader](2026-06-04-organization-finance-hub-design.md) (PR #89) — урок про JWT-producer (под-роль молча умирает, если не проэмитить).
- [C4 Result-contract](2026-06-05-arch-debt-result-contract-design.md) (PR #91) — boundary try/catch при throw внутри `$transaction`.

Эта фича закрывает то, что три кабинетных спека явно отложили на «Phase 9»: партнёр-сайд upload + симметричный обмен (см. «не-цели» в [partner](2026-05-21-partner-cabinet-design.md)/[organization](2026-05-25-organization-cabinet-design.md)/[manager](2026-05-26-manager-cabinet-design.md) спеках). ЭДО (Контур.Диадок/СБИС) — **отдельная** будущая фича, в этот объём НЕ входит.

---

## 1. Цель и не-цели

**Цель.** Превратить односторонний «менеджер → организация push» в **двусторонний обмен документами по каналам**, где документ принадлежит каналу `counterparty ↔ менеджеры`, а третья сторона заказа его не видит.

- **Двустороннее направление.** Менеджер → клиент (`outgoing`, уже есть для орг) **и** клиент → менеджеры (`incoming`, новое для ручной загрузки; сегодня `incoming` появляется только через 1С-синк).
- **Counterparty-якорь.** У документа появляется явный владелец-канал: `(counterpartyType: organization|partner, counterpartyId)`. Заказ становится **опциональным** контекстом (`orderId` → nullable **в Фазе B**), что открывает order-less «общие документы».
- **Изоляция каналов.** Организация видит только org-channel, партнёр — только partner-channel. **Менеджер видит ОБА** канала в пределах своего order/company-scope (изоляция — правило для **клиентов**, не для менеджеров).
- **Симметричные уведомления.** Менеджер→партнёр получает пуш (новый `notifyPartner` — закрывает исходный гэп); клиент→менеджеры уведомляет менеджеров.

**Не-цели (явно вне объёма):**
- **НЕ ЭДО.** Никакой интеграции с Контур.Диадок/СБИС, статуса подписания бухгалтерией, вебхуков провайдеров. Поле `signedAt` остаётся как есть (timestamp из 1С).
- **НЕ саб-роль-гейт на upload.** Любой активный пользователь стороны грузит и заказные, и общие документы (выбор пользователя). Гейтинг по `roleInOrg`/partner-admin **не вводим**.
- **НЕ меняем** scan/storage-контракт: тот же бакет `documents`, signed-URL TTL 600s, 20 МБ, MIME allow-list, ClamAV `pending→clean|infected`, 410 на infected (§10).
- **НЕ глобальная видимость менеджера.** Менеджерский scope остаётся order/company-партиционированным (наследует `teamMode` из C8).

---

## 2. Ключевые решения

1. **Counterparty как первоклассное поле `Document`.** Добавляем `counterpartyType CounterpartyType` + `counterpartyId String` (NOT NULL после бэкфилла). Канал = `(counterpartyType, counterpartyId)`. Для заказных док-тов counterparty снимает неоднозначность «орг или партнёр» (заказ имеет и `organizationId`, и опц. `partnerId` — [schema:428-431](../../../prisma/schema.prisma)); для order-less counterparty и есть единственный якорь. **`orderId` остаётся `String`** в Фазе A; становится `String?` только в Фазе B (вместе с null-каскадом `d.order?.…` по read-сервисам/типам/компоненту) — чтобы Фаза A не платила за order-less, который в ней не используется.

2. **Единый channel-policy (структура A).** Новый модуль `src/lib/auth/documentChannelPolicy.ts` — сиблинг `managerPolicy.ts`, **единственный источник правды** правила канала. Все три кабинета + уведомления берут `where`/проверку отсюда. Обоснование — §4 CLAUDE.md и урок C8: дублированное scope-правило молча разъезжается (typecheck не ловит «забыл взять channel-where»).

3. **Изоляция — правило для клиентов, не для менеджеров.** `organizationChannelWhere`/`partnerChannelWhere` жёстко прибивают counterparty к сессии клиента. Менеджерский `where` остаётся существующим order/company-scope ([managerDocumentScope](../../../src/lib/auth/managerPolicy.ts) — teamMode-aware) для заказных док-тов **плюс** order-less для counterparty в его scope (Фаза B). Менеджер видит оба канала — это by design.

4. **Менеджер при `outgoing`-загрузке явно выбирает получателя-канал.** Форма менеджера получает селектор «получатель: организация / партнёр», **дефолт по типу документа**: `commission_statement` → партнёр, остальное → организация. Если у заказа нет `partnerId` — доступен только org-channel. Это устраняет сегодняшнее неявное «всё уведомляет орг» (из-за чего `commission_statement` сейчас ошибочно пушится организации — [document-published.tsx:12](../../../src/lib/email/templates/organization/document-published.tsx)).

5. **Бэкфилл существующих строк — детерминированное правило.** Все текущие `Document` получают counterparty из заказа: по умолчанию `organization`/`order.organizationId`; тип `commission_statement` → `partner`/`order.partnerId` (комиссия — деньги партнёра, и партнёр уже видит её в портфолио — [partner/documents/page.tsx:18](../../../src/app/partner/documents/page.tsx)). Если у заказа `partnerId = null`, а тип `commission_statement` — остаётся org-channel (fail-safe, не теряем видимость).

6. **`notifyPartner` — новый fan-out, data-слой уже готов.** У `Partner` уже есть relation `notifications Notification[]` ([schema:319](../../../prisma/schema.prisma)) — in-app инфраструктура для партнёра существует, нужен только модуль fan-out `src/lib/notifications/partner.ts` + barrel-экспорт. Активные получатели резолвятся из партнёрских пользователей (`Partner.users` / `PartnerUser`).

7. **Sibling write-paths по §11/§4.** Орг и партнёр грузят через **server-actions** (`uploadOrganizationDocument`, `uploadPartnerDocument`) — орг-кабинет исторически без upload-API-роута (§11). Менеджер сохраняет свой API-роут (обобщённый). Формы — sibling `organization-*`/`partner-*` (§4), не общий компонент.

8. **Нарушение канала = `not_found` (молча).** Чужой counterparty при list/download отдаёт `not_found`, без утечки существования — паттерн [getOrgDocumentForDownload](../../../src/lib/services/organization/documents.ts). Заражённый → `410 Gone` (отдельный сигнал, §10).

9. **Аудит на каждую загрузку/скачивание** (§12): `document_uploaded` (с `counterpartyType`, `direction`, `source`), `document_download_signed_url`. Реюз существующих action-кодов.

---

## 3. Дизайн по компонентам

### 3.1 Схема + миграция (additive + бэкфилл)
```prisma
enum CounterpartyType { organization  partner }

model Document {
  // ... существующие поля ...
  orderId          String             // остаётся NOT NULL в Фазе A (→ String? в Фазе B)
  order            Order   @relation(fields: [orderId], references: [id])
  counterpartyType CounterpartyType   // НОВОЕ (NOT NULL после бэкфилла)
  counterpartyId   String             // НОВОЕ (NOT NULL после бэкфилла)
  @@index([counterpartyType, counterpartyId])   // НОВОЕ
  @@index([orderId, type])                       // оставляем
}
```
**Порядок миграции** — одна миграция через `--create-only`, затем заменить авто-SQL безопасной последовательностью (применённые миграции не править, §11):
1. `CREATE TYPE "CounterpartyType"`.
2. `ADD COLUMN` обе колонки **nullable**.
3. Бэкфилл по правилу №5 (org по умолчанию; `commission_statement` → partner при `partnerId IS NOT NULL`).
4. `ALTER COLUMN … SET NOT NULL` для обеих.
5. `CREATE INDEX` по `(counterpartyType, counterpartyId)`; `npm run prisma:generate`. **`orderId` НЕ трогаем.**
6. Следствие NOT NULL: **все** `prisma.document.create(...)` (прод + тестовые сиды) обязаны выставлять counterparty, иначе typecheck падает — это закладывается в задачи плана.

### 3.2 `documentChannelPolicy.ts` (единственная точка решения)
```ts
type DocumentChannel = { type: 'organization' | 'partner'; id: string };

organizationChannelWhere(orgId): Prisma.DocumentWhereInput
  // { counterpartyType:'organization', counterpartyId: orgId, ...INFECTED_HIDDEN_WHERE }
partnerChannelWhere(partnerId): Prisma.DocumentWhereInput
  // { counterpartyType:'partner', counterpartyId: partnerId, ...INFECTED_HIDDEN_WHERE }
managerDocumentWhere(session, teamMode): Prisma.DocumentWhereInput
  // заказные: order ∈ managerOrderScope(session, teamMode)  (существующее)
  //  + order-less: counterpartyId ∈ managedOrgIds / company-wide  (Фаза B)
assertCanUpload(session, channel): boolean
  // клиент: session.role==='organization' && activeOrgId===channel.id  (org)
  //         session.role==='partner' && partnerId===channel.id        (partner)
  // менеджер: channel.id в его scope (org в managedOrgIds / company; partner — Фаза B company-wide)
```
Реюз [INFECTED_HIDDEN_WHERE](../../../src/lib/services/scan/visibility.ts) (admin видит всё — Model A). Чистые функции + `teamMode: boolean` (как C8) — тестируемо без Postgres.

### 3.3 Потоки записи
Общее ядро (по §10, как [createOrderDocument](../../../src/lib/services/manager/uploads.ts:81)): MIME allow-list + magic-bytes + 20 МБ → Supabase (`orders/{id}` или `counterparty/{type}/{id}` для order-less) → `Document.create` → enqueue `docs.scanDocument` → `recordAudit` → fan-out. Контракт §3: `{ ok:true, documentId } | { ok:false, error: 'forbidden'|'too_large'|'invalid_mime'|'storage'|'not_found' }`. Откат storage-объекта при сбое БД — boundary try/catch (урок C4).

| Поток | Точка входа | counterparty | direction | уведомление |
|---|---|---|---|---|
| Менеджер → клиент | обобщённый `createCounterpartyDocument` (рефактор `createOrderDocument`, +`counterparty`, `orderId?`) — API-роут менеджера | выбранный орг/партнёр (реш. №4) | `outgoing` | org→`notifyOrgUsers`, partner→`notifyPartner` |
| Организация → менеджеры | **новый** server-action `uploadOrganizationDocument` | self `activeOrgId` | `incoming` | `notifyManagers` |
| Партнёр → менеджеры | **новый** server-action `uploadPartnerDocument` | self `partnerId` | `incoming` | `notifyManagers` |

Клиент при upload выбирает свой заказ (Фаза A: `orderId` обязателен и принадлежит клиенту — орг: `Order.organizationId===activeOrgId`; партнёр: `Order.partnerId===partnerId`). Фаза B: `orderId` опционален (order-less).

### 3.4 Уведомления (симметрия, degrade gracefully §3)

| Событие | Канал | Тип | Статус |
|---|---|---|---|
| Менеджер → орг | `notifyOrgUsers` | `document_published` | есть |
| Менеджер → партнёр | **`notifyPartner`** (новый) | `document_published` | новое |
| Орг → менеджеры | `notifyManagers` | `document_uploaded_by_org` | есть (1С) |
| Партнёр → менеджеры | `notifyManagers` | **`document_uploaded_by_partner`** | новый тип |

- `notifyPartner` — новый `src/lib/notifications/partner.ts` + `export * from './partner'` в [index.ts](../../../src/lib/notifications/index.ts) (сейчас `core/org/manager`). In-app `Notification` с `partnerId` (relation уже есть) + best-effort email-шаблон `partner/document-published.tsx`.
- Получатели менеджеров для `incoming` — существующий `resolveManagerRecipients` (assigned + org-managers + historical commenters), он же используется 1С-синком. Notification-таргетинг остаётся scoped даже в C8-ON (не-цель C8).

### 3.5 Чтение + кабинеты
- **Организация** [/organization/documents](../../../src/app/organization/documents/page.tsx): `where = organizationChannelWhere(activeOrgId)`. **Поведение-изменение:** больше НЕ видит partner-channel (комиссии и т.п.).
- **Партнёр** [/partner/documents](../../../src/app/partner/documents/page.tsx) + [портфолио](../../../src/app/partner/portfolio/[orgId]/documents/page.tsx): `where = partnerChannelWhere(partnerId)`. **Поведение-изменение:** больше НЕ видит org-channel закрывающие организации.
- **Менеджер** [/manager/documents](../../../src/app/manager/documents/page.tsx): `where = managerDocumentWhere(session, teamMode)` — оба канала в scope (без изменения для заказных).
- **Admin:** /admin зеркало, `policy.ts` → видит всё (Model A).
- Download во всех кабинетах: signed-URL TTL 600s, 410 на infected, audit; channel-проверка из policy; чужой → `not_found`.

### 3.6 UI
- **Вкладка «Документы» у заказа** (3 кабинета): список (новая колонка **направление/сторона**), upload-контрол. У менеджера есть ([manager-doc-upload-form.tsx](../../../src/components/manager/manager-doc-upload-form.tsx)) — добавить селектор получателя (реш. №4). Орг/партнёр — добавить upload.
- **«Общие документы» (order-less, Фаза B)** — вкладка у орг/партнёра; у менеджера/админа — в карточке counterparty.
- **Форма загрузки** — inline-сиблинг существующей [ManagerDocUploadForm](../../../src/components/manager/manager-doc-upload-form.tsx) (карточка, **не модалка** — соответствует живому менеджерскому паттерну): селектор `DocumentType`, у менеджера — селектор получателя, live-сообщения через `role="alert"/"status"`, клиентские подсказки MIME/размер. Если позже понадобится модалка — мигрировать на `useDialogFocus` (§9).
- Компоненты: sibling `organization-document-upload-form`/`partner-document-upload-form` (§4). Рендерер списка [documents-list.tsx](../../../src/components/partner/documents-list.tsx) — презентационный + domain-agnostic → расширяем общий (исключение §4) колонкой направления.

### 3.7 Ошибки
Коды Result существующие; роут/экшен только мапит (§3). Channel-violation → `not_found`. Infected → `410`. Enqueue скана / уведомления → лог + проглот (§3). Невалидный `DocumentType` → коэрс в `other` (как сегодня [coerceDocType](../../../src/lib/services/manager/uploads.ts:75)).

---

## 4. Тестовая стратегия (четырёхслойно, §6)

- **Unit:** channel-policy (орг→только org-channel; партнёр→только partner; менеджер→оба в scope; чужой counterparty→`not_found`; `assertCanUpload` для каждой роли); upload-сервисы (каждое направление ставит верные `counterparty`+`direction`; менеджерский дефолт получателя по типу — реш. №4); `notifyPartner` fan-out; правило бэкфилла №5. `import React` обязателен (vitest classic JSX).
- **Integration (L3):** **инвариант изоляции каналов** — на заказе с орг+партнёром партнёр НЕ скачивает org-channel документ и наоборот (прямой аналог cross-company инварианта C8 — линчпин фичи); обратная загрузка end-to-end (орг/партнёр → менеджер видит + уведомлён нужным типом); `commission_statement` от менеджера → partner-channel + `notifyPartner`; signed-URL + 410; (Фаза B) order-less upload/visibility.
- **e2e (визуально, опц.):** a11y модалки загрузки, список с колонкой направления по кабинетам.
- Worker processor-coverage guardrail не затрагивается (новых процессоров нет); если правим [sync-documents.ts](../../../src/worker/processors/sync-documents.ts) для проставления counterparty — его integration-тест обновляется.

---

## 5. Фазовая поставка

**Фаза A — обмен по заказу (основная ценность):**
- Миграция: enum + counterparty-колонки (NOT NULL после бэкфилла) + индекс. **`orderId` остаётся NOT NULL** — null-путь и связанный null-каскад (`d.order?.…`) по read-сервисам отложены в Фазу B (Фаза A не использует order-less, поэтому не платит за него).
- `documentChannelPolicy.ts`; обобщение `createOrderDocument`→`createCounterpartyDocument` + селектор получателя.
- Обратные server-actions (орг/партнёр) для **заказных** док-тов.
- `notifyPartner` + тип `document_uploaded_by_partner`; перевод `commission_statement` в partner-channel.
- Channel-scoped чтения в 3 кабинетах; колонка направления.
- Integration-тест инварианта изоляции.
→ Едет: privacy-фикс (изоляция) + обратная загрузка + пуш партнёру.

**Фаза B — общие документы вне заказа:**
- Миграция `orderId` → `String?` + null-каскад (`d.order?.…`) по read-сервисам/row-типам/компоненту; «Общие документы» у орг/партнёра; вью counterparty + order-less upload у менеджера/админа.
- `managerDocumentWhere` order-less ветка; **scope менеджер↔партнёр = company-wide**.
- Тесты order-less + partner-company scope.

---

## 6. Открытые вопросы и риски

1. **Migration-risk: изоляция меняет видимость задним числом.** После бэкфилла партнёр перестаёт видеть org-channel документы на общих заказах (и орг — partner-channel `commission_statement`). Это **намеренно** (выбор «изоляция каналов»), но требует rollout-коммуникации партнёрам/организациям. Бэкфилл — детерминированный и обратимый по правилу №5.
2. **Phase-B: партнёр→компания выводится, не хранится.** У `Partner` НЕТ прямого `companyId` ([schema:304-320](../../../prisma/schema.prisma)); company выводится через `Partner.organizations[].companyId` / `Partner.orders[].companyId`. Если партнёр охватывает несколько компаний — company-wide scope = union. Решить при спеке Фазы B (на Фазу A не влияет — заказ даёт scope).
3. **Селектор получателя у менеджера (реш. №4)** — дефолт по типу. Если оператор вручную выберет «партнёр» на заказе без `partnerId` — UI должен заблокировать (валидация: partner-channel доступен только при `order.partnerId != null`).

---

## 7. Что НЕ делаем

- ЭДО / Контур.Диадок / СБИС / статус подписания бухгалтерией (отдельная будущая фича).
- Версионирование/замену документов сверх существующего `version`/`replacesDocumentId`.
- Саб-роль-гейт на загрузку (выбор пользователя — любой пользователь стороны).
- Изменение student-bridge / кабинета слушателя (отдельная тема).
