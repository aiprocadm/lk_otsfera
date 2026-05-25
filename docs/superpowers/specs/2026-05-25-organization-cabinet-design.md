# Spec: Кабинет организации-заказчика (Phase 7)

**Дата:** 2026-05-25
**Статус:** Draft — на ревью пользователя
**Подход:** «Зеркало партнёрского кабинета» (Вариант A) — reuse shared компонентов через `viewer` prop.
**Целевой пользователь:** Клиент Промтехносферы (организация-заказчик) — admin и member.

---

## 1. Цель и контекст

### 1.1 Бизнес-цель

После того как партнёрский и админский кабинеты дали Промтехносфере прозрачность и управление операциями, остаётся последняя сторона цепочки — **сам клиент**. Сегодня клиент-организация:

1. Узнаёт статус заказа звонком партнёру или менеджеру.
2. Получает счета/акты/договоры по почте, теряет их в переписке.
3. Не имеет единого места, где видны все заказы, оплаты и сотрудники-на-обучении.

Phase 7 даёт клиенту самостоятельный read-first кабинет с возможностью писать комментарии менеджеру и приглашать коллег.

### 1.2 Метрики успеха (3 месяца после rollout)

| Метрика | Цель |
|---|---|
| Организации с ≥1 активным пользователем кабинета | ≥ 40% |
| Снижение количества писем «пришлите счёт» в адрес менеджеров | −60% |
| Среднее количество приглашённых коллег на одну organization | 1.5+ |
| Доля organizations с двусторонней перепиской через комментарии | ≥ 25% |

### 1.3 Что уже есть к моменту Phase 7

- Партнёрский кабинет: фазы 0-5 (foundation, portfolio/team/leads, sync hardening, commission/PDF, polish/PWA/email/ClamAV/playwright).
- Админский кабинет MVP (Phase 6): AdminAppShell, dashboard, CRUD users/partners/organizations, audit-log viewer, requireAdmin guard, recordAudit helper, password-reset/invite flow.
- Схема: `Organization`, `OrganizationUser` (many-to-many с `roleInOrg`, `isActive`), `Order` (привязан к `Company`, но не к `Organization`), `Document`, `Payment`, `Comment`, `Student`, `Notification`.
- 1С-sync: `OneCOrderDto.organizationExternalId` присылает 1С, но `sync-orders` сейчас резолвит только до `companyId`/`partnerId`, теряя связь с `Organization`.
- Email через Resend, ClamAV для документов, Bullmq для async задач.

### 1.4 Что нужно достроить

- Прямую связь `Order ↔ Organization` (новое поле + backfill).
- Server-side guards для organization-роли (`requireOrganization`, `requireOrganizationAdmin`).
- Policy helpers и scope-фильтры для предотвращения утечки данных между юр.лицами одной Company.
- Сервис-слой `lib/services/organization/*.ts` с integration-тестами.
- UI: 6 страниц + 1 layout + 2 блока в существующих кабинетах для invite flow.
- 4 email-шаблона (org-invite, document-published, payment-received, order-status-changed) + helper `notifyOrgUsers`.
- Feature flag `ORGANIZATION_CABINET` для постадийного rollout.

---

## 2. Архитектура

### 2.1 Принципы

1. **Зеркало шаблона.** Структура повторяет partner/admin кабинеты (AppShell + Sidebar + страницы → server actions → services → prisma).
2. **Reuse через `viewer` prop.** `KpiGrid`, `EventsFeed`, `AttentionList`, `DocumentsList`, `CommentsThread` переезжают в `components/shared/` и принимают `viewer: 'partner' | 'organization' | 'admin'`. Поля, недоступные роли, отрезаются по типу.
3. **Capability passing.** Сервисы принимают `session` (или explicit orgId), фильтр по scope зашит внутри, не убираемый снаружи.
4. **Каждая фаза — один PR**, каждая task внутри — один commit.
5. **TDD-light:** integration-тесты с live Postgres для сервисов, unit-тесты с mock Prisma для server actions.
6. **Email graceful degradation.** Если `RESEND_API_KEY` пуст — silent no-op (как у партнёра).
7. **Feature flag env-driven.** UI-управляемых флагов не вводим в этой фазе.

### 2.2 Слои

```
┌────────────────────────────────────────────────────────────┐
│ Organization cabinet (Next.js 15 App Router)                │
│  /organization/* (Pages) → Server Actions → Services        │
│                                              ↓               │
│                                    src/lib/services/         │
│                                      organization/           │
│                                      - dashboard.ts          │
│                                      - orders.ts             │
│                                      - documents.ts          │
│                                      - students.ts           │
│                                      - team.ts               │
│                                      - invite.ts             │
│                                              ↓               │
│                                       Prisma / Supabase      │
└────────────────────────────────────────────────────────────┘
                                              ↑
┌────────────────────────────────────────────────────────────┐
│ Worker (BullMQ)                                              │
│  sync-orders → пишет Order.organizationId                    │
│  sync-payments → notifyOrgUsers('payment_received')          │
│  sync-documents → notifyOrgUsers('document_published')       │
└────────────────────────────────────────────────────────────┘
```

