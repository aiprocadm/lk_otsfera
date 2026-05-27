# Manager Cabinet (Phase 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Достроить кабинет для внутреннего менеджера Промтехносферы: read+write (комменты, статусы, документы) для закреплённых заказов/организаций; двусторонние нотификации с organization-стороной; admin-managed assignments.

**Architecture:** Зеркало org-кабинета (Phase 7) с обратной стороны диалога. Новая таблица `OrganizationManager` (join: user × organization, mirror of `OrganizationUser`); существующее поле `Order.managerId` активируется через новый admin action `assignOrderManagerAction`. RBAC через `managerOrderScopeFilter` объединяющий три пути видимости (per-order / per-org / historical-comment). `manager-*` sibling components по правилу `feedback-component-reuse`. Defense-in-depth: service-layer filter + page-level canSee check.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind, Prisma (PostgreSQL), Vitest, Playwright, Resend (email), Server Actions, BullMQ, JWT cookie auth. Без новых npm-зависимостей.

**Spec reference:** [docs/superpowers/specs/2026-05-26-manager-cabinet-design.md](../specs/2026-05-26-manager-cabinet-design.md)

**Branch:** `claude/manager-cabinet-phase8` создать от `origin/main`. Сначала `git fetch origin main && git checkout -b claude/manager-cabinet-phase8 origin/main`.

---

