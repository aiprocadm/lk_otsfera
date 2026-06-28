# Arch-debt C5: split bloated services — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split three bloated modules — `notifications.ts` (693), `admin/users.ts` (442), `manager/dashboard.ts` (376) — into focused submodules behind an `index.ts` barrel, with **byte-identical public surface and behavior** (existing tests are the contract and must stay green, untouched).

**Architecture:** Pure **move-only** refactor. Each file becomes a directory `<name>/` containing focused submodules + an `index.ts` barrel that re-exports today's public surface via `export *`. Import specifiers (`@/lib/notifications`, `@/lib/services/admin/users`, `@/lib/services/manager/dashboard`) are unchanged — a directory resolves to its `index.ts`, so all ~20 callers and every test stay untouched. Internal helpers stay non-`export`ed inside submodules (or in a private `shared`/`constants` module the barrel does NOT re-export). Mirrors the repo's existing `oneCSync/` + `email/templates/` barrel convention (CLAUDE.md §13). Full per-symbol detail in the **[spec](../specs/2026-06-05-c5-split-bloated-services-design.md)**.

**Tech Stack:** TypeScript 5 (strict, inline `type` import modifiers per existing files). Gate = `npm run typecheck` (barrel must reproduce the exact typed surface or ~20 callers fail) + `npm run lint` (incl. C3 `no-restricted-imports` guardrail) + targeted unit/integration tests + `npm run build`.

**Atomicity note:** each file's split lands in ONE commit (new submodules + `index.ts` + deletion of the old file together) — deleting the old file without the barrel breaks `tsc` and the pre-commit hook blocks it.

**Move convention:** "Move `symbolName` (lines A–B)" means cut that symbol's body **verbatim, unchanged** from the current file into the target submodule. Do not edit moved bodies. Only new code (import headers + barrels) is shown in full below.

---

### Task 0: Baseline (prove green before touching anything)

**Files:** none (read-only).

- [ ] **Step 1:** Confirm branch + clean tree.

Run: `git branch --show-current` → `claude/c5-split-bloated-services`; `git status --short` → empty.

- [ ] **Step 2:** Capture baseline green (branch is off fresh green `main` 3392625).

Run: `npm run typecheck` → PASS. `npm run lint` → PASS.

- [ ] **Step 3:** Capture touched-test baseline counts (so "same N green" is concrete after).

Run: `npm run test:unit -- services.admin.users server-actions.admin.users components.admin-users-table`
Expected: PASS — record file/test counts.

> Integration baseline is implied by green `main`; it is re-validated in Tasks 1/3 and the final gate.

---

### Task 1: Split `src/lib/notifications.ts` → `notifications/` (by audience)

**Files:**
- Create: `src/lib/notifications/shared.ts`
- Create: `src/lib/notifications/core.ts`
- Create: `src/lib/notifications/org.ts`
- Create: `src/lib/notifications/manager.ts`
- Create: `src/lib/notifications/index.ts`
- Delete: `src/lib/notifications.ts`
- Untouched (verify): all ~10 callers + `notifications.*` tests

- [ ] **Step 1: Create `shared.ts`** — move `getAppBaseUrl` (lines 152–154) and `orderLabel` (lines 156–158) verbatim. No imports. Both `export`ed (siblings import them; the barrel will NOT re-export this module).

```ts
// src/lib/notifications/shared.ts
export function getAppBaseUrl(): string {
  return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
}

export function orderLabel(orderNumber: string | null, orderTitle: string): string {
  return orderNumber ? `№ ${orderNumber}` : `«${orderTitle}»`;
}
```

- [ ] **Step 2: Create `core.ts`** — header below, then move `NotificationInput` (27–35, keep NON-exported), `createNotification` (37–44), `notifyDocumentCreated` (46–48), `notifyStatusChanged` (50–52), `notifyMessageCreated` (54–56), `triggerNotificationEmail` (58–86) verbatim.

```ts
// src/lib/notifications/core.ts
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { sendNotificationEmail } from '@/lib/email/send';
import { isEmailEnabled } from '@/lib/email/transport';
```

- [ ] **Step 3: Create `org.ts`** — header below, then move `OrgNotifyInput` (90–144, NON-exported), `NotifyOrgUsersSummary` (146–150, exported), `buildOrgNotification` (160–239, NON-exported), `dispatchOrgEmail` (241–300, NON-exported), `notifyOrgUsers` (302–374, exported) verbatim. (The `// ----- Organization-side` comment may come along.)

```ts
// src/lib/notifications/org.ts
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  sendNotificationEmail,
  sendOrgDocumentPublishedEmail,
  sendOrgManagerRepliedEmail,
  sendOrgOrderStatusChangedEmail,
  sendOrgPaymentReceivedEmail,
  type SendResult,
} from '@/lib/email/send';
import { getAppBaseUrl, orderLabel } from './shared';
```