### 2.3 Карта артефактов

```
prisma/migrations/
  20260525100000_order_organization_id/                    # nullable FK + индексы
  20260605100000_order_organization_id_required/           # NOT NULL после backfill

src/lib/auth/
  requireRole.ts                                           # +requireOrganization, +requireOrganizationAdmin
  organizationPolicy.ts                                    # canSeeOrder/canSeeDocument/scopeFilter
  session.ts                                               # +organizationMemberships в payload
  login.ts                                                 # загружает memberships при login

src/lib/services/organization/
  dashboard.ts          # kpis, attention, recentEvents
  orders.ts             # listOrders, getOrder
  documents.ts          # listDocuments, getDocumentForDownload
  students.ts           # listStudents
  team.ts               # listMembers, inviteMember, updateMemberRole, deactivateMember, reactivateMember
  invite.ts             # createOrgAdminInvite (общая точка для partner и admin invites)

src/server-actions/organization/
  team.ts               # inviteOrgMember/update/deactivate/reactivateAction
  comments.ts           # postOrgCommentAction
src/server-actions/admin/
  inviteOrgAdmin.ts     # обёртка вокруг services/organization/invite
src/server-actions/partner/
  inviteOrgAdmin.ts     # обёртка с partner-policy

src/lib/email/templates/organization/
  org-invite.tsx
  document-published.tsx
  payment-received.tsx
  order-status-changed.tsx

src/lib/notifications.ts                                   # +notifyOrgUsers helper

src/worker/processors/
  sync-orders.ts                                           # +write Order.organizationId
  sync-payments.ts                                         # +trigger payment-received email
  sync-documents.ts                                        # +trigger document-published email + status diff

src/components/organization/
  org-app-shell.tsx
  org-sidebar.tsx
  invite-org-user-form.tsx
  team-table.tsx

src/components/shared/                                     # вынос из partner/
  kpi-grid.tsx
  events-feed.tsx
  attention-list.tsx
  documents-list.tsx
  comments-thread.tsx

src/app/organization/
  layout.tsx
  dashboard/page.tsx
  orders/page.tsx
  orders/[id]/page.tsx
  documents/page.tsx
  students/page.tsx
  team/page.tsx                                            # admin only

src/app/api/organization/
  documents/[id]/download/route.ts                         # signed-url + 410 на infected

src/app/partner/portfolio/[orgId]/page.tsx                 # +блок «Доступ заказчика»
src/app/admin/organizations/[id]/page.tsx                  # +блок «Доступ заказчика»

scripts/
  backfill-order-organization-id.ts                        # idempotent migration helper

src/middleware.ts                                          # +/organization/* feature gate
src/lib/featureFlags.ts                                    # +'organization_cabinet'
src/lib/navigation/cabinet.ts                              # +OrgSidebar items

src/e2e/snapshots/
  organization-dashboard.spec.ts
  organization-orders.spec.ts
  organization-documents.spec.ts
```

### 2.4 Разбивка на 7 фаз (~14-16 дней)

| Фаза | Содержание | Дни |
|---|---|---|
| **7.0 Foundation** | `Order.organizationId` nullable + sync-orders update + backfill; `requireOrganization*` guards; `organizationPolicy.ts`; session extension с `organizationMemberships` | 2 |
| **7.1 Shell + Dashboard** | `OrgAppShell`+`OrgSidebar`; вынос `KpiGrid/EventsFeed/AttentionList` в `components/shared/`; `services/organization/dashboard.ts`; `/organization/dashboard` | 2 |
| **7.2 Orders** | `services/organization/orders.ts`; `/organization/orders` (list+filter+pagination) и `/organization/orders/[id]` (detail с timeline, документами, оплатами, комментариями read-only) | 3 |
| **7.3 Documents + Students** | `services/organization/documents.ts`+`students.ts`; download route с signed URL + 410; `/organization/documents` и `/organization/students` | 2 |
| **7.4 Comments write + Email** | вынос `CommentsThread` в shared, POST через существующий `/api/comments` с org-policy; 4 email-шаблона; `notifyOrgUsers` helper; hook points в worker (sync-payments, sync-documents, sync-orders status diff) | 2 |
| **7.5 Team + Invite flows** | `services/organization/team.ts` + `invite.ts`; `/organization/team`; блок «Доступ заказчика» в `/partner/portfolio/[orgId]` и `/admin/organizations/[id]` | 2 |
| **7.6 Polish** | `Order.organizationId` → NOT NULL миграция (только если backfill 100%); feature flag `ORGANIZATION_CABINET`; Playwright snapshots; manual smoke walkthrough | 2 |