## Архитектура (карта изменений)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Phase 8.0 — Foundation                                                  │
│   prisma migrations:                                                    │
│     - 20260527100000_organization_manager                               │
│       (NEW OrganizationManager + Order(managerId, executionStatus)      │
│        + Comment(authorId, orderId))                                    │
│   src/lib/auth/requireRole.ts          (+requireManager*)               │
│   src/lib/auth/managerPolicy.ts        (NEW — scope filters, canSee*)   │
│   src/lib/auth/policy.ts               (refactor manager branches)      │
│   src/lib/auth/session.ts              (+managedOrgIds in payload)      │
│   src/lib/auth/login.ts                (load managedOrgIds at login)    │
│                                                                         │
│ Phase 8.1 — Shell + Dashboard                                           │
│   src/components/manager/manager-app-shell.tsx                          │
│   src/components/manager/manager-sidebar.tsx                            │
│   src/components/manager/manager-kpi-grid.tsx                           │
│   src/components/manager/manager-attention-list.tsx                     │
│   src/components/manager/manager-events-feed.tsx                        │
│   src/lib/services/manager/dashboard.ts                                 │
│   src/app/manager/layout.tsx              (rewrite stub)                │
│   src/app/manager/dashboard/page.tsx      (rewrite stub)                │
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
│   src/app/manager/orders/page.tsx         (rewrite stub)                │
│   src/app/manager/orders/[id]/page.tsx    (new)                         │
│                                                                         │
│ Phase 8.3 — Documents + Organizations + Students                        │
│   src/lib/services/manager/documents.ts                                 │
│   src/lib/services/manager/organizations.ts                             │
│   src/lib/services/manager/students.ts                                  │
│   src/components/manager/manager-orgs-list.tsx                          │
│   src/components/manager/manager-org-card.tsx                           │
│   src/components/manager/manager-students-table.tsx                     │
│   src/app/manager/documents/page.tsx          (rewrite stub)            │
│   src/app/manager/organizations/page.tsx      (new)                     │
│   src/app/manager/organizations/[id]/page.tsx (new)                     │
│   src/app/manager/students/page.tsx           (new)                     │
│   src/app/api/manager/documents/[id]/download/route.ts                  │
│                                                                         │
│ Phase 8.4 — Write paths + Notifications                                 │
│   src/lib/services/manager/uploads.ts                                   │
│   src/lib/services/manager/messages.ts                                  │
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
│   src/app/manager/messages/page.tsx        (rewrite stub)               │
│                                                                         │
│ Phase 8.5 — Admin assign UI                                             │
│   src/lib/services/manager/team.ts                                      │
│   src/lib/services/manager/invite.ts                                    │
│   src/server-actions/admin/manager.ts                                   │
│   src/lib/email/templates/manager/invite.tsx                            │
│   src/components/admin/managers-block.tsx                               │
│   src/components/admin/assign-or-invite-manager-form.tsx                │
│   src/components/admin/assign-order-manager-form.tsx                    │
│   src/app/admin/organizations/[id]/page.tsx   (+Менеджеры block)        │
│   src/app/admin/orders/[id]/page.tsx          (+assign-manager UI)      │
│                                                                         │
│ Phase 8.6 — Polish                                                      │
│   src/lib/featureFlags.ts        (+'manager_cabinet')                   │
│   src/middleware.ts              (+/manager/* gate)                     │
│   .env.example                   (+FEATURE_MANAGER_CABINET=0)           │
│   src/e2e/snapshots/manager-dashboard.spec.ts                           │
│   src/e2e/snapshots/manager-orders.spec.ts                              │
│   src/e2e/snapshots/manager-documents.spec.ts                           │
│   prisma/seed.ts                (+manager@demo.local fixture)           │
└─────────────────────────────────────────────────────────────────────────┘
```

**Принципы:**

1. **Каждая task — один git commit.** При падении тестов внутри task — fix-up, не amend.
2. **TDD-light:** для сервисов — integration-тесты с live Postgres; для server actions — unit с mock prisma. Тесты пишем в той же task, что и реализацию.
3. **Sibling components (`manager-*`) по правилу feedback-component-reuse:** parallel siblings когда тип привязан к manager-specific domain'у. Direct reuse `DocumentsList` (через `downloadEndpointBase`), `DealStatusBadge`, `StatCard`, `CommentsThread` (через `viewer`).
4. **Server Actions over API routes** для мутаций кабинета. API routes только для multipart upload и расширения существующего `/api/comments`.
5. **Service-layer scope filtering + page-level canSee check** — defense-in-depth per `feedback-org-rbac-defense-in-depth`.
6. **`policy.ts` refactor не под feature flag** — фиксим существующую багу (manager branches сейчас семантически неправильны).

---

## Метрики приёмки (после Phase 8.6)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 новых warnings.
- `npm run build` — successful. Новые роуты: `/manager/dashboard`, `/manager/orders`, `/manager/orders/[id]`, `/manager/organizations`, `/manager/organizations/[id]`, `/manager/documents`, `/manager/students`, `/manager/messages`, `/api/manager/documents/[id]/download`, `/api/manager/documents/[orderId]/upload`.
- `npm test` — все existing + ~80 новых passing (~750 total).
- `npx prisma migrate status` — all applied.
- Manual smoke walkthrough (см. spec §10.1).
- Playwright: новые snapshots baseline без diff.

## Зависимости (новые)

- **Без новых npm-пакетов.** Используем уже установленные `bcryptjs`, `zod`, `resend`, `@react-email/components`, `@prisma/client`, `bullmq`.
- Новые env: `FEATURE_MANAGER_CABINET` (default `0`).

## Открытые вопросы (не блочат план — defaults из spec §11)

- [ ] Manager invite email subject/body — финальная редактура.
- [ ] `manager-students-table` — отдельный sibling или reuse `org-students-table` (решение во время Task 25 после чтения org-side кода).
- [ ] Denormalize `Comment.authorRole` отдельной миграцией если JOIN становится bottleneck.
- [ ] `assignOrderManagerAction` notification — слать новому assignee? **Default: нет.**

---

## Bite-sized tasks (для агентов-исполнителей)

## Phase 8.0 — Foundation: миграция, RBAC layer, policy refactor

### Task 1: Schema + миграция `OrganizationManager` + индексы

**Files:**
- Create: `prisma/migrations/20260527100000_organization_manager/migration.sql`
- Modify: `prisma/schema.prisma` (новая модель `OrganizationManager`, back-relation на `Organization` и `User`, индексы на `Order` и `Comment`)

- [ ] **Step 1.1**: В `prisma/schema.prisma` добавить новую модель сразу после модели `OrganizationUser`:
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
- [ ] **Step 1.2**: В модели `Organization` добавить back-relation после существующего `users OrganizationUser[]`:
  ```prisma
  managers OrganizationManager[] @relation("OrganizationManagers")
  ```
- [ ] **Step 1.3**: В модели `User` добавить back-relation после существующего `organizationMemberships OrganizationUser[]` (или аналогичной строки):
  ```prisma
  managedOrganizations OrganizationManager[] @relation("UserManagedOrgs")
  ```
- [ ] **Step 1.4**: В модели `Order` добавить индекс в конец секции `@@index`:
  ```prisma
  @@index([managerId, executionStatus])
  ```
- [ ] **Step 1.5**: В модели `Comment` добавить индекс в конец модели (если уже есть `@@index` — перед закрывающей скобкой):
  ```prisma
  @@index([authorId, orderId])
  ```
- [ ] **Step 1.6**: `npx prisma migrate dev --name organization_manager --create-only`. Проверить SQL: CREATE TABLE OrganizationManager + UNIQUE INDEX (organizationId,userId) + INDEX (userId,isActive); CREATE INDEX Order(managerId,executionStatus); CREATE INDEX Comment(authorId,orderId).
- [ ] **Step 1.7**: Применить миграцию: `npx prisma migrate dev`.
- [ ] **Step 1.8**: `npx prisma generate` — обновить Prisma Client.
- [ ] **Step 1.9**: `npm run typecheck` — 0 errors.
- [ ] **Step 1.10 — Commit**: `feat(schema): OrganizationManager table + manager and comment indices`

### Task 2: Guards `requireManager*` в `requireRole.ts`

**Files:**
- Modify: `src/lib/auth/requireRole.ts` (добавить три функции)
- Test: `src/__tests__/auth.requireManager.test.ts`

**Сигнатуры:**
```ts
export async function requireManager(): Promise<Session>
// requireSession() → проверить role === 'manager' AND session.managedOrgIds !== undefined
// если иначе → redirect('/login') (для unauthenticated) или redirect('/forbidden') (для wrong role)

export async function requireManagerForOrg(orgId: string): Promise<Session>
// requireManager() + isOrgInScope(session, orgId) || redirect('/manager/dashboard')

export async function requireManagerForOrder(orderId: string): Promise<{ session: Session; order: { id: string; managerId: string | null; organizationId: string | null } }>
// requireManager() → fetch order managerId/organizationId → canSeeOrder check → notFound() если нет
```

- [ ] **Step 2.1**: Реализовать `requireManager`:
  ```ts
  export async function requireManager(): Promise<Session> {
    const session = await requireSession();
    if (session.role !== 'manager') {
      redirect('/forbidden');
    }
    if (session.managedOrgIds === undefined) {
      redirect('/login');
    }
    return session;
  }
  ```
- [ ] **Step 2.2**: Реализовать `requireManagerForOrg`:
  ```ts
  import { isOrgInScope } from '@/lib/auth/managerPolicy';
  export async function requireManagerForOrg(orgId: string): Promise<Session> {
    const session = await requireManager();
    if (!isOrgInScope(session, orgId)) {
      redirect('/manager/dashboard');
    }
    return session;
  }
  ```
  (NB: `managerPolicy.ts` создаём в Task 3 — этот import станет valid после Task 3. Если TypeScript ругается на ordering — переставить tasks или временно inline-функция в этом файле и удалить в Task 3.)
- [ ] **Step 2.3**: Реализовать `requireManagerForOrder`:
  ```ts
  import { canSeeOrder } from '@/lib/auth/managerPolicy';
  import { notFound } from 'next/navigation';
  import { prisma } from '@/lib/db/prisma';
  export async function requireManagerForOrder(orderId: string) {
    const session = await requireManager();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, managerId: true, organizationId: true }
    });
    if (!order || !canSeeOrder(session, order)) {
      notFound();
    }
    return { session, order };
  }
  ```
- [ ] **Step 2.4**: В `auth.requireManager.test.ts` — mock `requireSession`, `redirect`, `notFound`, `prisma.order.findUnique`. Cases:
  - user без role → redirect /forbidden.
  - user role='manager' без managedOrgIds → redirect /login.
  - user role='manager' с пустым managedOrgIds — `requireManager` returns session (empty scope OK).
  - `requireManagerForOrg` orgId in scope → returns; out of scope → redirect.
  - `requireManagerForOrder` orderId not found → notFound called; canSeeOrder=false → notFound; ok → returns {session, order}.
- [ ] **Step 2.5**: `npm test src/__tests__/auth.requireManager.test.ts` — passes.
- [ ] **Step 2.6 — Commit**: `feat(auth): requireManager, requireManagerForOrg and requireManagerForOrder guards`

### Task 3: `managerPolicy.ts` — scope filters + canSee helpers

**Files:**
- Create: `src/lib/auth/managerPolicy.ts`
- Test: `src/__tests__/auth.managerPolicy.test.ts`

- [ ] **Step 3.1**: Создать `managerPolicy.ts` с экспортами:
  ```ts
  import type { Prisma } from '@prisma/client';
  import type { Session } from './session';

  export function managedOrgIds(session: Session): string[] {
    return session.managedOrgIds ?? [];
  }

  export function managerOrderScopeFilter(session: Session): Prisma.OrderWhereInput {
    return {
      OR: [
        { managerId: session.userId },
        { organizationId: { in: managedOrgIds(session) } },
        { comments: { some: { authorId: session.userId } } }
      ]
    };
  }

  export function managerDocumentScopeFilter(session: Session): Prisma.DocumentWhereInput {
    return {
      order: managerOrderScopeFilter(session),
      scanStatus: { not: 'infected' }
    };
  }

  export function managerOrgScopeFilter(session: Session): Prisma.OrganizationWhereInput {
    return { id: { in: managedOrgIds(session) } };
  }

  export function canSeeOrder(
    session: Session,
    order: { managerId: string | null; organizationId: string | null; commentsCountByMe?: number }
  ): boolean {
    if (order.managerId === session.userId) return true;
    if (order.organizationId && managedOrgIds(session).includes(order.organizationId)) return true;
    if ((order.commentsCountByMe ?? 0) > 0) return true;
    return false;
  }

  export function canSeeDocument(
    session: Session,
    doc: { order: { managerId: string | null; organizationId: string | null } }
  ): boolean {
    return canSeeOrder(session, doc.order);
  }

  export function canSeeOrganization(session: Session, orgId: string): boolean {
    return managedOrgIds(session).includes(orgId);
  }

  export const isOrgInScope = canSeeOrganization;
  ```
- [ ] **Step 3.2**: В `auth.managerPolicy.test.ts` — pure unit tests, без БД. Cases per function:
  - `managedOrgIds` — пустой когда `session.managedOrgIds === undefined`.
  - `managerOrderScopeFilter` — структура `{ OR: [...3 clauses...] }` с правильным userId/orgIds.
  - `canSeeOrder`: managerId match → true; orgId in scope → true; commentsCountByMe > 0 → true; всё false → false; null/null edge → false.
  - `canSeeOrganization`: in scope → true; не в scope → false; пустой scope → false.
- [ ] **Step 3.3**: `npm test src/__tests__/auth.managerPolicy.test.ts` — passes.
- [ ] **Step 3.4 — Commit**: `feat(auth): managerPolicy with three-way scope filters and canSee helpers`

### Task 4: Session payload extension + login loader

**Files:**
- Modify: `src/lib/auth/session.ts` (расширить `SessionPayload` type)
- Modify: `src/lib/auth/jwt.ts` (расширить `SessionPayload` если тип там)
- Modify: `src/lib/auth/login.ts` (load managedOrgIds при логине)
- Test: `src/__tests__/auth.login.manager.test.ts`

- [ ] **Step 4.1**: Сначала открыть `src/lib/auth/session.ts` и `src/lib/auth/jwt.ts` чтобы определить, где задан `SessionPayload`. Добавить поле:
  ```ts
  managedOrgIds?: string[]
  ```
  Прямо после `organizationMemberships?` (Phase 7 поле). Если поля organizationMemberships нет — добавить в конец type definition.
- [ ] **Step 4.2**: В `login.ts` после успешной проверки пароля найти блок где для `role === 'organization'` загружается `organizationMemberships`. Параллельно добавить:
  ```ts
  let managedOrgIds: string[] | undefined;
  if (user.role === 'manager') {
    const assigned = await prisma.organizationManager.findMany({
      where: { userId: user.id, isActive: true },
      select: { organizationId: true }
    });
    managedOrgIds = assigned.map(a => a.organizationId);
  }
  ```
- [ ] **Step 4.3**: Передать `managedOrgIds` в `SessionPayload` при выпуске JWT:
  ```ts
  const payload: SessionPayload = {
    sub: user.id,
    role: user.role,
    // ...existing fields
    ...(managedOrgIds !== undefined && { managedOrgIds })
  };
  ```
- [ ] **Step 4.4**: Important — в отличие от Phase 7 org-кабинета, manager **без** assignments всё равно может залогиниться (managedOrgIds=[]). Никаких 403 'manager_not_assigned'. Эта философия закреплена в spec §4.1 и §11.
- [ ] **Step 4.5**: Тесты `auth.login.manager.test.ts` — integration или unit с mock prisma:
  - login с role=manager без OrganizationManager rows → session.managedOrgIds === [].
  - login с 2 active OrganizationManager → session.managedOrgIds === [org1.id, org2.id].
  - login с 1 active + 1 deactivated → session.managedOrgIds содержит только active.
  - login с role !== 'manager' → managedOrgIds undefined (не дисплеитсия в payload).
- [ ] **Step 4.6**: `npm test src/__tests__/auth.login.manager.test.ts` — passes.
- [ ] **Step 4.7 — Commit**: `feat(auth): load managedOrgIds into session at login for manager role`

### Task 5: Refactor `policy.ts` manager branches

**Files:**
- Modify: `src/lib/auth/policy.ts` (переписать manager-веки `canAccessOrganization` line 27 и `canReadOrder` line 53)
- Test: `src/__tests__/auth.policy.manager-refactor.test.ts`

- [ ] **Step 5.1**: Сначала прочитать `policy.ts` целиком и убедиться что других манагер-зависимостей нет.
- [ ] **Step 5.2**: Заменить manager-ветку в `canAccessOrganization` (line ~27):
  ```ts
  // BEFORE:
  if (session.role === 'manager') {
    const membership = await prisma.organizationUser.findFirst({ ... });
    return Boolean(membership);
  }

  // AFTER:
  if (session.role === 'manager') {
    const { canSeeOrganization } = await import('@/lib/auth/managerPolicy');
    return canSeeOrganization(session, organizationId);
  }
  ```
  (Dynamic import чтобы избежать циклов; `managerPolicy.ts` не зависит от `policy.ts`.)
- [ ] **Step 5.3**: Заменить manager-ветку в `canReadOrder` (line ~53):
  ```ts
  // BEFORE:
  if (session.role === 'manager') {
    const membership = await prisma.organizationUser.findFirst({ where: { userId: session.sub, isActive: true, organization: { companyId: order.companyId } } });
    return Boolean(membership);
  }

  // AFTER:
  if (session.role === 'manager') {
    const { canSeeOrder } = await import('@/lib/auth/managerPolicy');
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      select: { managerId: true, organizationId: true }
    });
    if (!fullOrder) return false;
    return canSeeOrder(session, fullOrder);
  }
  ```
  (Comments-history clause не проверяется на уровне `policy.ts` — это top-level RBAC guard для assignment-based визиблити. Comments-history check фолбэк-путь и проверяется только в сервисах /manager/orders при необходимости.)
- [ ] **Step 5.4**: `auth.policy.manager-refactor.test.ts` — integration с live PG:
  - Setup: User role='manager', Organization org1, Order order1 (managerId=user.id), Order order2 (organizationId=org1.id), Order order3 (no assignment). OrganizationManager(user, org1, isActive=true).
  - `canReadOrder(session, order1)` → true (per-order).
  - `canReadOrder(session, order2)` → true (per-org).
  - `canReadOrder(session, order3)` → false.
  - `canAccessOrganization(session, org1.id)` → true.
  - `canAccessOrganization(session, otherOrg.id)` → false.
  - Edge: deactivated assignment → false.
- [ ] **Step 5.5**: Существующие тесты `/api/documents`, `/api/notifications` для роли manager должны продолжать проходить. Запустить `npm test src/__tests__/api.documents.test.ts src/__tests__/api.notifications.test.ts` (или эквивалентные имена) — если в существующих тестах используются OrganizationUser fixture'ы для manager-роли, их нужно ПЕРЕПИСАТЬ под OrganizationManager (это и есть refactor). Изменения тестов идут в этом же коммите.
- [ ] **Step 5.6**: `npm test src/__tests__/auth.policy.manager-refactor.test.ts` — passes.
- [ ] **Step 5.7 — Commit**: `refactor(auth): policy.ts manager branches use OrganizationManager and Order.managerId`

### Task 6: Финал Phase 8.0 — lint/typecheck/build/tests

- [ ] **Step 6.1**: `npm run typecheck` — 0 errors.
- [ ] **Step 6.2**: `npm run lint` — 0 new warnings.
- [ ] **Step 6.3**: `npm test` — все existing + новые passing.
- [ ] **Step 6.4**: `npm run build` — successful. На этом этапе НЕТ новых routes (только foundation).
- [ ] **Step 6.5 — Commit (если есть fix-up)**: `chore(phase8.0): final lint/types polish`. Если ничего не правится — пропустить.

---

## Phase 8.1 — Shell + Dashboard

### Task 7: `ManagerAppShell` + `ManagerSidebar`

**Files:**
- Create: `src/components/manager/manager-app-shell.tsx`
- Create: `src/components/manager/manager-sidebar.tsx`
- Test: `src/__tests__/components.manager-sidebar.test.tsx`

- [ ] **Step 7.1**: `manager-app-shell.tsx` — server component, header «Кабинет менеджера», user dropdown (email + form action → `/api/auth/logout`), 240px sidebar + content max-w-1280, padding 24px. Принимает `children` + `session`. Структура: смотреть как сделан `src/components/organization/org-app-shell.tsx` — повторить тот же скелет, заменить тексты и сайдбар-импорт. Никаких multi-org селекторов (manager имеет flat scope).
- [ ] **Step 7.2**: `manager-sidebar.tsx` — client component (использует `usePathname()` для active state). 7 пунктов:
  ```tsx
  const items = [
    { href: '/manager/dashboard',     label: 'Главная' },
    { href: '/manager/orders',        label: 'Заказы' },
    { href: '/manager/organizations', label: 'Организации' },
    { href: '/manager/documents',     label: 'Документы' },
    { href: '/manager/students',      label: 'Сотрудники' },
    { href: '/manager/messages',      label: 'Сообщения' },
  ];
  ```
  Active state — orange `#F97316` accent. Mobile: drawer.
- [ ] **Step 7.3**: Тесты `components.manager-sidebar.test.tsx`:
  - Рендерит 6 ссылок.
  - Active class применяется к одной ссылке (mock usePathname для `/manager/orders` → 'Заказы' активна).
- [ ] **Step 7.4**: `npm test src/__tests__/components.manager-sidebar.test.tsx` — passes.
- [ ] **Step 7.5 — Commit**: `feat(manager): ManagerAppShell with sidebar (6 items)`

### Task 8: Dashboard widgets — `manager-kpi-grid`, `manager-attention-list`, `manager-events-feed`

**Files:**
- Create: `src/components/manager/manager-kpi-grid.tsx`
- Create: `src/components/manager/manager-attention-list.tsx`
- Create: `src/components/manager/manager-events-feed.tsx`

- [ ] **Step 8.1**: `manager-kpi-grid.tsx` — server component (presentational). Принимает props:
  ```ts
  type KpiData = {
    activeOrders: number; activeOrdersDelta: number;
    attentionCount: number;
    unreadComments: number;
    urgentDeadlines: number;
  };
  ```
  4 карточки grid (md:grid-cols-4): «Активные заказы» (+delta -30d), «Требует внимания», «Непрочитанные комментарии», «Срочные дедлайны». Использовать `StatCard` из `@/components/dashboard/stat-card` (direct reuse).
- [ ] **Step 8.2**: `manager-attention-list.tsx` — server component. Принимает `AttentionItem[]` где `AttentionItem = { id, kind, severity: 'warn'|'urgent', message, href }`. Render: secondary heading «Требует внимания», список с цветовой маркировкой severity. Empty state «Ничего срочного — отдохните».
- [ ] **Step 8.3**: `manager-events-feed.tsx` — server component. Принимает `EventItem[]` где `EventItem = { id, kind, when, text, href? }`. Render: список с timestamp, click → href если есть. Empty state «Нет событий за последний период».
- [ ] **Step 8.4**: `npm run typecheck` — 0 errors.
- [ ] **Step 8.5 — Commit**: `feat(manager): dashboard widgets (KPI grid, attention list, events feed)`

### Task 9: `services/manager/dashboard.ts`

**Files:**
- Create: `src/lib/services/manager/dashboard.ts`
- Test: `src/__tests__/services.manager.dashboard.test.ts`

- [ ] **Step 9.1**: Создать файл с тремя экспортами:
  ```ts
  import type { PrismaClient } from '@prisma/client';
  import type { Session } from '@/lib/auth/session';
  import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';

  export async function kpis(prisma: PrismaClient, session: Session) {
    const scope = managerOrderScopeFilter(session);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);
    const threeDaysAhead = new Date(now.getTime() + 3 * 86400_000);

    const [activeOrders, activeOrders30dAgo, attentionCount, unreadComments, urgentDeadlines] = await Promise.all([
      prisma.order.count({ where: { AND: [scope, { executionStatus: { in: ['new', 'in_progress'] } }] } }),
      prisma.order.count({ where: { AND: [scope, { executionStatus: { in: ['new', 'in_progress'] } }, { createdAt: { lte: thirtyDaysAgo } }] } }),
      // attentionCount = orders overdue, computed inline matching attention() rules
      prisma.order.count({ where: { AND: [scope, { deadline: { lt: now } }, { executionStatus: { notIn: ['completed', 'closed'] } }] } }),
      prisma.notification.count({ where: { userId: session.userId, isRead: false, type: 'comment_from_org' } }),
      prisma.order.count({ where: { AND: [scope, { deadline: { gte: now, lt: threeDaysAhead } }, { executionStatus: { notIn: ['completed', 'closed'] } }] } }),
    ]);

    return {
      activeOrders,
      activeOrdersDelta: activeOrders - activeOrders30dAgo,
      attentionCount,
      unreadComments,
      urgentDeadlines,
    };
  }
  ```
- [ ] **Step 9.2**: `attention(prisma, session)` — возвращает `AttentionItem[]`. Источники:
  - Orders overdue (`deadline < now`, не completed/closed) → severity 'urgent'.
  - Comments from org > 24h without manager reply → severity 'urgent'. (Реализация: comments where author.role='organization' AND createdAt < now-24h AND no later comment by current user.)
  - Documents type='act' not signed > 3d → severity 'warn'.
  - executionStatus='in_progress' no updates > 14d → severity 'warn'.
  Объединить в массив, sort by severity desc.
- [ ] **Step 9.3**: `recentEvents(prisma, session, take=15)` — параллельные fetch'и:
  - documents где `order: scope` (take=20),
  - payments где `order: scope` (take=20),
  - audit log entries kind in ['order_status_changed','comment_posted'] для orders в scope (take=20),
  - comments где `order: scope` (take=20).
  Merge, sort by timestamp desc, slice(take).
- [ ] **Step 9.4**: Integration-тесты с live PG:
  - empty DB → KPI все 0, attention пуст, events пуст.
  - seed scenario: manager assigned to org1; 2 active orders, 1 overdue → activeOrders=2, attention has 1 'urgent', urgentDeadlines counts deadlines next 3d.
  - RBAC: orders из другой org не попадают.
- [ ] **Step 9.5**: `npm test src/__tests__/services.manager.dashboard.test.ts` — passes.
- [ ] **Step 9.6 — Commit**: `feat(manager): dashboard service with kpis, attention, recent events`

### Task 10: Layout `/manager/layout.tsx` + dashboard page (rewrite stubs)

**Files:**
- Modify: `src/app/manager/layout.tsx` (заменить generic AppShell на ManagerAppShell)
- Modify: `src/app/manager/dashboard/page.tsx` (rewrite — real KPIs + RBAC)
- Delete: `src/app/manager/loading.tsx` НЕ удаляем — оставляем, проверить корректность под новый layout

- [ ] **Step 10.1**: `layout.tsx` — server component:
  ```tsx
  import type { ReactNode } from 'react';
  import { requireManager } from '@/lib/auth/requireRole';
  import { ManagerAppShell } from '@/components/manager/manager-app-shell';

  export default async function ManagerLayout({ children }: { children: ReactNode }) {
    const session = await requireManager();
    return <ManagerAppShell session={session}>{children}</ManagerAppShell>;
  }
  ```
- [ ] **Step 10.2**: `dashboard/page.tsx` — полная замена существующего stub'а:
  ```tsx
  import { requireManager } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { kpis, attention, recentEvents } from '@/lib/services/manager/dashboard';
  import { ManagerKpiGrid } from '@/components/manager/manager-kpi-grid';
  import { ManagerAttentionList } from '@/components/manager/manager-attention-list';
  import { ManagerEventsFeed } from '@/components/manager/manager-events-feed';

  export default async function ManagerDashboard() {
    const session = await requireManager();
    const [kpiData, attentionData, events] = await Promise.all([
      kpis(prisma, session),
      attention(prisma, session),
      recentEvents(prisma, session)
    ]);
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">Главная</h1>
        <ManagerKpiGrid data={kpiData} />
        <ManagerAttentionList items={attentionData} />
        <ManagerEventsFeed events={events} />
      </>
    );
  }
  ```
- [ ] **Step 10.3**: Manual smoke (опционально — full E2E в Phase 8.6): запустить dev сервер, залогиниться руками как manager (после Task 4 login flow готов), убедиться что dashboard рендерится без ошибок (даже с пустыми данными).
- [ ] **Step 10.4**: `npm run typecheck` — 0 errors.
- [ ] **Step 10.5 — Commit**: `feat(manager): dashboard page with KPI, attention, events`

### Task 11: Финал Phase 8.1 — lint/typecheck/build/tests

- [ ] **Step 11.1**: `npm run typecheck` — 0 errors.
- [ ] **Step 11.2**: `npm run lint` — 0 new warnings.
- [ ] **Step 11.3**: `npm test` — passes.
- [ ] **Step 11.4**: `npm run build` — successful. Новый роут: `/manager/dashboard` в выводе (но cabinet ещё не gated — это в Phase 8.6).
- [ ] **Step 11.5 — Commit (если есть fix-up)**: `chore(phase8.1): final polish`.

---

## Phase 8.2 — Orders (list + detail) + status change

### Task 12: `services/manager/orders.ts`

**Files:**
- Create: `src/lib/services/manager/orders.ts`
- Test: `src/__tests__/services.manager.orders.test.ts`

- [ ] **Step 12.1**: Реализовать `listOrders(prisma, opts)`:
  ```ts
  import { z } from 'zod';
  import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';

  const ListOrdersOptionsSchema = z.object({
    session: z.any(),
    q: z.string().optional(),
    executionStatus: z.string().optional(),
    financialStatus: z.string().optional(),
    organizationId: z.string().optional(),
    take: z.number().int().min(1).max(100).default(50),
    cursor: z.string().optional()
  });

  export async function listOrders(prisma, optsRaw) {
    const opts = ListOrdersOptionsSchema.parse(optsRaw);
    const scope = managerOrderScopeFilter(opts.session);
    const filters: any[] = [scope];
    if (opts.executionStatus) filters.push({ executionStatus: opts.executionStatus });
    if (opts.financialStatus) filters.push({ financialStatus: opts.financialStatus });
    if (opts.organizationId) filters.push({ organizationId: opts.organizationId });
    if (opts.q) filters.push({ OR: [
      { title: { contains: opts.q, mode: 'insensitive' } },
      { orderNumber: { contains: opts.q, mode: 'insensitive' } }
    ]});
    const rows = await prisma.order.findMany({
      where: { AND: filters },
      include: { organization: { select: { id, name } }, manager: { select: { id, name, email } } },
      orderBy: { id: 'desc' },
      take: opts.take + 1,
      ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 })
    });
    const nextCursor = rows.length > opts.take ? rows[opts.take - 1].id : null;
    return { rows: rows.slice(0, opts.take), nextCursor };
  }
  ```
- [ ] **Step 12.2**: Реализовать `getOrder(prisma, session, orderId)`:
  ```ts
  import { canSeeOrder } from '@/lib/auth/managerPolicy';

  export async function getOrder(prisma, session, orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        documents: { where: { scanStatus: { not: 'infected' } } },
        payments: true,
        manager: { select: { id, name, email } },
        organization: { select: { id, name } },
        comments: { where: { authorId: session.userId }, take: 1, select: { id: true } },
        _count: { select: { comments: true } }
      }
    });
    if (!order) return null;
    const commentsCountByMe = order.comments.length;
    if (!canSeeOrder(session, { ...order, commentsCountByMe })) return null;
    return order;
  }
  ```
- [ ] **Step 12.3**: Integration-тесты RBAC scenarios:
  - setup: 2 orgs (orgA, orgB), userA assigned to orgA, userB assigned to orgB, userC assigned to none.
  - listOrders(sessionA) → видит только orgA orders + orders с managerId=userA.
  - listOrders(sessionB) → видит orgB.
  - listOrders(sessionC) → видит только orders с managerId=userC.
  - Comments-history path: userA postит коммент на orgB order; admin удаляет userA-assignment; getOrder(sessionA, orgBOrder.id) → still visible через comments-history.
  - getOrder для чужого order без любой связи → null.
- [ ] **Step 12.4**: `npm test src/__tests__/services.manager.orders.test.ts` — passes.
- [ ] **Step 12.5 — Commit**: `feat(manager): orders service with three-way RBAC scope`

### Task 13: `services/manager/status.ts` + server action

**Files:**
- Create: `src/lib/services/manager/status.ts`
- Create: `src/server-actions/manager/transitionOrderStatus.ts`
- Test: `src/__tests__/server-actions.manager.status.test.ts`

- [ ] **Step 13.1**: `services/manager/status.ts`:
  ```ts
  import { canSeeOrder } from '@/lib/auth/managerPolicy';
  import { recordAudit } from '@/lib/audit';
  import { notifyOrgUsers, notifyManagers } from '@/lib/notifications';

  const VALID_STATUSES = ['new', 'in_progress', 'completed'] as const;
  type ManagerSettableStatus = (typeof VALID_STATUSES)[number];

  export async function transitionOrderStatus(prisma, session, orderId: string, newStatus: ManagerSettableStatus) {
    if (!VALID_STATUSES.includes(newStatus)) throw new Error('invalid_status');
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, managerId: true, organizationId: true, executionStatus: true, orderNumber: true, title: true }
    });
    if (!order || !canSeeOrder(session, order)) throw new Error('forbidden');
    if (order.executionStatus === newStatus) return; // no-op
    await prisma.order.update({
      where: { id: orderId },
      data: {
        executionStatus: newStatus,
        ...(newStatus === 'completed' ? { completedAt: new Date() } : {}),
        ...(order.executionStatus === 'completed' && newStatus !== 'completed' ? { completedAt: null } : {})
      }
    });
    await recordAudit('order_status_changed', {
      entity: 'order',
      entityId: orderId,
      before: { executionStatus: order.executionStatus },
      after: { executionStatus: newStatus, actor: 'manager' }
    });
    if (order.organizationId) {
      await notifyOrgUsers(prisma, {
        organizationId: order.organizationId,
        type: 'order_status_changed',
        payload: { orderId, orderNumber: order.orderNumber, dimension: 'execution', oldStatus: order.executionStatus, newStatus, orderTitle: order.title }
      });
    }
    await notifyManagers(prisma, { orderId, type: 'order_status_changed_by_manager', payload: { newStatus, oldStatus: order.executionStatus, actorUserId: session.userId } }, { excludeUserId: session.userId });
  }
  ```
  (`notifyManagers` будет реализован в Task 23. На этом этапе можно либо временный stub в `notifications.ts`, либо отложить hook — реализовать `notifyManagers` в Task 13 чуть рано, поэтому сейчас просто пропустить вызов и добавить в Task 23. Mark TODO в комментарии и убрать в Task 23 commit.)
- [ ] **Step 13.2**: ВАЖНО: чтобы избежать forward-reference на ещё несуществующий `notifyManagers`, временно убрать вызов в этой реализации:
  ```ts
  // TODO(8.4): wire notifyManagers here once notifications.ts:notifyManagers exists (Task 23)
  // await notifyManagers(prisma, ..., { excludeUserId: session.userId });
  ```
  В Task 23 раскомментируем и удалим TODO.
- [ ] **Step 13.3**: `server-actions/manager/transitionOrderStatus.ts`:
  ```ts
  'use server';
  import { revalidatePath } from 'next/cache';
  import { z } from 'zod';
  import { prisma } from '@/lib/db/prisma';
  import { requireManager } from '@/lib/auth/requireRole';
  import { transitionOrderStatus } from '@/lib/services/manager/status';

  const InputSchema = z.object({
    orderId: z.string().min(1),
    newStatus: z.enum(['new', 'in_progress', 'completed'])
  });

  export async function transitionOrderStatusAction(input: { orderId: string; newStatus: string }) {
    const session = await requireManager();
    const parsed = InputSchema.parse(input);
    try {
      await transitionOrderStatus(prisma, session, parsed.orderId, parsed.newStatus);
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
    revalidatePath(`/manager/orders/${parsed.orderId}`);
    revalidatePath('/manager/orders');
    revalidatePath('/manager/dashboard');
    return { ok: true };
  }
  ```
- [ ] **Step 13.4**: Тесты `server-actions.manager.status.test.ts` с mock prisma + mock notifyOrgUsers:
  - happy path: new → in_progress on assigned order → update happens, audit recorded, notifyOrgUsers called, revalidatePath called.
  - to completed: completedAt set.
  - from completed: completedAt cleared.
  - same status: no-op, no DB write.
  - forbidden order: throws, action returns { ok: false, error: 'forbidden' }.
  - invalid status: zod throws.
- [ ] **Step 13.5**: `npm test src/__tests__/server-actions.manager.status.test.ts` — passes.
- [ ] **Step 13.6 — Commit**: `feat(manager): status service and transitionOrderStatusAction with audit and org notify`

### Task 14: `manager-orders-filter` + `manager-orders-table` components

**Files:**
- Create: `src/components/manager/manager-orders-filter.tsx`
- Create: `src/components/manager/manager-orders-table.tsx`

- [ ] **Step 14.1**: `manager-orders-filter.tsx` — `<form method="get">` с select'ами execution/financial и text input `q` + select organizationId (опции загружаются через server action / props passed from page — для простоты: page загружает list managed orgs и передаёт props). Submit перезагружает страницу с query params.
- [ ] **Step 14.2**: `manager-orders-table.tsx` — server component (presentational). Колонки: №, Название, Организация (NEW для manager view), Сумма, Оплачено, Исполнение, Финансы, Менеджер. Без partner-commission. Принимает `rows: OrderRow[]` и `nextCursor: string | null`. Pagination link «Дальше» использует current URL params + `cursor`.
- [ ] **Step 14.3**: `npm run typecheck` — 0 errors.
- [ ] **Step 14.4 — Commit**: `feat(manager): orders filter and table components`

### Task 15: Page `/manager/orders` (list — rewrite stub)

**Files:**
- Modify: `src/app/manager/orders/page.tsx` (полная замена существующего `<h1>` stub'а)

- [ ] **Step 15.1**: Replace contents:
  ```tsx
  import { requireManager } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { listOrders } from '@/lib/services/manager/orders';
  import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';
  import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';
  import { listOrganizations } from '@/lib/services/manager/organizations'; // создаётся в Task 21; пока временно встроенный fallback []

  type SearchParams = { q?: string; executionStatus?: string; financialStatus?: string; organizationId?: string; cursor?: string };

  export default async function ManagerOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const session = await requireManager();
    const sp = await searchParams;
    const [{ rows, nextCursor }, orgs] = await Promise.all([
      listOrders(prisma, { session, ...sp }),
      // placeholder for Task 21 — temporarily fetch active managed orgs inline:
      prisma.organization.findMany({ where: { id: { in: session.managedOrgIds ?? [] } }, select: { id, name } })
    ]);
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">Заказы</h1>
        <ManagerOrdersFilter orgs={orgs} initial={sp} />
        <ManagerOrdersTable rows={rows} nextCursor={nextCursor} searchParams={sp} />
      </>
    );
  }
  ```
- [ ] **Step 15.2**: NOTE — Task 21 заменит inline `findMany` на `listOrganizations(prisma, session)`. До Task 21 inline-вариант валиден.
- [ ] **Step 15.3**: `npm run typecheck` — 0 errors.
- [ ] **Step 15.4 — Commit**: `feat(manager): orders list page with filter, table and pagination`

### Task 16: `manager-order-*` siblings + page `/manager/orders/[id]` (detail)

**Files:**
- Create: `src/components/manager/manager-order-header.tsx`
- Create: `src/components/manager/manager-order-amounts.tsx`
- Create: `src/components/manager/manager-order-timeline.tsx`
- Create: `src/components/manager/manager-payments-list.tsx`
- Create: `src/app/manager/orders/[id]/page.tsx`

- [ ] **Step 16.1**: `manager-order-header.tsx` — presentational. Принимает `{ order: { id, orderNumber, title, executionStatus, financialStatus, manager, organization, deadline, contractSignedAt } }`. Render: orderNumber + title h1 + 2 badges (execution + financial) + manager email + дедлайн.
- [ ] **Step 16.2**: `manager-order-amounts.tsx` — presentational. Card с total, paid, оставшаяся сумма, % оплаты.
- [ ] **Step 16.3**: `manager-order-timeline.tsx` — presentational. Принимает `{ order, auditEntries }` и рендерит хронологию: contractSignedAt, payments (даты), document publishes, status changes (kind 'order_status_changed'). **Скрывает** строки с `kind in ['partner_commission_*','partner_rate_changed']`. **ПОКАЗЫВАЕТ** строки `kind='order_status_changed'` с пометкой actor (cabinet/manager/1c) если actor доступен в audit meta.
- [ ] **Step 16.4**: `manager-payments-list.tsx` — presentational. Список платежей: дата, сумма, метод (если есть), 1C-source флаг.
- [ ] **Step 16.5**: `/manager/orders/[id]/page.tsx`:
  ```tsx
  import { requireManager } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { getOrder } from '@/lib/services/manager/orders';
  import { ManagerOrderHeader } from '@/components/manager/manager-order-header';
  import { ManagerOrderAmounts } from '@/components/manager/manager-order-amounts';
  import { ManagerOrderTimeline } from '@/components/manager/manager-order-timeline';
  import { ManagerPaymentsList } from '@/components/manager/manager-payments-list';
  import { DocumentsList } from '@/components/partner/documents-list';
  import { CommentsThread } from '@/components/shared/comments-thread'; // путь подкорректировать под актуальное расположение (Phase 7 шаред)
  import { notFound } from 'next/navigation';

  export default async function ManagerOrderDetail({ params }: { params: Promise<{ id: string }> }) {
    const session = await requireManager();
    const { id } = await params;
    const order = await getOrder(prisma, session, id);
    if (!order) notFound();
    const auditEntries = await prisma.auditLog.findMany({ where: { entityId: id, kind: { in: ['order_status_changed', 'document_uploaded', 'comment_posted'] } }, orderBy: { createdAt: 'desc' }, take: 50 });
    const comments = await prisma.comment.findMany({ where: { orderId: id }, include: { author: { select: { id, name, email, role } } }, orderBy: { createdAt: 'asc' } });
    return (
      <>
        <ManagerOrderHeader order={order} />
        <ManagerOrderAmounts order={order} />
        <DocumentsList viewer="manager" rows={order.documents} downloadEndpointBase="/api/manager/documents" />
        <ManagerPaymentsList payments={order.payments} />
        <ManagerOrderTimeline order={order} auditEntries={auditEntries} />
        {/* Status change form added in Task 17 */}
        <CommentsThread viewer="manager" orderId={order.id} initialComments={comments} />
      </>
    );
  }
  ```
  (Если `@/components/shared/comments-thread` не существует — заменить на `@/components/partner/comments-thread` или путь куда фактически лежит после Phase 7. Проверить ls.)
- [ ] **Step 16.6**: `npm run typecheck` — 0 errors.
- [ ] **Step 16.7 — Commit**: `feat(manager): order detail page with header, amounts, timeline, payments, comments`

### Task 17: `manager-status-change-form` + интеграция в order detail page

**Files:**
- Create: `src/components/manager/manager-status-change-form.tsx`
- Modify: `src/app/manager/orders/[id]/page.tsx` (добавить рендер `ManagerStatusChangeForm`)

- [ ] **Step 17.1**: `manager-status-change-form.tsx` — client component:
  ```tsx
  'use client';
  import { useTransition, useState } from 'react';
  import { transitionOrderStatusAction } from '@/server-actions/manager/transitionOrderStatus';

  type Props = { orderId: string; currentStatus: 'new' | 'in_progress' | 'completed' | 'closed' };

  export function ManagerStatusChangeForm({ orderId, currentStatus }: Props) {
    const [isPending, startTransition] = useTransition();
    const [newStatus, setNewStatus] = useState<'new' | 'in_progress' | 'completed'>(currentStatus === 'closed' ? 'in_progress' : currentStatus);
    const [error, setError] = useState<string | null>(null);

    if (currentStatus === 'closed') return <div className="text-sm text-gray-500">Заказ закрыт; статус управляется 1С.</div>;

    const onSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      startTransition(async () => {
        const result = await transitionOrderStatusAction({ orderId, newStatus });
        if (!result.ok) setError(result.error ?? 'Ошибка');
      });
    };

    return (
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <label className="text-sm">
          Новый статус:
          <select value={newStatus} onChange={e => setNewStatus(e.target.value as any)} className="ml-2 border rounded px-2 py-1">
            <option value="new">Новый</option>
            <option value="in_progress">В работе</option>
            <option value="completed">Завершён</option>
          </select>
        </label>
        <button type="submit" disabled={isPending || newStatus === currentStatus} className="px-3 py-1 bg-orange-500 text-white rounded disabled:opacity-50">
          {isPending ? 'Сохраняю…' : 'Изменить'}
        </button>
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </form>
    );
  }
  ```
- [ ] **Step 17.2**: В `src/app/manager/orders/[id]/page.tsx` добавить рендер между `ManagerOrderTimeline` и `CommentsThread`:
  ```tsx
  <ManagerStatusChangeForm orderId={order.id} currentStatus={order.executionStatus} />
  ```
  (import добавить наверх.)
- [ ] **Step 17.3**: Manual smoke (опционально): открыть `/manager/orders/[id]` как manager → select status → submit → видим перезагрузку и обновлённый статус.
- [ ] **Step 17.4**: `npm run typecheck` — 0 errors.
- [ ] **Step 17.5 — Commit**: `feat(manager): status change form on order detail page`

### Task 18: Финал Phase 8.2

- [ ] **Step 18.1**: `npm run typecheck` — 0 errors.
- [ ] **Step 18.2**: `npm run lint` — 0 new warnings.
- [ ] **Step 18.3**: `npm test` — passes.
- [ ] **Step 18.4**: `npm run build` — successful. Новые роуты `/manager/orders`, `/manager/orders/[id]`.
- [ ] **Step 18.5 — Commit (если есть fix-up)**: `chore(phase8.2): final polish`.

---

## Phase 8.3 — Documents + Organizations + Students

### Task 19: `services/manager/documents.ts` + download route

**Files:**
- Create: `src/lib/services/manager/documents.ts`
- Create: `src/app/api/manager/documents/[id]/download/route.ts`
- Test: `src/__tests__/services.manager.documents.test.ts`
- Test: `src/__tests__/api.manager.documents.download.test.ts`

- [ ] **Step 19.1**: `services/manager/documents.ts`:
  ```ts
  import { managerDocumentScopeFilter, canSeeDocument } from '@/lib/auth/managerPolicy';

  export async function listDocuments(prisma, opts: { session, q?, orderId?, type?, take?, cursor? }) {
    const scope = managerDocumentScopeFilter(opts.session);
    const filters: any[] = [scope];
    if (opts.orderId) filters.push({ orderId: opts.orderId });
    if (opts.type) filters.push({ docType: opts.type });
    if (opts.q) filters.push({ name: { contains: opts.q, mode: 'insensitive' } });
    const take = opts.take ?? 50;
    const rows = await prisma.document.findMany({
      where: { AND: filters },
      include: { order: { select: { id, orderNumber, title, managerId, organizationId } } },
      orderBy: { id: 'desc' },
      take: take + 1,
      ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 })
    });
    const nextCursor = rows.length > take ? rows[take - 1].id : null;
    return { rows: rows.slice(0, take), nextCursor };
  }

  type DownloadResult = { ok: true; path: string; mimeType: string; name: string } | { ok: false; error: 'not_found' | 'infected' };

  export async function getDocumentForDownload(prisma, session, docId: string): Promise<DownloadResult> {
    const doc = await prisma.document.findUnique({
      where: { id: docId },
      select: { id, path: true, mimeType: true, name: true, scanStatus: true, order: { select: { managerId: true, organizationId: true } } }
    });
    if (!doc) return { ok: false, error: 'not_found' };
    if (!canSeeDocument(session, doc as any)) return { ok: false, error: 'not_found' }; // не палим
    if (doc.scanStatus === 'infected') return { ok: false, error: 'infected' };
    return { ok: true, path: doc.path, mimeType: doc.mimeType, name: doc.name };
  }
  ```
- [ ] **Step 19.2**: Download route `src/app/api/manager/documents/[id]/download/route.ts`:
  ```ts
  import { NextRequest } from 'next/server';
  import { requireManager } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { getDocumentForDownload } from '@/lib/services/manager/documents';
  import { supabaseAdmin } from '@/lib/storage/supabase';

  export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireManager();
    const { id } = await params;
    const result = await getDocumentForDownload(prisma, session, id);
    if (!result.ok && result.error === 'not_found') return new Response(null, { status: 404 });
    if (!result.ok && result.error === 'infected') return new Response('Document quarantined', { status: 410 });
    const { data: signed, error } = await supabaseAdmin.storage.from('documents').createSignedUrl(result.path, 600);
    if (error || !signed) return new Response('Storage error', { status: 500 });
    return Response.redirect(signed.signedUrl, 302);
  }
  ```
- [ ] **Step 19.3**: Тесты сервиса — RBAC + infected фильтр (mirror Phase 7 docs service tests).
- [ ] **Step 19.4**: Тесты route — 404 несущ., 404 чужой, 410 infected, 302 clean (mock Supabase).
- [ ] **Step 19.5**: `npm test src/__tests__/services.manager.documents.test.ts src/__tests__/api.manager.documents.download.test.ts` — passes.
- [ ] **Step 19.6 — Commit**: `feat(manager): documents service with hide-infected and signed-url download route`

### Task 20: Page `/manager/documents` (rewrite stub)

**Files:**
- Modify: `src/app/manager/documents/page.tsx` (полная замена)

- [ ] **Step 20.1**: Replace contents:
  ```tsx
  import { requireManager } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { listDocuments } from '@/lib/services/manager/documents';
  import { DocumentsList } from '@/components/partner/documents-list';

  type SearchParams = { q?: string; type?: string; orderId?: string; cursor?: string };

  export default async function ManagerDocumentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const session = await requireManager();
    const sp = await searchParams;
    const { rows, nextCursor } = await listDocuments(prisma, { session, ...sp });
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">Документы</h1>
        <form method="get" className="mb-3 flex gap-2">
          <input name="q" defaultValue={sp.q ?? ''} placeholder="Поиск…" className="border rounded px-2 py-1" />
          <select name="type" defaultValue={sp.type ?? ''} className="border rounded px-2 py-1">
            <option value="">Все типы</option>
            <option value="invoice">Счёт</option>
            <option value="act">Акт</option>
            <option value="contract">Договор</option>
          </select>
          <button type="submit" className="px-3 py-1 bg-orange-500 text-white rounded">Найти</button>
        </form>
        <DocumentsList viewer="manager" rows={rows} downloadEndpointBase="/api/manager/documents" />
        {nextCursor && (
          <a href={`/manager/documents?cursor=${nextCursor}${sp.q ? `&q=${sp.q}` : ''}${sp.type ? `&type=${sp.type}` : ''}`} className="mt-3 inline-block">Дальше →</a>
        )}
      </>
    );
  }
  ```
- [ ] **Step 20.2**: Если `DocumentsList` не принимает `viewer` / `downloadEndpointBase` — проверить актуальную сигнатуру и привести в соответствие. Если фундаментально несовместим, создать `manager-documents-list.tsx` sibling (документировать решение в commit message).
- [ ] **Step 20.3**: `npm run typecheck` — 0 errors.
- [ ] **Step 20.4 — Commit**: `feat(manager): documents list page with filter and download`

### Task 21: `services/manager/organizations.ts` + pages + components

**Files:**
- Create: `src/lib/services/manager/organizations.ts`
- Create: `src/components/manager/manager-orgs-list.tsx`
- Create: `src/components/manager/manager-org-card.tsx`
- Create: `src/app/manager/organizations/page.tsx`
- Create: `src/app/manager/organizations/[id]/page.tsx`
- Modify: `src/app/manager/orders/page.tsx` (заменить inline findMany на listOrganizations)
- Test: `src/__tests__/services.manager.organizations.test.ts`

- [ ] **Step 21.1**: `services/manager/organizations.ts`:
  ```ts
  import { managerOrgScopeFilter, canSeeOrganization } from '@/lib/auth/managerPolicy';

  export async function listOrganizations(prisma, session) {
    return prisma.organization.findMany({
      where: managerOrgScopeFilter(session),
      select: { id, name, _count: { select: { orders: true, students: true } } },
      orderBy: { name: 'asc' }
    });
  }

  export async function getOrganization(prisma, session, orgId: string) {
    if (!canSeeOrganization(session, orgId)) return null;
    return prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        _count: { select: { orders: true, students: true, users: true } },
        partner: { select: { id, name } }
      }
    });
  }
  ```
- [ ] **Step 21.2**: `manager-orgs-list.tsx` — table presentational (Название, Заказы, Сотрудники, →).
- [ ] **Step 21.3**: `manager-org-card.tsx` — карточка одной организации с counters and «Открыть» CTA.
- [ ] **Step 21.4**: `/manager/organizations/page.tsx`:
  ```tsx
  import { requireManager } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { listOrganizations } from '@/lib/services/manager/organizations';
  import { ManagerOrgsList } from '@/components/manager/manager-orgs-list';

  export default async function ManagerOrganizationsPage() {
    const session = await requireManager();
    const orgs = await listOrganizations(prisma, session);
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">Организации</h1>
        {orgs.length === 0 ? <p>Вам пока не назначено ни одной организации.</p> : <ManagerOrgsList orgs={orgs} />}
      </>
    );
  }
  ```
- [ ] **Step 21.5**: `/manager/organizations/[id]/page.tsx`:
  ```tsx
  import { requireManagerForOrg } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { getOrganization } from '@/lib/services/manager/organizations';
  import { ManagerOrgCard } from '@/components/manager/manager-org-card';
  import { listOrders } from '@/lib/services/manager/orders';
  import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';
  import { notFound } from 'next/navigation';

  export default async function ManagerOrgDetail({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await requireManagerForOrg(id);
    const [org, { rows: recentOrders }] = await Promise.all([
      getOrganization(prisma, session, id),
      listOrders(prisma, { session, organizationId: id, take: 10 })
    ]);
    if (!org) notFound();
    return (
      <>
        <ManagerOrgCard org={org} />
        <h2 className="mt-6 mb-2 text-xl font-semibold">Последние заказы</h2>
        <ManagerOrdersTable rows={recentOrders} nextCursor={null} searchParams={{}} />
      </>
    );
  }
  ```
- [ ] **Step 21.6**: В `src/app/manager/orders/page.tsx` заменить inline `prisma.organization.findMany` на `await listOrganizations(prisma, session)`. Удалить временный TODO-comment если был.
- [ ] **Step 21.7**: Тесты сервиса:
  - `listOrganizations`: возвращает только in-scope orgs; пустой scope → [].
  - `getOrganization` для in-scope → org; для out-of-scope → null.
- [ ] **Step 21.8**: `npm test src/__tests__/services.manager.organizations.test.ts` — passes.
- [ ] **Step 21.9 — Commit**: `feat(manager): organizations service + index/detail pages`

### Task 22: `services/manager/students.ts` + page

**Files:**
- Create: `src/lib/services/manager/students.ts`
- Create: `src/components/manager/manager-students-table.tsx` (либо reuse `org-students-table` если совместим — решение в Step 22.4)
- Create: `src/app/manager/students/page.tsx`
- Test: `src/__tests__/services.manager.students.test.ts`

- [ ] **Step 22.1**: `services/manager/students.ts`:
  ```ts
  import { managedOrgIds } from '@/lib/auth/managerPolicy';
  import { z } from 'zod';

  const ListStudentsOptionsSchema = z.object({
    session: z.any(),
    q: z.string().optional(),
    take: z.number().int().min(1).max(100).default(50),
    cursor: z.string().optional()
  });

  export async function listStudents(prisma, optsRaw) {
    const opts = ListStudentsOptionsSchema.parse(optsRaw);
    const orgIds = managedOrgIds(opts.session);
    const filters: any[] = [{ organizationId: { in: orgIds } }];
    if (opts.q) filters.push({ OR: [
      { name: { contains: opts.q, mode: 'insensitive' } },
      { email: { contains: opts.q, mode: 'insensitive' } }
    ]});
    const rows = await prisma.student.findMany({
      where: { AND: filters },
      include: { organization: { select: { id, name } } },
      orderBy: { id: 'desc' },
      take: opts.take + 1,
      ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 })
    });
    const nextCursor = rows.length > opts.take ? rows[opts.take - 1].id : null;
    return { rows: rows.slice(0, opts.take), nextCursor };
  }
  ```
- [ ] **Step 22.2**: Открыть `src/components/organization/org-students-table.tsx` (если существует — иначе grep чтобы найти). Если компонент принимает `viewer` prop или может работать с types из `manager/students.ts` — re-use. Иначе создать `manager-students-table.tsx`:
  ```tsx
  type StudentRow = { id: string; name: string | null; email: string | null; externalStudentId: string | null; createdAt: Date; organization: { id: string; name: string } };
  export function ManagerStudentsTable({ rows }: { rows: StudentRow[] }) {
    if (rows.length === 0) return <p>Сотрудники не найдены.</p>;
    return (
      <table className="w-full">
        <thead><tr><th>ФИО</th><th>Email</th><th>Организация</th><th>ExternalId</th><th>Добавлен</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id}>
            <td>{r.name ?? '—'}</td>
            <td>{r.email ?? '—'}</td>
            <td>{r.organization.name}</td>
            <td>{r.externalStudentId ?? '—'}</td>
            <td>{r.createdAt.toLocaleDateString('ru-RU')}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  ```
- [ ] **Step 22.3**: `/manager/students/page.tsx`:
  ```tsx
  import { requireManager } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { listStudents } from '@/lib/services/manager/students';
  import { ManagerStudentsTable } from '@/components/manager/manager-students-table';

  type SearchParams = { q?: string; cursor?: string };

  export default async function ManagerStudentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const session = await requireManager();
    const sp = await searchParams;
    const { rows, nextCursor } = await listStudents(prisma, { session, ...sp });
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">Сотрудники</h1>
        <form method="get" className="mb-3"><input name="q" defaultValue={sp.q ?? ''} placeholder="Поиск" className="border rounded px-2 py-1" /></form>
        <ManagerStudentsTable rows={rows} />
        {nextCursor && <a href={`/manager/students?cursor=${nextCursor}${sp.q ? `&q=${sp.q}` : ''}`}>Дальше →</a>}
      </>
    );
  }
  ```
- [ ] **Step 22.4**: Тесты:
  - RBAC: `listStudents` для manager в orgA → только orgA students; orgB не попадает.
  - Search: q matches на name/email.
- [ ] **Step 22.5**: `npm test src/__tests__/services.manager.students.test.ts` — passes.
- [ ] **Step 22.6 — Commit**: `feat(manager): students list page scoped to managed organizations`

### Task 23: Финал Phase 8.3

- [ ] **Step 23.1**: typecheck/lint/test/build.
- [ ] **Step 23.2 — Commit (fix-up если есть)**: `chore(phase8.3): final polish`.

---

## Phase 8.4 — Write paths + Notifications

### Task 24: `services/manager/uploads.ts` + upload route + form component

**Files:**
- Create: `src/lib/services/manager/uploads.ts`
- Create: `src/app/api/manager/documents/[orderId]/upload/route.ts`
- Create: `src/components/manager/manager-doc-upload-form.tsx`
- Test: `src/__tests__/services.manager.uploads.test.ts`
- Test: `src/__tests__/api.manager.documents.upload.test.ts`

- [x] **Step 24.1**: `services/manager/uploads.ts`:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { canSeeOrder } from '@/lib/auth/managerPolicy';
  import { recordAudit } from '@/lib/audit';
  import { supabaseAdmin } from '@/lib/storage/supabase';
  import { addToQueue } from '@/worker/queues'; // путь поправить под актуальный
  import { notifyOrgUsers } from '@/lib/notifications';

  const MAX_SIZE = 20 * 1024 * 1024;
  const ALLOWED_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

  type Result = { ok: true; documentId: string } | { ok: false; error: 'forbidden' | 'too_large' | 'invalid_mime' | 'storage' };

  export async function createOrderDocument(prisma, session, args: { orderId: string; file: { name: string; size: number; mimeType: string; buffer: Buffer }; docType: string }): Promise<Result> {
    if (args.file.size > MAX_SIZE) return { ok: false, error: 'too_large' };
    if (!ALLOWED_MIMES.has(args.file.mimeType)) return { ok: false, error: 'invalid_mime' };
    const order = await prisma.order.findUnique({ where: { id: args.orderId }, select: { managerId: true, organizationId: true, orderNumber: true } });
    if (!order || !canSeeOrder(session, order)) return { ok: false, error: 'forbidden' };
    const storagePath = `orders/${args.orderId}/${randomUUID()}-${args.file.name}`;
    const upload = await supabaseAdmin.storage.from('documents').upload(storagePath, args.file.buffer, { contentType: args.file.mimeType });
    if (upload.error) return { ok: false, error: 'storage' };
    const doc = await prisma.document.create({
      data: {
        orderId: args.orderId,
        name: args.file.name,
        mimeType: args.file.mimeType,
        size: args.file.size,
        path: storagePath,
        docType: args.docType,
        generationSource: 'user',
        scanStatus: 'pending',
        uploaderUserId: session.userId
      }
    });
    await addToQueue('document-scan', { documentId: doc.id });
    await recordAudit('document_uploaded', { entity: 'document', entityId: doc.id, before: null, after: { orderId: args.orderId, docType: args.docType, source: 'manager' } });
    if (order.organizationId) {
      await notifyOrgUsers(prisma, {
        organizationId: order.organizationId,
        type: 'document_published',
        payload: { orderId: args.orderId, orderNumber: order.orderNumber, docName: args.file.name, docType: args.docType }
      });
    }
    return { ok: true, documentId: doc.id };
  }
  ```
