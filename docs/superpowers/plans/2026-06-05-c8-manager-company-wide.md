# C8: менеджерский кабинет → company-wide видимость + роль руководителя — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать любому менеджеру компании переключаемую (leader/admin-управляемую) видимость всех заказов/документов/комментариев/дашборда/организаций/студентов своей компании, и ввести под-роль `leader` (руководитель) с полномочиями «флип переключателя + управление ростером».

**Architecture:** Один runtime-флаг `Company.managerTeamVisibility` (default OFF), читаемый СВЕЖИМ на каждый запрос (не из JWT). Вся менеджерская RBAC проходит через 6 функций в `managerPolicy.ts` — делаем их mode-aware (`teamMode: boolean`), один резолвер выбирает ветку: ON → `{ companyId: session.companyId }`, OFF → сегодняшний 3-way OR. Каждый из ~8 read-сайтов читает флаг и передаёт `teamMode`. Граница изоляции переезжает «менеджер↔менеджер» → «компания↔компания». Под-роль `leader` — `User.managerRole String?`, в JWT, выдаётся только admin.

**Tech Stack:** Next.js 15 (App Router, server components + server-actions), Prisma 5 + PostgreSQL, TypeScript strict, Vitest (unit `--mode=unit` без Postgres; integration `--mode=integration` с Postgres), zod.

**Spec:** [2026-06-05-c8-manager-company-wide-design.md](../specs/2026-06-05-c8-manager-company-wide-design.md). **Трек C / C8** из [completion-roadmap](../specs/2026-06-02-completion-roadmap.md).

**Базовая ветка:** `claude/c8-manager-company-wide` (отрезана от свежего `main` c688b43, включает C5). Спека уже закоммичена (3ce1a54).

---

## Карта файлов (что создаём / меняем)

**Создаём:**
- `prisma/migrations/<ts>_c8_manager_company_wide/migration.sql` — +`Company.managerTeamVisibility`, +`User.managerRole`.
- `src/lib/services/manager/teamVisibility.ts` — сервис флипа тоггла (+audit).
- `src/lib/services/admin/managerRole.ts` — сервис выдачи/снятия роли leader (+audit).
- `src/server-actions/manager/teamVisibility.ts` — leader server-action флипа.
- `src/server-actions/manager/team.ts` — leader server-actions ростера (reuse `invite.ts` + company-check).
- `src/app/manager/team/page.tsx` — leader-хаб (server component).
- `src/components/manager/team-visibility-toggle.tsx` — клиентский тоггл.
- `src/components/manager/manager-roster-panel.tsx` — клиентский ростер.
- `src/components/admin/manager-role-control.tsx` — admin-контрол выдачи роли.
- Тесты: `src/__tests__/services.manager.teamVisibility.test.ts`, `services.admin.managerRole.test.ts`, расширения существующих.

**Меняем:**
- `prisma/schema.prisma`, `src/lib/auth/jwt.ts`, `src/app/api/auth/login/route.ts`.
- `src/lib/auth/managerPolicy.ts` (ядро), `src/lib/auth/audit.ts` (+entity `company`), `src/lib/auth/requireRole.ts` (+`requireManagerLeader`, mode-aware org/order guards).
- Read-сайты: `services/manager/{orders,documents,messages,organizations,students,uploads,status}.ts`, `services/manager/dashboard/{kpis,attention,events}.ts`, `lib/auth/policy.ts`, `app/api/comments/route.ts`.
- `src/server-actions/admin/manager.ts` (+role-grant action), `src/lib/navigation/cabinet.ts` (+пункт «Команда» для leader).
- Тесты: `auth.managerPolicy.test.ts`, `auth.policy.manager-refactor.test.ts`.

**НЕ меняем намеренно** (decoupling «видимость ≠ таргетинг», спека решение 7):
- `src/lib/notifications/manager.ts` (fan-out — кого уведомлять).
- `src/app/api/notifications/route.ts` (лента «колокольчика» — что показывать в нотификациях). Остаются scoped даже при ON.

---

# ФАЗА 0 — Фундамент: схема + JWT + примитивы политики (поведение НЕ меняется)

## Task 1: Prisma-миграция (+ поле тоггла + поле роли)

**Files:**
- Modify: `prisma/schema.prisma` (model `Company` ~393-401, model `User` ~95-128)
- Create: миграция через `prisma migrate`

- [ ] **Step 1: Добавить поля в схему**

В `model Company` добавить строку (после `name String`):
```prisma
  managerTeamVisibility Boolean @default(false)
```
В `model User` добавить строку (после `role Role @default(organization)`):
```prisma
  managerRole         String?              // null = обычный менеджер, 'leader' = руководитель
```

- [ ] **Step 2: Сгенерировать миграцию + клиент**

Run:
```bash
npx prisma migrate dev --name c8_manager_company_wide
```
Expected: создаётся `prisma/migrations/<ts>_c8_manager_company_wide/migration.sql` с двумя `ALTER TABLE ... ADD COLUMN`; `prisma generate` отрабатывает. Backfill не нужен (оба поля с дефолтами/nullable).

- [ ] **Step 3: Проверить, что миграция additive**

Открыть сгенерированный `migration.sql`. Expected: только `ALTER TABLE "Company" ADD COLUMN "managerTeamVisibility" BOOLEAN NOT NULL DEFAULT false;` и `ALTER TABLE "User" ADD COLUMN "managerRole" TEXT;`. Никаких DROP/изменений существующих колонок (CLAUDE.md §11 — применённые миграции не править).

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS (Prisma-клиент знает новые поля).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(c8): add Company.managerTeamVisibility + User.managerRole (additive migration)"
```

---

## Task 2: JWT — тип сессии несёт managerRole

**Files:**
- Modify: `src/lib/auth/jwt.ts:15-40`

- [ ] **Step 1: Добавить тип роли + поле в SessionPayload**

После `export type OrgRoleInOrg = 'admin' | 'leader' | 'member';` (строка 19) добавить:
```ts
export type ManagerRole = 'leader';
```
В `SessionPayload` (после `managedOrgIds?: string[];`, строка 34) добавить:
```ts
  managerRole?: ManagerRole | null;
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS (поле опциональное, существующие создатели токена ещё его не пишут).

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/jwt.ts
git commit -m "feat(c8): SessionPayload carries managerRole"
```

---

## Task 3: login-producer эмитит managerRole (gotcha C1)

**Files:**
- Modify: `src/app/api/auth/login/route.ts:120-143`

- [ ] **Step 1: Загрузить и прокинуть managerRole в ветке manager**

Заменить блок (строки 120-128):
```ts
  let managedOrgIds: string[] | undefined;

  if (user.role === 'manager') {
    const assigned = await prisma.organizationManager.findMany({
      where: { userId: user.id, isActive: true },
      select: { organizationId: true }
    });
    managedOrgIds = assigned.map((a) => a.organizationId);
  }
```
на:
```ts
  let managedOrgIds: string[] | undefined;
  let managerRole: 'leader' | null | undefined;

  if (user.role === 'manager') {
    const assigned = await prisma.organizationManager.findMany({
      where: { userId: user.id, isActive: true },
      select: { organizationId: true }
    });
    managedOrgIds = assigned.map((a) => a.organizationId);
    // Preserve 'leader' explicitly. Mirrors the org-membership narrowing warning
    // above (lines ~112-116): collapsing this to null silently kills the leader
    // feature for the whole 7d token lifetime.
    managerRole = user.managerRole === 'leader' ? 'leader' : null;
  }
```
В вызове `signToken({...})` (после `...(managedOrgIds !== undefined ? { managedOrgIds } : {})`, строка 142) добавить:
```ts
    ...(managerRole !== undefined ? { managerRole } : {})
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/login/route.ts
git commit -m "feat(c8): login emits managerRole for manager sessions"
```

---

## Task 4: managerPolicy — mode-aware примитивы (TDD, чистые функции)

**Files:**
- Modify: `src/lib/auth/managerPolicy.ts`
- Test: `src/__tests__/auth.managerPolicy.test.ts`

- [ ] **Step 1: Дописать failing-тесты для новых примитивов**

В конец `src/__tests__/auth.managerPolicy.test.ts` добавить (импорты в шапке файла — дополнить список из `@/lib/auth/managerPolicy`: `companyWideOrderFilter, managerOrderScope, managerDocumentScope, managerOrgScope, isManagerLeader`):
```ts
describe('companyWideOrderFilter', () => {
  it('filters by session.companyId', () => {
    const session = makeSession({ companyId: 'co-1' });
    expect(companyWideOrderFilter(session)).toEqual({ companyId: 'co-1' });
  });

  it('falls back to a never-match sentinel when companyId is missing', () => {
    expect(companyWideOrderFilter(makeSession())).toEqual({ companyId: '__no_company__' });
  });
});