---

## 3. Data model и миграции

### 3.1 Изменения в `prisma/schema.prisma`

**Phase 7.0** (nullable):

```prisma
model Order {
  // ... existing fields ...
  organizationId String?
  organization   Organization? @relation("OrderOrganization", fields: [organizationId], references: [id])
  // ... existing fields ...

  @@index([organizationId, executionStatus])
  @@index([organizationId, financialStatus])
}

model Organization {
  // ... existing fields ...
  orders Order[] @relation("OrderOrganization")
}
```

**Phase 7.6** (после backfill):

```prisma
model Order {
  organizationId String        // NOT NULL
  organization   Organization  @relation("OrderOrganization", fields: [organizationId], references: [id])
}
```

### 3.2 Миграции

**`20260525100000_order_organization_id/migration.sql`** (Phase 7.0):

```sql
ALTER TABLE "Order" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Order_organizationId_executionStatus_idx" ON "Order"("organizationId", "executionStatus");
CREATE INDEX "Order_organizationId_financialStatus_idx" ON "Order"("organizationId", "financialStatus");
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

**`20260605100000_order_organization_id_required/migration.sql`** (Phase 7.6):

```sql
-- Pre-check: SELECT count(*) FROM "Order" WHERE "organizationId" IS NULL;
-- если > 0 — не применяем, разбираемся с остатками вручную
ALTER TABLE "Order" ALTER COLUMN "organizationId" SET NOT NULL;
```

Если останутся legacy «бесхозные» orders без `externalId` — оставляем nullable и фиксируем как known limitation; в `listOrders` они не появятся ни у одной organization.

### 3.3 Backfill — `scripts/backfill-order-organization-id.ts`

Идемпотентный, две стратегии в одном проходе:

**Strategy A — через externalId 1С** (основная):
1. `SELECT id, externalId FROM Order WHERE organizationId IS NULL AND externalId IS NOT NULL`
2. `await oneCAdapter.pullOrders({})` → batch DTO
3. для каждого matched DTO: lookup `Organization by externalId` → `UPDATE Order SET organizationId = ?`

**Strategy B — через Company heuristic** (запасная, для legacy без externalId):
1. `SELECT order WHERE organizationId IS NULL AND externalId IS NULL`
2. JOIN на Organization GROUP BY companyId HAVING count(*) = 1
3. `UPDATE Order SET organizationId = (single org in that company)`
4. orders в Company с >1 organizations — оставляем NULL, лог warn

Каждое решение пишется в `SyncLog` (`entity='backfill_order_org'`). Итоговая сводка: `{matched_via_1c, matched_via_company, left_null}`.

### 3.4 Hooks в sync processors

**`sync-orders.ts`** (Phase 7.0):

```ts
// в create:
data: { ..., organizationId: org.id }
// в update: НЕ перетираем (immutable после set);
// исключение: existing.organizationId === null (legacy) → заполняем при первом sync
```

**`sync-payments.ts`** (Phase 7.4): после `payment.create` → `notifyOrgUsers({ type: 'payment_received', organizationId, payload: {orderId, amount, paidAt} })`.

**`sync-documents.ts`** (Phase 7.4): после `document.create` → `notifyOrgUsers({ type: 'document_published', payload: {orderId, docName, docType} })`. Исключение: `document.generationSource === 'user'` AND uploader ∈ той же organization → не шлём.

**`sync-orders.ts` status diff** (Phase 7.4): после `update` — если изменился `executionStatus` или `financialStatus` → `notifyOrgUsers({ type: 'order_status_changed', ... })`.

### 3.5 `notifyOrgUsers` helper

```ts
export async function notifyOrgUsers(
  prisma: PrismaClient,
  args: {
    organizationId: string
    type: 'document_published' | 'payment_received' | 'order_status_changed'
    payload: Record<string, unknown>
  }
): Promise<void>
```

Один запрос: `SELECT u.email FROM OrganizationUser ou JOIN User u WHERE ou.organizationId = ? AND ou.isActive AND u.isActive`. Для каждого — `send({ to, react: <Template payload={...} /> })` + `Notification.create` (in-app bell).

**Rate-limit / dedupe в MVP не делаем.** При импорте 5 документов на один заказ — 5 писем. Окей для первой итерации; батчинг в Phase 8.

---

## 4. Auth, RBAC и доступ к данным

### 4.1 Session payload расширение

```ts
type SessionPayload = {
  userId: string
  email: string
  role: Role
  // existing partner extension:
  partnerId?: string
  partnerRole?: 'admin' | 'manager'
  assignedOrgIds?: string[]
  // NEW:
  organizationMemberships?: Array<{
    organizationId: string
    roleInOrg: 'admin' | 'member'
    isActive: boolean
  }>
}
```

**Загрузка при логине** (`src/lib/auth/login.ts`): после успешной проверки пароля — `SELECT organizationId, roleInOrg, isActive FROM OrganizationUser WHERE userId = ? AND isActive = true`. Кладём в JWT.

**Edge case:** user с `role='organization'` но без active OrganizationUser → не пускаем после login, returns 403 `account_not_linked_to_organization`.

### 4.2 Server-side guards

В `src/lib/auth/requireRole.ts`:

```ts
export async function requireOrganization(): Promise<Session>
// throws → redirect('/login'); проверяет role==='organization' AND
// session.organizationMemberships?.some(m => m.isActive)

