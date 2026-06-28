# Arch-debt: dashboard services own their return types (§2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reverse the dependency arrow for 7 dashboard return-types so the owning service defines them and the presentational component imports them down (restores CLAUDE.md §2).

**Architecture:** Pure type-only relocation. Each `export type X = {…}` moves from a component into the dashboard service that produces it; the component replaces its definition with `import type { X } from '@/lib/services/<role>/dashboard'`. No runtime change — `import type` is erased at compile time, so a client component importing from a server service pulls no runtime into the bundle. Verified entirely by `tsc`.

**Tech Stack:** TypeScript 5 (strict), Next.js 15, Vitest. Gate = `npm run typecheck` + `npm run lint` + existing dashboard unit tests.

**Spec:** [2026-05-31-arch-debt-dashboard-types-design](../specs/2026-05-31-arch-debt-dashboard-types-design.md) · **Track:** C / C3 from [completion-roadmap](../specs/2026-06-02-completion-roadmap.md).

**Scope note (verified against current main `13416fa`):** These 6 imports are the *only* `services → components` imports in the entire `src/lib/services/` tree. Each of the 7 types is referenced solely by its owning component + owning service (dashboard pages import the component *functions*, not the types). `admin/dashboard.ts` defines its own same-named `AttentionItem`/`EventItem` — **different module, out of scope, do not touch.**

---

### Task 1: Organization dashboard service owns its 4 types

Move `OrgDashboardKpis`, `OrgAttentionItem`, `OrgAttention`, `OrgEvent` into the org dashboard service; flip the 3 component imports down. (`OrgAttention` nests `OrgAttentionItem`; they live in the same component and move together.)

**Files:**
- Modify: `src/lib/services/organization/dashboard.ts:2-4` (replace 3 import-up lines with type definitions)
- Modify: `src/components/organization/org-kpi-grid.tsx:3-8` (def → import)
- Modify: `src/components/organization/org-attention-list.tsx:3-14` (def → import)
- Modify: `src/components/organization/org-events-feed.tsx:3-9` (def → import)

- [ ] **Step 1: Replace the 3 import-up lines in the service with the type definitions**

In `src/lib/services/organization/dashboard.ts`, replace lines 2-4:

```ts
import type { OrgDashboardKpis } from '@/components/organization/org-kpi-grid';
import type { OrgAttention, OrgAttentionItem } from '@/components/organization/org-attention-list';
import type { OrgEvent } from '@/components/organization/org-events-feed';
```

with:

```ts

export type OrgDashboardKpis = {
  activeOrders: number;
  outstandingAmount: string;
  studentsCount: number;
  recentDocumentsCount: number;
};

export type OrgAttentionItem = {
  id: string;
  kind: 'billed_unpaid' | 'unsigned_act' | 'completed_open';
  orderId: string;
  title: string;
  meta?: string;
  severity: 'warn' | 'urgent';
};

export type OrgAttention = {
  items: OrgAttentionItem[];
};

export type OrgEvent = {
  id: string;
  kind: 'document_published' | 'payment_received' | 'order_status_changed' | 'comment_posted';
  orderId: string;
  title: string;
  at: Date;
};
```

(Line 1, `import type { PrismaClient } from '@prisma/client';`, stays.)

- [ ] **Step 2: Flip `org-kpi-grid.tsx` — replace the type def with an import**

In `src/components/organization/org-kpi-grid.tsx`, replace lines 3-8:

```ts
export type OrgDashboardKpis = {
  activeOrders: number;
  outstandingAmount: string;
  studentsCount: number;
  recentDocumentsCount: number;
};
```

with:

```ts
import type { OrgDashboardKpis } from '@/lib/services/organization/dashboard';
```

(Place the import directly under the existing `import { StatCard }` line so all imports sit together.)

- [ ] **Step 3: Flip `org-attention-list.tsx` — replace both type defs with one import**

In `src/components/organization/org-attention-list.tsx`, replace lines 3-14 (the `OrgAttentionItem` + `OrgAttention` defs) with:

```ts
import type { OrgAttention, OrgAttentionItem } from '@/lib/services/organization/dashboard';
```

(The component uses `OrgAttentionItem` in `Record<OrgAttentionItem['kind'], string>` (type-position) and `OrgAttention` in the function signature — both names must be imported. Place under the existing `import Link` line.)

- [ ] **Step 4: Flip `org-events-feed.tsx` — replace the type def with an import**

In `src/components/organization/org-events-feed.tsx`, replace lines 3-9 (the `OrgEvent` def) with:

```ts
import type { OrgEvent } from '@/lib/services/organization/dashboard';
```

(Place under the existing `import Link` line.)

- [ ] **Step 5: Typecheck the org side**