describe('managerOrderScope (resolver)', () => {
  it('teamMode=false returns the legacy three-way OR', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(managerOrderScope(session, false)).toEqual(managerOrderScopeFilter(session));
  });

  it('teamMode=true returns the company-wide filter', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(managerOrderScope(session, true)).toEqual({ companyId: 'co-1' });
  });
});

describe('managerOrgScope (resolver)', () => {
  it('teamMode=false returns id IN managedOrgIds', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(managerOrgScope(session, false)).toEqual({ id: { in: ['org-A'] } });
  });
  it('teamMode=true returns companyId filter', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(managerOrgScope(session, true)).toEqual({ companyId: 'co-1' });
  });
});

describe('canSeeOrder with teamMode', () => {
  it('teamMode=true: visible iff order.companyId === session.companyId', () => {
    const session = makeSession({ companyId: 'co-1' });
    expect(canSeeOrder(session, { managerId: 'other', organizationId: 'org-X', companyId: 'co-1' }, true)).toBe(true);
    expect(canSeeOrder(session, { managerId: 'other', organizationId: 'org-X', companyId: 'co-2' }, true)).toBe(false);
  });
  it('teamMode=true with no session.companyId denies', () => {
    expect(canSeeOrder(makeSession(), { managerId: null, organizationId: null, companyId: 'co-1' }, true)).toBe(false);
  });
  it('teamMode=false keeps the legacy three-way semantics', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(canSeeOrder(session, { managerId: 'user-1', organizationId: null, companyId: 'co-2' }, false)).toBe(true);
  });
});

