# Organization Cabinet (Phase 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Достроить кабинет для клиентов-организаций: read-first dashboard / заказы / документы / студенты / команда; двусторонние комментарии с менеджером; email-нотификации; invite flow от partner-admin и platform-admin.

**Architecture:** Зеркало партнёрского кабинета — `OrgAppShell` + sidebar, reuse `KpiGrid`/`EventsFeed`/`AttentionList`/`DocumentsList`/`CommentsThread` через вынос в `components/shared/` с `viewer` prop. Сервис-слой `lib/services/organization/*` с integration-тестами на live Postgres. Новое поле `Order.organizationId` (nullable → backfill → NOT NULL) обеспечивает per-юрлицо изоляцию. Server Actions для team management, существующий `/api/comments` расширяется для org-viewer, signed-URL download через `/api/organization/documents/[id]/download`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind, Prisma (PostgreSQL), Vitest, Playwright, Resend (email), Server Actions, BullMQ, JWT cookie auth.

**Spec reference:** [docs/superpowers/specs/2026-05-25-organization-cabinet-design.md](docs/superpowers/specs/2026-05-25-organization-cabinet-design.md)

**Branch:** `claude/organization-cabinet-phase7` (создать от main после merge phase6 → main; если ещё не вмержена — от текущей `claude/partner-cabinet-phase3`).

---