- [x] **Step 24.2**: Upload route:
  ```ts
  import { NextRequest } from 'next/server';
  import { requireManager } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { createOrderDocument } from '@/lib/services/manager/uploads';

  export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
    const session = await requireManager();
    const { orderId } = await params;
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const docType = String(form.get('docType') ?? 'other');
    if (!file) return new Response('No file', { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await createOrderDocument(prisma, session, { orderId, docType, file: { name: file.name, size: file.size, mimeType: file.type, buffer } });
    if (!result.ok) {
      const status = result.error === 'forbidden' ? 403 : result.error === 'too_large' ? 413 : result.error === 'invalid_mime' ? 415 : 500;
      return Response.json({ ok: false, error: result.error }, { status });
    }
    return Response.json({ ok: true, documentId: result.documentId }, { status: 201 });
  }
  ```
- [x] **Step 24.3**: `manager-doc-upload-form.tsx` — client component с `<input type="file">`, select docType, submit handler через `fetch(POST /api/manager/documents/[orderId]/upload, FormData)`. Показать progress / error states.
- [x] **Step 24.4**: Тесты сервиса — happy path; oversized → too_large; bad mime → invalid_mime; forbidden order → forbidden; storage failure → storage.
- [x] **Step 24.5**: Тесты route — параллельные status codes для каждой ошибки.
- [x] **Step 24.6**: `npm test src/__tests__/services.manager.uploads.test.ts src/__tests__/api.manager.documents.upload.test.ts` — passes.
- [x] **Step 24.7 — Commit**: `feat(manager): document upload service, route, and form`