describe('isManagerLeader', () => {
  it('true only for role=manager + managerRole=leader', () => {
    expect(isManagerLeader(makeSession({ managerRole: 'leader' }))).toBe(true);
    expect(isManagerLeader(makeSession())).toBe(false);
    expect(isManagerLeader(makeSession({ role: 'admin', managerRole: 'leader' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — тесты должны падать**

Run: `npx vitest run --mode=unit src/__tests__/auth.managerPolicy.test.ts`
Expected: FAIL — `companyWideOrderFilter is not a function` и т.п.

- [ ] **Step 3: Реализовать примитивы в managerPolicy.ts**

В шапке заменить `import type { Prisma } from '@prisma/client';` на:
```ts
import type { Prisma, PrismaClient } from '@prisma/client';
```
Заменить тело `canSeeOrder` (строки 39-47) на mode-aware версию:
```ts
export function canSeeOrder(
  session: SessionPayload,
  order: {
    managerId: string | null;
    organizationId: string | null;
    companyId?: string | null;
    commentsCountByMe?: number;
  },
  teamMode = false
): boolean {
  if (teamMode) return !!session.companyId && order.companyId === session.companyId;
  if (order.managerId === session.sub) return true;
  if (order.organizationId && managedOrgIds(session).includes(order.organizationId)) return true;
  if ((order.commentsCountByMe ?? 0) > 0) return true;
  return false;
}
```
Заменить тело `canSeeDocument` (строки 49-54) на:
```ts
export function canSeeDocument(
  session: SessionPayload,
  doc: { order: { managerId: string | null; organizationId: string | null; companyId?: string | null } },
  teamMode = false
): boolean {
  return canSeeOrder(session, doc.order, teamMode);
}
```
В конец файла (после `export const isOrgInScope = canSeeOrganization;`) добавить:
```ts

// ----- C8: company-wide mode -------------------------------------------------

const NO_COMPANY_SENTINEL = '__no_company__';

/** Company-wide order filter: every order in the manager's own company. */
export function companyWideOrderFilter(session: SessionPayload): Prisma.OrderWhereInput {
  // Order.companyId is required, so an impossible value denies all (fail-safe).
  return { companyId: session.companyId ?? NO_COMPANY_SENTINEL };
}

/** Resolver: pick the order filter by the live team-visibility flag. */
export function managerOrderScope(session: SessionPayload, teamMode: boolean): Prisma.OrderWhereInput {
  return teamMode ? companyWideOrderFilter(session) : managerOrderScopeFilter(session);
}

export function managerDocumentScope(session: SessionPayload, teamMode: boolean): Prisma.DocumentWhereInput {
  return { order: managerOrderScope(session, teamMode), scanStatus: { not: 'infected' } };
}

export function managerOrgScope(session: SessionPayload, teamMode: boolean): Prisma.OrganizationWhereInput {
  return teamMode ? { companyId: session.companyId ?? NO_COMPANY_SENTINEL } : managerOrgScopeFilter(session);
}

export function isManagerLeader(session: SessionPayload): boolean {
  return session.role === 'manager' && session.managerRole === 'leader';
}

/**
 * The single DB read of the live toggle. Returns false when companyId is absent
 * — so a null-company manager can never reach the company-wide branch and simply
 * keeps the scoped model (NOT denied-all). Callers memo per-request if they read
 * it more than once.
 */
export async function getCompanyTeamVisibility(
  prisma: PrismaClient,
  companyId: string | null | undefined
): Promise<boolean> {
  if (!companyId) return false;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { managerTeamVisibility: true }
  });
  return company?.managerTeamVisibility ?? false;
}
```

- [ ] **Step 4: Запустить — тесты зелёные, регресс цел**

Run: `npx vitest run --mode=unit src/__tests__/auth.managerPolicy.test.ts`
Expected: PASS (новые + все старые — старые проверяют OFF-путь, он не изменился).

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/lib/auth/managerPolicy.ts src/__tests__/auth.managerPolicy.test.ts
git commit -m "feat(c8): mode-aware managerPolicy primitives + getCompanyTeamVisibility (TDD)"
```

---

# ФАЗА 1 — Fan-out: каждый read-путь становится mode-aware

> Паттерн на КАЖДОМ сайте: вверху функции `const teamMode = await getCompanyTeamVisibility(prisma, <session>.companyId);`, затем `managerOrderScopeFilter(s)` → `managerOrderScope(s, teamMode)` (аналогично doc/org), а point-check `canSeeOrder(s, x)` → `canSeeOrder(s, x, teamMode)` с добавлением `companyId` в `select`. Главный гейт фазы — `npm run typecheck`. Поведение OFF идентично сегодняшнему (teamMode=false ⇒ те же фильтры), поэтому существующие integration-тесты остаются зелёными; ON-путь добавляется в Task 11.

## Task 5: orders.ts (listOrders + getOrder)

**Files:**
- Modify: `src/lib/services/manager/orders.ts`

- [ ] **Step 1: Импорт-резолвер**

Строка 4 — заменить:
```ts
import { managerOrderScopeFilter, canSeeOrder } from '@/lib/auth/managerPolicy';
```
на:
```ts
import { managerOrderScope, canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
```

- [ ] **Step 2: listOrders — читать флаг, резолвить scope**

Строки 46-47 — заменить:
```ts
  const opts = ListOrdersOptionsSchema.parse(optsRaw);
  const scope = managerOrderScopeFilter(opts.session);
```
на:
```ts
  const opts = ListOrdersOptionsSchema.parse(optsRaw);
  const teamMode = await getCompanyTeamVisibility(prisma, opts.session.companyId);
  const scope = managerOrderScope(opts.session, teamMode);
```

- [ ] **Step 3: getOrder — teamMode в canSeeOrder (companyId уже в include)**

Строки 98-111 — в начале функции добавить чтение флага и передать его. Заменить:
```ts
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      ...DETAIL_INCLUDE,
      comments: {
        where: { authorId: session.sub },
        take: 1,
        select: { id: true }
      }
    }
  });
  if (!order) return null;
  const commentsCountByMe = order.comments.length;
  if (!canSeeOrder(session, { ...order, commentsCountByMe })) return null;
```
на:
```ts
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      ...DETAIL_INCLUDE,
      comments: {
        where: { authorId: session.sub },
        take: 1,
        select: { id: true }
      }
    }
  });
  if (!order) return null;
  const commentsCountByMe = order.comments.length;
  // `order` is a findUnique-with-include, so the scalar `companyId` is present.
  if (!canSeeOrder(session, { ...order, commentsCountByMe }, teamMode)) return null;
```

- [ ] **Step 4: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/lib/services/manager/orders.ts
git commit -m "feat(c8): orders service honors team-visibility mode"
```

---

## Task 6: documents.ts (listDocuments + getDocumentForDownload)

**Files:**
- Modify: `src/lib/services/manager/documents.ts`

- [ ] **Step 1: Импорт-резолвер**

Строка 4 — заменить:
```ts
import { managerDocumentScopeFilter, canSeeOrder } from '@/lib/auth/managerPolicy';
```
на:
```ts
import { managerDocumentScope, canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
```

- [ ] **Step 2: listDocuments — флаг + резолвер**

Строки 54-55 — заменить:
```ts
  const opts = ListDocumentsOptionsSchema.parse(optsRaw);
  const scope = managerDocumentScopeFilter(opts.session);
```
на:
```ts
  const opts = ListDocumentsOptionsSchema.parse(optsRaw);
  const teamMode = await getCompanyTeamVisibility(prisma, opts.session.companyId);
  const scope = managerDocumentScope(opts.session, teamMode);
```

- [ ] **Step 3: getDocumentForDownload — companyId в select, skip comment-count при teamMode**

Заменить блок (строки 87-124):
```ts
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      path: true,
      mimeType: true,
      scanStatus: true,
      scanReason: true,
      order: {
        select: {
          managerId: true,
          organizationId: true
        }
      }
    }
  });

  if (!doc) return { ok: false, error: 'not_found' };

  // Silent 404 for out-of-scope documents: do not leak existence. We cannot
  // count historical comments cheaply here, so the canSeeDocument helper
  // accepts a `commentsCountByMe`-shaped order — the route layer falls back
  // to an extra comment.count() only when the order's managerId/organizationId
  // both miss the session scope.
  let commentsCountByMe = 0;
  if (
    doc.order.managerId !== session.sub &&
    !(doc.order.organizationId && (session.managedOrgIds ?? []).includes(doc.order.organizationId))
  ) {
    commentsCountByMe = await prisma.comment.count({
      where: { order: { documents: { some: { id: documentId } } }, authorId: session.sub }
    });
  }

  if (!canSeeOrder(session, { ...doc.order, commentsCountByMe })) {
    return { ok: false, error: 'not_found' };
  }
```
на:
```ts
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      path: true,
      mimeType: true,
      scanStatus: true,
      scanReason: true,
      order: {
        select: {
          managerId: true,
          organizationId: true,
          companyId: true
        }
      }
    }
  });

  if (!doc) return { ok: false, error: 'not_found' };

  // Silent 404 for out-of-scope documents: do not leak existence. In company-wide
  // mode the cheap companyId check decides, so we skip the historical-comment
  // count entirely; in scoped mode we count comments only when managerId/org miss.
  let commentsCountByMe = 0;
  if (
    !teamMode &&
    doc.order.managerId !== session.sub &&
    !(doc.order.organizationId && (session.managedOrgIds ?? []).includes(doc.order.organizationId))
  ) {
    commentsCountByMe = await prisma.comment.count({
      where: { order: { documents: { some: { id: documentId } } }, authorId: session.sub }
    });
  }

  if (!canSeeOrder(session, { ...doc.order, commentsCountByMe }, teamMode)) {
    return { ok: false, error: 'not_found' };
  }
```

- [ ] **Step 4: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/lib/services/manager/documents.ts
git commit -m "feat(c8): documents service honors team-visibility mode"
```

---

## Task 7: messages.ts (listIncomingComments)

**Files:**
- Modify: `src/lib/services/manager/messages.ts`

- [ ] **Step 1: Импорт + резолвер**

Строка 4 — заменить `import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';` на:
```ts
import { managerOrderScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
```
Строки 50-59 — добавить чтение флага после `const since = ...` и заменить `order: managerOrderScopeFilter(opts.session)`:
```ts
  const opts = ListIncomingCommentsOptionsSchema.parse(optsRaw);
  const since = opts.since ?? new Date(Date.now() - DEFAULT_WINDOW_MS);
  const teamMode = await getCompanyTeamVisibility(prisma, opts.session.companyId);
```
и в `where`:
```ts
      order: managerOrderScope(opts.session, teamMode),
```

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/lib/services/manager/messages.ts
git commit -m "feat(c8): messages inbox honors team-visibility mode"
```

---

## Task 8: dashboard kpis + attention + events

**Files:**
- Modify: `src/lib/services/manager/dashboard/kpis.ts`, `attention.ts`, `events.ts`

Каждый файл: строка 3 — заменить `import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';` на `import { managerOrderScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';`; затем `const scope = managerOrderScopeFilter(session);` → две строки.

- [ ] **Step 1: kpis.ts**

Строка 22 — заменить:
```ts
  const scope = managerOrderScopeFilter(session);
```
на:
```ts
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const scope = managerOrderScope(session, teamMode);
```
(+ импорт строка 3, см. выше.)

- [ ] **Step 2: attention.ts**

Строка 33 — та же замена (`const scope = managerOrderScopeFilter(session);` → флаг + резолвер) и импорт строка 3.

- [ ] **Step 3: events.ts**

Строка 25 — та же замена и импорт строка 3.

- [ ] **Step 4: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/lib/services/manager/dashboard/kpis.ts src/lib/services/manager/dashboard/attention.ts src/lib/services/manager/dashboard/events.ts
git commit -m "feat(c8): dashboard widgets honor team-visibility mode"
```

---

## Task 9: organizations.ts + students.ts

**Files:**
- Modify: `src/lib/services/manager/organizations.ts`, `src/lib/services/manager/students.ts`

- [ ] **Step 1: organizations.ts — импорт**

Строка 3 — заменить:
```ts
import { managerOrgScopeFilter, canSeeOrganization } from '@/lib/auth/managerPolicy';
```
на:
```ts
import { managerOrgScope, canSeeOrganization, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
```

- [ ] **Step 2: organizations.ts — listOrganizations**

Заменить тело (строки 34-43):
```ts
export async function listOrganizations(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ManagerOrgListRow[]> {
  return prisma.organization.findMany({
    where: managerOrgScopeFilter(session),
    select: LIST_SELECT,
    orderBy: { name: 'asc' }
  });
}
```
на:
```ts
export async function listOrganizations(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ManagerOrgListRow[]> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  return prisma.organization.findMany({
    where: managerOrgScope(session, teamMode),
    select: LIST_SELECT,
    orderBy: { name: 'asc' }
  });
}
```

- [ ] **Step 3: organizations.ts — getOrganization (fetch-then-check, company-wide ветка)**

Заменить тело (строки 58-68):
```ts
export async function getOrganization(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<ManagerOrgDetail | null> {
  if (!canSeeOrganization(session, orgId)) return null;
  return prisma.organization.findUnique({
    where: { id: orgId },
    include: DETAIL_INCLUDE
  });
}
```
на:
```ts
export async function getOrganization(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<ManagerOrgDetail | null> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  // Fetch by id, then check scope in-process so a foreign org returns null
  // (no existence-leak), same as before — but company-wide needs org.companyId.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: DETAIL_INCLUDE
  });
  if (!org) return null;
  if (teamMode) {
    return !!session.companyId && org.companyId === session.companyId ? org : null;
  }
  return canSeeOrganization(session, orgId) ? org : null;
}
```

- [ ] **Step 4: students.ts — company-wide через relation-фильтр**

Строка 4 — заменить `import { managedOrgIds } from '@/lib/auth/managerPolicy';` на:
```ts
import { managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
```
Заменить строки 47-50:
```ts
  const opts = ListStudentsOptionsSchema.parse(optsRaw);
  const orgIds = managedOrgIds(opts.session);

  const filters: Prisma.StudentWhereInput[] = [{ organizationId: { in: orgIds } }];
```
на:
```ts
  const opts = ListStudentsOptionsSchema.parse(optsRaw);
  const teamMode = await getCompanyTeamVisibility(prisma, opts.session.companyId);

  // Student has no companyId; in company-wide mode scope through its organization.
  const orgFilter: Prisma.StudentWhereInput = teamMode
    ? { organization: { companyId: opts.session.companyId ?? '__no_company__' } }
    : { organizationId: { in: managedOrgIds(opts.session) } };
  const filters: Prisma.StudentWhereInput[] = [orgFilter];
```

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/lib/services/manager/organizations.ts src/lib/services/manager/students.ts
git commit -m "feat(c8): organizations + students services honor team-visibility mode"
```

---

## Task 10: write-path + guards + shared API (status, uploads, requireRole, policy, comments)

**Files:**
- Modify: `src/lib/services/manager/status.ts`, `src/lib/services/manager/uploads.ts`, `src/lib/auth/requireRole.ts`, `src/lib/auth/policy.ts`, `src/app/api/comments/route.ts`

- [ ] **Step 1: status.ts — teamMode + companyId в select**

Строка 3 — заменить `import { canSeeOrder } from '@/lib/auth/managerPolicy';` на:
```ts
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
```
Заменить строки 47-65 (fetch + canSeeOrder):
```ts
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      executionStatus: true,
      orderNumber: true,
      title: true
    }
  });
  if (!order) throw new ManagerStatusError('not_found');

  // The orders service already enforces the three-way scope on read; this
  // duplicate check makes the write path defence-in-depth so direct calls
  // can't bypass RBAC even if an upstream caller drops the guard.
  if (!canSeeOrder(session, order)) {
    throw new ManagerStatusError('forbidden');
  }