## Архитектура (карта изменений)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase 7.0 — Foundation                                                   │
│   prisma migrations:                                                     │
│     - 20260525100000_order_organization_id                               │
│   schema: Order.organizationId String? + index + back-relation           │
│   sync-orders processor: write Order.organizationId                      │
│   scripts/backfill-order-organization-id.ts                              │
│   src/lib/auth/requireRole.ts             (+requireOrganization*)        │
│   src/lib/auth/organizationPolicy.ts      (NEW)                          │
│   src/lib/auth/session.ts                 (+organizationMemberships)     │
│   src/lib/auth/login.ts                   (load memberships at login)    │
│   src/lib/auth/orgContext.ts              (resolveActiveOrgId helper)    │
│                                                                          │
│ Phase 7.1 — Shell + Dashboard                                            │
│   src/components/shared/kpi-grid.tsx          (вынос из partner)         │
│   src/components/shared/events-feed.tsx       (вынос из partner)         │
│   src/components/shared/attention-list.tsx    (вынос из partner)         │
│   src/components/organization/org-app-shell.tsx                          │
│   src/components/organization/org-sidebar.tsx                            │
│   src/lib/services/organization/dashboard.ts                             │
│   src/app/organization/layout.tsx                                        │
│   src/app/organization/dashboard/page.tsx                                │
│                                                                          │
│ Phase 7.2 — Orders                                                       │
│   src/lib/services/organization/orders.ts                                │
│   src/components/shared/two-dim-status-filter.tsx (вынос из partner)     │
│   src/components/shared/order-timeline.tsx        (вынос из partner)     │
│   src/app/organization/orders/page.tsx                                   │
│   src/app/organization/orders/[id]/page.tsx                              │
│                                                                          │
│ Phase 7.3 — Documents + Students                                         │
│   src/lib/services/organization/documents.ts                             │
│   src/lib/services/organization/students.ts                              │
│   src/components/shared/documents-list.tsx        (вынос из partner)     │
│   src/app/organization/documents/page.tsx                                │
│   src/app/organization/students/page.tsx                                 │
│   src/app/api/organization/documents/[id]/download/route.ts              │
│                                                                          │
│ Phase 7.4 — Comments write + Email                                       │
│   src/components/shared/comments-thread.tsx       (вынос из partner)     │
│   src/app/api/comments/route.ts                   (extend for org)       │
│   src/lib/email/templates/organization/org-invite.tsx                    │
│   src/lib/email/templates/organization/document-published.tsx            │
│   src/lib/email/templates/organization/payment-received.tsx              │
│   src/lib/email/templates/organization/order-status-changed.tsx          │
│   src/lib/notifications.ts                        (+notifyOrgUsers)      │
│   src/worker/processors/sync-payments.ts          (+hook)                │
│   src/worker/processors/sync-documents.ts         (+hook)                │
│   src/worker/processors/sync-orders.ts            (+status diff hook)    │
│                                                                          │
│ Phase 7.5 — Team + Invite flows                                          │
│   src/lib/services/organization/team.ts                                  │
│   src/lib/services/organization/invite.ts                                │
│   src/server-actions/organization/team.ts                                │
│   src/server-actions/admin/inviteOrgAdmin.ts                             │
│   src/server-actions/partner/inviteOrgAdmin.ts                           │
│   src/components/organization/team-table.tsx                             │
│   src/components/organization/invite-org-user-form.tsx                   │
│   src/app/organization/team/page.tsx                                     │
│   src/app/partner/portfolio/[orgId]/page.tsx      (+access block)        │
│   src/app/admin/organizations/[id]/page.tsx       (+access block)        │
│                                                                          │
│ Phase 7.6 — Polish                                                       │
│   prisma migrations:                                                     │
│     - 20260605100000_order_organization_id_required                      │
│   src/lib/featureFlags.ts        (+'organization_cabinet')               │
│   src/middleware.ts              (+/organization/* gate)                 │
│   src/lib/navigation/cabinet.ts  (+org sidebar items)                    │
│   src/e2e/snapshots/organization-dashboard.spec.ts                       │
│   src/e2e/snapshots/organization-orders.spec.ts                          │
│   src/e2e/snapshots/organization-documents.spec.ts                       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Принципы:**

1. **Каждая task — один git commit.** При падении тестов внутри task — fix-up, не amend.
2. **TDD-light:** для сервисов — integration-тесты с live Postgres (как в `services.partner.*`), для server actions — unit с mock prisma. Тесты пишем в той же task, что и реализацию.
3. **Reuse через viewer-prop:** массовое перемещение компонентов в `components/shared/` делаем **отдельным коммитом** в начале каждой фазы — это безопасно (типы guard'ят), и упрощает diff.
4. **Server Actions over API routes** для всех мутаций organization-стороны.
5. **`Order.organizationId` двухступенчато**: nullable в Phase 7.0, NOT NULL в Phase 7.6 (только если backfill 100%).
6. **`canSeeOrder`/`canSeeDocument` после fetch** — обязательно в каждой page, даже когда сервис фильтрует по scope. Защита от direct-URL атак.
7. **Hide infected** в documents автоматически (фильтр `scanStatus != 'infected'` в сервисе).

---

## Метрики приёмки (после Phase 7.6)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 новых warnings.
- `npm run build` — successful. Новые роуты: `/organization/dashboard`, `/organization/orders`, `/organization/orders/[id]`, `/organization/documents`, `/organization/students`, `/organization/team`, `/api/organization/documents/[id]/download`.
- `npm test` — все existing + ~90 новых passing (~470-490 total).
- `npx prisma migrate status` — all applied.
- `scripts/backfill-order-organization-id.ts` — 0 critical warns.
- Manual smoke walkthrough (см. spec §8.1).
- Playwright: новые snapshots baseline без diff.

## Зависимости (новые)

- **Без новых npm-пакетов.** Используем уже установленные `bcryptjs`, `zod`, `resend`, `@react-email/components`, `@prisma/client`, `bullmq`.
- Новые env: `FEATURE_ORGANIZATION_CABINET` (default `0`).

## Открытые вопросы (не блочат план — defaults из spec §11)

- [ ] Email-копирайт шаблонов — финальная редактура.
- [ ] UX-уточнения по dashboard для пустых organization.

---

## Bite-sized tasks (для агентов-исполнителей)

## Phase 7.0 — Foundation: миграции, sync hook, auth guards

### Task 1: Schema + миграция `Order.organizationId` nullable

**Files:**
- Create: `prisma/migrations/20260525100000_order_organization_id/migration.sql`
- Modify: `prisma/schema.prisma` (Order: добавить `organizationId String?` + relation + 2 индекса; Organization: back-relation `orders Order[] @relation("OrderOrganization")`)

- [ ] **Step 1.1**: В `prisma/schema.prisma` модель `Order` — добавить после `partnerId`:
  ```prisma
  organizationId String?
  organization   Organization? @relation("OrderOrganization", fields: [organizationId], references: [id])
  ```
  и индексы в конец модели:
  ```prisma
  @@index([organizationId, executionStatus])
  @@index([organizationId, financialStatus])
  ```
- [ ] **Step 1.2**: В модели `Organization` добавить back-relation после строки `students Student[]`:
  ```prisma
  orders Order[] @relation("OrderOrganization")
  ```
- [ ] **Step 1.3**: `npx prisma migrate dev --name order_organization_id --create-only`. Проверить SQL: добавление NULL колонки, 2 индекса, FK с `ON DELETE SET NULL`.
- [ ] **Step 1.4**: Применить миграцию: `npx prisma migrate dev`.
- [ ] **Step 1.5**: `npx prisma generate` — обновить Prisma Client.
- [ ] **Step 1.6**: `npm run typecheck` — 0 errors.
- [ ] **Step 1.7 — Commit**: `feat(schema): add Order.organizationId nullable + indices`

### Task 2: Update `sync-orders` processor — пишет `organizationId`

**Files:**
- Modify: `src/worker/processors/sync-orders.ts` (в create: `organizationId: org.id`; в update: только если existing.organizationId === null)
- Modify: `src/__tests__/worker.sync-orders.test.ts` (или создать если не существует) — тест что Order создаётся с `organizationId`, и не перетирается при update

- [ ] **Step 2.1**: В `sync-orders.ts` в `data` для `db.order.create` добавить `organizationId: org.id`.
- [ ] **Step 2.2**: Для update — текущая логика не трогает `organizationId` (поле не в `ownedBy1C`), это корректно. Добавить отдельный backfill кейс: если `existing.organizationId === null` — `update({ data: { ...ownedBy1C, organizationId: org.id } })`. Для этого после `findUnique` запросить `organizationId` в `select`.
- [ ] **Step 2.3**: В тестах:
  - test 1: новый order создаётся с `organizationId === org.id`.
  - test 2: existing order с `organizationId === null` (legacy) — после sync `organizationId` заполняется.
  - test 3: existing order с уже заданным `organizationId` — после sync не перетирается, даже если orgExt → другая Organization (в реальности не должно быть, но защищаемся).
- [ ] **Step 2.4**: `npm test src/__tests__/worker.sync-orders.test.ts` — passes.
- [ ] **Step 2.5 — Commit**: `feat(sync): sync-orders writes Order.organizationId on create and backfills legacy nulls`

### Task 3: Backfill-скрипт `scripts/backfill-order-organization-id.ts`

**Files:**
- Create: `scripts/backfill-order-organization-id.ts`
- Test: `src/__tests__/scripts.backfill-order-org.test.ts`

**Структура:**
```ts
import { prisma } from '@/lib/db/prisma'
import { getOneCAdapter } from '@/lib/services/oneCSync'
import { writeSyncLog } from '@/lib/services/oneCSync/log'

export async function backfillOrderOrganizationId(): Promise<{ matched_via_1c: number; matched_via_company: number; left_null: number }> {
  // Strategy A: через externalId
  //   1. select orders with organizationId IS NULL AND externalId IS NOT NULL
  //   2. await adapter.pullOrders({})
  //   3. для каждого matched DTO: lookup Organization by externalId → update Order
  // Strategy B: через Company heuristic (orders без externalId)
  //   group by companyId, если у Company ровно 1 Organization → update
  // sync log запись
}

if (require.main === module) {
  backfillOrderOrganizationId().then(s => { console.log(s); process.exit(0) }).catch(e => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 3.1**: Реализовать функцию по описанию выше.
- [ ] **Step 3.2**: Идемпотентность: каждый UPDATE с `WHERE organizationId IS NULL` (или загружаем только NULL). Повторный запуск не ломает.
- [ ] **Step 3.3**: SyncLog запись: `entity='backfill_order_org'`, `direction='internal'`, `operation='update'`, `status='success'|'warn'`, `payload={...summary}`.
- [ ] **Step 3.4**: Тесты:
  - test 1: 5 orders без orgId, 1С возвращает соответствия → все backfilled, summary `{matched_via_1c: 5, matched_via_company: 0, left_null: 0}`.
  - test 2: 2 orders без externalId, Company с 1 Organization → matched_via_company.
  - test 3: 2 orders без externalId, Company с 2 Organizations → left_null = 2.
  - test 4: повторный запуск — 0 изменений, idempotent.
- [ ] **Step 3.5**: `npm test src/__tests__/scripts.backfill-order-org.test.ts` — passes.
- [ ] **Step 3.6 — Commit**: `chore(scripts): backfill Order.organizationId from 1C + Company heuristic`

### Task 4: Server-side guards `requireOrganization*`

**Files:**
- Modify: `src/lib/auth/requireRole.ts` (добавить две функции)
- Test: `src/__tests__/auth.requireRole.organization.test.ts`

**Сигнатуры:**
```ts
export async function requireOrganization(): Promise<Session>
// throws → redirect('/login')
// проверяет: role==='organization' AND session.organizationMemberships?.some(m => m.isActive)
// иначе redirect

export async function requireOrganizationAdmin(orgId?: string): Promise<Session>
// requireOrganization() сначала
// если orgId не передан — требует ANY membership с roleInOrg='admin' AND isActive
// если orgId передан — требует именно эту org с roleInOrg='admin' AND isActive
```

- [ ] **Step 4.1**: Реализовать `requireOrganization` — `requireSession()` → проверить role + memberships. Иначе redirect.
- [ ] **Step 4.2**: Реализовать `requireOrganizationAdmin` — `requireOrganization()` → проверить admin role.
- [ ] **Step 4.3**: Тесты с mock `next/navigation.redirect` и mock `getSession`:
  - user без role=organization → redirect.
  - user с role=organization, без memberships → redirect.
  - user с deactivated membership → redirect.
  - user с active membership → returns session.
  - admin guard: member user → redirect; admin user без orgId → ok; admin user с orgId совпадающим → ok; admin user с orgId чужим → redirect.
- [ ] **Step 4.4**: `npm test src/__tests__/auth.requireRole.organization.test.ts` — passes.
- [ ] **Step 4.5 — Commit**: `feat(auth): requireOrganization and requireOrganizationAdmin guards`

### Task 5: Policy helpers `organizationPolicy.ts`

**Files:**
- Create: `src/lib/auth/organizationPolicy.ts`
- Test: `src/__tests__/auth.organizationPolicy.test.ts`

**Экспорты:**
```ts
export function isOrgMember(session: Session, orgId: string): boolean
export function isOrgAdmin(session: Session, orgId: string): boolean
export function activeOrgIds(session: Session): string[]
export function organizationOrgScopeFilter(session: Session): { id: { in: string[] } }
export function organizationOrderScopeFilter(session: Session): { organizationId: { in: string[] } }
export function canSeeOrder(session: Session, order: { organizationId: string | null }): boolean
export function canSeeDocument(session: Session, doc: { order: { organizationId: string | null } }): boolean
```

- [ ] **Step 5.1**: Реализовать все 7 функций. `activeOrgIds` — `session.organizationMemberships?.filter(m => m.isActive).map(m => m.organizationId) ?? []`. Остальные строятся через неё.
- [ ] **Step 5.2**: `canSeeOrder` — если `order.organizationId === null` → false (orphan, защищаем); иначе `isOrgMember(session, order.organizationId)`.
- [ ] **Step 5.3**: `canSeeDocument` — `doc.order.organizationId === null ? false : isOrgMember(session, doc.order.organizationId)`.
- [ ] **Step 5.4**: Тесты для каждой функции, edge cases (пустые memberships, deactivated, null orgId).
- [ ] **Step 5.5**: `npm test src/__tests__/auth.organizationPolicy.test.ts` — passes.
- [ ] **Step 5.6 — Commit**: `feat(auth): organizationPolicy with scope filters and canSee helpers`

### Task 6: Session extension с `organizationMemberships`

**Files:**
- Modify: `src/lib/auth/session.ts` (расширить `SessionPayload` type)
- Modify: `src/lib/auth/login.ts` (load memberships при логине)
- Test: `src/__tests__/auth.login.organization.test.ts`

- [ ] **Step 6.1**: В `session.ts` добавить в `SessionPayload`:
  ```ts
  organizationMemberships?: Array<{
    organizationId: string
    roleInOrg: 'admin' | 'member'
    isActive: boolean
  }>
  ```
- [ ] **Step 6.2**: В `login.ts` после успешной проверки пароля и **если** `user.role === 'organization'`:
  ```ts
  const memberships = await prisma.organizationUser.findMany({
    where: { userId: user.id, isActive: true },
    select: { organizationId: true, roleInOrg: true, isActive: true }
  })
  // если memberships.length === 0 → return 403 'account_not_linked_to_organization'
  // иначе включить в JWT
  ```
- [ ] **Step 6.3**: Mapper из БД-строки в payload: `roleInOrg` (текстовое в схеме) → cast `'admin' | 'member'` (если другое значение — fallback на `'member'`, лог warn).
- [ ] **Step 6.4**: Тесты:
  - login с role=organization без OrganizationUser → 403 `account_not_linked_to_organization`.
  - login с 1 active membership → session contains 1 entry.
  - login с 2 memberships (1 admin, 1 member) → session contains both, типы корректные.
  - login с 1 deactivated membership → 403.
- [ ] **Step 6.5**: `npm test src/__tests__/auth.login.organization.test.ts` — passes.
- [ ] **Step 6.6 — Commit**: `feat(auth): load organizationMemberships into session at login`

### Task 7: `orgContext.ts` helper — resolveActiveOrgId

**Files:**
- Create: `src/lib/auth/orgContext.ts`
- Test: `src/__tests__/auth.orgContext.test.ts`

**Сигнатура:**
```ts
export function resolveActiveOrgId(
  session: Session,
  queryOrgId: string | undefined,
  cookieOrgId: string | undefined
): string
// 1. если queryOrgId передан и user member этой org → return queryOrgId
// 2. иначе если cookieOrgId передан и member → return cookieOrgId
// 3. иначе → первый active membership.organizationId
// invariant: caller ensures session has ≥1 active membership (через requireOrganization)
```

- [ ] **Step 7.1**: Реализовать `resolveActiveOrgId`.
- [ ] **Step 7.2**: Тесты:
  - query валидный → возвращается query.
  - query невалидный (не в memberships) → fallback на cookie.
  - cookie невалидный → fallback на first active.
  - оба undefined → first active.
  - memberships пуст → throw (это invariant violation, не должно происходить).
- [ ] **Step 7.3**: `npm test src/__tests__/auth.orgContext.test.ts` — passes.
- [ ] **Step 7.4 — Commit**: `feat(auth): resolveActiveOrgId helper for multi-org users`

### Task 8: Финал Phase 7.0 — lint/typecheck/build/tests

- [ ] **Step 8.1**: `npm run typecheck` — 0 errors.
- [ ] **Step 8.2**: `npm run lint` — 0 new warnings.
- [ ] **Step 8.3**: `npm test` — все existing + новые passing.
- [ ] **Step 8.4**: `npm run build` — successful. На этом этапе НЕТ новых routes (только foundation).
- [ ] **Step 8.5 — Commit (если есть fix-up)**: `chore(phase7.0): final lint/types polish`. Если ничего не правится — пропустить.

---

## Phase 7.1 — AppShell + Dashboard

### Task 9: Вынос `KpiGrid`, `EventsFeed`, `AttentionList` в `components/shared/`

**Files:**
- Move: `src/components/partner/kpi-grid.tsx` → `src/components/shared/kpi-grid.tsx`
- Move: `src/components/partner/events-feed.tsx` → `src/components/shared/events-feed.tsx`
- Move: `src/components/partner/attention-list.tsx` → `src/components/shared/attention-list.tsx`
- Modify: все импорты в `src/app/partner/dashboard/page.tsx`, `src/app/admin/dashboard/page.tsx`, других файлах где используются

**Изменения в каждом компоненте:**
- Добавить prop `viewer: 'partner' | 'organization' | 'admin'` (опциональный, default 'partner' для backward compat).
- Внутри — если есть partner-specific фичи (например ссылка «Открыть портфель»), скрывать при `viewer !== 'partner'`.

- [ ] **Step 9.1**: `git mv` файлы (либо Read + Write если git не воспринимает).
- [ ] **Step 9.2**: В каждом — добавить `viewer?: 'partner' | 'organization' | 'admin'` в props.
- [ ] **Step 9.3**: Найти все импорты `@/components/partner/kpi-grid` и т.д. (grep) → заменить на `@/components/shared/...`.
- [ ] **Step 9.4**: `npm run typecheck` — 0 errors.
- [ ] **Step 9.5**: `npm test` — existing partner-dashboard тесты должны зеленеть.
- [ ] **Step 9.6 — Commit**: `refactor(components): move KpiGrid/EventsFeed/AttentionList to shared/ with viewer prop`

### Task 10: `OrgAppShell` и `OrgSidebar`

**Files:**
- Create: `src/components/organization/org-app-shell.tsx`
- Create: `src/components/organization/org-sidebar.tsx`
- Test: `src/__tests__/components.org-sidebar.test.tsx`

- [ ] **Step 10.1**: `OrgAppShell` — server component, рендерит layout 240px sidebar + top bar + content max-w-1280, padding 24px. Принимает `children` + `session`. Top-bar: логотип «Промтехносфера», название active organization (из session+orgContext), email текущего user'а + dropdown «Выход» (form action → `/api/auth/logout`).
- [ ] **Step 10.2**: `OrgSidebar` — client component (использует `usePathname()` для active state). 5 пунктов: Главная (`/organization/dashboard`), Заказы (`/organization/orders`), Документы (`/organization/documents`), Сотрудники (`/organization/students`), Команда (`/organization/team` — admin only).
- [ ] **Step 10.3**: Условный рендер «Команда»: принимает props `viewerRole: 'admin' | 'member'` (computed в parent через `isOrgAdmin(session, activeOrgId)`).
- [ ] **Step 10.4**: Если `session.organizationMemberships.length > 1` — отдельный dropdown «Организация: ...» сверху sidebar с переключением. Параметр `?org=<id>` в href + cookie `org_ctx` setting через client onChange.
- [ ] **Step 10.5**: Стили: brand colors (`#F97316` оранжевый для active), hover states. Mobile breakpoint: sidebar превращается в drawer.
- [ ] **Step 10.6**: Тесты:
  - sidebar рендерит 5 ссылок для admin.
  - sidebar рендерит 4 ссылки (без Команды) для member.
  - org-selector скрыт при memberships.length === 1.
  - org-selector виден при length > 1 с правильными опциями.
  - active class применяется к одной ссылке.
- [ ] **Step 10.7 — Commit**: `feat(organization): OrgAppShell with role-aware sidebar and multi-org selector`

### Task 11: `services/organization/dashboard.ts`

**Files:**
- Create: `src/lib/services/organization/dashboard.ts`
- Test: `src/__tests__/services.organization.dashboard.test.ts`

**Сигнатуры:** см. spec §6.1.

- [ ] **Step 11.1**: Реализовать `kpis()` — 4 параллельных запроса через `Promise.all`:
  1. count(orders WHERE organizationId AND executionStatus IN ('pending','in_progress'))
  2. sum(totalAmount - paidAmount) WHERE organizationId AND financialStatus IN ('billed','partially_paid')
  3. count(students WHERE organizationId)
  4. count(documents WHERE order.organizationId === org AND createdAt > now-30d AND scanStatus != 'infected')
  Дельта (1) — count за предыдущие 30 дней.
- [ ] **Step 11.2**: Реализовать `attention()` — три источника:
  - orders с executionStatus=in_progress AND financialStatus=billed AND обновление >7 дней назад
  - documents type='act' AND signedAt IS NULL AND createdAt >3 дней назад
  - orders executionStatus=completed AND closedAt IS NULL
  Объединить в `AttentionItem[]`, severity 'warn'/'urgent' по правилам spec §5.2.
- [ ] **Step 11.3**: Реализовать `recentEvents()` — параллельные fetch'и documents/payments/audit(order_status)/comments (each take=20), merge + sort desc + slice(take=15 default).
- [ ] **Step 11.4**: Integration-тесты с live PG: пустая БД → KPI все 0, attention пуст, events пуст. Засеять данные → нужные значения; RBAC — другой org-id не должен попадать в выдачу.
- [ ] **Step 11.5**: `npm test src/__tests__/services.organization.dashboard.test.ts` — passes.
- [ ] **Step 11.6 — Commit**: `feat(organization): dashboard service with kpis, attention, recent events`

### Task 12: Layout `/organization/layout.tsx` + dashboard page

**Files:**
- Create: `src/app/organization/layout.tsx`
- Create: `src/app/organization/dashboard/page.tsx`

- [ ] **Step 12.1**: `layout.tsx` — server component, `requireOrganization()` → `resolveActiveOrgId(session, searchParams?.org, cookies)` → передать в `<OrgAppShell session={session} activeOrgId={activeOrgId}>{children}</OrgAppShell>`.
- [ ] **Step 12.2**: `dashboard/page.tsx` — server component, читает `session` и `activeOrgId` через context (или передаётся через layout — для App Router это означает либо параллельный fetch здесь, либо отдельный helper `getOrgContext()`). Параллельно вызвать `kpis(prisma, activeOrgId)`, `attention(prisma, activeOrgId)`, `recentEvents(prisma, activeOrgId)` через `Promise.all`.
- [ ] **Step 12.3**: Render: `<KpiGrid viewer="organization" kpis={k} />`, `<AttentionList viewer="organization" data={a} />`, `<EventsFeed viewer="organization" events={events} />`.
- [ ] **Step 12.4**: Подзаголовок: «Главная — {organizationName}».
- [ ] **Step 12.5**: Manual smoke: `/organization/dashboard` рендерится с реальными данными (потребуется тестовый user-organization через seed или временный hack — финальный smoke в Phase 7.6).
- [ ] **Step 12.6 — Commit**: `feat(organization): dashboard page with KPI, attention, events`

### Task 13: Финал Phase 7.1 — lint/typecheck/build/tests

- [ ] **Step 13.1**: `npm run typecheck` — 0 errors.
- [ ] **Step 13.2**: `npm run lint` — 0 new warnings.
- [ ] **Step 13.3**: `npm test` — passes.
- [ ] **Step 13.4**: `npm run build` — successful. Новые роуты: `/organization/dashboard` в выводе.
- [ ] **Step 13.5 — Commit (если есть fix-up)**: `chore(phase7.1): final lint/types polish`.

---

## Phase 7.2 — Orders (list + detail)

### Task 14: Вынос `TwoDimStatusFilter` и `OrderTimeline` в shared

**Files:**
- Move: `src/components/partner/two-dim-status-filter.tsx` → `src/components/shared/two-dim-status-filter.tsx`
- Move: `src/components/partner/order-timeline.tsx` → `src/components/shared/order-timeline.tsx`
- Modify: импорты в partner pages

- [ ] **Step 14.1**: Move + обновить импорты как в Task 9.
- [ ] **Step 14.2**: Добавить prop `viewer` в каждый. В `OrderTimeline` — скрывать строки с `kind === 'partner_commission_*' || 'partner_rate_changed'` если `viewer !== 'partner'`.
- [ ] **Step 14.3**: `npm run typecheck` + `npm test` — passes.
- [ ] **Step 14.4 — Commit**: `refactor(components): move TwoDimStatusFilter and OrderTimeline to shared/ with viewer prop`

### Task 15: `services/organization/orders.ts`

**Files:**
- Create: `src/lib/services/organization/orders.ts`
- Test: `src/__tests__/services.organization.orders.test.ts`

**Сигнатуры:** см. spec §6.2.

- [ ] **Step 15.1**: `listOrders(prisma, opts)` — Zod-validate opts, build `where` (organizationId required, executionStatus/financialStatus/q ILIKE по title и orderNumber), take=50 default, cursor по `id` desc.
- [ ] **Step 15.2**: `getOrder(prisma, orgId, orderId)` — `prisma.order.findUnique({ where: { id }, include: { documents: { where: { scanStatus: { not: 'infected' } } }, payments: true, _count: { select: { comments: true } } } })`. Если `result.organizationId !== orgId` → return null.
- [ ] **Step 15.3**: Маппинг в `OrderRow`/`OrderDetail` — добавить `managerName` через include manager.
- [ ] **Step 15.4**: Integration-тесты с **RBAC scenarios** (key для multi-tenant):
  - setup: 2 organizations (orgA, orgB), 2 orders в каждой, 3 users (userA ∈ orgA, userB ∈ orgB, userC ∈ orgA+orgB).
  - listOrders(orgA) → 2 orders, ни одного из orgB.
  - listOrders(orgB) → 2 orders из orgB.
  - getOrder(orgA, orderA1) → returns.
  - getOrder(orgA, orderB1) → null.
  - getOrder(orgB, orderA1) → null.
- [ ] **Step 15.5**: `npm test src/__tests__/services.organization.orders.test.ts` — passes.
- [ ] **Step 15.6 — Commit**: `feat(organization): orders service with RBAC-safe list and get`

### Task 16: Page `/organization/orders` (list)

**Files:**
- Create: `src/app/organization/orders/page.tsx`
- Create: `src/components/organization/orders-filter-form.tsx` (reuse TwoDimStatusFilter)

- [ ] **Step 16.1**: Page — server component, `requireOrganization()` → `resolveActiveOrgId(...)` → parse URL params в `ListOrdersOptions` → `listOrders(prisma, opts)`.
- [ ] **Step 16.2**: `OrdersFilterForm` — `<form method="get">` с `<TwoDimStatusFilter viewer="organization" />` (execution/financial) + text input q. Submit перезагружает страницу.
- [ ] **Step 16.3**: Render `<OrdersTable viewer="organization" rows={rows} />`. **Если OrdersTable нет в shared** — создать минимальный таблицу прямо в page или вынести из partner.
  - Decision: создаём `src/components/shared/orders-table.tsx` с viewer prop. Колонки base: №, Название, Сумма, Оплачено, Исполн., Финансы. Колонки `Партнёр`/`Комиссия` показываются только если `viewer === 'partner' || viewer === 'admin'`.
- [ ] **Step 16.4**: Pagination: «Дальше» если `nextCursor` есть, link с `?cursor=...`.
- [ ] **Step 16.5**: Manual smoke: `/organization/orders` — таблица отрабатывает.
- [ ] **Step 16.6 — Commit**: `feat(organization): orders list page with two-dim filter and pagination`

### Task 17: Page `/organization/orders/[id]` (detail)

**Files:**
- Create: `src/app/organization/orders/[id]/page.tsx`

- [ ] **Step 17.1**: Page — server, `requireOrganization` → `resolveActiveOrgId` → `getOrder(activeOrgId, params.id)`. Если `null` → `notFound()`.
- [ ] **Step 17.2**: Render секции:
  - Заголовок (номер, название, status-badges, менеджер, даты).
  - Сумма / оплачено / срок (карточка).
  - `<DocumentsList viewer="organization" docs={order.documents} />` (вынос делаем в Task 21 — пока inline или временный stub).
  - `<PaymentsList payments={order.payments} />` (новый минимальный компонент, либо вынос из partner если есть).
  - `<OrderTimeline viewer="organization" order={order} />`.
  - `<CommentsThread viewer="organization" orderId={order.id} />` — в Phase 7.4 будет полная имплементация; пока stub «загрузка комментариев…».
- [ ] **Step 17.3**: Manual smoke: открыть `/organization/orders/[validId]` — рендерится; `/organization/orders/[fakeId]` → 404; `/organization/orders/[otherOrgOrderId]` → 404.
- [ ] **Step 17.4 — Commit**: `feat(organization): order detail page with timeline, documents, payments`

### Task 18: Финал Phase 7.2

- [ ] **Step 18.1**: `npm run typecheck` — 0 errors.
- [ ] **Step 18.2**: `npm run lint` — 0 new warnings.
- [ ] **Step 18.3**: `npm test` — passes.
- [ ] **Step 18.4**: `npm run build` — successful. Новые роуты `/organization/orders`, `/organization/orders/[id]`.
- [ ] **Step 18.5 — Commit (если есть fix-up)**: `chore(phase7.2): final polish`.

---

## Phase 7.3 — Documents + Students

### Task 19: Вынос `DocumentsList` в shared

**Files:**
- Move: `src/components/partner/documents-list.tsx` → `src/components/shared/documents-list.tsx`
- Modify: импорты

- [ ] **Step 19.1**: Move + update imports.
- [ ] **Step 19.2**: Добавить `viewer` prop. Скрывать кнопку «Загрузить» если `viewer !== 'partner'`.
- [ ] **Step 19.3**: `npm run typecheck` + `npm test` — passes.
- [ ] **Step 19.4 — Commit**: `refactor(components): move DocumentsList to shared/ with viewer prop`

### Task 20: `services/organization/documents.ts`

**Files:**
- Create: `src/lib/services/organization/documents.ts`
- Test: `src/__tests__/services.organization.documents.test.ts`

**Сигнатуры:** см. spec §6.3 (включая discriminated union `DownloadResult`).

- [ ] **Step 20.1**: `listDocuments(prisma, opts)` — `prisma.document.findMany` с JOIN `order` (`where: { order: { organizationId: opts.organizationId }, scanStatus: { not: 'infected' } }`). Cursor по `id`.
- [ ] **Step 20.2**: `getDocumentForDownload(prisma, orgId, docId)` — fetch document с `order: { select: { organizationId } }`. Если `!doc` → `{ok:false, error:'not_found'}`. Если `doc.order.organizationId !== orgId` → `{ok:false, error:'not_found'}` (не палим). Если `doc.scanStatus === 'infected'` → `{ok:false, error:'infected'}`. Иначе `{ok:true, path: doc.path, mimeType, name}`.
- [ ] **Step 20.3**: Integration-тесты с **RBAC** + scan filters:
  - listDocuments(orgA) → не показывает orgB и infected.
  - getDocumentForDownload(orgA, infected) → `infected`.
  - getDocumentForDownload(orgA, otherOrg) → `not_found`.
- [ ] **Step 20.4**: `npm test` — passes.
- [ ] **Step 20.5 — Commit**: `feat(organization): documents service with hide-infected and download discriminator`

### Task 21: Page `/organization/documents` + download route

**Files:**
- Create: `src/app/organization/documents/page.tsx`
- Create: `src/app/api/organization/documents/[id]/download/route.ts`
- Test: `src/__tests__/api.organization.documents.download.test.ts`

- [ ] **Step 21.1**: Page — server, `requireOrganization` + `resolveActiveOrgId` → `listDocuments(opts)`. Фильтры в URL: type, orderId, from, to, q.
- [ ] **Step 21.2**: Render `<DocumentsList viewer="organization" rows={rows} />` + filter form. Кнопка «Скачать» → href `/api/organization/documents/[id]/download`.
- [ ] **Step 21.3**: Download route:
  ```ts
  export async function GET(req, { params }) {
    const session = await requireOrganization()
    const activeOrgId = resolveActiveOrgId(session, req.nextUrl.searchParams.get('org'), cookies().get('org_ctx')?.value)
    const result = await getDocumentForDownload(prisma, activeOrgId, params.id)
    if (!result.ok && result.error === 'not_found') return new Response(null, { status: 404 })
    if (!result.ok && result.error === 'infected') return new Response('Document quarantined', { status: 410 })
    // signed URL via supabase admin client
    const { data: signed } = await supabaseAdmin.storage.from('documents').createSignedUrl(result.path, 600)
    return Response.redirect(signed.signedUrl, 302)
  }
  ```
- [ ] **Step 21.4**: Тесты route:
  - 404 для несуществующего.
  - 404 для чужой org.
  - 410 для infected.
  - 302 для clean (mock Supabase).
- [ ] **Step 21.5**: Manual smoke: `/organization/documents` показывает таблицу; «Скачать» открывает файл.
- [ ] **Step 21.6 — Commit**: `feat(organization): documents page with signed-url download and 410 for infected`

### Task 22: `services/organization/students.ts` + page

**Files:**
- Create: `src/lib/services/organization/students.ts`
- Create: `src/app/organization/students/page.tsx`
- Test: `src/__tests__/services.organization.students.test.ts`

- [ ] **Step 22.1**: `listStudents(prisma, opts: { organizationId, q?, take?, cursor? })` — `prisma.student.findMany` с фильтром по `organizationId` + опциональный q ILIKE по name/email. Cursor по `id`.
- [ ] **Step 22.2**: Page — server, `requireOrganization` + `resolveActiveOrgId` → `listStudents`. Render таблица (ФИО, email, externalStudentId, createdAt). Empty-state «У вашей организации пока нет сотрудников на обучении» если rows.length === 0.
- [ ] **Step 22.3**: Поиск через `<form method="get">` с `name="q"`.
- [ ] **Step 22.4**: Тесты:
  - RBAC: listStudents(orgA) не включает orgB студентов.
  - Поиск по q.
- [ ] **Step 22.5**: Manual smoke.
- [ ] **Step 22.6 — Commit**: `feat(organization): students list page with search`

### Task 23: Финал Phase 7.3

- [ ] **Step 23.1**: typecheck/lint/test/build.
- [ ] **Step 23.2 — Commit (fix-up если есть)**: `chore(phase7.3): final polish`.

---

## Phase 7.4 — Comments write + Email notifications

### Task 24: Вынос `CommentsThread` в shared

**Files:**
- Move: `src/components/partner/comments-thread.tsx` → `src/components/shared/comments-thread.tsx`
- Modify: импорты в partner pages

- [ ] **Step 24.1**: Move + update imports + добавить `viewer` prop.
- [ ] **Step 24.2**: API URL POST в форме определяется по `viewer`: для partner — `/api/comments`, для organization — `/api/comments` тоже (мы расширим существующий, не делаем отдельный endpoint).
- [ ] **Step 24.3**: `npm run typecheck` + `npm test` — passes.
- [ ] **Step 24.4 — Commit**: `refactor(components): move CommentsThread to shared/ with viewer prop`

### Task 25: Extend `/api/comments` POST для org-viewer

**Files:**
- Modify: `src/app/api/comments/route.ts` (добавить branch для `session.role === 'organization'`)
- Test: `src/__tests__/api.comments.organization.test.ts`

- [ ] **Step 25.1**: В POST handler — после `getSession()` если `session.role === 'organization'`:
  - Zod validate `{ orderId, body, attachmentPath? }`.
  - `prisma.order.findUnique({ where: { id: orderId }, select: { organizationId: true } })`.
  - `canSeeOrder(session, order) || return 403`.
  - `prisma.comment.create({ data: { orderId, body, attachmentPath, authorId: session.userId } })`.
  - `recordAudit('comment_posted', { entity: 'order', entityId: orderId, after: { commentId } })`.
  - Return 201.
- [ ] **Step 25.2**: Тесты:
  - org-user пишет коммент на свой order → 201.
  - org-user пишет коммент на чужой order → 403.
  - org-user без active membership → 403 (через requireOrganization implicit).
  - existing partner-comment flow тесты должны зеленеть.
- [ ] **Step 25.3 — Commit**: `feat(api): /api/comments POST accepts organization role with order scope check`

### Task 26: Page `/organization/orders/[id]` — финализация Comments секции

**Files:**
- Modify: `src/app/organization/orders/[id]/page.tsx` — заменить stub на полный `<CommentsThread />`

- [ ] **Step 26.1**: Заменить stub на `<CommentsThread viewer="organization" orderId={order.id} initialComments={comments} />`. Подгрузить comments через `prisma.comment.findMany({ where: { orderId }, include: { author: { select: { name, email } } }, orderBy: { createdAt: 'asc' } })` в server component.
- [ ] **Step 26.2**: Форма постинга должна делать POST `/api/comments` через client component внутри CommentsThread.
- [ ] **Step 26.3**: Manual smoke: открыть свой order → написать коммент → видим в треде.
- [ ] **Step 26.4 — Commit**: `feat(organization): comments thread with write on order detail page`

### Task 27: Email шаблоны `organization/*`

**Files:**
- Create: `src/lib/email/templates/organization/org-invite.tsx`
- Create: `src/lib/email/templates/organization/document-published.tsx`
- Create: `src/lib/email/templates/organization/payment-received.tsx`
- Create: `src/lib/email/templates/organization/order-status-changed.tsx`

- [ ] **Step 27.1**: Каждый шаблон — React Email component через `@react-email/components` (Container, Heading, Text, Button, Section).
- [ ] **Step 27.2**: Содержимое:
  - **org-invite**: «Вы приглашены в кабинет организации {orgName}». Кнопка «Установить пароль» → inviteUrl.
  - **document-published**: «На заказ {orderNumber} загружен документ {docName} ({docType})». Кнопка «Открыть заказ» → `/organization/orders/[id]`.
  - **payment-received**: «Получена оплата {amount} ₽ по заказу {orderNumber}». Кнопка «Открыть заказ».
  - **order-status-changed**: «Статус заказа {orderNumber} изменён: {oldStatus} → {newStatus}». Кнопка «Открыть заказ».
- [ ] **Step 27.3**: Brand styling: orange `#F97316` на CTA. Inline styles (no CSS файлов).
- [ ] **Step 27.4**: Smoke render test для каждого шаблона (Vitest, snapshot).
- [ ] **Step 27.5 — Commit**: `feat(email): organization templates (invite, document-published, payment-received, order-status-changed)`

### Task 28: `notifyOrgUsers` helper

**Files:**
- Modify: `src/lib/notifications.ts` (добавить функцию)
- Test: `src/__tests__/notifications.notifyOrgUsers.test.ts`

**Сигнатура:** см. spec §3.5.

- [ ] **Step 28.1**: Реализовать:
  ```ts
  export async function notifyOrgUsers(prisma, args) {
    const recipients = await prisma.organizationUser.findMany({
      where: { organizationId: args.organizationId, isActive: true, user: { isActive: true } },
      select: { user: { select: { email: true, name: true, id: true } } }
    })
    for (const r of recipients) {
      // выбрать template по args.type
      const template = TEMPLATES[args.type](args.payload)
      await send({ to: r.user.email, subject: template.subject, react: template.component })
      await prisma.notification.create({ data: { userId: r.user.id, organizationId: args.organizationId, type: args.type, title: template.subject, body: template.shortBody, meta: args.payload } })
    }
  }
  ```
- [ ] **Step 28.2**: TEMPLATES map: ключ type → fn(payload) → `{subject, component, shortBody}`.
- [ ] **Step 28.3**: Тесты с mock send + mock prisma:
  - 2 active members → send вызван 2 раза + Notification created.
  - 1 active 1 deactivated → send 1 раз.
  - Нет members → no error, no calls.
  - Resend not configured (RESEND_API_KEY env пустой) → send no-op (через existing graceful degradation), но Notification всё равно создаётся.
- [ ] **Step 28.4**: `npm test` — passes.
- [ ] **Step 28.5 — Commit**: `feat(notifications): notifyOrgUsers helper for organization-side emails and in-app bell`

### Task 29: Hooks в worker processors

**Files:**
- Modify: `src/worker/processors/sync-payments.ts` (после payment.create — notifyOrgUsers с payment_received)
- Modify: `src/worker/processors/sync-documents.ts` (после document.create — notifyOrgUsers с document_published, кроме user-uploaded из той же org)
- Modify: `src/worker/processors/sync-orders.ts` (после update — diff status → notifyOrgUsers с order_status_changed)
- Test: `src/__tests__/worker.notification-hooks.test.ts`

- [ ] **Step 29.1**: В `sync-payments.ts` — после успешного create:
  ```ts
  const order = await db.order.findUnique({ where: { id: payment.orderId }, select: { organizationId: true, orderNumber: true } })
  if (order?.organizationId) {
    await notifyOrgUsers(db, { organizationId: order.organizationId, type: 'payment_received', payload: { orderId: payment.orderId, orderNumber: order.orderNumber, amount: payment.amount, paidAt: payment.paidAt } })
  }
  ```
- [ ] **Step 29.2**: В `sync-documents.ts` — после create:
  - Загрузить order.organizationId.
  - Skip если `doc.generationSource === 'user'` AND uploader ∈ той же org (для этого fetch uploader's OrganizationUser).
  - Иначе `notifyOrgUsers({ type: 'document_published', payload: { orderId, docName, docType } })`.
- [ ] **Step 29.3**: В `sync-orders.ts` — после `update` сравнить existing.executionStatus/financialStatus с newer. Если изменился — `notifyOrgUsers({ type: 'order_status_changed', payload: { orderId, orderNumber, oldStatus, newStatus, dimension: 'execution' | 'financial' } })`.
- [ ] **Step 29.4**: Тесты:
  - sync-payments создаёт payment → notifyOrgUsers вызван 1 раз.
  - sync-documents с user-uploaded same-org → notifyOrgUsers НЕ вызван.
  - sync-orders без diff → no calls.
  - sync-orders с diff executionStatus → calls с правильными аргументами.
- [ ] **Step 29.5 — Commit**: `feat(worker): organization email/notification hooks in sync processors`

### Task 30: Финал Phase 7.4

- [ ] **Step 30.1**: typecheck/lint/test/build.
- [ ] **Step 30.2 — Commit (fix-up)**: `chore(phase7.4): final polish`.

---

## Phase 7.5 — Team + Invite flows

### Task 31: `services/organization/team.ts`

**Files:**
- Create: `src/lib/services/organization/team.ts`
- Test: `src/__tests__/services.organization.team.test.ts`

**Сигнатуры:** см. spec §6.5.

- [ ] **Step 31.1**: `OrgMemberError` custom class с `code: 'already_member' | 'last_admin_protected' | 'self_action_forbidden' | 'not_found'`.
- [ ] **Step 31.2**: `listMembers(prisma, orgId)` — JOIN с User. Возвращает все (active+inactive) для admin UI.
- [ ] **Step 31.3**: `inviteMember(prisma, args, actorUserId)` — транзакция (см. spec §6.5):
  1. Найти User by email или create (passwordHash=null, name, role='organization', isActive=true).
  2. Найти existing OrganizationUser → если active → throw `already_member`; если deactivated → update {isActive:true, roleInOrg}.
  3. Иначе create OrganizationUser.
  4. Если user.passwordHash IS NULL → createInviteToken → inviteUrl. Иначе inviteUrl=null, alreadyHasPassword=true.
  5. recordAudit('org_member_invited').
  6. Return `{ user: { id, email }, inviteUrl, alreadyHasPassword }`.
- [ ] **Step 31.4**: `updateMemberRole(prisma, orgUserId, newRole, actorUserId)`:
  - Load orgUser → если actor === user → throw `self_action_forbidden`.
  - Если newRole='member' AND currentRole='admin' AND count(active admins in org) === 1 → throw `last_admin_protected`.
  - update + audit.
- [ ] **Step 31.5**: `deactivateMember` — те же проверки + isActive=false.
- [ ] **Step 31.6**: `reactivateMember` — load → set isActive=true + audit (без last-admin check, т.к. reactivate не уменьшает админов).
- [ ] **Step 31.7**: Integration-тесты на live PG для всех функций + edge cases.
- [ ] **Step 31.8 — Commit**: `feat(organization): team service with invite, role/active management and last-admin protection`

### Task 32: `services/organization/invite.ts`

**Files:**
- Create: `src/lib/services/organization/invite.ts`
- Test: `src/__tests__/services.organization.invite.test.ts`

**Сигнатура:** см. spec §6.6.

- [ ] **Step 32.1**: `createOrgAdminInvite(prisma, args, actorUserId, source)`:
  - lookup `Organization` by `args.organizationId` → если null → throw `not_found`.
  - **Если source='partner'**: проверить что actor ∈ partner-admin AND org.partnerId === actor.partnerId → иначе throw `forbidden`.
  - Вызов `inviteMember(prisma, { ...args, roleInOrg: 'admin' }, actorUserId)`.
  - В audit `meta.source = source`.
- [ ] **Step 32.2**: Тесты:
  - partner-admin приглашает в свой portfolio org → ok.
  - partner-admin пытается в чужой org → forbidden.
  - platform-admin в любую → ok.
- [ ] **Step 32.3 — Commit**: `feat(organization): invite.ts createOrgAdminInvite with source-based policy`

### Task 33: Server actions for organization team

**Files:**
- Create: `src/server-actions/organization/team.ts`
- Test: `src/__tests__/server-actions.organization.team.test.ts`

- [ ] **Step 33.1**: `inviteOrgMemberAction(formData)`:
  - `requireOrganizationAdmin(orgId из formData)`.
  - Zod parse {organizationId, email, name, roleInOrg}.
  - Try `inviteMember`. Catch `OrgMemberError` → return `{ok:false, error: e.code}`.
  - Если `inviteUrl !== null` AND RESEND настроен → send `OrgInvite` template; иначе вернуть inviteUrl в ответе для отображения.
  - `revalidatePath('/organization/team')`.
  - Return `{ok:true, inviteUrl}` или `{ok:true, alreadyHasPassword:true}`.
- [ ] **Step 33.2**: `updateOrgMemberRoleAction`, `deactivateOrgMemberAction`, `reactivateOrgMemberAction` — каждый `requireOrganizationAdmin(orgId)` → service call → catch → revalidate.
- [ ] **Step 33.3**: Тесты с mock prisma + mock email:
  - RBAC (не admin → throw).
  - Validation.
  - Happy/denied paths каждого action.
- [ ] **Step 33.4 — Commit**: `feat(organization): server actions for team (invite/role/deactivate/reactivate)`

### Task 34: Page `/organization/team`

**Files:**
- Create: `src/app/organization/team/page.tsx`
- Create: `src/components/organization/team-table.tsx`
- Create: `src/components/organization/invite-org-user-form.tsx`

- [ ] **Step 34.1**: Page — server, `requireOrganizationAdmin(activeOrgId)` → `listMembers(prisma, activeOrgId)`.
- [ ] **Step 34.2**: Render `<InviteOrgUserForm orgId={activeOrgId} />` (кнопка → modal) + `<TeamTable members={members} currentUserId={session.userId} />`.
- [ ] **Step 34.3**: `TeamTable` — таблица с колонками per spec §5.7. Каждая строка — кнопки «Сменить роль», «Деактивировать»/«Возобновить». Каждая bound на соответствующий action через `<form action={action.bind(null, orgUserId, newRole)}>`.
- [ ] **Step 34.4**: `InviteOrgUserForm` — client component, modal. Поля email/name/role select. Submit → `inviteOrgMemberAction`. На success с inviteUrl — показать copy-button. На success с alreadyHasPassword — показать «пользователь уже зарегистрирован, доступ предоставлен». На error — показать message.
- [ ] **Step 34.5**: Manual smoke: пригласить второго юзера → invite-url → залогиниться → видим dashboard.
- [ ] **Step 34.6 — Commit**: `feat(organization): team page with invite, role/active management UI`

### Task 35: Блок «Доступ заказчика» в `/partner/portfolio/[orgId]`

**Files:**
- Modify: `src/app/partner/portfolio/[orgId]/page.tsx`
- Create: `src/server-actions/partner/inviteOrgAdmin.ts`
- Test: `src/__tests__/server-actions.partner.inviteOrgAdmin.test.ts`

- [ ] **Step 35.1**: Создать action `invitePartnerOrgAdminAction(formData)`:
  - `requirePartnerAdmin()` (из существующего auth).
  - Zod parse {organizationId, email, name}.
  - `createOrgAdminInvite(prisma, args, session.userId, 'partner')`.
  - Если RESEND настроен — send OrgInvite. Иначе вернуть inviteUrl.
  - revalidatePath текущей portfolio страницы.
- [ ] **Step 35.2**: На `/partner/portfolio/[orgId]/page.tsx` после существующих секций — добавить «Доступ заказчика»:
  - `listMembers(prisma, orgId)` (read-only, partner-admin может видеть).
  - Если есть active admin'ы — таблица read-only + кнопка «Пригласить ещё».
  - Если 0 active admin'ов — кнопка «Пригласить администратора».
  - Modal с email/name (client component) → `invitePartnerOrgAdminAction`.
- [ ] **Step 35.3**: Тесты action: partner-admin приглашает в свой org → ok; partner-admin в чужой → throw; partner-manager → throw.
- [ ] **Step 35.4 — Commit**: `feat(partner): "Customer access" block on portfolio page with invite-org-admin action`

### Task 36: Блок «Доступ заказчика» в `/admin/organizations/[id]`

**Files:**
- Modify: `src/app/admin/organizations/[id]/page.tsx`
- Create: `src/server-actions/admin/inviteOrgAdmin.ts`
- Test: `src/__tests__/server-actions.admin.inviteOrgAdmin.test.ts`

- [ ] **Step 36.1**: Action `inviteOrgUserAction(formData)`:
  - `requireAdmin()`.
  - `createOrgAdminInvite(prisma, args, session.userId, 'platform_admin')` (без partner-policy guard).
  - Email или inviteUrl response.
  - revalidate.
- [ ] **Step 36.2**: Аналогичный блок на admin page (reuse идея, разные actions).
- [ ] **Step 36.3**: Тесты action: admin → ok; manager → throw.
- [ ] **Step 36.4 — Commit**: `feat(admin): "Customer access" block on organization detail with invite-org-admin action`

### Task 37: Финал Phase 7.5

- [ ] **Step 37.1**: typecheck/lint/test/build.
- [ ] **Step 37.2 — Commit (fix-up)**: `chore(phase7.5): final polish`.

---

## Phase 7.6 — Polish: NOT NULL, feature flag, Playwright, smoke

### Task 38: Миграция `Order.organizationId` → NOT NULL

**Files:**
- Create: `prisma/migrations/20260605100000_order_organization_id_required/migration.sql`
- Modify: `prisma/schema.prisma` (Order: `organizationId String`; organization: `Organization @relation`)

- [ ] **Step 38.1**: Pre-check: `SELECT count(*) FROM "Order" WHERE "organizationId" IS NULL;` через `psql` или Prisma раzraw. Если > 0 → разобраться, возможно прогнать backfill повторно. Если остались legacy без `externalId` → решить вручную (обычно — assign к manager, либо удалить если orphan).
- [ ] **Step 38.2**: Если 0 — изменить schema: `organizationId String` (без `?`), relation без `?`.
- [ ] **Step 38.3**: `npx prisma migrate dev --name order_organization_id_required --create-only`. Проверить SQL: `ALTER TABLE "Order" ALTER COLUMN "organizationId" SET NOT NULL;`.
- [ ] **Step 38.4**: Применить. `npx prisma generate`.
- [ ] **Step 38.5**: `npm run typecheck` — типы могут сломаться там, где `order.organizationId === null` проверялось (`canSeeOrder` в policy). Поправить (после миграции `organizationId` всегда string).
  - Note: оставить null-check в `canSeeOrder` как safety net на уровне runtime (если каким-то чудом NULL придёт). Cast через `as string | null` локально.
- [ ] **Step 38.6**: `npm test` — passes.
- [ ] **Step 38.7 — Commit**: `feat(schema): Order.organizationId NOT NULL after backfill`

**Note:** Если backfill не закрыл 100% — пропустить этот Task, зафиксировать в README как known limitation, сделать commit `docs: known limitation — some legacy orders without organizationId`.

### Task 39: Feature flag `ORGANIZATION_CABINET`

**Files:**
- Modify: `src/lib/featureFlags.ts` (добавить `'organization_cabinet'` в union)
- Modify: `src/middleware.ts` (добавить prefix gate)
- Modify: `.env.example` (добавить `FEATURE_ORGANIZATION_CABINET=1`)
- Test: `src/__tests__/featureFlags.organization.test.ts`

- [ ] **Step 39.1**: Расширить `FeatureFlag` union: добавить `'organization_cabinet'`.
- [ ] **Step 39.2**: Mapping в `isFeatureEnabled`: `'organization_cabinet' → process.env.FEATURE_ORGANIZATION_CABINET === '1'`.
- [ ] **Step 39.3**: В middleware добавить prefix `/organization` с flag check (404 если выключен).
- [ ] **Step 39.4**: В `.env.example` добавить `FEATURE_ORGANIZATION_CABINET=0`.
- [ ] **Step 39.5**: Тест: при `FEATURE_ORGANIZATION_CABINET=0` → `/organization/dashboard` → 404.
- [ ] **Step 39.6 — Commit**: `feat(flags): ORGANIZATION_CABINET feature flag gating /organization/*`

### Task 40: Playwright snapshots

**Files:**
- Modify: `src/e2e/auth.setup.ts` (добавить storageState для organization-user)
- Create: `src/e2e/snapshots/organization-dashboard.spec.ts`
- Create: `src/e2e/snapshots/organization-orders.spec.ts`
- Create: `src/e2e/snapshots/organization-documents.spec.ts`

- [ ] **Step 40.1**: Расширить `auth.setup.ts`: добавить login сценарий для тестового organization-user (test fixture в seed или дополнительный create). Сохранить storageState в `playwright/.auth/organization.json`.
- [ ] **Step 40.2**: Spec dashboard: login → goto `/organization/dashboard?org=<testOrgId>` → snapshot desktop + mobile.
- [ ] **Step 40.3**: Spec orders: goto `/organization/orders` → snapshot.
- [ ] **Step 40.4**: Spec documents: goto `/organization/documents` → snapshot.
- [ ] **Step 40.5**: Первый прогон создаёт baselines: `npm run e2e:visual -- --update-snapshots`. Commit baselines в репо.
- [ ] **Step 40.6 — Commit**: `test(e2e): visual regression for organization dashboard, orders, documents`

### Task 41: Manual smoke walkthrough + final commit

- [ ] **Step 41.1**: `npm run typecheck` → 0 errors.
- [ ] **Step 41.2**: `npm run lint` → 0 new warnings.
- [ ] **Step 41.3**: `npm test` → все existing + ~90 новых passing.
- [ ] **Step 41.4**: `npm run build` → successful, все 7 новых роутов в выводе.
- [ ] **Step 41.5**: Manual smoke walkthrough по spec §8.1 (12 шагов): admin invite → reset → login → dashboard → orders list → order detail → write comment → documents → download → students → team invite → RBAC sanity (404) → email через worker → partner-side invite → last admin protection.
- [ ] **Step 41.6 — Final commit (если что-то правится)**: `chore(phase7): final smoke walkthrough fixes`. Если нет — пропустить.

---

## Что НЕ делаем в Phase 7 (отложено)

- Документы — загрузка/подпись от organization (Phase 8 + Контур.Диадок).
- Notification preferences UI (mute, digest) — Phase 8.
- Comment notifications в сторону manager — Phase 9+ (вместе с manager-кабинетом).
- Bulk download — Phase 8+.
- Saved views для organization — Phase 8+.
- CSV/XLSX экспорт списков — Phase 8+.
- Live-updates через WebSocket — overkill для MVP.

## Сознательные упрощения Phase 7

1. **Документы read-only** — кнопка «Загрузить» в DocumentsList скрыта через viewer-prop.
2. **Org-selector через query-param + cookie**, не path-segment.
3. **Notifications без preferences** — всем-всё.
4. **Membership snapshot в JWT** — реактивация видна после relogin.
5. **`canSeeOrder` оставлен с null-check** даже после NOT NULL миграции — defensive runtime safety.
6. **Server actions используют `revalidatePath`**, без `revalidateTag`.

---

**После завершения**: PR на main, заголовок `feat(phase7): Organization cabinet — RBAC, dashboard, orders/docs/students, team management, email notifications`. После merge → Stage 1 rollout (flag=0). Дальше — staging валидация → пилотная organization → full.