export async function requireOrganizationAdmin(orgId?: string): Promise<Session>
// если orgId не передан — требует хоть одну роль admin в любой org
// если передан — требует admin именно в этой org
```

### 4.3 `organizationPolicy.ts`

```ts
export function isOrgMember(session: Session, orgId: string): boolean
export function isOrgAdmin(session: Session, orgId: string): boolean
export function activeOrgIds(session: Session): string[]

// scope filter для Prisma where clauses:
export function organizationOrgScopeFilter(session: Session): { id: { in: string[] } }
export function organizationOrderScopeFilter(session: Session): { organizationId: { in: string[] } }

// per-entity проверка после fetch (для direct URL атак):
export function canSeeOrder(session: Session, order: { organizationId: string | null }): boolean
export function canSeeDocument(session: Session, doc: { order: { organizationId: string | null } }): boolean
```

**Защита от direct-URL:** server component делает `getOrder(prisma, orgId, id)` → `canSeeOrder || notFound()`. **404, не 403** — не палим существование чужих ресурсов.

### 4.4 Middleware

В `src/middleware.ts`:

```ts
const FEATURE_PREFIXES = [
  ...existing,
  { prefix: '/organization', flag: 'organization_cabinet' }
]
```

`/organization/team` дополнительно проверяется в самой странице через `requireOrganizationAdmin(activeOrgId)`.

### 4.5 Активная organization

Если у user `organizationMemberships.length > 1` — переключение через query-param `?org=<id>` + cookie `org_ctx` с last selected.

В сервисах вызывающий code (server component) определяет `activeOrgId`:

```ts
const session = await requireOrganization()
const activeOrgId = resolveActiveOrgId(session, searchParams.org, cookies)  // helper в lib/auth/orgContext.ts
const orders = await listOrders(prisma, { organizationId: activeOrgId, ... })
```

`resolveActiveOrgId` валидирует, что выбранный orgId реально в `session.organizationMemberships` (иначе fallback на первый active).

### 4.6 Тестирование RBAC

Каждый service-метод имеет integration-тест с тремя пользователями:
1. `userA` ∈ orgA → видит orderA, не видит orderB
2. `userB` ∈ orgB → видит orderB, не видит orderA
3. `userC` ∈ orgA+orgB → видит оба
4. Direct URL `getOrder(orgA.id, orderB.id)` от userA → null/404

### 4.7 Сознательные упрощения

1. **JWT-based session**, без revocation table — после деактивации продержится до истечения JWT (1ч).
2. **Membership snapshot в JWT**, не live lookup. Новая связка видна после следующего логина.
3. **`organization_cabinet` flag — env-driven**, без UI-toggle.

---

## 5. UI и страницы

### 5.1 Навигация — `OrgSidebar`

```
Главная (Dashboard)
Заказы
Документы
Сотрудники     ← пункт виден всегда; страница покажет empty-state если students.count = 0
Команда        ← admin only (проверка через session.organizationMemberships[activeOrg].roleInOrg === 'admin')
```

**Org-selector** в top-bar (только если memberships.length > 1) — dropdown с переключением через `?org=<id>` + cookie.

**Mobile:** bottom tab bar (4 пункта — Главная/Заказы/Документы/Профиль).

### 5.2 `/organization/dashboard`

4 KPI плитки + Attention List + Events Feed.

**KPI:**
1. «Активных заказов» — count(orders WHERE executionStatus IN ('pending','in_progress'))
2. «К оплате» — sum(totalAmount - paidAmount) WHERE financialStatus IN ('billed','partially_paid')
3. «Студентов на курсе» — count(students)
4. «Документов за 30 дней» — count(documents WHERE createdAt > now-30d AND scanStatus != 'infected')

**Attention rules:**
- Заказ с `executionStatus=in_progress` AND `financialStatus=billed` AND billed >7 дней → «к оплате».
- Document с `type='act'` AND `signedAt IS NULL` AND createdAt >3 дней → «требует подписания».
- Заказ с `executionStatus=completed` AND `closedAt IS NULL` → «закрытие».

**Events feed:** merge documents/payments/audit(order_status)/comments → sort desc → take(15).

Reuse: `<KpiGrid viewer="organization" />`, `<AttentionList viewer="organization" />`, `<EventsFeed viewer="organization" />`.

### 5.3 `/organization/orders` (list)

Двухмерный фильтр (как в `/partner/deals`): executionStatus × financialStatus + search + cursor pagination (take=50).

Колонки: №, Название, Сумма, Оплачено, Исполнение, Финансы.
**Не показываем:** Партнёр, Комиссия.

Mobile: card-list.

### 5.4 `/organization/orders/[id]` (detail)

Секции:
- Заголовок (номер, название, статус-badges, менеджер, даты)
- Сумма / оплачено / срок
- Documents list (фильтр scanStatus != 'infected', кнопка «Скачать»)
- Payments list (read-only)
- Comments thread (read + write)

Reuse: `<OrderTimeline viewer="organization">` (скрывает строки `partner_commission_*`, `partner_rate_changed`), `<DocumentsList viewer="organization">` (без «Загрузить» в MVP), `<PaymentsList>`, `<CommentsThread viewer="organization">`.

### 5.5 `/organization/documents` (global)

Таблица всех документов по всем заказам активной org. Фильтры: тип, заказ, период, поиск. Колонки: дата, тип, название, заказ, скачать.

Скачивание через `GET /api/organization/documents/[id]/download`:
- Server: `requireOrganization` → `getDocumentForDownload(orgId, docId)`.
- Если `not_found` → 404; если `infected` → 410 Gone; иначе → Supabase Storage signed URL TTL=10min, 302 redirect.

### 5.6 `/organization/students`

Простая таблица (read-only). Колонки: ФИО, email, externalStudentId, дата создания. Поиск.

**Без полей прогресса** — у `Student` в схеме нет таких полей. Если позже добавим `StudentProgress` модель — расширим таблицу.

### 5.7 `/organization/team` (admin only)

Таблица членов. Колонки: ФИО, email, роль (admin/member), статус (актив/деакт), действия.

**Кнопки:**
- «+ Пригласить участника» → modal (email/name/role) → `inviteOrgMemberAction`.
- «Сменить роль» → `updateOrgMemberRoleAction`.
- «Деактивировать» / «Возобновить» → соответствующие actions.

**Бизнес-инварианты:**
- В каждой active organization должен быть ≥1 active admin.
- Запрет на self-deactivation (`actorUserId === targetUserId` → throw).
- Запрет на demote / deactivate последнего admin.

Все нарушения возвращают понятный error string из action.

### 5.8 Блоки в существующих кабинетах

**`/partner/portfolio/[orgId]`** (Phase 7.5):

```
Доступ заказчика
Пользователей в кабинете: N
[Список существующих org-users, read-only]
[+ Пригласить администратора]   ← если ни одного active admin нет
```

После клика — modal (email/name) → server action `invitePartnerOrgAdminAction` (требует partner-admin, проверяет `partnerOrgScopeFilter`). Создаёт User + OrganizationUser(admin) + invite-token. Возвращает inviteUrl или email-sent статус.

**`/admin/organizations/[id]`** (Phase 7.5):

Идентичный блок, action `inviteOrgUserAction` (platform-admin), без partner-policy.

### 5.9 Layout — `OrgAppShell`

Зеркало `AdminAppShell` / `PartnerAppShell`. Top bar: логотип, название организации, dropdown профиль/выход. Sidebar 240px / drawer на mobile. Content `max-w-1280`, padding 24px.

---

## 6. Сервисы и API

### 6.1 `services/organization/dashboard.ts`

```ts
export type OrgKpiTile = { label: string; value: string | number; delta?: { value: number; positive: boolean } }
export type OrgAttentionItem = { id: string; title: string; href: string; severity: 'warn' | 'urgent' }
export type OrgEventItem = { id: string; verb: string; entity: string; entityHref: string; timestamp: Date }