### Task 25: Extend `/api/comments` POST для `viewer='manager'` + organization manager-replied template

**Files:**
- Modify: `src/app/api/comments/route.ts` (добавить branch для `session.role === 'manager'`)
- Create: `src/lib/email/templates/organization/manager-replied.tsx`
- Test: `src/__tests__/api.comments.manager.test.ts`

- [ ] **Step 25.1**: Открыть `src/app/api/comments/route.ts`, в POST handler после existing branches добавить:
  ```ts
  if (session.role === 'manager') {
    const { managerPolicy } = await import('@/lib/auth/managerPolicy');
    const body = await req.json();
    const parsed = z.object({ orderId: z.string(), body: z.string().min(1), attachmentPath: z.string().optional() }).safeParse(body);
    if (!parsed.success) return Response.json({ error: 'bad_input' }, { status: 400 });
    const order = await prisma.order.findUnique({ where: { id: parsed.data.orderId }, select: { id, managerId: true, organizationId: true, orderNumber: true } });
    if (!order || !managerPolicy.canSeeOrder(session, order)) return new Response(null, { status: 403 });
    const comment = await prisma.comment.create({
      data: { orderId: order.id, body: parsed.data.body, attachmentPath: parsed.data.attachmentPath, authorId: session.userId }
    });
    await recordAudit('comment_posted', { entity: 'order', entityId: order.id, after: { commentId: comment.id, role: 'manager' } });
    if (order.organizationId) {
      await notifyOrgUsers(prisma, {
        organizationId: order.organizationId,
        type: 'manager_replied',
        payload: { orderId: order.id, orderNumber: order.orderNumber, commentExcerpt: parsed.data.body.slice(0, 200) }
      });
    }
    return Response.json({ ok: true, commentId: comment.id }, { status: 201 });
  }
  ```
