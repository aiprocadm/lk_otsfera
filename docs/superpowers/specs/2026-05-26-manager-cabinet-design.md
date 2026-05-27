# Phase 8 — Manager Cabinet Design Spec

**Status:** Draft for plan generation
**Date:** 2026-05-26
**Author:** brainstormed with Claude during session 2026-05-26
**Predecessor:** [Phase 7 — Organization Cabinet](2026-05-25-organization-cabinet-design.md)

## 1. Goal

Полнофункциональный кабинет для внутреннего менеджера Промтехносферы: видит свои закреплённые заказы и организации, отвечает на комментарии клиентов, загружает документы, меняет execution-статусы. Двусторонние нотификации с organization-стороной. Назначения управляются platform-admin'ом.

**Not goals (deferred to Phase 9+):**

- Подпись актов (Контур.Диадок) — вместе с organization-side upload.
- Notification preferences UI (mute/digest).
- Partner-admin как назначающая сторона для менеджеров (менеджер — internal Промтехносфера-staff).
- Создание manager-юзеров вне сценария «invite в modal'е» (отдельный admin user-management уже существует).
- Студенческий кабинет.

## 2. Architecture overview

Зеркало org-кабинета (Phase 7) с обратной стороны диалога. Те же принципы:

1. **Каждая task — один git commit.** При падении тестов внутри task — fix-up, не amend.
2. **TDD-light:** для сервисов — integration-тесты с live Postgres; для server actions — unit с mock prisma.
3. **Sibling components (`manager-*`)** по правилу из `feedback-component-reuse`: parallel siblings вместо `components/shared/` + viewer prop, за исключением чисто-presentational + domain-agnostic типов (`DealStatusBadge`, `StatCard`) и компонентов с узкой URL-параметризацией (`DocumentsList` через `downloadEndpointBase`).
4. **Server Actions over API routes** для всех мутаций кабинета (status-change, admin assignments). API routes только там где нужен multipart (upload) или extension существующего endpoint (POST /api/comments).
5. **Service-layer scope filtering + page-level `canSee*` check** — defense-in-depth per `feedback-org-rbac-defense-in-depth`.
6. **`canSeeOrder` оставляет null-checks** даже на полях которые формально NOT NULL — runtime safety net.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind, Prisma (PostgreSQL), Vitest, Playwright, Resend (email), Server Actions, BullMQ, JWT cookie auth — без новых npm-зависимостей.