```
на:
```ts
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      companyId: true,
      executionStatus: true,
      orderNumber: true,
      title: true
    }
  });
  if (!order) throw new ManagerStatusError('not_found');

  // Defence-in-depth on the write path (mode-aware): company-wide ⇒ same-company,
  // otherwise the three-way scope.
  if (!canSeeOrder(session, order, teamMode)) {
    throw new ManagerStatusError('forbidden');
  }
```

- [ ] **Step 2: uploads.ts — teamMode + companyId, skip comment-count при teamMode**

Строка 4 — заменить `import { canSeeOrder, managedOrgIds } from '@/lib/auth/managerPolicy';` на:
```ts
import { canSeeOrder, managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
```
Заменить строки 102-132:
```ts
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      orderNumber: true,
      title: true
    }
  });

  if (!order) {
    return { ok: false, error: 'not_found' };
  }

  // Three-way visibility: managerId, org scope, or historical comments. Cheap
  // checks first; only count comments when the others miss.
  let commentsCountByMe = 0;
  if (order.managerId !== session.sub) {
    const inOrgScope =
      order.organizationId !== null &&
      managedOrgIds(session).includes(order.organizationId);
    if (!inOrgScope) {
      commentsCountByMe = await prisma.comment.count({
        where: { orderId: order.id, authorId: session.sub }
      });
    }
  }
  if (!canSeeOrder(session, { ...order, commentsCountByMe })) {
    return { ok: false, error: 'forbidden' };
  }
```
на:
```ts
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      companyId: true,
      orderNumber: true,
      title: true
    }
  });

  if (!order) {
    return { ok: false, error: 'not_found' };
  }

  // Company-wide ⇒ same-company decides; otherwise three-way (count comments
  // only when managerId/org miss).
  let commentsCountByMe = 0;
  if (!teamMode && order.managerId !== session.sub) {
    const inOrgScope =
      order.organizationId !== null &&
      managedOrgIds(session).includes(order.organizationId);
    if (!inOrgScope) {
      commentsCountByMe = await prisma.comment.count({
        where: { orderId: order.id, authorId: session.sub }
      });
    }
  }
  if (!canSeeOrder(session, { ...order, commentsCountByMe }, teamMode)) {
    return { ok: false, error: 'forbidden' };
  }
```

- [ ] **Step 3: requireRole.ts — импорт + mode-aware org/order guards**

Строка 5 — заменить `import { canSeeOrder, isOrgInScope } from '@/lib/auth/managerPolicy';` на:
```ts
import { canSeeOrder, isOrgInScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
```
Заменить `requireManagerForOrg` (строки 76-80):
```ts
export async function requireManagerForOrg(orgId: string): Promise<SessionPayload> {
  const session = await requireManager();
  if (!isOrgInScope(session, orgId)) redirect('/manager/dashboard');
  return session;
}
```
на:
```ts
export async function requireManagerForOrg(orgId: string): Promise<SessionPayload> {
  const session = await requireManager();
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  if (teamMode) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { companyId: true }
    });
    if (!org || !session.companyId || org.companyId !== session.companyId) {
      redirect('/manager/dashboard');
    }
    return session;
  }
  if (!isOrgInScope(session, orgId)) redirect('/manager/dashboard');
  return session;
}
```
Заменить `requireManagerForOrder` (строки 82-113), добавив `companyId` в select + в return-аннотацию + teamMode:
```ts
export async function requireManagerForOrder(
  orderId: string
): Promise<{
  session: SessionPayload;
  order: { id: string; managerId: string | null; organizationId: string | null; companyId: string };
}> {
  const session = await requireManager();
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, managerId: true, organizationId: true, companyId: true }
  });
  if (!order) notFound();

  // Three-way visibility check (scoped mode only): managerId, org scope, or
  // historical comments. Company-wide mode skips straight to the companyId check.
  let commentsCountByMe = 0;
  if (!teamMode && order.managerId !== session.sub) {
    const inOrgScope =
      order.organizationId !== null && isOrgInScope(session, order.organizationId);
    if (!inOrgScope) {
      commentsCountByMe = await prisma.comment.count({
        where: { orderId: order.id, authorId: session.sub }
      });
    }
  }

  if (!canSeeOrder(session, { ...order, commentsCountByMe }, teamMode)) notFound();

  return { session, order };
}
```

- [ ] **Step 4: policy.ts — manager-ветки canReadOrder + canAccessOrganization**

Заменить manager-ветку в `canAccessOrganization` (строки 27-33):
```ts
  if (session.role === 'manager') {
    // Manager visibility is driven by `OrganizationManager` (cached on session as
    // `managedOrgIds` at login by `auth/login.ts`). We delegate to `managerPolicy`
    // via a dynamic import to keep this module free of a static cycle with it.
    const { canSeeOrganization } = await import('@/lib/auth/managerPolicy');
    return canSeeOrganization(session, organizationId);
  }
```
на:
```ts
  if (session.role === 'manager') {
    const { canSeeOrganization, getCompanyTeamVisibility } = await import('@/lib/auth/managerPolicy');
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    if (teamMode) {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { companyId: true }
      });
      return !!session.companyId && org?.companyId === session.companyId;
    }
    return canSeeOrganization(session, organizationId);
  }
```
Заменить manager-ветку в `canReadOrder` (строки 56-71):
```ts
  if (session.role === 'manager') {
    // Top-level RBAC guard: per-order ownership (Order.managerId === session.sub)
    // OR per-org scope (Order.organizationId ∈ session.managedOrgIds).
    //
    // Comments-history fallback path is intentionally NOT applied here — that's
    // the responsibility of downstream services (e.g. /manager/orders) that need
    // to surface historical visibility. This guard reflects the assignment graph
    // only.
    const { canSeeOrder } = await import('@/lib/auth/managerPolicy');
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      select: { managerId: true, organizationId: true }
    });
    if (!fullOrder) return false;
    return canSeeOrder(session, fullOrder);
  }
```
на:
```ts
  if (session.role === 'manager') {
    const { canSeeOrder, getCompanyTeamVisibility } = await import('@/lib/auth/managerPolicy');
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    // `order` already carries companyId, so company-wide is a pure comparison.
    if (teamMode) return !!session.companyId && order.companyId === session.companyId;
    // Scoped mode: assignment graph only (no comments-history at this guard).
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      select: { managerId: true, organizationId: true, companyId: true }
    });
    if (!fullOrder) return false;
    return canSeeOrder(session, fullOrder, false);
  }
```

- [ ] **Step 5: api/comments/route.ts — manager-ветка mode-aware**

Заменить manager-блок (строки 94-123):
```ts
  if (s.role === 'manager') {
    const { canSeeOrder: canSeeOrderMgr, managedOrgIds } = await import(
      '@/lib/auth/managerPolicy'
    );
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        managerId: true,
        organizationId: true,
        orderNumber: true,
        title: true
      }
    });
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let commentsCountByMe = 0;
    if (order.managerId !== s.sub) {
      const inOrgScope =
        order.organizationId !== null &&
        managedOrgIds(s).includes(order.organizationId);
      if (!inOrgScope) {
        commentsCountByMe = await prisma.comment.count({
          where: { orderId: order.id, authorId: s.sub }
        });
      }
    }
    if (!canSeeOrderMgr(s, { ...order, commentsCountByMe })) {
      return forbiddenResponse('Access denied');
    }