- [ ] **Step 25.2**: Создать `src/lib/email/templates/organization/manager-replied.tsx`:
  ```tsx
  import { Container, Heading, Text, Button, Section } from '@react-email/components';
  export function OrgManagerReplied({ orderNumber, commentExcerpt, orderUrl }: { orderNumber: string; commentExcerpt: string; orderUrl: string }) {
    return (
      <Container>
        <Heading>Менеджер ответил по заказу {orderNumber}</Heading>
        <Section><Text>«{commentExcerpt}»</Text></Section>
        <Button href={orderUrl} style={{ backgroundColor: '#F97316', color: '#fff', padding: '10px 20px', borderRadius: 6 }}>Открыть заказ</Button>
      </Container>
    );
  }
  ```
- [ ] **Step 25.3**: В `notifyOrgUsers` (Phase 7) helper добавить case `manager_replied` в TEMPLATES map. Если карта в `src/lib/notifications.ts` — расширить:
  ```ts
  manager_replied: (payload) => ({
    subject: `Менеджер ответил по заказу ${payload.orderNumber}`,
    shortBody: payload.commentExcerpt,
    component: <OrgManagerReplied orderNumber={payload.orderNumber} commentExcerpt={payload.commentExcerpt} orderUrl={`${process.env.PUBLIC_URL}/organization/orders/${payload.orderId}`} />
  })
  ```