export async function kpis(prisma, organizationId: string): Promise<OrgKpiTile[]>
export async function attention(prisma, organizationId: string): Promise<OrgAttentionItem[]>
export async function recentEvents(prisma, organizationId: string, take?: number): Promise<OrgEventItem[]>
```

### 6.2 `services/organization/orders.ts`

```ts
type ListOrdersOptions = {
  organizationId: string
  executionStatus?: ExecutionStatus
  financialStatus?: FinancialStatus
  q?: string
  take?: number
  cursor?: string
}

type OrderRow = {
  id: string; orderNumber: string | null; title: string
  totalAmount: number; paidAmount: number
  executionStatus: ExecutionStatus; financialStatus: FinancialStatus
  deadline: Date | null; managerName: string | null
}

type OrderDetail = OrderRow & {
  contractSignedAt: Date | null; completedAt: Date | null; closedAt: Date | null
  vatIncluded: boolean; productMix: string[]
  documents: DocumentRow[]; payments: PaymentRow[]; commentsCount: number
}

export async function listOrders(prisma, opts): Promise<{ rows: OrderRow[]; nextCursor: string | null }>
export async function getOrder(prisma, orgId: string, orderId: string): Promise<OrderDetail | null>
```

`getOrder` принимает `orgId` отдельно. Возвращает `null` если order не привязан к этой org — page → `notFound()`.

### 6.3 `services/organization/documents.ts`

```ts
type ListDocumentsOptions = {
  organizationId: string
  type?: DocumentType; orderId?: string
  from?: Date; to?: Date; q?: string
  take?: number; cursor?: string
}