- [ ] **Step 4: Create `manager.ts`** — header below, then move `NotifyManagersType` (378–383), `NotifyManagersInput` (385–427), `NotifyManagersOptions` (429), `NotifyManagersSummary` (431–435), `ManagerRecipient` (437–441) [all exported], `resolveManagerRecipients` (443–498, exported), `OrderContext` (500–505, NON-exported), `ManagerNotificationOutput` (507–511, NON-exported), `MANAGER_TEMPLATES` (513–598, NON-exported), `getManagerOrderUrl` (600–602, NON-exported), `metaFromInput` (604–612, NON-exported), `notifyManagers` (614–693, exported) verbatim.

```ts
// src/lib/notifications/manager.ts
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  sendManagerCommentFromOrgEmail,
  sendManagerDocumentUploadedByOrgEmail,
  sendManagerOrderMarkedPaidBy1CEmail,
  sendManagerOrderStatusChangedEmail,
  sendNotificationEmail,
  type SendResult,
} from '@/lib/email/send';
import {
  managerCommentFromOrgSubject,
  managerCommentFromOrgText,
  managerDocumentUploadedByOrgSubject,
  managerDocumentUploadedByOrgText,
  managerOrderMarkedPaidBy1CSubject,
  managerOrderMarkedPaidBy1CText,
  managerOrderStatusChangedSubject,
  managerOrderStatusChangedText,
} from '@/lib/email/templates';
import { getAppBaseUrl, orderLabel } from './shared';
```

- [ ] **Step 5: Create `index.ts` barrel.**

```ts
// src/lib/notifications/index.ts
export * from './core';
export * from './org';
export * from './manager';
```

- [ ] **Step 6: Delete the old file.**

Run: `git rm src/lib/notifications.ts`

- [ ] **Step 7: Typecheck** (proves the barrel reproduced the exact surface for all callers).