- [ ] **Step 25.4**: Тесты `api.comments.manager.test.ts`:
  - manager пишет на assigned order → 201, comment created, notifyOrgUsers вызван с type='manager_replied'.
  - manager на чужой order → 403.
  - manager без active assignment → 403 через canSeeOrder.
  - existing partner и organization branches тесты должны зеленеть.
- [ ] **Step 25.5**: `npm test src/__tests__/api.comments.manager.test.ts` — passes.
- [ ] **Step 25.6 — Commit**: `feat(api): /api/comments POST accepts manager role with manager_replied notification`

### Task 26: Manager email templates (4 файла)

**Files:**
- Create: `src/lib/email/templates/manager/comment-from-org.tsx`
- Create: `src/lib/email/templates/manager/document-uploaded-by-org.tsx`
- Create: `src/lib/email/templates/manager/order-marked-paid-by-1c.tsx`
- Create: `src/lib/email/templates/manager/order-status-changed.tsx`

- [ ] **Step 26.1**: `comment-from-org.tsx`:
  ```tsx
  import { Container, Heading, Text, Button, Section } from '@react-email/components';
  export function ManagerCommentFromOrg({ orgName, orderNumber, commentExcerpt, orderUrl }: { orgName: string; orderNumber: string; commentExcerpt: string; orderUrl: string }) {
    return (
      <Container>
        <Heading>Новое сообщение от {orgName} по заказу {orderNumber}</Heading>
        <Section><Text>«{commentExcerpt}»</Text></Section>
        <Button href={orderUrl} style={{ backgroundColor: '#F97316', color: '#fff', padding: '10px 20px', borderRadius: 6 }}>Открыть заказ</Button>
      </Container>
    );
  }
  ```
- [ ] **Step 26.2**: `document-uploaded-by-org.tsx` — аналогично, заголовок «{orgName} загрузил документ {docName} к заказу {orderNumber}».
- [ ] **Step 26.3**: `order-marked-paid-by-1c.tsx` — заголовок «Получена оплата {amount} ₽ по заказу {orderNumber}».
- [ ] **Step 26.4**: `order-status-changed.tsx` — заголовок «Менеджер {actorName} перевёл заказ {orderNumber} в {newStatus}».
- [ ] **Step 26.5**: Smoke render test (Vitest, snapshot) для каждого:
  ```ts
  import { render } from '@react-email/render';
  // ...
  expect(await render(<ManagerCommentFromOrg orgName="ACME" orderNumber="O-001" commentExcerpt="Test" orderUrl="http://localhost" />)).toContain('ACME');
  ```
- [ ] **Step 26.6**: `npm test` (или конкретный test file) — passes.
- [ ] **Step 26.7 — Commit**: `feat(email): manager templates (comment_from_org, document_uploaded_by_org, order_marked_paid_by_1c, order_status_changed)`

### Task 27: `notifyManagers` helper + recipient resolver + invariant test

**Files:**
- Modify: `src/lib/notifications.ts` (добавить функцию + TEMPLATES map для manager templates)
- Create: `src/__tests__/notifications.notifyManagers.test.ts`
- Create: `src/__tests__/notifications.invariant.test.ts`

- [ ] **Step 27.1**: В `notifications.ts` добавить:
  ```ts
  import { ManagerCommentFromOrg } from '@/lib/email/templates/manager/comment-from-org';
  import { ManagerDocumentUploadedByOrg } from '@/lib/email/templates/manager/document-uploaded-by-org';
  import { ManagerOrderMarkedPaidBy1C } from '@/lib/email/templates/manager/order-marked-paid-by-1c';
  import { ManagerOrderStatusChanged } from '@/lib/email/templates/manager/order-status-changed';

  type NotifyManagersArgs = {
    orderId: string;
    type: 'comment_from_org' | 'document_uploaded_by_org' | 'order_marked_paid_by_1c' | 'order_status_changed_by_manager';
    payload: Record<string, any>;
  };
  type NotifyManagersOpts = { excludeUserId?: string };

  export async function resolveManagerRecipients(prisma, orderId: string, opts?: NotifyManagersOpts): Promise<{ id: string; email: string; name: string | null }[]> {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { managerId: true, organizationId: true } });
    if (!order) return [];
    const ids = new Set<string>();
    if (order.managerId) ids.add(order.managerId);
    if (order.organizationId) {
      const orgAssigned = await prisma.organizationManager.findMany({ where: { organizationId: order.organizationId, isActive: true }, select: { userId: true } });
      orgAssigned.forEach(a => ids.add(a.userId));
    }
    const historical = await prisma.comment.findMany({ where: { orderId, author: { role: 'manager' } }, select: { authorId: true }, distinct: ['authorId'] });
    historical.forEach(c => ids.add(c.authorId));
    if (opts?.excludeUserId) ids.delete(opts.excludeUserId);
    if (ids.size === 0) return [];
    return prisma.user.findMany({ where: { id: { in: Array.from(ids) }, isActive: true }, select: { id, email, name } });
  }

  const MANAGER_TEMPLATES = {
    comment_from_org: (payload, ctx) => ({
      subject: `Новое сообщение от ${payload.orgName ?? 'клиента'} по заказу ${ctx.orderNumber}`,
      shortBody: payload.commentExcerpt,
      component: <ManagerCommentFromOrg orgName={payload.orgName ?? '—'} orderNumber={ctx.orderNumber} commentExcerpt={payload.commentExcerpt} orderUrl={`${process.env.PUBLIC_URL}/manager/orders/${payload.orderId ?? ctx.orderId}`} />
    }),
    document_uploaded_by_org: (payload, ctx) => ({ /* analogous */ }),
    order_marked_paid_by_1c: (payload, ctx) => ({ /* analogous */ }),
    order_status_changed_by_manager: (payload, ctx) => ({ /* analogous */ })
  } as const;

  export async function notifyManagers(prisma, args: NotifyManagersArgs, opts?: NotifyManagersOpts) {
    const order = await prisma.order.findUnique({ where: { id: args.orderId }, select: { orderNumber: true, title: true } });
    if (!order) return;
    const recipients = await resolveManagerRecipients(prisma, args.orderId, opts);
    for (const r of recipients) {
      const tpl = MANAGER_TEMPLATES[args.type](args.payload, { orderNumber: order.orderNumber, title: order.title, orderId: args.orderId });
      await send({ to: r.email, subject: tpl.subject, react: tpl.component });
      await prisma.notification.create({ data: { userId: r.id, type: args.type, title: tpl.subject, body: tpl.shortBody, meta: { ...args.payload, orderId: args.orderId } } });
    }
  }
  ```
- [ ] **Step 27.2**: Тесты `notifications.notifyManagers.test.ts` с mock send + mock prisma:
  - per-order recipient (managerId set) → 1 email.
  - per-org recipients (2 active managers, 1 deactivated) → 2 emails.
  - historical (manager без active assignment но с прошлым commentom) → попадает в recipients.
  - dedupe: один user попадает из 2 источников → 1 email.
  - excludeUserId: actor исключён.
  - Resend not configured → send no-op, но Notification всё равно создаётся.
- [ ] **Step 27.3**: Invariant test `notifications.invariant.test.ts`:
  ```ts
  it('notification recipient set equals visibility set', async () => {
    // setup: 5 manager users, mixed assignments, 3 orders, 4 comments
    // for each order: compute recipients = (await resolveManagerRecipients(prisma, order.id)).map(r => r.id).sort();
    //                 compute visible_users = await Promise.all(allManagers.map(async m => ({ id: m.id, visible: canSeeOrder(buildSession(m), order) })))
    //                                              .then(arr => arr.filter(x => x.visible).map(x => x.id).sort());
    // expect(recipients).toEqual(visible_users)
  });
  ```
  (Это тест защищающий invariant из spec §8.1.)
- [ ] **Step 27.4**: `npm test src/__tests__/notifications.notifyManagers.test.ts src/__tests__/notifications.invariant.test.ts` — passes.
- [ ] **Step 27.5 — Commit**: `feat(notifications): notifyManagers helper with three-way recipient resolver and visibility-invariant test`

### Task 28: Hook в `/api/comments` POST (org-comment → notifyManagers)

**Files:**
- Modify: `src/app/api/comments/route.ts` (добавить вызов в branch `session.role === 'organization'`)
- Test: `src/__tests__/api.comments.notifies-managers.test.ts`

- [ ] **Step 28.1**: В organization branch `/api/comments` POST (из Phase 7), после успешного `comment.create`, добавить:
  ```ts
  await notifyManagers(prisma, {
    orderId: order.id,
    type: 'comment_from_org',
    payload: { orderId: order.id, orgName: organization?.name, commentExcerpt: parsed.data.body.slice(0, 200), orderNumber }
  });
  ```
  (Импорт notifyManagers сверху файла.)
- [ ] **Step 28.2**: Тесты:
  - org user пишет коммент → 201 + notifyManagers вызван 1 раз с правильным recipient'ами.
  - existing notifyOrgUsers (если был) для каких-то целей продолжает работать.
- [ ] **Step 28.3**: `npm test src/__tests__/api.comments.notifies-managers.test.ts` — passes.
- [ ] **Step 28.4 — Commit**: `feat(api): org comments trigger notifyManagers (comment_from_org)`

### Task 29: Hook в `sync-payments` processor

**Files:**
- Modify: `src/worker/processors/sync-payments.ts` (добавить notifyManagers рядом с существующим notifyOrgUsers вызовом, если он есть)
- Test: `src/__tests__/worker.sync-payments.notifies-managers.test.ts`

- [ ] **Step 29.1**: Прочитать `sync-payments.ts`. Найти место где payment создаётся. После этого блока добавить (параллельно/независимо от notifyOrgUsers):
  ```ts
  await notifyManagers(db, {
    orderId: payment.orderId,
    type: 'order_marked_paid_by_1c',
    payload: { amount: payment.amount, paidAt: payment.paidAt, orderId: payment.orderId }
  });
  ```