type DocumentRow = {
  id: string; type: DocumentType; name: string
  size: number | null; mimeType: string
  createdAt: Date; orderId: string; orderNumber: string | null
  signedAt: Date | null
}

type DownloadResult =
  | { ok: true; path: string; mimeType: string; name: string }
  | { ok: false; error: 'not_found' | 'infected' }

export async function listDocuments(prisma, opts): Promise<{ rows: DocumentRow[]; nextCursor: string | null }>
export async function getDocumentForDownload(prisma, orgId: string, docId: string): Promise<DownloadResult>
```

### 6.4 `services/organization/students.ts`

```ts
export async function listStudents(
  prisma,
  opts: { organizationId: string; q?: string; take?: number; cursor?: string }
): Promise<{ rows: StudentRow[]; nextCursor: string | null }>
```

### 6.5 `services/organization/team.ts`

```ts
type OrgMemberRow = {
  organizationUserId: string; userId: string
  email: string; name: string
  roleInOrg: 'admin' | 'member'
  isActive: boolean; invitedAt: Date
  lastLoginAt: Date | null  // null в MVP
}

export async function listMembers(prisma, orgId: string): Promise<OrgMemberRow[]>

export async function inviteMember(
  prisma,
  args: { organizationId: string; email: string; name: string; roleInOrg: 'admin' | 'member' },
  actorUserId: string
): Promise<{ user: { id: string; email: string }; inviteUrl: string | null; alreadyHasPassword: boolean }>
// inviteUrl: null если у user уже стоит passwordHash (re-invite не нужен — просто добавлена связка)
// alreadyHasPassword: true в том же случае; action использует для UX-сообщения «пользователь уже зарегистрирован, доступ к org предоставлен»