Run: `npm run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 8: No deep-import bypass.**

Run: `rg -n "from '@/lib/notifications/(core|org|manager|shared)'" src --glob '!src/lib/notifications/**'`
Expected: no matches.

- [ ] **Step 9: Run notifications contract tests (unit + integration).**

Run: `npm run test:integration -- notifications.notifyManagers notifications.notifyOrgUsers notifications.invariant`
Then: `npm run test:unit -- api.notifications.manager-refactor api.comments worker.notification-hooks`
Expected: PASS, same counts as before. (Tests were not modified.)

- [ ] **Step 10: Verify the diff is a pure move** — no caller/test changed.

Run: `git add -A && git status --short`
Expected: only `D src/lib/notifications.ts` + 5 new `A src/lib/notifications/*.ts`. No other paths.

- [ ] **Step 11: Commit.**

```bash
git commit -m "refactor(notifications): split 693-line module into core/org/manager submodules + barrel (C5)"
```

---

### Task 2: Split `src/lib/services/admin/users.ts` → `users/` (reads vs writes)

**Files:**
- Create: `src/lib/services/admin/users/errors.ts`
- Create: `src/lib/services/admin/users/queries.ts`
- Create: `src/lib/services/admin/users/mutations.ts`
- Create: `src/lib/services/admin/users/index.ts`
- Delete: `src/lib/services/admin/users.ts`
- Untouched (verify): `server-actions/admin/users.ts`, `admin/partners.ts`, admin pages/components, `services.admin.users.test.ts`, `server-actions.admin.users.test.ts`, `components.admin-users-table.test.tsx`

- [ ] **Step 1: Create `errors.ts`** — move `AdminUserErrorCode` (5–12), `AdminUserError` (14–21), `AdminUserFailure` (23) verbatim. No imports. All exported (internal throw-mechanism from C4, still part of the surface).

- [ ] **Step 2: Create `queries.ts`** — header below, then move `UserDetail` (25–40, exported), `getUser` (42–83, exported), `UserFilters` (336–344, exported), `UserRow` (346–354, exported), `computeAttachmentLabel` (356–374, NON-exported), `listUsers` (376–442, exported) verbatim.

```ts
// src/lib/services/admin/users/queries.ts
import type { PrismaClient, Prisma, Role } from '@prisma/client';
```

- [ ] **Step 3: Create `mutations.ts`** — header below, then move `CreateUserArgs` (85–90), `CreateUserResult` (92–95), `createUser` (97–160), `assertNotLastActiveAdmin` (162–172, NON-exported), `UpdateUserArgs` (174–179), `ALLOWED_TRANSITIONS` (181–185, NON-exported), `isAllowedRoleTransition` (187–190, NON-exported), `updateUser` (192–264), `deactivateUser` (266–302), `reactivateUser` (304–334) verbatim. (`createUser`/`updateUser`/`deactivate`/`reactivate` + the 3 Args/Result types exported; helpers private.)

```ts
// src/lib/services/admin/users/mutations.ts
import type { PrismaClient, Prisma, Role } from '@prisma/client';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { recordAudit } from '@/lib/auth/audit';
import { AdminUserError, type AdminUserFailure } from './errors';
import { getUser, type UserDetail } from './queries';
```

> `updateUser` calls `getUser` (was line 256) and returns `{ ok: true; user: UserDetail }` — both now come from `./queries`. One-way dependency, no cycle.

- [ ] **Step 4: Create `index.ts` barrel.**

```ts
// src/lib/services/admin/users/index.ts
export * from './errors';
export * from './queries';
export * from './mutations';
```

- [ ] **Step 5: Delete the old file.**

Run: `git rm src/lib/services/admin/users.ts`

- [ ] **Step 6: Typecheck.**

Run: `npm run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 7: No deep-import bypass.**

Run: `rg -n "from '@/lib/services/admin/users/(errors|queries|mutations)'" src --glob '!src/lib/services/admin/users/**'`
Expected: no matches.

- [ ] **Step 8: Run admin/users contract tests (unit-only — no integration exists).**

Run: `npm run test:unit -- services.admin.users server-actions.admin.users components.admin-users-table`
Expected: PASS, same counts as Task 0 baseline.

- [ ] **Step 9: Verify pure-move diff.**

Run: `git add -A && git status --short`
Expected: only `D .../users.ts` + 4 new `A .../users/*.ts`.

- [ ] **Step 10: Commit.**

```bash
git commit -m "refactor(admin): split users service into queries/mutations/errors + barrel (C5)"
```

---

### Task 3: Split `src/lib/services/manager/dashboard.ts` → `dashboard/` (by widget)

**Files:**
- Create: `src/lib/services/manager/dashboard/constants.ts`
- Create: `src/lib/services/manager/dashboard/kpis.ts`
- Create: `src/lib/services/manager/dashboard/attention.ts`
- Create: `src/lib/services/manager/dashboard/events.ts`
- Create: `src/lib/services/manager/dashboard/index.ts`
- Delete: `src/lib/services/manager/dashboard.ts`
- Untouched (verify): `manager/dashboard/page.tsx`, `manager-{kpi-grid,events-feed,attention-list}.tsx`, `services.manager.dashboard.test.ts`

- [ ] **Step 1: Create `constants.ts`** — move lines 29–39 verbatim (`DAY_MS`, `THIRTY_DAYS_MS`, `FOURTEEN_DAYS_MS`, `THREE_DAYS_MS`, `ONE_DAY_MS`, `ATTENTION_CAP_PER_SOURCE`, `DEFAULT_EVENTS`, `ACTIVE_EXEC`, `TERMINAL_EXEC`). Add `export` to each `const` (siblings import them; barrel does NOT re-export this module). Keep the `ExecutionStatus` comment.

```ts
// src/lib/services/manager/dashboard/constants.ts
const DAY_MS = 24 * 60 * 60 * 1000;
export const THIRTY_DAYS_MS = 30 * DAY_MS;
export const FOURTEEN_DAYS_MS = 14 * DAY_MS;
export const THREE_DAYS_MS = 3 * DAY_MS;
export const ONE_DAY_MS = 1 * DAY_MS;
export const ATTENTION_CAP_PER_SOURCE = 10;
export const DEFAULT_EVENTS = 15;

// ExecutionStatus enum: pending | in_progress | completed | cancelled | on_hold
export const ACTIVE_EXEC = ['pending', 'in_progress'] as const;
export const TERMINAL_EXEC = ['completed', 'cancelled'] as const;
```

> `DAY_MS` stays a private base const (only used to derive the others here).

- [ ] **Step 2: Create `kpis.ts`** — header below, then move `KpiData` (5–11, exported) + `kpis` (41–107, exported) verbatim.

```ts
// src/lib/services/manager/dashboard/kpis.ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';
import { THIRTY_DAYS_MS, THREE_DAYS_MS, ACTIVE_EXEC, TERMINAL_EXEC } from './constants';
```

- [ ] **Step 3: Create `attention.ts`** — header below, then move `AttentionItem` (13–19, exported) + `attention` (109–265, exported) verbatim.

```ts
// src/lib/services/manager/dashboard/attention.ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';
import {
  ONE_DAY_MS,
  THREE_DAYS_MS,
  FOURTEEN_DAYS_MS,
  ATTENTION_CAP_PER_SOURCE,
  TERMINAL_EXEC,
} from './constants';
```

- [ ] **Step 4: Create `events.ts`** — header below, then move `EventItem` (21–27, exported) + `recentEvents` (267–397, exported) verbatim.

```ts
// src/lib/services/manager/dashboard/events.ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';
import { DEFAULT_EVENTS } from './constants';
```

- [ ] **Step 5: Create `index.ts` barrel.**

```ts
// src/lib/services/manager/dashboard/index.ts
export * from './kpis';
export * from './attention';
export * from './events';
```

- [ ] **Step 6: Delete the old file.**

Run: `git rm src/lib/services/manager/dashboard.ts`

- [ ] **Step 7: Typecheck.**

Run: `npm run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 8: No deep-import bypass.**

Run: `rg -n "from '@/lib/services/manager/dashboard/(kpis|attention|events|constants)'" src --glob '!src/lib/services/manager/dashboard/**'`
Expected: no matches.

- [ ] **Step 9: Run dashboard contract tests (integration + component unit).**

Run: `npm run test:integration -- services.manager.dashboard`
Then: `npm run test:unit -- manager-kpi-grid manager-events-feed manager-attention-list`
Expected: PASS, same counts as before.

- [ ] **Step 10: Verify pure-move diff.**

Run: `git add -A && git status --short`
Expected: only `D .../dashboard.ts` + 5 new `A .../dashboard/*.ts`.

- [ ] **Step 11: Commit.**

```bash
git commit -m "refactor(manager): split dashboard service into kpis/attention/events + barrel (C5)"
```

---

### Task 4: Full gate + docs + close-out

**Files:**
- Modify: `CLAUDE.md` (§2 layer map: note `notifications` is now a directory)
- Create: `docs/superpowers/plans/2026-06-05-c5-split-bloated-services-DONE.md`

- [ ] **Step 1: Lint** (incl. C3 `no-restricted-imports` services guardrail — the move must not violate it).

Run: `npm run lint`
Expected: PASS, 0 errors.

- [ ] **Step 2: Full unit suite.**

Run: `npm run test:unit`
Expected: PASS — 1082 (same as C4 close-out; no tests added/removed).

- [ ] **Step 3: Integration for all touched areas.**

Run: `npm run test:integration -- notifications admin.users manager.dashboard comments`
Expected: PASS.

- [ ] **Step 4: Build.**

Run: `npm run build`
Expected: compiles, 0 errors.

- [ ] **Step 5: Update `CLAUDE.md` §2** — change the layer-map line `src/lib/notifications.ts ← …` to reflect the directory. Replace the file ref with `src/lib/notifications/ ← notifyManagers/notifyOrgUsers + email-dispatch (barrel: index.ts)`.

- [ ] **Step 6: Independent subagent review** — dispatch a review: "Verify C5 is a pure move-only refactor: (a) `git diff main...HEAD -- '*.ts'` shows only relocations, no body edits; (b) no caller or test file changed; (c) barrels re-export exactly the prior public surface, internal helpers (`getAppBaseUrl`, `orderLabel`, `computeAttachmentLabel`, `assertNotLastActiveAdmin`, `isAllowedRoleTransition`, `MANAGER_TEMPLATES`, dashboard constants) are not leaked through any barrel; (d) no import cycles." Address any finding.

- [ ] **Step 7: Commit docs + write close-out** per CLAUDE.md §8 (companion to plan; reference [partner-cabinet-phase4-DONE](2026-05-22-partner-cabinet-phase4-DONE.md) format).

```bash
git add CLAUDE.md docs/superpowers/plans/2026-06-05-c5-split-bloated-services-DONE.md
git commit -m "docs(arch): close-out — split bloated services DONE (C5)"
```

- [ ] **Step 8: Finish the branch** — REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch (verify all green, present merge/PR options).

---

## Self-Review

- **Spec coverage:** all three files (spec §3.1/3.2/3.3) → Tasks 1/2/3; verification (spec §4) → per-task steps + Task 4 gate; CLAUDE.md §2 note (spec §5) → Task 4 Step 5. ✓
- **Placeholders:** none — every new file (barrels, import headers) shown in full; moves specified by exact symbol + line range (bodies copied verbatim, not re-pasted, since they are unchanged existing code). ✓
- **Type consistency:** barrel `export *` reproduces today's exports; submodule headers import exactly what each moved symbol uses (cross-checked against the reads); `mutations → queries/errors`, dashboard widgets → `constants` are the only new internal edges, all acyclic. ✓
- **Behavior preserved:** callers + tests untouched (verified by per-task `git status` shape check + final subagent review); move-only by construction. ✓
- **Out of scope:** signature/code/status/text changes, caller repointing, query/perf tweaks, test rewrites. ✓