- [ ] **Step 29.2**: Тесты:
  - sync-payments создаёт payment на order с managerId → notifyManagers called once.
  - order без managerId но с org-assigned managers → notifyManagers called с org recipients.
  - order без любых manager связей → notifyManagers called но recipients=[], не падает.
- [ ] **Step 29.3**: `npm test src/__tests__/worker.sync-payments.notifies-managers.test.ts` — passes.
- [ ] **Step 29.4 — Commit**: `feat(worker): sync-payments triggers notifyManagers (order_marked_paid_by_1c)`

### Task 30: Wire notifyManagers в `transitionOrderStatus` service (раскомментировать TODO из Task 13)

**Files:**
- Modify: `src/lib/services/manager/status.ts` (раскомментировать вызов из Task 13)
- Test: `src/__tests__/server-actions.manager.status.test.ts` (обновить — теперь notifyManagers тоже мокается и проверяется)

- [ ] **Step 30.1**: В `status.ts` заменить TODO-комментарий на реальный вызов:
  ```ts
  await notifyManagers(prisma, {
    orderId,
    type: 'order_status_changed_by_manager',
    payload: { newStatus, oldStatus: order.executionStatus, actorUserId: session.userId, orderNumber: order.orderNumber }
  }, { excludeUserId: session.userId });
  ```
- [ ] **Step 30.2**: В тестах из Task 13 добавить проверку: при manager-A смене статуса → notifyManagers вызван с `excludeUserId === actor`.
- [ ] **Step 30.3**: `npm test src/__tests__/server-actions.manager.status.test.ts` — passes.
- [ ] **Step 30.4 — Commit**: `feat(manager): transitionOrderStatus notifies other managers (order_status_changed_by_manager)`

### Task 31: `services/manager/messages.ts` + inbox component + page

**Files:**
- Create: `src/lib/services/manager/messages.ts`
- Create: `src/components/manager/manager-messages-inbox.tsx`
- Modify: `src/app/manager/messages/page.tsx` (rewrite stub)
- Test: `src/__tests__/services.manager.messages.test.ts`

- [ ] **Step 31.1**: `messages.ts`:
  ```ts
  import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';

  export async function listIncomingComments(prisma, opts: { session, since?: Date, take?: number, cursor?: string, withOutgoing?: boolean }) {
    const take = opts.take ?? 30;
    const since = opts.since ?? new Date(Date.now() - 30 * 86400_000);
    const rows = await prisma.comment.findMany({
      where: {
        order: managerOrderScopeFilter(opts.session),
        author: { role: opts.withOutgoing ? { in: ['organization', 'manager'] } : 'organization' },
        createdAt: { gte: since }
      },
      include: {
        order: { select: { id, orderNumber, title } },
        author: { select: { id, name, email, role } }
      },
      orderBy: { id: 'desc' },
      take: take + 1,
      ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 })
    });
    const nextCursor = rows.length > take ? rows[take - 1].id : null;
    return { rows: rows.slice(0, take), nextCursor };
  }
  ```
- [ ] **Step 31.2**: `manager-messages-inbox.tsx` — presentational. Принимает `{ rows: InboxItem[]; nextCursor: string | null }`. Render: список с avatar role (org=blue, manager=orange), order link, excerpt, timestamp. Group by orderNumber для читаемости.
- [ ] **Step 31.3**: `/manager/messages/page.tsx`:
  ```tsx
  import { requireManager } from '@/lib/auth/requireRole';
  import { prisma } from '@/lib/db/prisma';
  import { listIncomingComments } from '@/lib/services/manager/messages';
  import { ManagerMessagesInbox } from '@/components/manager/manager-messages-inbox';

  type SearchParams = { cursor?: string };

  export default async function ManagerMessagesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const session = await requireManager();
    const sp = await searchParams;
    const { rows, nextCursor } = await listIncomingComments(prisma, { session, withOutgoing: true, ...sp });
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">Сообщения</h1>
        <ManagerMessagesInbox rows={rows} nextCursor={nextCursor} />
      </>
    );
  }
  ```
- [ ] **Step 31.4**: Тесты сервиса:
  - withOutgoing=false: только comments от org-роли users.
  - withOutgoing=true: org + manager comments.
  - since filter: отфильтровывает старше.
  - RBAC: comments из orders вне scope не попадают.
- [ ] **Step 31.5**: `npm test src/__tests__/services.manager.messages.test.ts` — passes.
- [ ] **Step 31.6 — Commit**: `feat(manager): messages inbox service, component, and page`

### Task 32: Финал Phase 8.4

- [ ] **Step 32.1**: typecheck/lint/test/build.
- [ ] **Step 32.2 — Commit (fix-up)**: `chore(phase8.4): final polish`.

---

## Phase 8.5 — Admin assign UI

### Task 33: `services/manager/team.ts`

**Files:**
- Create: `src/lib/services/manager/team.ts`
- Test: `src/__tests__/services.manager.team.test.ts`

- [ ] **Step 33.1**: Реализовать `listManagersForOrg(prisma, orgId)`:
  ```ts
  export async function listManagersForOrg(prisma, orgId: string) {
    const rows = await prisma.organizationManager.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id, name, email, isActive } } },
      orderBy: [{ isActive: 'desc' }, { assignedAt: 'desc' }]
    });
    return {
      active: rows.filter(r => r.isActive),
      inactive: rows.filter(r => !r.isActive)
    };
  }
  ```
- [ ] **Step 33.2**: Тесты:
  - empty → { active: [], inactive: [] }.
  - mixed → правильно разбиты по isActive.
- [ ] **Step 33.3**: `npm test src/__tests__/services.manager.team.test.ts` — passes.
- [ ] **Step 33.4 — Commit**: `feat(manager): team service listManagersForOrg`

### Task 34: `services/manager/invite.ts`

**Files:**
- Create: `src/lib/services/manager/invite.ts`
- Test: `src/__tests__/services.manager.invite.test.ts`

- [ ] **Step 34.1**: Реализовать с full mode-discriminated логикой per spec §6.10:
  ```ts
  import { createPasswordResetToken } from '@/lib/auth/passwordReset'; // путь подкорректировать
  import { recordAudit } from '@/lib/audit';

  export class ManagerInviteError extends Error {
    constructor(public code: 'already_assigned' | 'role_conflict' | 'user_not_found' | 'org_not_found', message?: string) {
      super(message ?? code);
    }
  }

  type Args = { email: string; name?: string; organizationId: string; mode: 'existing' | 'new' };

  export async function createAndAssignManager(prisma, args: Args, actorUserId: string) {
    const org = await prisma.organization.findUnique({ where: { id: args.organizationId }, select: { id: true } });
    if (!org) throw new ManagerInviteError('org_not_found');
    let user = await prisma.user.findUnique({ where: { email: args.email } });

    if (args.mode === 'existing') {
      if (!user) throw new ManagerInviteError('user_not_found');
      if (user.role !== 'manager') throw new ManagerInviteError('role_conflict');
    } else {
      if (user && user.role !== 'manager') throw new ManagerInviteError('role_conflict');
      if (!user) {
        user = await prisma.user.create({
          data: { email: args.email, name: args.name ?? null, role: 'manager', isActive: true, passwordHash: null }
        });
      }
    }

    const existing = await prisma.organizationManager.findUnique({ where: { organizationId_userId: { organizationId: args.organizationId, userId: user.id } } });
    if (existing && existing.isActive) throw new ManagerInviteError('already_assigned');
    if (existing) {
      await prisma.organizationManager.update({
        where: { id: existing.id },
        data: { isActive: true, deactivatedAt: null, assignedBy: actorUserId, assignedAt: new Date() }
      });
    } else {
      await prisma.organizationManager.create({
        data: { organizationId: args.organizationId, userId: user.id, isActive: true, assignedBy: actorUserId }
      });
    }

    let inviteUrl: string | null = null;
    let alreadyExisted = false;
    if (user.passwordHash === null) {
      const token = await createPasswordResetToken(prisma, user.id);
      inviteUrl = `${process.env.PUBLIC_URL}/auth/reset-password?token=${token}`;
    } else {
      alreadyExisted = true;
    }

    await recordAudit(args.mode === 'new' && user.passwordHash === null ? 'manager_invited' : 'manager_assigned', {
      entity: 'organization_manager',
      entityId: user.id,
      after: { organizationId: args.organizationId, userId: user.id, mode: args.mode }
    });

    return { user: { id: user.id, email: user.email }, inviteUrl, alreadyExisted };
  }
  ```
- [ ] **Step 34.2**: Тесты:
  - mode='existing' с unknown email → user_not_found.
  - mode='existing' с user role='partner' → role_conflict.
  - mode='existing' active → already_assigned.
  - mode='existing' inactive → reactivate.
  - mode='new' new user → user created, inviteUrl returned.
  - mode='new' existing manager user — reuse flow.
  - mode='new' existing non-manager → role_conflict.
- [ ] **Step 34.3**: `npm test src/__tests__/services.manager.invite.test.ts` — passes.
- [ ] **Step 34.4 — Commit**: `feat(manager): invite service with mode-discriminated assign-or-invite logic`

### Task 35: Server actions + manager invite email template

**Files:**
- Create: `src/server-actions/admin/manager.ts`
- Create: `src/lib/email/templates/manager/invite.tsx`
- Test: `src/__tests__/server-actions.admin.manager.test.ts`

- [ ] **Step 35.1**: `manager/invite.tsx`:
  ```tsx
  import { Container, Heading, Text, Button } from '@react-email/components';
  export function ManagerInvite({ inviteUrl, orgName }: { inviteUrl: string; orgName: string }) {
    return (
      <Container>
        <Heading>Вы приглашены в кабинет менеджера Промтехносферы</Heading>
        <Text>Вам назначена организация: {orgName}.</Text>
        <Button href={inviteUrl} style={{ backgroundColor: '#F97316', color: '#fff', padding: '10px 20px', borderRadius: 6 }}>Установить пароль</Button>
      </Container>
    );
  }
  ```
- [ ] **Step 35.2**: `src/server-actions/admin/manager.ts`:
  ```ts
  'use server';
  import { z } from 'zod';
  import { revalidatePath } from 'next/cache';
  import { prisma } from '@/lib/db/prisma';
  import { requireAdmin } from '@/lib/auth/requireRole';
  import { createAndAssignManager, ManagerInviteError } from '@/lib/services/manager/invite';
  import { ManagerInvite } from '@/lib/email/templates/manager/invite';
  import { send } from '@/lib/email/transport';
  import { recordAudit } from '@/lib/audit';

  const AssignSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('existing'), organizationId: z.string(), email: z.string().email() }),
    z.object({ mode: z.literal('new'), organizationId: z.string(), email: z.string().email(), name: z.string().optional() })
  ]);

  export async function assignOrInviteManagerAction(formData: FormData) {
    const session = await requireAdmin();
    const parsed = AssignSchema.parse(Object.fromEntries(formData));
    try {
      const result = await createAndAssignManager(prisma, parsed, session.userId);
      if (result.inviteUrl && process.env.RESEND_API_KEY) {
        const org = await prisma.organization.findUnique({ where: { id: parsed.organizationId }, select: { name } });
        await send({ to: result.user.email, subject: 'Вы приглашены в кабинет менеджера Промтехносферы', react: <ManagerInvite inviteUrl={result.inviteUrl} orgName={org?.name ?? '—'} /> });
      }
      revalidatePath(`/admin/organizations/${parsed.organizationId}`);
      return { ok: true, inviteUrl: result.inviteUrl, alreadyExisted: result.alreadyExisted };
    } catch (e: any) {
      if (e instanceof ManagerInviteError) return { ok: false, error: e.code };
      throw e;
    }
  }

  const DeactivateSchema = z.object({ assignmentId: z.string() });

  export async function deactivateManagerAssignmentAction(formData: FormData) {
    const session = await requireAdmin();
    const { assignmentId } = DeactivateSchema.parse(Object.fromEntries(formData));
    const row = await prisma.organizationManager.findUnique({ where: { id: assignmentId }, select: { organizationId: true } });
    if (!row) return { ok: false, error: 'not_found' };
    await prisma.organizationManager.update({ where: { id: assignmentId }, data: { isActive: false, deactivatedAt: new Date() } });
    await recordAudit('manager_deactivated', { entity: 'organization_manager', entityId: assignmentId, before: { isActive: true }, after: { isActive: false } });
    revalidatePath(`/admin/organizations/${row.organizationId}`);
    return { ok: true };
  }

  export async function reactivateManagerAssignmentAction(formData: FormData) {
    const session = await requireAdmin();
    const { assignmentId } = DeactivateSchema.parse(Object.fromEntries(formData));
    const row = await prisma.organizationManager.findUnique({ where: { id: assignmentId }, select: { organizationId: true } });
    if (!row) return { ok: false, error: 'not_found' };
    await prisma.organizationManager.update({ where: { id: assignmentId }, data: { isActive: true, deactivatedAt: null } });
    await recordAudit('manager_reactivated', { entity: 'organization_manager', entityId: assignmentId, before: { isActive: false }, after: { isActive: true } });
    revalidatePath(`/admin/organizations/${row.organizationId}`);
    return { ok: true };
  }

  const AssignOrderSchema = z.object({
    orderId: z.string(),
    managerUserId: z.string().nullable()
  });

  export async function assignOrderManagerAction(formData: FormData) {
    const session = await requireAdmin();
    const { orderId, managerUserId } = AssignOrderSchema.parse(Object.fromEntries(formData));
    if (managerUserId !== null) {
      const u = await prisma.user.findUnique({ where: { id: managerUserId }, select: { role: true, isActive: true } });
      if (!u || u.role !== 'manager' || !u.isActive) return { ok: false, error: 'invalid_manager' };
    }
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { managerId: true } });
    if (!order) return { ok: false, error: 'order_not_found' };
    if (order.managerId === managerUserId) return { ok: true }; // no-op
    await prisma.order.update({ where: { id: orderId }, data: { managerId: managerUserId } });
    await recordAudit('order_manager_changed', { entity: 'order', entityId: orderId, before: { managerId: order.managerId }, after: { managerId: managerUserId } });
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  }
  ```