Run: `npm run typecheck`
Expected: PASS (0 errors). If `tsc` complains about a missing name, a def/import block was mis-edited.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/organization/dashboard.ts src/components/organization/org-kpi-grid.tsx src/components/organization/org-attention-list.tsx src/components/organization/org-events-feed.tsx
git commit -m "refactor(org): dashboard service owns its return types (restores §2)"
```

---

### Task 2: Manager dashboard service owns its 3 types

Move `KpiData`, `AttentionItem`, `EventItem` into the manager dashboard service; flip the 3 component imports down.

**Files:**
- Modify: `src/lib/services/manager/dashboard.ts:4-6` (replace 3 import-up lines with type definitions)
- Modify: `src/components/manager/manager-kpi-grid.tsx:3-9` (def → import)
- Modify: `src/components/manager/manager-attention-list.tsx:3-9` (def → import)
- Modify: `src/components/manager/manager-events-feed.tsx:3-9` (def → import)

- [ ] **Step 1: Replace the 3 import-up lines in the service with the type definitions**

In `src/lib/services/manager/dashboard.ts`, replace lines 4-6:

```ts
import type { KpiData } from '@/components/manager/manager-kpi-grid';
import type { AttentionItem } from '@/components/manager/manager-attention-list';
import type { EventItem } from '@/components/manager/manager-events-feed';
```

with:

```ts

export type KpiData = {
  activeOrders: number;
  activeOrdersDelta: number;
  attentionCount: number;
  unreadComments: number;
  urgentDeadlines: number;
};

export type AttentionItem = {
  id: string;
  kind: string;
  severity: 'warn' | 'urgent';
  message: string;
  href: string;
};

export type EventItem = {
  id: string;
  kind: string;
  when: Date;
  text: string;
  href?: string;
};
```

(Lines 1-3 — `PrismaClient`, `SessionPayload`, `managerOrderScopeFilter` — stay.)

- [ ] **Step 2: Flip `manager-kpi-grid.tsx` — replace the type def with an import**

In `src/components/manager/manager-kpi-grid.tsx`, replace lines 3-9 (the `KpiData` def) with:

```ts
import type { KpiData } from '@/lib/services/manager/dashboard';
```

(Place under the existing `import { StatCard }` line.)

- [ ] **Step 3: Flip `manager-attention-list.tsx` — replace the type def with an import**

In `src/components/manager/manager-attention-list.tsx`, replace lines 3-9 (the `AttentionItem` def) with:

```ts
import type { AttentionItem } from '@/lib/services/manager/dashboard';
```

(Place under the existing `import Link` line.)

- [ ] **Step 4: Flip `manager-events-feed.tsx` — replace the type def with an import**

In `src/components/manager/manager-events-feed.tsx`, replace lines 3-9 (the `EventItem` def) with:

```ts
import type { EventItem } from '@/lib/services/manager/dashboard';
```

(Place under the existing `import Link` line.)

- [ ] **Step 5: Typecheck the manager side**

Run: `npm run typecheck`
Expected: PASS (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/manager/dashboard.ts src/components/manager/manager-kpi-grid.tsx src/components/manager/manager-attention-list.tsx src/components/manager/manager-events-feed.tsx
git commit -m "refactor(manager): dashboard service owns its return types (restores §2)"
```

---

### Task 3: Full gate — lint + typecheck + dashboard tests

No new behavior, so no new tests (spec: `tsc` fully verifies a type-only move). Confirm the whole gate is green and that zero `services → components` imports remain.

**Files:** none (verification only).

- [ ] **Step 1: Confirm no service still imports from components**

Run: `rg -n "from '@/components" src/lib/services/`
Expected: no output (exit 1). Any hit means a def/import flip was missed.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (0 errors).

- [ ] **Step 3: Lint (catches any now-unused import left behind)**

Run: `npm run lint`
Expected: PASS, no warnings about unused `Link`/`StatCard`/types.

- [ ] **Step 4: Existing dashboard unit tests stay green (behavior unchanged)**

Run: `npm run test:unit -- dashboard`
Expected: PASS — `services.manager.dashboard.test.ts` and any org-dashboard test resolve types from the new home and behave identically.

- [ ] **Step 5: Commit (only if Steps 1-4 produced any follow-up edit; otherwise skip)**

```bash
git add -A
git commit -m "chore(arch): verify §2 dependency direction restored for dashboards"
```

---

## Self-Review

- **Spec coverage:** All 7 types from the spec's table have a move task (Task 1 = 4 org types, Task 2 = 3 manager types). Gate (typecheck + lint + existing tests) = Task 3. ✓
- **Placeholder scan:** Every code step shows the exact before/after blocks (verified against current source on `13416fa`). No TBD/TODO. ✓
- **Type consistency:** Field shapes copied verbatim from the components; `OrgAttention.items: OrgAttentionItem[]` nested dep moves with it; manager `AttentionItem`/`EventItem` are distinct from the unrelated `admin/dashboard.ts` types (different module). ✓
- **Out of scope (do not touch):** type renames; `admin/dashboard.ts`; error-contract (#2); service splits (#3); any new ESLint guardrail (offered separately as an optional follow-up).