export async function updateMemberRole(prisma, orgUserId: string, newRole: 'admin' | 'member', actorUserId: string): Promise<void>
export async function deactivateMember(prisma, orgUserId: string, actorUserId: string): Promise<void>
export async function reactivateMember(prisma, orgUserId: string, actorUserId: string): Promise<void>
```

`inviteMember` транзакция:
1. Найти или создать User (email unique; если существует с `passwordHash !== null` — переиспользуем активный аккаунт).
2. Если у User уже есть OrganizationUser с этим orgId AND `isActive=true` → throw `OrgMemberError('already_member')`.
3. Если есть с `isActive=false` → реактивируем `update({isActive:true, roleInOrg})`.
4. Иначе `OrganizationUser.create`.
5. Если `user.passwordHash === null` (новый user или не активированный) → `createInviteToken(userId)`, вернуть `inviteUrl`. Иначе `inviteUrl = null`, `alreadyHasPassword = true`.
6. `recordAudit('org_member_invited', { before: null, after: {...} })`.

### 6.6 `services/organization/invite.ts`

```ts
export async function createOrgAdminInvite(
  prisma,
  args: { organizationId: string; email: string; name: string },
  actorUserId: string,
  source: 'partner' | 'platform_admin'
): Promise<{ inviteUrl: string; userId: string }>
```

Внутри: lookup org → policy check (partner может только для своих org через `partnerOrgScopeFilter`) → `inviteMember` с `role='admin'`. Audit поле `meta.source` для трассировки.

### 6.7 Server Actions

**`src/server-actions/organization/team.ts`:**

```ts
export async function inviteOrgMemberAction(formData: FormData): Promise<Result<{ inviteUrl?: string }>>
export async function updateOrgMemberRoleAction(orgUserId: string, newRole: 'admin'|'member'): Promise<Result>
export async function deactivateOrgMemberAction(orgUserId: string): Promise<Result>
export async function reactivateOrgMemberAction(orgUserId: string): Promise<Result>
```

Каждый: `requireOrganizationAdmin(orgId)` сначала, Zod validate, ловит `OrgMemberError` → `{ok:false, error}`, `revalidatePath('/organization/team')`.

**`src/server-actions/organization/comments.ts`:**

```ts
export async function postOrgCommentAction(orderId: string, formData: FormData): Promise<Result>
```

`requireOrganization` → `getOrder(activeOrgId, orderId)` → `canSeeOrder || throw` → `comment.create` → `recordAudit('comment_posted')` → `revalidatePath(/organization/orders/[id])`. **Не** шлём email (комменты на менеджера будут через manager-кабинет в Phase 8+).

**`src/server-actions/admin/inviteOrgAdmin.ts`** и **`src/server-actions/partner/inviteOrgAdmin.ts`** — тонкие обёртки вокруг `services/organization/invite.createOrgAdminInvite`.

### 6.8 API Routes

- `POST /api/comments` (существующий) — расширяем branch для `session.role === 'organization'` с `canSeeOrder` проверкой.
- `GET /api/organization/documents/[id]/download` — signed-url + 410 на infected.

`POST /api/organization/comments` отдельный endpoint не делаем — Server Action достаточно.

### 6.9 Email шаблоны

`src/lib/email/templates/organization/`:
- **`org-invite.tsx`** — «Вы приглашены в кабинет организации {orgName}. Установите пароль:» CTA → inviteUrl.
- **`document-published.tsx`** — «На заказ {orderNumber} загружен документ {docName}». CTA → `/organization/orders/[id]`.
- **`payment-received.tsx`** — «Получена оплата {amount} ₽ по заказу {orderNumber}». CTA → `/organization/orders/[id]`.
- **`order-status-changed.tsx`** — «Статус заказа {orderNumber} изменён: {oldStatus} → {newStatus}». CTA → `/organization/orders/[id]`.

### 6.10 Что НЕ делаем в сервисах/API

1. Bulk operations (выгрузить все доки за период архивом) — Phase 8+.
2. Saved views для organization — отдельная задача.
3. CSV/XLSX экспорт списков — отложено.
4. WebSocket live-updates — нет, refresh через revalidate.
5. Rate-limiting на API/actions — отложено.

---

## 7. Тестовое покрытие

| Phase | Что тестируем | Прирост |
|---|---|---|
| 7.0 | session extension; requireOrganization*; policy helpers; sync-orders с organizationId; backfill script idempotency | +25 |
| 7.1 | dashboard service (live PG) — kpis, attention, events | +10 |
| 7.2 | orders service (RBAC scenarios: 3 users × 4 orders); page integration | +15 |
| 7.3 | documents service (filter, hide infected); students service; download route 410/302 | +10 |
| 7.4 | comments POST с org viewer; email templates render; notifyOrgUsers helper | +10 |
| 7.5 | team service (last admin protection, self-deactivation); invite flow E2E | +15 |
| 7.6 | feature flag gating; Playwright snapshots (3 spec); NOT NULL migration safety | +5 |
| **Total** | | **~90 новых тестов** (итого ~470-490) |

---

## 8. Метрики приёмки

```
✓ npm run typecheck   → 0 errors
✓ npm run lint        → 0 new warnings
✓ npm test            → все existing + ~90 новых passing (~470-490)
✓ npm run build       → успешный, новые роуты в выводе:
    /organization/dashboard, /organization/orders, /organization/orders/[id],
    /organization/documents, /organization/students, /organization/team,
    /api/organization/documents/[id]/download