```
на:
```ts
  if (s.role === 'manager') {
    const { canSeeOrder: canSeeOrderMgr, managedOrgIds, getCompanyTeamVisibility } = await import(
      '@/lib/auth/managerPolicy'
    );
    const teamMode = await getCompanyTeamVisibility(prisma, s.companyId);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        managerId: true,
        organizationId: true,
        companyId: true,
        orderNumber: true,
        title: true
      }
    });
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    let commentsCountByMe = 0;
    if (!teamMode && order.managerId !== s.sub) {
      const inOrgScope =
        order.organizationId !== null &&
        managedOrgIds(s).includes(order.organizationId);
      if (!inOrgScope) {
        commentsCountByMe = await prisma.comment.count({
          where: { orderId: order.id, authorId: s.sub }
        });
      }
    }
    if (!canSeeOrderMgr(s, { ...order, commentsCountByMe }, teamMode)) {
      return forbiddenResponse('Access denied');
    }
```

- [ ] **Step 6: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/lib/services/manager/status.ts src/lib/services/manager/uploads.ts src/lib/auth/requireRole.ts src/lib/auth/policy.ts src/app/api/comments/route.ts
git commit -m "feat(c8): write-path, guards and shared comments API honor team-visibility mode"
```

---

## Task 11: integration — cross-company инвариант + ON/OFF режимы

**Files:**
- Modify: `src/__tests__/auth.policy.manager-refactor.test.ts`

Этот тест уже создаёт company/orgs/orders и проверяет OFF-семантику (`Company.managerTeamVisibility` по дефолту false ⇒ ветки не меняются, существующие проверки остаются зелёными). Добавляем 2-ю компанию + ON-режим + cross-company изоляцию.

- [ ] **Step 1: Расширить фикстуру — вторая компания и её заказ**

В блоке объявлений (после `let order3Id`) добавить:
```ts
let otherCompanyId: string;
let foreignOrderId: string; // в ДРУГОЙ компании — невидим всегда
```
В `beforeAll`, после создания `order3`, добавить:
```ts
  const otherCompany = await prisma.company.create({ data: { name: `MgrPolicyOtherC-${stamp}` } });
  otherCompanyId = otherCompany.id;
  const foreignOrg = await prisma.organization.create({
    data: { name: `MgrPolicyForeignOrg-${stamp}`, partnerId, companyId: otherCompanyId }
  });
  const foreignOrder = await prisma.order.create({
    data: {
      title: `MgrPolicy-Foreign-${stamp}`,
      orderNumber: `MPF-${stamp}`,
      companyId: otherCompanyId,
      partnerId,
      organizationId: foreignOrg.id,
      executionStatus: 'in_progress',
      financialStatus: 'not_billed'
    }
  });
  foreignOrderId = foreignOrder.id;
```
В `afterAll` дополнить очистку (ПЕРЕД удалением partner/company; порядок — заказы → orgs → companies):
```ts
  await prisma.order.deleteMany({ where: { id: foreignOrderId } });
  await prisma.organization.deleteMany({ where: { companyId: otherCompanyId } });
  await prisma.company.deleteMany({ where: { id: otherCompanyId } });
```
(Существующие `deleteMany` для order1-3/org/partner/company оставить; убедиться, что foreignOrder удаляется до своей org/company.)

- [ ] **Step 2: Добавить company-wide (ON) describe-блок**

В конец файла добавить. Сессия менеджера с `companyId` (важно: добавить companyId в helper или инлайн). Заменить helper `managerSession`:
```ts
function managerSession(managedOrgIds: string[]): SessionPayload {
  return { sub: managerUserId, role: 'manager', managedOrgIds, companyId };
}
```
(добавлен `companyId`). Затем:
```ts
describe('policy.canReadOrder — manager branch, company-wide mode', () => {
  beforeAll(async () => {
    await prisma.company.update({ where: { id: companyId }, data: { managerTeamVisibility: true } });
  });
  afterAll(async () => {
    await prisma.company.update({ where: { id: companyId }, data: { managerTeamVisibility: false } });
  });

  it('sees ANY order in its own company (even with empty managedOrgIds)', async () => {
    const session = managerSession([]); // no assignments at all
    expect(await canReadOrder(session, { id: order3Id, companyId })).toBe(true); // foreign org, same company
  });

  it('still CANNOT see an order in another company (cross-company isolation)', async () => {
    const session = managerSession([]);
    expect(await canReadOrder(session, { id: foreignOrderId, companyId: otherCompanyId })).toBe(false);
  });

  it('canAccessOrganization: any org in own company, but not foreign company org', async () => {
    const session = managerSession([]);
    expect(await canAccessOrganization(session, otherOrgId)).toBe(true); // same company, previously out of scope
    const foreignOrg = await prisma.organization.findFirst({ where: { companyId: otherCompanyId }, select: { id: true } });
    expect(await canAccessOrganization(session, foreignOrg!.id)).toBe(false);
  });
});
```

- [ ] **Step 3: Запустить (нужен Postgres)**

Run: `npx vitest run --mode=integration src/__tests__/auth.policy.manager-refactor.test.ts`
Expected: PASS — OFF-блоки без изменений зелёные; ON-блок подтверждает company-wide + cross-company deny.
(Если нет локального Postgres — поднять через `npm run gate` оркестратор или запустить в L2.5-гейте позже.)

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/auth.policy.manager-refactor.test.ts
git commit -m "test(c8): company-wide ON mode + cross-company isolation invariant"
```

---

# ФАЗА 2 — Бэкенд роли leader: тоггл, выдача роли, ростер-actions

## Task 12: сервис + server-action флипа видимости (+ audit entity)

**Files:**
- Modify: `src/lib/auth/audit.ts:3-16` (добавить `'company'` в `AuditEntity`)
- Create: `src/lib/services/manager/teamVisibility.ts`
- Create: `src/server-actions/manager/teamVisibility.ts`
- Test: `src/__tests__/services.manager.teamVisibility.test.ts`

- [ ] **Step 1: Расширить AuditEntity**

В `src/lib/auth/audit.ts`, в union `AuditEntity` (строки 3-16) добавить `| 'company'`.

- [ ] **Step 2: Failing-тест сервиса (mock prisma)**

Create `src/__tests__/services.manager.teamVisibility.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { setTeamVisibility } from '@/lib/services/manager/teamVisibility';

function makePrisma(current: boolean) {
  return {
    company: {
      findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: current }),
      update: vi.fn().mockResolvedValue({})
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) }
  } as unknown as Parameters<typeof setTeamVisibility>[0];
}