- [ ] **Step 35.3**: Тесты с mock prisma + mock send:
  - RBAC: non-admin throws.
  - assignOrInvite mode='new' happy → success + inviteUrl.
  - assignOrInvite mode='new' role_conflict.
  - deactivate happy + not_found.
  - reactivate happy.
  - assignOrderManager happy → managerId set; null → unset; bad user → invalid_manager.
- [ ] **Step 35.4**: `npm test src/__tests__/server-actions.admin.manager.test.ts` — passes.
- [ ] **Step 35.5 — Commit**: `feat(admin): server actions for manager assign/invite/deactivate/reactivate and per-order assignment`

### Task 36: Блок «Менеджеры организации» на `/admin/organizations/[id]`

**Files:**
- Create: `src/components/admin/managers-block.tsx`
- Create: `src/components/admin/assign-or-invite-manager-form.tsx`
- Modify: `src/app/admin/organizations/[id]/page.tsx` (добавить блок)

- [ ] **Step 36.1**: `managers-block.tsx` — server component. Принимает `orgId: string`. Внутри:
  ```tsx
  import { listManagersForOrg } from '@/lib/services/manager/team';
  import { prisma } from '@/lib/db/prisma';
  import { AssignOrInviteManagerForm } from './assign-or-invite-manager-form';
  import { deactivateManagerAssignmentAction, reactivateManagerAssignmentAction } from '@/server-actions/admin/manager';

  export async function ManagersBlock({ orgId }: { orgId: string }) {
    const { active, inactive } = await listManagersForOrg(prisma, orgId);
    return (
      <section className="mt-6">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-semibold">Менеджеры организации</h2>
          <AssignOrInviteManagerForm orgId={orgId} />
        </div>
        <table className="w-full">
          <tbody>
            {active.map(a => (
              <tr key={a.id}>
                <td>{a.user.name ?? '—'}</td>
                <td>{a.user.email}</td>
                <td>active</td>
                <td>
                  <form action={deactivateManagerAssignmentAction}>
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <button type="submit" className="text-sm text-red-600">Деактивировать</button>
                  </form>
                </td>
              </tr>
            ))}
            {inactive.map(a => (
              <tr key={a.id} className="opacity-50">
                <td>{a.user.name ?? '—'}</td>
                <td>{a.user.email}</td>
                <td>inactive</td>
                <td>
                  <form action={reactivateManagerAssignmentAction}>
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <button type="submit" className="text-sm text-orange-600">Возобновить</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {active.length === 0 && inactive.length === 0 && <p className="text-gray-500">Менеджеров пока нет.</p>}
      </section>
    );
  }
  ```
- [ ] **Step 36.2**: `assign-or-invite-manager-form.tsx` — client component (modal). Two tabs: «Существующий» / «Пригласить нового». На submit вызывает `assignOrInviteManagerAction`. На success с inviteUrl → показать copy button.
- [ ] **Step 36.3**: В `/admin/organizations/[id]/page.tsx` импортировать и отрендерить `<ManagersBlock orgId={params.id} />` между existing блоком «Доступ заказчика» и footer.
- [ ] **Step 36.4**: Manual smoke (опционально): открыть страницу как admin → modal → invite new manager → email/inviteUrl получены.
- [ ] **Step 36.5**: `npm run typecheck` — 0 errors.
- [ ] **Step 36.6 — Commit**: `feat(admin): managers block on /admin/organizations/[id] with combined invite-or-pick modal`

### Task 37: `assignOrderManagerForm` на `/admin/orders/[id]`

**Files:**
- Create: `src/components/admin/assign-order-manager-form.tsx`
- Modify: `src/app/admin/orders/[id]/page.tsx` (добавить форму)

- [ ] **Step 37.1**: `assign-order-manager-form.tsx` — client component с searchable select из пула `role='manager' AND isActive=true` (server fetch при mount). Submit вызывает `assignOrderManagerAction`. Опция «Снять менеджера» → managerUserId=null.
- [ ] **Step 37.2**: В `/admin/orders/[id]/page.tsx` добавить рендер `<AssignOrderManagerForm orderId={order.id} currentManagerId={order.managerId} />`.
- [ ] **Step 37.3**: `npm run typecheck` — 0 errors.
- [ ] **Step 37.4 — Commit**: `feat(admin): per-order manager assignment UI on /admin/orders/[id]`

### Task 38: Финал Phase 8.5

- [ ] **Step 38.1**: typecheck/lint/test/build.
- [ ] **Step 38.2 — Commit (fix-up)**: `chore(phase8.5): final polish`.

---

## Phase 8.6 — Polish: feature flag, middleware, seed, Playwright, smoke

### Task 39: Feature flag `MANAGER_CABINET` + middleware gate + env

**Files:**
- Modify: `src/lib/featureFlags.ts` (добавить `'manager_cabinet'` в union)
- Modify: `src/middleware.ts` (добавить prefix gate)
- Modify: `.env.example` (добавить `FEATURE_MANAGER_CABINET=0`)
- Test: `src/__tests__/featureFlags.manager.test.ts`

- [ ] **Step 39.1**: В `featureFlags.ts` расширить union: добавить `'manager_cabinet'`. Mapping: `'manager_cabinet' → process.env.FEATURE_MANAGER_CABINET === '1'`.
- [ ] **Step 39.2**: В `middleware.ts` добавить prefix `/manager` с feature flag check (404 redirect или straight 404 если выключен).
- [ ] **Step 39.3**: В `.env.example` добавить `FEATURE_MANAGER_CABINET=0`.
- [ ] **Step 39.4**: В `src/lib/navigation/cabinet.ts` обновить `navByRole.manager` чтобы соответствовать 7-пунктовому sidebar (см. Task 7.2) И добавить `flag: 'manager_cabinet'` к каждому пункту:
  ```ts
  manager: [
    { href: '/manager/dashboard',     label: 'Главная',      flag: 'manager_cabinet' },
    { href: '/manager/orders',        label: 'Заказы',       flag: 'manager_cabinet' },
    { href: '/manager/organizations', label: 'Организации',  flag: 'manager_cabinet' },
    { href: '/manager/documents',     label: 'Документы',    flag: 'manager_cabinet' },
    { href: '/manager/students',      label: 'Сотрудники',   flag: 'manager_cabinet' },
    { href: '/manager/messages',      label: 'Сообщения',    flag: 'manager_cabinet' },
  ],
  ```
  При выключенном флаге `cabinetNavFor('manager')` возвращает пустой массив — это значит redirect/forbidden поведение управляется middleware (Step 39.2), а UI просто не показывает пункты.
- [ ] **Step 39.5**: Тест: при `FEATURE_MANAGER_CABINET=0` → `/manager/dashboard` returns 404 (или redirect — match the existing org pattern). Также проверить `cabinetNavFor('manager')` возвращает [] при flag=0 и 6 items при flag=1.
- [ ] **Step 39.6**: `npm test src/__tests__/featureFlags.manager.test.ts` — passes.
- [ ] **Step 39.7 — Commit**: `feat(flags): MANAGER_CABINET feature flag gating /manager/* and navByRole.manager update`

### Task 40: Playwright snapshots + seed manager fixture

**Files:**
- Modify: `prisma/seed.ts` (добавить manager@demo.local fixture + OrganizationManager assignment)
- Modify: `src/e2e/auth.setup.ts` (добавить storageState для manager-user)
- Create: `src/e2e/snapshots/manager-dashboard.spec.ts`
- Create: `src/e2e/snapshots/manager-orders.spec.ts`
- Create: `src/e2e/snapshots/manager-documents.spec.ts`

- [ ] **Step 40.1**: В `seed.ts` добавить:
  ```ts
  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@demo.local' },
    update: { isActive: true },
    create: { email: 'manager@demo.local', name: 'Demo Manager', role: 'manager', isActive: true, passwordHash: await hashPassword('password123') }
  });
  if (firstOrg) {
    await prisma.organizationManager.upsert({
      where: { organizationId_userId: { organizationId: firstOrg.id, userId: managerUser.id } },
      update: { isActive: true },
      create: { organizationId: firstOrg.id, userId: managerUser.id, isActive: true, assignedBy: null }
    });
  }
  console.log('  - manager@demo.local (manager, assigned to firstOrg)');
  ```
- [ ] **Step 40.2**: Расширить `auth.setup.ts`: login сценарий для manager@demo.local, save storageState `playwright/.auth/manager.json`.
- [ ] **Step 40.3**: `manager-dashboard.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  test.use({ storageState: 'playwright/.auth/manager.json' });
  test('manager dashboard desktop', async ({ page }) => {
    await page.goto('/manager/dashboard');
    await expect(page).toHaveScreenshot('manager-dashboard-desktop.png', { fullPage: true });
  });
  test('manager dashboard mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/manager/dashboard');
    await expect(page).toHaveScreenshot('manager-dashboard-mobile.png', { fullPage: true });
  });
  ```
- [ ] **Step 40.4**: `manager-orders.spec.ts` и `manager-documents.spec.ts` — аналогично.
- [ ] **Step 40.5**: `FEATURE_MANAGER_CABINET=1 npm run e2e:visual -- --update-snapshots` — первый прогон создаёт baselines. Commit baselines.
- [ ] **Step 40.6 — Commit**: `test(e2e): visual regression for manager dashboard, orders, documents + seed manager fixture`

### Task 41: Manual smoke walkthrough + final commit

- [ ] **Step 41.1**: `npm run typecheck` → 0 errors.
- [ ] **Step 41.2**: `npm run lint` → 0 new warnings.
- [ ] **Step 41.3**: `npm test` → все existing + ~80 новых passing.
- [ ] **Step 41.4**: `npm run build` → successful, все 10 новых роутов в выводе.
- [ ] **Step 41.5**: Manual smoke walkthrough по spec §10.1 (12 шагов): admin invite manager → reset → login → dashboard → orders list → per-order assignment активирует видимость → org user коммент → manager email/bell → manager отвечает → email обратно → manager меняет статус → org email + other manager email → manager загружает PDF → org email document_published → RBAC 404 sanity → comments-history persistence → deactivation сжимает scope.
- [ ] **Step 41.6 — Final commit (если есть fix-up)**: `chore(phase8): final smoke walkthrough fixes`. Если нет — пропустить.

---

## Что НЕ делаем в Phase 8 (отложено)

- Документы — подпись через Контур.Диадок (Phase 9 вместе с org-side upload).
- Notification preferences UI (mute/digest) — Phase 9+.
- Bulk operations (archive, mass-status-change) — будущая полировка.
- Saved views для manager — Phase 9+.
- CSV/XLSX экспорт списков — Phase 9+.
- Manager-side dashboard analytics (workload trends, response time).
- Student cabinet (отдельная фаза).
- Manager-to-manager direct messages (вне comments тредов).
- Live updates (WebSocket).
- Partner-admin assigning managers — оставлено admin-only.

## Сознательные упрощения Phase 8

1. **Документы read+upload, без подписи.** Подпись — Phase 9.
2. **Manager без preferences** — всем-всё (email+bell).
3. **Membership snapshot в JWT** — реактивация/деактивация видна после relogin.
4. **`canSeeOrder` two-mode API** (с/без comments-history).
5. **Refactor `policy.ts` manager-веток сразу без feature flag** — фикс существующей баги.
6. **Server actions с `revalidatePath`**, без `revalidateTag`.
7. **Нет partner-side manager invite** — admin-only.
8. **`Comment.authorRole` НЕ денормализуем** — derive через `comment.author.role` JOIN. Денормализация — отдельная миграция позже если performance потребует.

---

**После завершения Phase 8.6:** PR на main, заголовок `feat(phase8): Manager cabinet — RBAC, dashboard, orders/docs/orgs/students/messages, write paths, notifications, admin assign`. После merge → Stage 1 rollout (flag=0). Дальше — staging smoke (§10.1) → пилотная rollout → full.