✓ npx prisma migrate status → all applied
✓ scripts/backfill-order-organization-id.ts → 0 critical warns
```

### 8.1 Manual smoke walkthrough

1. Через `/admin/organizations/[id]` пригласить admin'а тестовой Organization.
2. Получить invite-link → reset-password → login → редирект на `/organization/dashboard`.
3. Dashboard: 4 KPI, attention реальный, events последние 15.
4. `/organization/orders`: только заказы своей org; фильтр+pagination работают.
5. `/organization/orders/[id]`: timeline без commission-строк; документы без infected; написать комментарий → виден в треде.
6. `/organization/documents`: фильтр по типу=invoice; «Скачать» → 302 → signed URL.
7. `/organization/students`: список студентов своей org.
8. Пригласить второго юзера с ролью `member` → залогиниться → `/organization/team` недоступен; остальные пункты sidebar видны.
9. RBAC sanity: открыть `/organization/orders/[id]` чужой org как user1 → 404.
10. Через worker дёрнуть `sync-payments` с тестовым payment → org-users получают email; in-app bell обновляется.
11. Под partner-admin зайти в `/partner/portfolio/[orgId]` → invite второго org-admin → invite работает.
12. Под org-admin попытаться деактивировать единственного админа → action error.

---

## 9. Rollout strategy

`FEATURE_ORGANIZATION_CABINET = 0` в `.env.example` (default).

| Stage | Что | Кто | Длительность |
|---|---|---|---|
| 1 | Deploy в main, flag=0. Схема мигрирована, backfill отработал, sync-orders пишет organizationId. Кабинет 404 | dev | сразу после PR merge |
| 2 | flag=1 на staging; команда Промтехносферы заходит как test-org, валидирует UX | QA + team | 1-2 недели |
| 3 | flag=1 в prod для одной пилотной organization | product | 2 недели |
| 4 | flag=1 для всех; partner-admin'ы получают сообщение «теперь можно пригласить заказчиков» | full rollout | финал |

**Откат:** flag=0 → 404 на `/organization/*`, partner/admin кабинеты не задеты. `Order.organizationId` остаётся read-only полем, sync-orders продолжает писать (idempotent).

### 9.1 Backwards compatibility

| Изменение | Влияние на partner/admin | Митигация |
|---|---|---|
| `Order.organizationId` nullable → required | partner orders резолвят организацию через Company; новое поле read-only для них | None — partner queries не используют `organizationId` |
| Вынос `KpiGrid` в `components/shared/` | imports в partner pages нужно обновить | Один commit с массовым импорт-rewrite, TypeScript ловит |
| `Comment.create` теперь принимает `role='organization'` авторов | partner/admin auth flows не задеты | Existing partner-comment-flow тесты должны зеленеть |
| Sync processors добавляют `notifyOrgUsers` | если RESEND не настроен — silent no-op | Existing graceful degradation |

---

## 10. Зависимости

**Новых npm-пакетов нет.** Используем уже установленные: `bcryptjs`, `zod`, `resend`, `@react-email/components`, `@prisma/client`.

Новые env-переменные:
- `FEATURE_ORGANIZATION_CABINET` (default `0`)

---

## 11. Открытые вопросы (defaults без блокировки)

| # | Вопрос | Default |
|---|---|---|
| 1 | Что показывать на dashboard новой organization без данных? | Empty-state: «попросите менеджера привязать первый заказ» |
| 2 | Org-admin видит деактивированных team members? | Да, в отдельной секции под основной таблицей |
| 3 | Двойной invite одного email от партнёра и платформы? | Игнор: User email unique; existing user получает новую/реактивированную OrganizationUser связку. `inviteUrl=null` если passwordHash уже стоит — UI показывает «пользователь уже зарегистрирован, доступ предоставлен» |
| 4 | Показывать комиссию партнёра org-юзеру? | НЕТ — `viewer="organization"` отрезает |
| 5 | Audit-viewer для org-admin (логи скачиваний)? | НЕТ в MVP. Audit пишется, UI viewer отложен |
| 6 | Notification preferences (mute, digest)? | Phase 8 — пока всем-всё |
| 7 | Re-invite token при реактивации member с уже стоящим паролем? | НЕТ — пароль есть, просто реактивируем связку |
| 8 | Что если Organization сама деактивирована (`Organization.isActive` в Phase 8)? | Не в скоупе Phase 7 |

---

## 12. Сознательные упрощения Phase 7

1. **Документы read-only** — загрузки/подписи от org — Phase 8 (вместе с Контур.Диадок).
2. **Org-selector через query-param + cookie**, не path-segment — меньше рефакторинга URL'ов, ок для MVP.
3. **Notifications без preferences** — всем-всё.
4. **No comment notifications** — org-юзер пишет коммент, manager узнаёт через manager-кабинет когда он появится (Phase 9+).
5. **No mobile push** — email достаточно.
6. **Single timezone** Europe/Moscow.
7. **Org context без breadcrumb-баннера** — только название в top-bar и dropdown переключатель.
8. **Membership snapshot в JWT** — новая связка видна после relogin (TTL 1ч).

---

## 13. Что НЕ делаем в Phase 7 (отложено)

- Manager и Student кабинеты — Phase 8+.
- Document upload / signing от organization — Phase 8 + Контур.Диадок.
- Notification preferences UI — Phase 8.
- Comment notifications в сторону manager — Phase 9+ (вместе с manager-кабинетом).
- Bulk download (zip за период) — Phase 8+.
- Saved views для organization — Phase 8+.
- CSV/XLSX экспорт списков — Phase 8+.
- WebSocket / SSE для live-updates — overkill для MVP.
- BI-аналитика для organization — отдельный продукт.
- Telegram-бот, Web Push — не в скоупе кабинета.

---

## 14. Связанные документы

- `docs/superpowers/specs/2026-05-21-partner-cabinet-design.md` — партнёрский spec (зеркальный pattern, многие концепции применимы).
- `docs/superpowers/specs/2026-05-24-admin-cabinet-mvp-design.md` — admin spec (AppShell pattern, requireAdmin/recordAudit).
- `prisma/schema.prisma` — точка входа для миграций.
- `src/middleware.ts` — текущий RBAC и feature flags gating.
- `src/lib/services/partner/*` — pattern сервис-слоя для зеркального переноса.

---

**После завершения Phase 7:** PR на main, заголовок `feat(phase7): Organization cabinet — RBAC, dashboard, orders/docs/students, team management, email notifications`. После merge → Stage 1 rollout. Дальше Phase 8 (manager-кабинет или полировка organization — TBD по фидбеку).