**Branch:** `claude/manager-cabinet-phase8` (создать от `origin/main` после fetch).

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Phase 8.0 — Foundation                                                  │
│   prisma migrations:                                                    │
│     - 20260527100000_organization_manager                               │
│     (новая таблица + (managerId, executionStatus) + (authorId, orderId) │
│      на Comment)                                                        │
│   schema: OrganizationManager, Order.@@index, Comment.@@index           │
│   src/lib/auth/requireRole.ts          (+requireManager*)               │
│   src/lib/auth/managerPolicy.ts        (NEW — scope filters, canSee*)   │
│   src/lib/auth/policy.ts               (refactor manager branches)      │
│   src/lib/auth/session.ts              (+managedOrgIds)                 │
│   src/lib/auth/login.ts                (load managedOrgIds at login)    │
│                                                                         │
│ Phase 8.1 — Shell + Dashboard                                           │
│   src/components/manager/manager-app-shell.tsx                          │
│   src/components/manager/manager-sidebar.tsx                            │
│   src/components/manager/manager-kpi-grid.tsx                           │
│   src/components/manager/manager-attention-list.tsx                     │
│   src/components/manager/manager-events-feed.tsx                        │
│   src/lib/services/manager/dashboard.ts                                 │
│   src/app/manager/layout.tsx           (rewrite — uses ManagerAppShell) │
│   src/app/manager/dashboard/page.tsx   (rewrite — real KPIs + RBAC)     │
│                                                                         │
│ Phase 8.2 — Orders + status change                                      │
│   src/lib/services/manager/orders.ts                                    │
│   src/lib/services/manager/status.ts                                    │
│   src/components/manager/manager-orders-filter.tsx                      │
│   src/components/manager/manager-orders-table.tsx                       │
│   src/components/manager/manager-order-header.tsx                       │
│   src/components/manager/manager-order-amounts.tsx                      │
│   src/components/manager/manager-order-timeline.tsx                     │
│   src/components/manager/manager-payments-list.tsx                      │
│   src/components/manager/manager-status-change-form.tsx                 │
│   src/server-actions/manager/transitionOrderStatus.ts                   │
│   src/app/manager/orders/page.tsx                                       │
│   src/app/manager/orders/[id]/page.tsx                                  │
│                                                                         │
│ Phase 8.3 — Documents + Organizations + Students                        │
│   src/lib/services/manager/documents.ts                                 │
│   src/lib/services/manager/organizations.ts                             │
│   src/lib/services/manager/students.ts                                  │
│   src/components/manager/manager-orgs-list.tsx                          │
│   src/components/manager/manager-org-card.tsx                           │
│   src/components/manager/manager-students-table.tsx                     │
│     (or reuse org sibling if domain types align)                        │
│   src/app/manager/documents/page.tsx       (rewrite)                    │
│   src/app/manager/organizations/page.tsx                                │
│   src/app/manager/organizations/[id]/page.tsx                           │
│   src/app/manager/students/page.tsx                                     │
│   src/app/api/manager/documents/[id]/download/route.ts                  │
│                                                                         │
│ Phase 8.4 — Write paths + Notifications                                 │
│   src/components/manager/manager-doc-upload-form.tsx                    │
│   src/components/manager/manager-messages-inbox.tsx                     │
│   src/app/api/manager/documents/[orderId]/upload/route.ts               │
│   src/app/api/comments/route.ts        (+viewer='manager' branch)       │
│   src/lib/email/templates/manager/comment-from-org.tsx                  │
│   src/lib/email/templates/manager/document-uploaded-by-org.tsx          │
│   src/lib/email/templates/manager/order-marked-paid-by-1c.tsx           │
│   src/lib/email/templates/manager/order-status-changed.tsx              │
│   src/lib/email/templates/organization/manager-replied.tsx              │
│   src/lib/notifications.ts             (+notifyManagers)                │
│   src/worker/processors/sync-payments.ts                                │
│     (+notifyManagers hook alongside existing notifyOrgUsers)            │
│   src/app/manager/messages/page.tsx    (rewrite)                        │
│                                                                         │
│ Phase 8.5 — Admin assign UI                                             │
│   src/lib/services/manager/invite.ts                                    │
│   src/lib/services/manager/team.ts                                      │
│   src/server-actions/admin/manager.ts                                   │
│   src/lib/email/templates/manager/invite.tsx                            │
│   src/components/admin/managers-block.tsx                               │
│   src/components/admin/assign-or-invite-manager-form.tsx                │
│   src/app/admin/organizations/[id]/page.tsx   (+Менеджеры block)        │
│                                                                         │
│ Phase 8.6 — Polish                                                      │
│   src/lib/featureFlags.ts        (+'manager_cabinet')                   │
│   src/middleware.ts              (+/manager/* gate)                     │
│   src/lib/navigation/cabinet.ts  (+manager sidebar items, if applicable)│
│   .env.example                   (+FEATURE_MANAGER_CABINET=0)           │
│   src/e2e/snapshots/manager-dashboard.spec.ts                           │
│   src/e2e/snapshots/manager-orders.spec.ts                              │
│   src/e2e/snapshots/manager-documents.spec.ts                           │
│   manual smoke walkthrough (see §10.1)                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. Data model

### 3.1 New table `OrganizationManager`

```prisma
model OrganizationManager {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation("OrganizationManagers", fields: [organizationId], references: [id], onDelete: Cascade)
  userId         String
  user           User         @relation("UserManagedOrgs", fields: [userId], references: [id], onDelete: Cascade)
  isActive       Boolean      @default(true)
  assignedAt     DateTime     @default(now())
  assignedBy     String?
  deactivatedAt  DateTime?

  @@unique([organizationId, userId])
  @@index([userId, isActive])
}
```

Back-relations:

- `Organization.managers OrganizationManager[] @relation("OrganizationManagers")`
- `User.managedOrganizations OrganizationManager[] @relation("UserManagedOrgs")`

Все assignments создаются platform-admin'ом через UI на `/admin/organizations/[id]` (§9). При создании нового OrganizationManager actor user.id пишется в `assignedBy` для аудита.

### 3.2 Existing field reuse — `Order.managerId`

Уже в схеме (line 396): `managerId String? @relation("OrderManager")`. Поле опциональное.

**Текущее состояние данных:** verified via grep — никакой код (`sync-orders`, seed, server actions) **не пишет** `Order.managerId`. В prod это поле сейчас всегда `NULL`. 1С-adapter не отдаёт manager в payload (см. `src/lib/services/oneCSync/*`).

**Phase 8 решение:** добавить admin server action `assignOrderManagerAction(orderId, managerUserId | null)` в §9.1, доступный с `/admin/orders/[id]` (или с per-order modal'а на `/admin/organizations/[id]` orders list — точное место решается в Phase 8.5). Это активирует per-order RBAC path. Если решим не делать admin UI для этого в Phase 8 — per-order path останется defensive code path без живых данных, что всё равно корректно (просто избыточно). Default: **делаем admin assign-order-manager UI** — minimal effort (один action + один button в существующей admin order detail).

### 3.3 Новые индексы

```prisma
// Order
@@index([managerId, executionStatus])  // дашборд "активные заказы менеджера"

// Comment
@@index([authorId, orderId])  // быстрый EXISTS для comments-history RBAC path
```

### 3.4 Session payload extension

В `SessionPayload` (src/lib/auth/jwt.ts либо session.ts — точное место по реализации) добавить:

```ts
managedOrgIds?: string[]
```

Заполняется при login если `user.role === 'manager'`:

```ts
const assigned = await prisma.organizationManager.findMany({
  where: { userId: user.id, isActive: true },
  select: { organizationId: true }
})
managedOrgIds = assigned.map(a => a.organizationId)
// Empty array is OK — manager без assignments видит пустой кабинет;
// requireManager() пропускает их, страницы показывают empty state.
```

### 3.5 Migration safety

Миграция `20260527100000_organization_manager`:

1. CREATE TABLE OrganizationManager …
2. CREATE UNIQUE INDEX … ON OrganizationManager (organizationId, userId)
3. CREATE INDEX … ON OrganizationManager (userId, isActive)
4. CREATE INDEX … ON "Order" (managerId, executionStatus)
5. CREATE INDEX … ON Comment (authorId, orderId)

Безопасно применять на prod ДО включения `FEATURE_MANAGER_CABINET`: таблица пустая, индексы только улучшают существующие запросы. Backfill не нужен.

## 4. Auth & RBAC

### 4.1 Guards in `src/lib/auth/requireRole.ts`

```ts
export async function requireManager(): Promise<Session>
// throws → redirect('/login')
// требует: session.role === 'manager' AND session.managedOrgIds !== undefined
// (даже пустой managedOrgIds OK — менеджер без назначений увидит empty state)

export async function requireManagerForOrg(orgId: string): Promise<Session>
// requireManager() + isOrgInScope(session, orgId) || redirect('/manager/dashboard')

export async function requireManagerForOrder(orderId: string): Promise<{ session: Session; order: OrderWithScope }>
// requireManager() + fetch order + canSeeOrder check
// возвращает session + загруженный order чтобы caller не делал двойной fetch
```

### 4.2 `src/lib/auth/managerPolicy.ts`

```ts
export function managedOrgIds(session: Session): string[]
// session.managedOrgIds ?? []

export function managerOrderScopeFilter(session: Session): Prisma.OrderWhereInput {
  return {
    OR: [
      { managerId: session.userId },
      { organizationId: { in: managedOrgIds(session) } },
      { comments: { some: { authorId: session.userId } } }
    ]
  }
}

export function managerDocumentScopeFilter(session: Session): Prisma.DocumentWhereInput
// where: { order: managerOrderScopeFilter(session), scanStatus: { not: 'infected' } }

export function managerOrgScopeFilter(session: Session): Prisma.OrganizationWhereInput
// { id: { in: managedOrgIds(session) } }

export function canSeeOrder(
  session: Session,
  order: { id: string; managerId: string | null; organizationId: string | null; commentsCountByMe?: number }
): boolean
// match по любому из трёх criteria; commentsCountByMe передаётся caller'ом если
// detail page подключал `comments: { where: { authorId: me }, take: 1 }` к include

export function canSeeDocument(
  session: Session,
  doc: { order: { managerId: string | null; organizationId: string | null } }
): boolean
// canSeeOrder(session, doc.order) — без comments-history check для простоты;
// document без visible order — defensively false

export function canSeeOrganization(session: Session, orgId: string): boolean
// managedOrgIds(session).includes(orgId)

export function isOrgInScope(session: Session, orgId: string): boolean
// alias for canSeeOrganization (читаемее в местах "guard")
```

**Принципы:**

- Все scope-filters возвращают Prisma `WhereInput` — caller спокойно мерджит в свой `where`.
- `canSeeOrder` имеет два режима — без comments-history (быстро, для list rendering после service-level filter) и с comments-history (через `commentsCountByMe`, для direct-URL детальной страницы).
- Никакого `as any` cast'а ради null-shotgun'а; типы Prisma'ы матчат явные nullable поля.

### 4.3 Refactor of existing `src/lib/auth/policy.ts`

Сейчас в файле:

- `canReadOrder` для `role === 'manager'` (line 53) — проверяет `OrganizationUser` membership через `companyId`. **Wrong model** для cabinet'а — менеджер не клиент, он internal-staff.
- `canAccessOrganization` для `role === 'manager'` (line 27) — то же.

Refactor (как часть Phase 8.0):

```ts
// canReadOrder, manager branch:
if (session.role === 'manager') {
  const fullOrder = await prisma.order.findUnique({
    where: { id: order.id },
    select: { id: true, managerId: true, organizationId: true }
  })
  if (!fullOrder) return false
  // managerPolicy.canSeeOrder without comments-history is fine here —
  // history-only visibility is checked separately in services/manager
  // when needed; this top-level guard is the strict-assignment one.
  return managerPolicy.canSeeOrder(session, fullOrder)
}
```

```ts
// canAccessOrganization, manager branch:
if (session.role === 'manager') {
  return managerPolicy.canSeeOrganization(session, organizationId)
}
```

**Important:** этот refactor НЕ под feature flag — он фиксит существующую багу (текущая `policy.ts` для manager-роли семантически неправильно). Применяется всегда. Тесты, существующие для `/api/documents` и `/api/notifications` (роли manager), должны пройти после refactor'а — они проверяют end-to-end "manager видит assigned order's documents/notifications", и теперь "assigned" определяется правильно (через `OrganizationManager` + `Order.managerId`, а не `OrganizationUser`).

### 4.4 Defense-in-depth checklist (per memory)

Каждая `/manager/*` page MUST:

1. Вызвать `requireManager()` или `requireManagerForOrg/Order(...)`.
2. Использовать service с `managerOrderScopeFilter`-style фильтром в `where`.
3. Для detail-страниц: после fetch'а вызвать `canSeeOrder/canSeeDocument` ещё раз (даже если service фильтровал). Защита от direct-URL probing.

## 5. UI / Pages

### 5.1 Route tree

| Route | Purpose |
|---|---|
| `/manager/dashboard` | KPIs + attention + recent events; widget'ы скейлятся на 1–4 column по brаkpoint'ам |
| `/manager/orders` | список scope'ных заказов с двух-измерительным фильтром (execution × financial), поиском, pagination |
| `/manager/orders/[id]` | header + amounts + timeline + documents + payments + comments thread (write) + status-change form (если transitions доступны) + doc-upload form |
| `/manager/organizations` | таблица закреплённых организаций |
| `/manager/organizations/[id]` | overview одной org: контакты, последние заказы, recent activity |
| `/manager/documents` | все документы scope'ные; filter по type/orderId/date; download через signed URL |
| `/manager/students` | сотрудники organizations'а scope; фильтр по `organizationId IN managedOrgIds` |
| `/manager/messages` | centralized inbox: incoming comments от org-side за последние 30 дней (+outgoing для контекста, visually отличаемые); клик → order detail |

Старые stub файлы (`/manager/{dashboard,orders,documents,messages}/page.tsx`, `layout.tsx`, `loading.tsx`) **перезаписываются**. Существующий `loading.tsx` (12 lines, skeleton) можно сохранить почти как есть с минимальной доработкой под нужное количество колонок.

### 5.2 Component plan — `manager-*` siblings

Создаются по правилу `feedback-component-reuse`: parallel siblings когда тип привязан к manager-specific domain'у, narrow optional props когда меняется только endpoint, direct reuse если presentational + domain-agnostic.

| Новый компонент | Mirrors | Заметки |
|---|---|---|
| `manager-app-shell.tsx` | `org-app-shell.tsx`, `admin-app-shell.tsx` | header «Кабинет менеджера» + user dropdown |
| `manager-sidebar.tsx` | `org-sidebar.tsx` | 7 пунктов; no multi-org selector (flat scope) |
| `manager-kpi-grid.tsx` | `org-kpi-grid.tsx` | KPIs: Активные заказы / Требует внимания / Непрочитанные комментарии / Срочные дедлайны |
| `manager-attention-list.tsx` | `org-attention-list.tsx` | severity warn/urgent правила (см. §6.1) |
| `manager-events-feed.tsx` | `org-events-feed.tsx` | объединяет docs/payments/status-changes/comments из scope |
| `manager-orders-filter.tsx` | `org-orders-filter.tsx` | two-dim status + search + (new) фильтр по organizationId |
| `manager-orders-table.tsx` | `org-orders-table.tsx` | колонка «Организация» (плоско по scope), без commission/partner-rate |
| `manager-order-header.tsx` | `org-order-header.tsx` | |
| `manager-order-amounts.tsx` | `org-order-amounts.tsx` | |
| `manager-order-timeline.tsx` | `org-order-timeline.tsx` | скрывает partner-commission строки; ПОКАЗЫВАЕТ строки «статус изменён менеджером» |
| `manager-payments-list.tsx` | `org-payments-list.tsx` | |
| `manager-orgs-list.tsx` | (новый) | |
| `manager-org-card.tsx` | (новый) | summary card с recent activity |
| `manager-messages-inbox.tsx` | (новый) | сгруппированная лента входящих org-комментариев |
| `manager-students-table.tsx` | возможен прямой reuse `org-students-table` через optional `viewer` prop — решить при чтении org-side кода | |
| `manager-status-change-form.tsx` | (новый) | client form: select status → server action |
| `manager-doc-upload-form.tsx` | (новый) | client form: file picker + type select |

### 5.3 Direct reuse без модификаций

- `DocumentsList` (`src/components/partner/documents-list.tsx`) через `downloadEndpointBase="/api/manager/documents"`.
- `DealStatusBadge` (consumes domain-agnostic `Stage`).
- `StatCard`.
- `CommentsThread` (sibling используемый Phase 7'ом) — direct reuse с `viewer='manager'`. Компонент уже dispatch'ит POST на `/api/comments`.

## 6. Services

Все в `src/lib/services/manager/*`. Первый аргумент — `prisma` (project convention). Integration-tested против live Postgres.

### 6.1 `dashboard.ts`

```ts
kpis(prisma, session): Promise<{
  activeOrders: number; activeOrdersDelta: number;  // -30d
  attentionCount: number;
  unreadComments: number;                            // см. определение ниже
  urgentDeadlines: number;                            // см. определение ниже
}>

// unreadComments = COUNT(Notification WHERE userId=session.userId AND isRead=false AND type='comment_from_org').
//   Метрика «висит в inbox сейчас», не trend. Никаких новых таблиц/полей — переиспользуем существующий Notification.isRead flag,
//   тот же который драйвит in-app bell.
// urgentDeadlines = COUNT(Order in scope WHERE deadline IS NOT NULL AND deadline < now()+3d AND executionStatus NOT IN ('completed','closed')).
//   Completed/closed заказы исключаются даже с просроченным deadline'ом (per §11 default).

attention(prisma, session): Promise<AttentionItem[]>
// severity 'warn'/'urgent' rules:
//   urgent: order overdue >7d (deadline < now-7d, не completed)
//   urgent: новый org-comment > 24h без ответа manager'а
//   warn: documents type='act' not signed > 3d
//   warn: executionStatus=in_progress без активности (no updates) > 14d

recentEvents(prisma, session, take=15): Promise<EventItem[]>
// merge: документы (createdAt), payments (paidAt), audit log (kind in ['order_status_changed','comment_posted']), последние комментарии
// все из scope'а; sort desc; slice
```

### 6.2 `orders.ts`

```ts
listOrders(prisma, opts): Promise<{ rows: OrderRow[]; nextCursor: string | null }>
// opts: { session, q?, executionStatus?, financialStatus?, organizationId?, take=50, cursor? }
// where = AND([managerOrderScopeFilter(session), ...filters])

getOrder(prisma, session, orderId): Promise<OrderDetail | null>
// findUnique with include { documents (scanStatus != 'infected'), payments, comments (with author), _count: comments }
// также включает comments_by_me для canSeeOrder history-path check:
//   comments: { where: { authorId: session.userId }, take: 1, select: { id: true } }
// после fetch — canSeeOrder(session, order). Если нет — return null (страница вернёт 404)
```

### 6.3 `status.ts`

```ts
transitionOrderStatus(prisma, session, orderId, newStatus): Promise<void>
// requireManager (caller); canSeeOrder; validate newStatus ∈ {new, in_progress, completed} (closed — terminal, 1C-only)
// update Order: executionStatus = newStatus; if to completed: completedAt = now(); if from completed: completedAt = null
// recordAudit('order_status_changed', before/after с актором='manager')
// notifyOrgUsers({ type: 'order_status_changed', dimension: 'execution', ... })
// notifyManagers({ orderId, type: 'order_status_changed_by_manager', payload }, { excludeUserId: session.userId })
```

### 6.4 `documents.ts`

```ts
listDocuments(prisma, opts): Promise<{ rows: DocumentRow[]; nextCursor: string | null }>
// where: AND(managerDocumentScopeFilter, opts.filters)

getDocumentForDownload(prisma, session, docId): Promise<
  | { ok: true; path: string; mimeType: string; name: string }
  | { ok: false; error: 'not_found' | 'infected' }
>
// findUnique with include order: { managerId, organizationId }
// not found ИЛИ canSeeDocument === false → { ok:false, 'not_found' } (не палим)
// scanStatus === 'infected' → { ok:false, 'infected' }
// иначе { ok:true, ... }
```

### 6.5 `organizations.ts`

```ts
listOrganizations(prisma, session, opts?): Promise<OrgRow[]>
// where: managerOrgScopeFilter(session); include {_count: orders}, recent activity summary

getOrganization(prisma, session, orgId): Promise<OrgDetail | null>
// canSeeOrganization || null; fetch contacts + orders summary + comments activity
```

### 6.6 `students.ts`

```ts
listStudents(prisma, opts): Promise<{ rows: StudentRow[]; nextCursor: string | null }>
// opts: { session, q?, take?, cursor? }
// where: { organizationId: { in: managedOrgIds(session) }, ...filters }
```

### 6.7 `messages.ts`

```ts
listIncomingComments(prisma, opts): Promise<{ rows: InboxItem[]; nextCursor: string | null }>
// opts: { session, since?: Date, take=30, cursor?, withOutgoing?: boolean }
//
// **Comment role is derived through JOIN, not denormalized** — Comment.authorRole does NOT exist in schema
// (verified via grep on prisma/schema.prisma); use `author: { role: ... }` relation filter:
//
// where: {
//   order: managerOrderScopeFilter(session),
//   author: { role: withOutgoing
//     ? { in: ['organization', 'manager'] }   // показываем и outgoing для контекста
//     : 'organization'                          // только incoming (для primary list/badge)
//   },
//   createdAt: since ? { gte: since } : { gte: 30 days ago }
// }
// include { order: { select: { id, orderNumber, title } }, author: { select: { id, name, email, role } } }
//
// **Default in UI:** /manager/messages вызывает с withOutgoing=true (showing both, visually отличаемые
// через author.role в render'е).
// Для unread-badge KPI (см. §6.1) счётчик идёт по Notification.isRead, не по этой выборке.
```

### 6.8 `uploads.ts`

```ts
createOrderDocument(prisma, session, args): Promise<{ ok: true; documentId: string } | { ok: false; error: string }>
// args: { orderId, file, docType, uploaderUserId }
// 1. canSeeOrder(session, order) || { ok:false, 'forbidden' }
// 2. validate size (<= 20MB) + MIME whitelist; иначе { ok:false, 'invalid_file' }
// 3. upload to Supabase Storage path `orders/{orderId}/{uuid}-{filename}`
// 4. create Document { generationSource:'user', scanStatus:'pending', uploaderUserId, docType, orderId, name, mimeType, path }
// 5. enqueue scan job (existing pipeline)
// 6. recordAudit('document_uploaded')
// 7. notifyOrgUsers({ type:'document_published', payload:{...} })
// 8. return { ok:true, documentId }
```

### 6.9 `team.ts`

```ts
listManagersForOrg(prisma, orgId): Promise<{ active: ManagerEntry[]; inactive: ManagerEntry[] }>
// для admin UI на /admin/organizations/[id]
```

### 6.10 `invite.ts`

```ts
class ManagerInviteError extends Error {
  code: 'already_assigned' | 'role_conflict' | 'org_not_found'
}

createAndAssignManager(prisma, args, actorUserId): Promise<{
  user: { id: string; email: string }; inviteUrl: string | null; alreadyExisted: boolean
}>
// args: { email, name, organizationId, mode: 'existing' | 'new' }
//
// mode='existing':
//   - lookup user by email (must exist)
//   - if not found → throw 'user_not_found'
//   - if found AND user.role !== 'manager' → throw 'role_conflict' (НЕ трансмутируем роли —
//     это бы сломало существующий partner/organization доступ юзера)
//   - check OrganizationManager(orgId, userId):
//       active → throw 'already_assigned'
//       inactive → reactivate (isActive=true, deactivatedAt=null, assignedBy=actor)
//       not exists → create (isActive=true, assignedBy=actor)
//   - inviteUrl=null, alreadyExisted=true
//
// mode='new':
//   - lookup user by email
//   - if FOUND с role !== 'manager' → 'role_conflict' (same reason)
//   - if FOUND с role==='manager' → fallback to existing flow (reactivate or already_assigned check)
//     возвращаем alreadyExisted=true, inviteUrl=null если passwordHash был установлен;
//     иначе создаём new PasswordResetToken для resend invite-link
//   - if NOT FOUND → create User (role='manager', passwordHash=null, isActive=true, email, name)
//     createPasswordResetToken → inviteUrl, alreadyExisted=false
//   - в любом случае upsert OrganizationManager + recordAudit('manager_invited' OR 'manager_assigned')
```

## 7. Write paths

### 7.1 Comments — extend `POST /api/comments` для `viewer='manager'`

```ts
if (session.role === 'manager') {
  const { orderId, body, attachmentPath } = z.object({...}).parse(input)
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id, managerId, organizationId }
  })
  if (!order || !managerPolicy.canSeeOrder(session, order)) return 403
  const comment = await prisma.comment.create({
    data: { orderId, body, attachmentPath, authorId: session.userId }
    // NB: NO authorRole field — role is derived through `comment.author.role` at query time.
    // Если в будущем будет много queries по role и JOIN становится bottleneck'ом —
    // можно денормализовать Comment.authorRole отдельной миграцией (см. open question §11).
  })
  await recordAudit('comment_posted', { entity:'order', entityId:orderId, after:{ commentId: comment.id, role:'manager' } })
  if (order.organizationId) {
    await notifyOrgUsers(prisma, {
      organizationId: order.organizationId,
      type: 'manager_replied',
      payload: { orderId, orderNumber, commentExcerpt: body.slice(0, 200) }
    })
  }
  return 201
}
```

Existing branches (`organization`, `partner`, `admin`) не трогаются. New `Notification.type` value: `manager_replied`. Org-side email template: `src/lib/email/templates/organization/manager-replied.tsx`.

### 7.2 Document upload — new `POST /api/manager/documents/[orderId]/upload`

Multipart form. Internally calls `services/manager/uploads.ts:createOrderDocument`. Returns:

- 200 `{ ok:true, documentId }` on success.
- 403 if not in scope.
- 413 if oversized.
- 415 if MIME not allowed.

### 7.3 Status change — Server Action `transitionOrderStatusAction(orderId, newStatus)`

См. §6.3. Без whitelist transitions — менеджер может свободно двигать `new ↔ in_progress ↔ completed` (для исправлений). `closed` всегда terminal и 1C-driven.

### 7.4 Notification suppression

В `notifyManagers` recipient resolver: optional `excludeUserId` для пропуска actor'а в случае notify-other-managers (status change actor не получает email о собственном действии).

## 8. Notifications

### 8.1 `notifyManagers` helper

```ts
notifyManagers(prisma, args, opts?): Promise<void>
// args: { orderId, type, payload }
// opts: { excludeUserId? }
// 1. fetch order { managerId, organizationId, orderNumber, title }
// 2. resolve recipients via three RBAC criteria (same as managerOrderScopeFilter):
//    a) Order.managerId (single user id, может быть null)
//    b) OrganizationManager where organizationId == order.organizationId AND isActive=true
//    c) historical: distinct Comment.authorId where Comment.orderId == orderId AND Comment.author.role == 'manager'
//       (role через JOIN, не через Comment.authorRole — поле не существует)
//    UNION, dedupe by id, filter User.isActive=true, exclude opts.excludeUserId
// 3. for each: send email via Resend + create Notification row
//    (если RESEND_API_KEY не сконфигурён — email skip, Notification всё равно создаётся)
```

**Invariant:** "notification set === visibility set". Reuse the same recipient resolver internally for `managerOrderScopeFilter`'s "who can see this order" computation if possible (через extract'нутый helper), OR покрыть test'ом который строит обе стороны и сравнивает.

### 8.2 Email templates `manager/*`

| Файл | Trigger | Subject |
|---|---|---|
| `comment-from-org.tsx` | org user posts comment | «Новое сообщение от {orgName} по заказу {orderNumber}» |
| `document-uploaded-by-org.tsx` | org user uploads document (Phase 9) — template создаём в Phase 8 как placeholder | «{orgName} загрузил документ {docName} к заказу {orderNumber}» |
| `order-marked-paid-by-1c.tsx` | sync-payments видит новый payment на заказе с manager(s) | «Получена оплата {amount} ₽ по заказу {orderNumber}» |
| `order-status-changed.tsx` | manager-A сменил status; recipients = other managers in scope | «Менеджер {actorName} перевёл заказ {orderNumber} в {newStatus}» |
| `invite.tsx` | admin приглашает нового manager в modal'е | «Вы приглашены в кабинет менеджера Промтехносферы» |

Brand styling: orange `#F97316` на CTA. Inline styles, no CSS files. CTA → `/manager/orders/[id]` (или `/manager/dashboard` для invite).

### 8.3 Hook points в Phase 8

| Where | Trigger | Notification args |
|---|---|---|
| `/api/comments` POST (org-comment) | always | `notifyManagers({orderId, type:'comment_from_org', payload})` |
| `sync-payments` processor | always alongside existing `notifyOrgUsers` | `notifyManagers({orderId, type:'order_marked_paid_by_1c', payload})` |
| `transitionOrderStatus` action | always | `notifyManagers({orderId, type:'order_status_changed_by_manager', payload}, { excludeUserId: actor })` |

Deferred to Phase 9: hook в org-side upload (document_uploaded_by_org). Шаблон создаём сейчас чтобы не возвращаться.

### 8.4 Tests Section 8

- `notifications.notifyManagers.test.ts` — все три recipient criteria; dedup; deactivated; exclude; RESEND no-op путь.
- `notifications.invariant.test.ts` — для случайного набора {orderId, sessions} проверяет: `recipientsOf(orderId) === { s ∈ allManagerSessions : canSeeOrder(s, order) }`. Этот тест защищает invariant «notification set === visibility set».
- `api.comments.notifies-managers.test.ts` — org-comment → notifyManagers вызван 1 раз с правильным recipient'ами.
- `worker.sync-payments.notifies-managers.test.ts` — paid order with manager(s) → оба helper'а fire.

## 9. Admin assign UI

### 9.1 Server actions `src/server-actions/admin/manager.ts`

```ts
assignOrInviteManagerAction(formData): Promise<{ ok: true; inviteUrl?: string | null; alreadyExisted?: boolean } | { ok: false; error: string }>
// requireAdmin()
// parse { mode: 'existing'|'new', organizationId, email?, name?, userId? } (mode-discriminated zod)
// delegate to services/manager/invite.ts:createAndAssignManager
// если inviteUrl !== null AND RESEND настроен — send ManagerInvite email
// revalidatePath(`/admin/organizations/${organizationId}`)
// return action result with inviteUrl (для admin'а — показать copy button если email не ушёл)

deactivateManagerAssignmentAction(formData): Promise<{ ok: true } | { ok: false; error: string }>
// requireAdmin(); update OrganizationManager isActive=false, deactivatedAt=now()
// recordAudit; revalidate

reactivateManagerAssignmentAction(formData): Promise<{ ok: true } | { ok: false; error: string }>
// requireAdmin(); update isActive=true, deactivatedAt=null
// recordAudit; revalidate

assignOrderManagerAction(formData): Promise<{ ok: true } | { ok: false; error: string }>
// requireAdmin()
// parse { orderId, managerUserId: string | null }  (null = снять назначение)
// validate: если managerUserId not null — user existing с role='manager' AND isActive
// load existing order.managerId; update only если изменилось
// recordAudit('order_manager_changed', { before:{managerId: oldId}, after:{managerId: newId} })
// если новый managerUserId not null — notifyManagers({orderId, type:'assigned_to_order', payload}, {excludeUserId: actor})
//   (этот тип отсутствует в §8.2 списке — добавляется как 6-й template ИЛИ переиспользуем comment_from_org через generalize)
//   default: пропускаем notification для assign — admin поставит manager, manager сам зайдёт; можно добавить позже
// revalidatePath(`/admin/orders/${orderId}`)
```

`assignOrderManagerAction` — UI триггерится с `/admin/orders/[id]` (там уже есть order detail; добавляется select+submit-button). При желании дублируется с per-org orders list. Если notification на assign не нужен — пропускаем `notifyManagers` call и оставляем только audit.

### 9.2 UI на `/admin/organizations/[id]`

Между «Доступ заказчика» (Phase 7 block) и footer'ом — новый раздел:

```
┌──────────────────────────────────────────────┐
│ Менеджеры организации        [+ Назначить]   │
├──────────────────────────────────────────────┤
│ Иван Петров      ivan@…        active   [⋮]  │
│ Анна Сидорова    anna@…       inactive  [⋮]  │
└──────────────────────────────────────────────┘
```

Modal «Назначить менеджера» (client component):

- Two tabs / segmented control: «Выбрать существующего» / «Пригласить нового»
- «Существующий» — searchable select по `User where role='manager' AND isActive AND NOT activeAssignment(orgId)`.
- «Новый» — поля email + name; submit → `mode='new'` server action; на success с inviteUrl — copy button + ссылка на reset-password.

Per-row dropdown:

- Active: «Деактивировать».
- Inactive: «Возобновить».
- (Future polish) «Сменить роль/перевести на другую org».

### 9.3 Партнёрская сторона — out of scope

В отличие от Phase 7 (где partner-admin приглашает org-admin для своих portfolio org), Phase 8 НЕ даёт partner-admin'у назначать manager'ов. Аргумент: manager — internal Промтехносфера-staff, не клиентский ресурс. Если в будущем потребуется — отдельная фаза.

## 10. Acceptance metrics + Manual smoke

### 10.1 Manual smoke walkthrough (Stage-2 staging, `FEATURE_MANAGER_CABINET=1`)

1. Под admin'ом: `/admin/organizations/[id]` → block «Менеджеры организации» → modal «Пригласить нового» → email+name.
2. Получить invite-link → reset-password → login → редирект на `/manager/dashboard`.
3. Dashboard: 4 KPI (заказы / attention / непрочитанные комменты / срочные дедлайны), attention real, events последние 15.
4. `/manager/orders`: только in-scope заказы (assigned-by-org); фильтр + pagination работают.
5. Назначить вручную (через DB или admin assign Order.managerId — если есть UI) ещё один заказ напрямую → этот заказ появляется в /manager/orders регардлесс org assignment'а (per-order path).
6. Третьим юзером logged in как org-admin: пост комментарий → manager получает email + bell в течение ~5с; коммент появляется в `/manager/messages`.
7. Manager постит ответ → org-admin получает email `manager_replied`; коммент в треде на org-стороне.
8. Manager меняет executionStatus `new → in_progress` через manager-status-change-form → org-admin получает `order_status_changed` email; второй manager в scope получает `order_status_changed_by_manager`.
9. Manager загружает PDF через manager-doc-upload-form → org-admin получает `document_published` email; документ виден в `/organization/documents`.
10. RBAC sanity: open `/manager/orders/[id]` для не-scope'ного заказа → 404.
11. Comments-history path: admin assign manager-A к org, manager-A постит коммент на заказ X, admin removes manager-A from org. Manager-A relogin → заказ X всё ещё виден через comments-history. **Документировано как expected.**
12. Admin деактивирует manager assignment → manager-A relogin → org-scope исчез, видимы только заказы где `managerId=me` ИЛИ historical comment.

### 10.2 Automated acceptance

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 new warnings.
- `npm test` — все existing + ~80 новых passing (~750 total).
- `npm run build` — successful. Новые routes: `/manager/{dashboard,orders,orders/[id],organizations,organizations/[id],documents,students,messages}` + `/api/manager/documents/[id]/download` + `/api/manager/documents/[orderId]/upload`.
- `npx prisma migrate status` — applied.
- Playwright: 3 new snapshot specs baseline без diff.

## 11. Открытые вопросы (не блочат план — defaults применятся)

- [ ] Manager invite email subject/body — финальная редактура отличная от org-invite.
- [ ] Comments-history visibility path — продукт OK с тем что бывший manager сохраняет видимость заказов где когда-то комментил? **Default (записан в feedback): yes, intentional.**
- [ ] `manager-students-table.tsx` — отдельный sibling или reuse `org-students-table` с optional `viewer` prop? Решение во время Phase 8.3 после чтения org-side кода.
- [ ] Admin user-management — где создавать manager-юзеров вне modal'а? Существующий admin UI должен поддерживать `role='manager'` (если нет — отдельная задача в 8.6).
- [ ] Partner-admin assign managers — отложено, см. §9.3.
- [ ] Denormalize `Comment.authorRole` отдельной миграцией, если JOIN-based filter в `/manager/messages` станет slow при больших объёмах. Сейчас идём через `author: { role: ... }` — backfill-free, но joins. Триггер: p95 latency `/manager/messages` > 500ms.
- [ ] `assignOrderManagerAction` notification — слать notifyManagers новому assignee при назначении? **Default: нет** (manager сам зайдёт; добавим если будут жалобы).

## 12. Что НЕ делаем в Phase 8 (отложено)

- Подпись актов через Контур.Диадок (Phase 9 вместе с org-upload).
- Notification preferences UI (mute/digest) — пока all-or-nothing.
- Bulk operations (archive, mass-status-change) — будущая полировка.
- Saved views для manager (только URL-params).
- CSV/XLSX экспорт списков.
- Manager-side dashboard analytics (workload trends, response time) — после feedback от продакта.
- Student cabinet (отдельная фаза).
- Manager-to-manager direct messages (вне comments тредов на заказе).
- Live updates (WebSocket) — overkill для MVP.

## 13. Сознательные упрощения Phase 8

1. **Документы read+upload, без подписи.** Подпись — Phase 9.
2. **Manager без preferences** — всем-всё (email+bell).
3. **Membership snapshot в JWT** — реактивация/деактивация видна после relogin.
4. **`canSeeOrder` two-mode API** (с/без comments-history) — экономия запросов на list rendering без жертвы корректности на detail.
5. **Refactor `policy.ts` manager-веток сразу** без feature flag — фиксим существующую багу.
6. **Server actions с `revalidatePath`**, без `revalidateTag`.
7. **Нет partner-side manager invite** — оставляем admin-only.

---

**После завершения Phase 8.6:** PR на main, заголовок `feat(phase8): Manager cabinet — RBAC, dashboard, orders/docs/orgs/students/messages, write paths, notifications, admin assign`. После merge → Stage 1 rollout (flag=0). Дальше — staging smoke (§10.1) → пилотная rollout → full.