describe('setTeamVisibility', () => {
  it('flips OFF→ON, writes audit, reports changed', async () => {
    const prisma = makePrisma(false);
    const res = await setTeamVisibility(prisma, 'actor-1', 'co-1', true);
    expect(res).toEqual({ changed: true });
    expect((prisma.company.update as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { managerTeamVisibility: true }
    });
    expect((prisma.auditLog.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it('is a no-op when already in target state (no audit, changed=false)', async () => {
    const prisma = makePrisma(true);
    const res = await setTeamVisibility(prisma, 'actor-1', 'co-1', true);
    expect(res).toEqual({ changed: false });
    expect((prisma.company.update as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((prisma.auditLog.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Запустить — FAIL**

Run: `npx vitest run --mode=unit src/__tests__/services.manager.teamVisibility.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 4: Реализовать сервис**

Create `src/lib/services/manager/teamVisibility.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Flip the company-wide manager visibility toggle. Idempotent: a no-op flip
 * writes no audit row. Callers (leader/admin server-actions) own authorization.
 */
export async function setTeamVisibility(
  prisma: PrismaClient,
  actorUserId: string,
  companyId: string,
  enabled: boolean
): Promise<{ changed: boolean }> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { managerTeamVisibility: true }
  });
  if (!company) throw new Error('company_not_found');
  if (company.managerTeamVisibility === enabled) return { changed: false };

  await prisma.company.update({
    where: { id: companyId },
    data: { managerTeamVisibility: enabled }
  });
  await recordAudit(prisma, {
    userId: actorUserId,
    action: 'manager_team_visibility_changed',
    entity: 'company',
    entityId: companyId,
    before: { managerTeamVisibility: company.managerTeamVisibility },
    after: { managerTeamVisibility: enabled }
  });
  return { changed: true };
}
```

- [ ] **Step 5: Запустить — PASS**

Run: `npx vitest run --mode=unit src/__tests__/services.manager.teamVisibility.test.ts` → PASS

- [ ] **Step 6: Server-action (leader|admin)**

Create `src/server-actions/manager/teamVisibility.ts`:
```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { setTeamVisibility } from '@/lib/services/manager/teamVisibility';

const InputSchema = z.object({ enabled: z.boolean() });

export type SetTeamVisibilityResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'validation' | 'no_company' };

export async function setTeamVisibilityAction(input: {
  enabled: boolean;
}): Promise<SetTeamVisibilityResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();
  if (!session.companyId) return { ok: false, error: 'no_company' };

  const result = await setTeamVisibility(prisma, session.sub, session.companyId, parsed.data.enabled);
  revalidatePath('/manager/team');
  revalidatePath('/manager/dashboard');
  return { ok: true, changed: result.changed };
}
```
(`requireManagerLeader` создаётся в Task 15 — если выполняем строго по порядку, временно typecheck упадёт здесь; поэтому Task 15 (guard) логически предшествует — см. порядок ниже: сначала сделать Step «guard» из Task 15, либо выполнять Task 15 перед server-actions. Для простоты: **guard `requireManagerLeader` добавить здесь же** перед server-action — см. Task 15 Step 1, он атомарен.)

- [ ] **Step 7: typecheck + commit**

Run: `npm run typecheck` → PASS (после добавления guard, Task 15 Step 1)
```bash
git add src/lib/auth/audit.ts src/lib/services/manager/teamVisibility.ts src/server-actions/manager/teamVisibility.ts src/__tests__/services.manager.teamVisibility.test.ts
git commit -m "feat(c8): team-visibility toggle service + leader server-action (audited)"
```

---

## Task 13: выдача роли leader — сервис + admin server-action (privesc-граница)

**Files:**
- Create: `src/lib/services/admin/managerRole.ts`
- Modify: `src/server-actions/admin/manager.ts` (дописать action + импорт)
- Test: `src/__tests__/services.admin.managerRole.test.ts`

- [ ] **Step 1: Failing-тест сервиса (mock prisma)**

Create `src/__tests__/services.admin.managerRole.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { setManagerRole } from '@/lib/services/admin/managerRole';

function makePrisma(user: { role: string; managerRole: string | null } | null) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({})
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) }
  } as unknown as Parameters<typeof setManagerRole>[0];
}

describe('setManagerRole', () => {
  it('grants leader to a manager (changed + audit)', async () => {
    const prisma = makePrisma({ role: 'manager', managerRole: null });
    const res = await setManagerRole(prisma, 'admin-1', 'mgr-1', 'leader');
    expect(res).toEqual({ ok: true, changed: true });
    expect((prisma.user.update as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      where: { id: 'mgr-1' },
      data: { managerRole: 'leader' }
    });
  });

  it('refuses a non-manager target', async () => {
    const prisma = makePrisma({ role: 'organization', managerRole: null });
    expect(await setManagerRole(prisma, 'admin-1', 'u-1', 'leader')).toEqual({ ok: false, error: 'not_a_manager' });
  });

  it('refuses unknown user', async () => {
    const prisma = makePrisma(null);
    expect(await setManagerRole(prisma, 'admin-1', 'nope', 'leader')).toEqual({ ok: false, error: 'user_not_found' });
  });

  it('no-op when already in target role', async () => {
    const prisma = makePrisma({ role: 'manager', managerRole: 'leader' });
    const res = await setManagerRole(prisma, 'admin-1', 'mgr-1', 'leader');
    expect(res).toEqual({ ok: true, changed: false });
    expect((prisma.user.update as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run --mode=unit src/__tests__/services.admin.managerRole.test.ts` → FAIL.

- [ ] **Step 3: Реализовать сервис**

Create `src/lib/services/admin/managerRole.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

export type SetManagerRoleResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'user_not_found' | 'not_a_manager' };

/**
 * Grant ('leader') or revoke (null) the manager leader sub-role. Admin-only
 * (the privesc boundary): the server-action gates with requireAdmin so a leader
 * can never promote anyone, including themselves.
 */
export async function setManagerRole(
  prisma: PrismaClient,
  actorUserId: string,
  targetUserId: string,
  role: 'leader' | null
): Promise<SetManagerRoleResult> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { role: true, managerRole: true }
  });
  if (!user) return { ok: false, error: 'user_not_found' };
  if (user.role !== 'manager') return { ok: false, error: 'not_a_manager' };
  if (user.managerRole === role) return { ok: true, changed: false };

  await prisma.user.update({ where: { id: targetUserId }, data: { managerRole: role } });
  await recordAudit(prisma, {
    userId: actorUserId,
    action: 'manager_role_changed',
    entity: 'user',
    entityId: targetUserId,
    before: { managerRole: user.managerRole },
    after: { managerRole: role }
  });
  return { ok: true, changed: true };
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run --mode=unit src/__tests__/services.admin.managerRole.test.ts` → PASS.

- [ ] **Step 5: admin server-action**

В `src/server-actions/admin/manager.ts`: добавить импорт после строки 13:
```ts
import { setManagerRole } from '@/lib/services/admin/managerRole';
```
В конец файла добавить:
```ts

const setManagerRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['leader', 'member'])
});

export type SetManagerRoleActionResult =
  | { ok: true }
  | { ok: false; error: 'validation' | 'user_not_found' | 'not_a_manager' };

export async function setManagerRoleAction(
  formData: FormData
): Promise<SetManagerRoleActionResult> {
  const parsed = setManagerRoleSchema.safeParse({
    userId: readForm(formData, 'userId'),
    role: readForm(formData, 'role')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  const role: 'leader' | null = parsed.data.role === 'leader' ? 'leader' : null;
  const result = await setManagerRole(prisma, session.sub, parsed.data.userId, role);
  if (!result.ok) return result;

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { ok: true };
}
```

- [ ] **Step 6: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/lib/services/admin/managerRole.ts src/server-actions/admin/manager.ts src/__tests__/services.admin.managerRole.test.ts
git commit -m "feat(c8): admin-only setManagerRole service + action (privesc boundary)"
```

---

## Task 14: leader ростер-actions (reuse invite.ts + company-check)

**Files:**
- Create: `src/server-actions/manager/team.ts`

Leader управляет ростером ТОЛЬКО в своей компании — defense-in-depth: проверяем `org.companyId === session.companyId` поверх reuse `createAndAssignManager`/`deactivateAssignment`.

- [ ] **Step 1: Реализовать leader-actions**

Create `src/server-actions/manager/team.ts`:
```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import {
  createAndAssignManager,
  deactivateAssignment,
  ManagerInviteError,
  type ManagerInviteErrorCode
} from '@/lib/services/manager/invite';

function readForm(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** A leader may only touch orgs in their own company. */
async function orgInLeaderCompany(orgId: string, companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { companyId: true } });
  return !!org && org.companyId === companyId;
}

const assignSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), organizationId: z.string().min(1), email: z.string().email() }),
  z.object({ mode: z.literal('new'), organizationId: z.string().min(1), email: z.string().email(), name: z.string().max(200).optional() })
]);

export type LeaderAssignResult =
  | { ok: true; inviteUrl: string | null; reactivated: boolean }
  | { ok: false; error: 'validation' | 'forbidden_org' | ManagerInviteErrorCode };

export async function leaderAssignManagerAction(formData: FormData): Promise<LeaderAssignResult> {
  const parsed = assignSchema.safeParse({
    mode: readForm(formData, 'mode'),
    organizationId: readForm(formData, 'organizationId'),
    email: readForm(formData, 'email'),
    name: readForm(formData, 'name')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();
  if (!(await orgInLeaderCompany(parsed.data.organizationId, session.companyId))) {
    return { ok: false, error: 'forbidden_org' };
  }

  try {
    const result = await createAndAssignManager(prisma, parsed.data, session.sub);
    revalidatePath('/manager/team');
    return { ok: true, inviteUrl: result.inviteUrl, reactivated: result.reactivated };
  } catch (e) {
    if (e instanceof ManagerInviteError) return { ok: false, error: e.code };
    throw e;
  }
}

const deactivateSchema = z.object({ assignmentId: z.string().min(1) });

export type LeaderDeactivateResult = { ok: true } | { ok: false; error: 'validation' | 'forbidden_org' | 'not_found' };

export async function leaderDeactivateAssignmentAction(formData: FormData): Promise<LeaderDeactivateResult> {
  const parsed = deactivateSchema.safeParse({ assignmentId: readForm(formData, 'assignmentId') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();
  // Resolve the assignment's org first to enforce the company boundary.
  const row = await prisma.organizationManager.findUnique({
    where: { id: parsed.data.assignmentId },
    select: { organizationId: true }
  });
  if (!row) return { ok: false, error: 'not_found' };
  if (!(await orgInLeaderCompany(row.organizationId, session.companyId))) {
    return { ok: false, error: 'forbidden_org' };
  }

  const result = await deactivateAssignment(prisma, parsed.data.assignmentId, session.sub);
  if (!result.ok) return { ok: false, error: 'not_found' };
  revalidatePath('/manager/team');
  return { ok: true };
}
```

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/server-actions/manager/team.ts
git commit -m "feat(c8): leader roster server-actions (company-scoped reuse of invite service)"
```

---

# ФАЗА 3 — UI: leader-хаб, admin-контрол, guard + навигация

## Task 15: requireManagerLeader guard + пункт навигации

**Files:**
- Modify: `src/lib/auth/requireRole.ts` (добавить guard — выполнять ПЕРЕД Task 12 Step 7 typecheck)
- Modify: `src/lib/navigation/cabinet.ts`
- Test: `src/__tests__/navigation.cabinet.test.ts` (если есть — иначе добавить inline-проверку)

- [ ] **Step 1: requireManagerLeader**

В `src/lib/auth/requireRole.ts`, после `requireManager` (строка 74) добавить:
```ts

export async function requireManagerLeader(): Promise<SessionPayload> {
  const session = await requireManager();
  if (session.managerRole !== 'leader') redirect('/manager/dashboard');
  return session;
}
```

- [ ] **Step 2: Пункт «Команда» для leader в навигации**

`navByRole` строится статически по роли и не знает про managerRole. Добавляем пункт `/manager/team` в массив `manager`, но фильтруем его по managerRole в рантайме. В `src/lib/navigation/cabinet.ts`:

Добавить в `manager`-массив (после строки 22, `messages`):
```ts
    { href: '/manager/team', label: 'Команда', flag: 'manager_cabinet', leaderOnly: true }
```
Расширить тип `NavItem` (строка 4):
```ts
export type NavItem = { href: string; label: string; disabled?: boolean; flag?: FeatureFlag; leaderOnly?: boolean };
```
Заменить `navItemsFor` (строки 47-49), добавив параметр сессии для leader-фильтра:
```ts
export function navItemsFor(role: Role, opts?: { isManagerLeader?: boolean }): NavItem[] {
  return navByRole[role].filter((item) => {
    if (item.flag && !isFeatureEnabled(item.flag)) return false;
    if (item.leaderOnly && !opts?.isManagerLeader) return false;
    return true;
  });
}
```

- [ ] **Step 3: Обновить вызывающих navItemsFor**

Run: `rg -n "navItemsFor\(" src` — для каждого вызова в шелле кабинета передать `{ isManagerLeader: isManagerLeader(session) }` (импорт `isManagerLeader` из `@/lib/auth/managerPolicy`). Обычно один сайт (app-shell). Expected: вызовы компилируются (параметр опционален — без правок остаются валидны, leader-пункт просто скрыт).

- [ ] **Step 4: typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/lib/auth/requireRole.ts src/lib/navigation/cabinet.ts src/components
git commit -m "feat(c8): requireManagerLeader guard + leader-only Команда nav item"
```

---

## Task 16: leader-хаб /manager/team (страница + тоггл-компонент)

**Files:**
- Create: `src/app/manager/team/page.tsx`
- Create: `src/components/manager/team-visibility-toggle.tsx`
- Modify: `src/lib/services/manager/team.ts` (добавить `listCompanyManagers`)

- [ ] **Step 1: Сервис ростера компании**

В `src/lib/services/manager/team.ts` добавить (после `listManagersForOrg`):
```ts
export type CompanyManagerRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  managerRole: string | null;
  assignments: { id: string; organizationId: string; organizationName: string; isActive: boolean }[];
};

/**
 * All managers belonging to a company, with their org-assignment rows. Powers
 * the leader hub roster panel. Company membership = User.companyId.
 */
export async function listCompanyManagers(
  prisma: PrismaClient,
  companyId: string
): Promise<CompanyManagerRow[]> {
  const users = await prisma.user.findMany({
    where: { role: 'manager', companyId },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      managerRole: true,
      managedOrganizations: {
        select: {
          id: true,
          isActive: true,
          organization: { select: { id: true, name: true } }
        }
      }
    },
    orderBy: { name: 'asc' }
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.isActive,
    managerRole: u.managerRole,
    assignments: u.managedOrganizations.map((a) => ({
      id: a.id,
      organizationId: a.organization.id,
      organizationName: a.organization.name,
      isActive: a.isActive
    }))
  }));
}
```

- [ ] **Step 2: Клиентский тоггл**

Create `src/components/manager/team-visibility-toggle.tsx`:
```tsx
'use client';

import { useState, useTransition } from 'react';
import { setTeamVisibilityAction } from '@/server-actions/manager/teamVisibility';

export function TeamVisibilityToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onToggle() {
    const next = !enabled;
    setError(null);
    startTransition(async () => {
      const res = await setTeamVisibilityAction({ enabled: next });
      if (res.ok) setEnabled(next);
      else setError('Не удалось изменить режим');
    });
  }

  return (
    <div className='rounded-lg bg-[#F3F4F6] p-4'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <p className='font-medium text-[#111111]'>Видимость всей команды</p>
          <p className='text-sm text-gray-600'>
            {enabled
              ? 'Включено: каждый менеджер видит все заказы компании.'
              : 'Выключено: каждый менеджер видит только свои назначения.'}
          </p>
        </div>
        <button
          type='button'
          onClick={onToggle}
          disabled={pending}
          aria-pressed={enabled}
          className={`rounded-md px-4 py-2 text-white ${enabled ? 'bg-[#EA580C]' : 'bg-gray-400'} disabled:opacity-50`}
        >
          {enabled ? 'Включено' : 'Выключено'}
        </button>
      </div>
      {error && <p role='alert' className='mt-2 text-sm text-red-600'>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Страница leader-хаба**

Create `src/app/manager/team/page.tsx`:
```tsx
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { TeamVisibilityToggle } from '@/components/manager/team-visibility-toggle';
import { ManagerRosterPanel } from '@/components/manager/manager-roster-panel';

export default async function ManagerTeamPage() {
  const session = await requireManagerLeader();
  const teamMode = session.companyId
    ? await getCompanyTeamVisibility(prisma, session.companyId)
    : false;
  const roster = session.companyId
    ? await listCompanyManagers(prisma, session.companyId)
    : [];

  return (
    <div className='space-y-6'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Команда</h1>
      <TeamVisibilityToggle initial={teamMode} />
      <ManagerRosterPanel roster={roster} />
    </div>
  );
}
```

- [ ] **Step 4: typecheck (ManagerRosterPanel ещё нет — будет Task 17; временно заглушка-импорт допустим, но лучше выполнять Task 17 до typecheck)**

Run: `npm run typecheck` (после Task 17) → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/manager/team.ts src/components/manager/team-visibility-toggle.tsx src/app/manager/team/page.tsx
git commit -m "feat(c8): leader hub page + team-visibility toggle + company roster service"
```

---

## Task 17: ростер-панель (клиент) + admin-контрол выдачи роли

**Files:**
- Create: `src/components/manager/manager-roster-panel.tsx`
- Create: `src/components/admin/manager-role-control.tsx`
- Modify: admin user-detail страница (подключить контрол)

- [ ] **Step 1: Ростер-панель leader'а**

Create `src/components/manager/manager-roster-panel.tsx`:
```tsx
'use client';

import { useTransition } from 'react';
import type { CompanyManagerRow } from '@/lib/services/manager/team';
import { leaderDeactivateAssignmentAction } from '@/server-actions/manager/team';

export function ManagerRosterPanel({ roster }: { roster: CompanyManagerRow[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <section className='space-y-3'>
      <h2 className='text-lg font-medium text-[#111111]'>Менеджеры компании</h2>
      {roster.length === 0 && <p className='text-sm text-gray-600'>Менеджеров пока нет.</p>}
      <ul className='divide-y rounded-lg border'>
        {roster.map((m) => (
          <li key={m.id} className='flex items-center justify-between gap-4 p-3'>
            <div>
              <p className='font-medium text-[#111111]'>
                {m.name}{' '}
                {m.managerRole === 'leader' && (
                  <span className='ml-1 rounded bg-[#F97316] px-2 py-0.5 text-xs text-white'>Руководитель</span>
                )}
              </p>
              <p className='text-sm text-gray-600'>{m.email}</p>
              <p className='text-xs text-gray-500'>
                Организации:{' '}
                {m.assignments.filter((a) => a.isActive).map((a) => a.organizationName).join(', ') || '—'}
              </p>
            </div>
            <div className='flex gap-2'>
              {m.assignments.filter((a) => a.isActive).map((a) => (
                <button
                  key={a.id}
                  type='button'
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const fd = new FormData();
                      fd.set('assignmentId', a.id);
                      await leaderDeactivateAssignmentAction(fd);
                    })
                  }
                  className='rounded-md border px-2 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50'
                >
                  Снять с «{a.organizationName}»
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: admin-контрол выдачи роли**

Create `src/components/admin/manager-role-control.tsx`:
```tsx
'use client';

import { useTransition } from 'react';
import { setManagerRoleAction } from '@/server-actions/admin/manager';

export function ManagerRoleControl({ userId, current }: { userId: string; current: string | null }) {
  const [pending, startTransition] = useTransition();
  const isLeader = current === 'leader';

  function setRole(role: 'leader' | 'member') {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('userId', userId);
      fd.set('role', role);
      await setManagerRoleAction(fd);
    });
  }

  return (
    <div className='flex items-center gap-2'>
      <span className='text-sm text-gray-600'>Роль в кабинете менеджера:</span>
      <span className='font-medium'>{isLeader ? 'Руководитель' : 'Менеджер'}</span>
      <button
        type='button'
        disabled={pending}
        onClick={() => setRole(isLeader ? 'member' : 'leader')}
        className='rounded-md border px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-50'
      >
        {isLeader ? 'Снять руководителя' : 'Назначить руководителем'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Подключить контрол на admin user-detail**

Run: `rg -n "admin/users/\[id\]" src/app` чтобы найти страницу деталей пользователя. На странице (server component), если `user.role === 'manager'`, отрендерить `<ManagerRoleControl userId={user.id} current={user.managerRole} />`. Убедиться, что выборка пользователя включает `managerRole` (добавить в `select`, если нужно — найти в `services/admin/users/queries.ts` `getUser` и добавить `managerRole: true`).

- [ ] **Step 4: typecheck + lint + commit**

Run: `npm run typecheck` → PASS; `npm run lint` → PASS (вкл. eslint `no-restricted-imports` из C3 — server-actions/components импортят сервисы только сверху-вниз, наши импорты валидны).
```bash
git add src/components/manager/manager-roster-panel.tsx src/components/admin/manager-role-control.tsx src/app/admin src/lib/services/admin/users
git commit -m "feat(c8): leader roster panel + admin manager-role control"
```

---

# ФАЗА 4 — Финальный гейт + close-out

## Task 18: полный гейт, ручная проверка, close-out

- [ ] **Step 1: Статические гейты**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: всё PASS.

- [ ] **Step 2: Полный unit-слой**

Run: `npm run test:unit`
Expected: PASS (новые unit-тесты + регресс managerPolicy/политик).

- [ ] **Step 3: Integration-гейт (L2.5)**

Run: `npm run gate` (поднимает Docker-Postgres, migrate+seed, прогоняет integration).
Expected: PASS, особенно `auth.policy.manager-refactor` (OFF + ON + cross-company), `services.manager.*`. Если Docker занят на :5432 — `npm run gate:down` затем повтор, либо ручной Postgres + `npm run test:integration`.

- [ ] **Step 4: Ручная smoke (preview)**

Поднять dev (`npm run dev`), залогиниться менеджером-leader'ом (выдать роль через admin или seed). Проверить: `/manager/team` доступна leader'у, рядовому менеджеру — redirect на dashboard; флип тоггла меняет видимость заказов (включил → видны чужие заказы компании; выключил → только свои); снятие назначения в ростере работает; admin видит контрол роли на `/admin/users/[id]`.

- [ ] **Step 5: Субагент-ревью RBAC-инвариантов**

Dispatch subagent: проверить, что (а) ни один read-сайт не остался на `managerOrderScopeFilter` напрямую (кроме OFF-ветки резолвера) — `rg "managerOrderScopeFilter\(" src/lib/services src/app` должен показывать только использования внутри резолвера/тестов; (б) cross-company изоляция держится в обоих режимах; (в) `requireManagerLeader` гейтит все leader-actions; (г) `setManagerRole` гейтится `requireAdmin` (leader не может выдать роль).

- [ ] **Step 6: Close-out**

Создать `docs/superpowers/plans/2026-06-05-c8-manager-company-wide-DONE.md` (эталон — [partner-cabinet-phase4-DONE.md](2026-05-22-partner-cabinet-phase4-DONE.md)): что отгружено, инварианты, гейты (unit N / integration M / build), gotchas (companyId-null degrade-to-scoped; notifications намеренно scoped; managerRole JWT-producer gotcha). Обновить CLAUDE.md §4 (новая company-граница) и §5/§2, если уместно. Обновить память (project-c8-...).

- [ ] **Step 7: Финальный commit + push**

```bash
git add docs/superpowers/plans/2026-06-05-c8-manager-company-wide-DONE.md CLAUDE.md
git commit -m "docs(c8): close-out — manager company-wide visibility + leader role DONE"
git push -u origin claude/c8-manager-company-wide   # при висящем gate-хуке на :5432 — push --no-verify (см. C5 gotcha)
```
Затем PR в `main` (мердж между сессиями, как C3-C5).

---

## Порядок выполнения и зависимости

- **Фаза 0 (Tasks 1-4)** — строго первой; всё остальное зависит от примитивов.
- **Фаза 1 (Tasks 5-11)** — после Фазы 0; задачи 5-10 независимы между собой (можно параллелить субагентами), Task 11 — после них.
- **Task 15 Step 1 (`requireManagerLeader`)** — выполнить ДО Task 12 Step 7 typecheck (server-action ссылается на guard). На практике: сделать Task 15 Step 1 первым шагом Фазы 2.
- **Фаза 2 (Tasks 12-14)** — после guard.
- **Фаза 3 (Tasks 15-17)** — UI; Task 16 typecheck зелёный только вместе с Task 17 (ManagerRosterPanel).
- **Фаза 4** — финал.

## Самопроверка плана (выполнена)

- **Покрытие спеки:** схема ✓(T1) · JWT+producer ✓(T2-3, gotcha) · mode-aware политика ✓(T4) · fan-out все сайты ✓(T5-10) · cross-company инвариант ✓(T11) · тоггл+audit ✓(T12) · роль admin-only ✓(T13) · leader ростер ✓(T14) · guard+nav ✓(T15) · leader-хаб ✓(T16-17) · notifications НЕ трогаем ✓(явно) · default OFF ✓(T1 `@default(false)`) · freshness per-request ✓(getCompanyTeamVisibility на каждом сайте).
- **Плейсхолдеры:** нет — весь новый код и тесты приведены; правки показаны как точные before→after.
- **Согласованность типов:** `managerOrderScope/managerDocumentScope/managerOrgScope/companyWideOrderFilter/isManagerLeader/getCompanyTeamVisibility` определены в T4 и используются с теми же сигнатурами далее; `canSeeOrder(session, order, teamMode)` — единый 3-й параметр; `setTeamVisibility`/`setManagerRole` сигнатуры совпадают между сервисом, тестом и server-action; `AuditEntity` расширен `'company'` (T12) до использования.
- **Риск companyId=null:** обработан дизайном (getCompanyTeamVisibility→false ⇒ scoped, не deny-all) — отдельный guard не нужен.
