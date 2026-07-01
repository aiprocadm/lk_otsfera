# Track B (P1) — Universal orders, completion, approval loop, distribution, limits

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `Order` behaviour in line with ТЗ v0.5/v0.6 Track B — a universal `serviceType`, an explicit lifecycle state machine on the dormant `OrderStatus` axis (guarded completion + `waiting_client` return-with-reason), attachment-based distribution + self-assign, and enforced org/partner user limits.

**Architecture:**
- The `Order.status` (`OrderStatus`) axis is currently **dormant** (never written). We activate it as the **approval/lifecycle** state machine via a new service `manager/orderLifecycle.ts` with an **explicit allowed-transitions map**. The operational `executionStatus` machine (`manager/status.ts`) and all commission/money logic are **left untouched**.
- Completion is a pure evaluator over a loaded order (`orders/completion.ts`), driven by `serviceType`.
- Distribution is a small service family (`manager/distribution.ts`): pure resolver + attachment auto-assign + shared manual-assign (admin & leader) + manager self-assign guard.
- Limits live as config constants (`config/teamLimits.ts`) enforced inside the two `inviteMember` chokepoints.

**Tech Stack:** Next.js 15 App Router · TypeScript strict · Prisma 5 + PostgreSQL · Vitest (unit + integration). Result-type service contract (§3 CLAUDE.md). Reversible additive migrations.

---

## File Structure

**Schema / migrations**
- `prisma/schema.prisma` — add enum `ServiceType`; `Order.serviceType`, `Order.accountingSignedAt`, `Order.returnReason`.
- `prisma/migrations/<ts>_order_service_type/` — B1.
- `prisma/migrations/<ts>_order_completion_fields/` — B2 (`accountingSignedAt`).
- `prisma/migrations/<ts>_order_return_reason/` — B3 (`returnReason`).

**Services (new)**
- `src/lib/orders/completion.ts` — pure completion evaluator (`evaluateOrderCompletion`).
- `src/lib/services/manager/orderLifecycle.ts` — `OrderStatus` state machine (B2 + B3).
- `src/lib/services/manager/distribution.ts` — B4 resolver + auto-assign + manual-assign + self-assign.
- `src/lib/config/teamLimits.ts` — B5 limit constants.

**Services (modified)**
- `src/lib/services/organization/team.ts` — enforce org limit in `inviteMember`; add `member_limit_reached` code.
- `src/lib/services/partner/team.ts` — enforce partner limit in `inviteMember`; add `member_limit_reached` code.
- `src/lib/services/admin/users/mutations.ts` — enforce partner limit when `createUser` attaches a partner user (same chokepoint family).

**Server-actions (new/modified)**
- `src/server-actions/manager/claimOrder.ts` — self-assign (new).
- `src/server-actions/manager/assignOrderManager.ts` — leader manual-assign (new, thin).
- `src/server-actions/admin/manager.ts` — refactor `assignOrderManagerAction` to call the shared `assignOrderManager` service.

**Tests (new)**
- `src/__tests__/orders.completion.unit.test.ts`
- `src/__tests__/services.manager.orderLifecycle.integration.test.ts`
- `src/__tests__/services.manager.distribution.integration.test.ts`
- `src/__tests__/services.team.limits.integration.test.ts`
- `src/__tests__/config.teamLimits.unit.test.ts`

---

## B1 — Universal service type

### Task 1: `ServiceType` enum + `Order.serviceType`

**Files:** Modify `prisma/schema.prisma`; migration `order_service_type`.

- [ ] **Step 1:** Add enum + field.

```prisma
enum ServiceType {
  training
  document_development
}
```
On `Order` (after `productMix`):
```prisma
  serviceType      ServiceType               @default(training)
```

- [ ] **Step 2:** `npx prisma migrate dev --name order_service_type` (or craft SQL: `CREATE TYPE "ServiceType" AS ENUM ('training','document_development'); ALTER TABLE "Order" ADD COLUMN "serviceType" "ServiceType" NOT NULL DEFAULT 'training';`). Existing rows default to `training` — training flow unchanged. Reversible (drop column + drop type).
- [ ] **Step 3:** `npm run prisma:generate`, `npm run typecheck`.
- [ ] **Step 4:** Commit `feat(order): add serviceType (default training) [B1]`.

`isTrainingOrder(serviceType)` helper lives in `orders/completion.ts` (Task 2) — the single consumer of the training branch.

---

## B2 — Completion by all conditions

### Task 2: Pure completion evaluator

**Files:** Create `src/lib/orders/completion.ts`; test `src/__tests__/orders.completion.unit.test.ts`.

Conditions (grounded in schema):
1. `documents_uploaded` — at least one order `Document` with `scanStatus === 'clean'`.
2. `accounting_signed` — `Order.accountingSignedAt != null` (manager checkbox, §21).
3. `certificates_issued` — **training only**: ≥1 `OrderItem` and every item `trainingStatus === 'certificate_issued'`.

- [ ] **Step 1 (failing test):**

```ts
import { describe, it, expect } from 'vitest';
import { evaluateOrderCompletion } from '@/lib/orders/completion';

const base = {
  serviceType: 'training' as const,
  accountingSignedAt: new Date(),
  documents: [{ scanStatus: 'clean' }],
  items: [{ trainingStatus: 'certificate_issued' as const }]
};

describe('evaluateOrderCompletion', () => {
  it('ready when all training conditions met', () => {
    expect(evaluateOrderCompletion(base)).toEqual({ ready: true, unmet: [] });
  });
  it('blocks when no clean scan', () => {
    const r = evaluateOrderCompletion({ ...base, documents: [{ scanStatus: 'pending' }] });
    expect(r.ready).toBe(false);
    expect(r.unmet).toContain('documents_uploaded');
  });
  it('blocks when accounting not signed', () => {
    const r = evaluateOrderCompletion({ ...base, accountingSignedAt: null });
    expect(r.unmet).toContain('accounting_signed');
  });
  it('blocks when a certificate is not issued (training)', () => {
    const r = evaluateOrderCompletion({ ...base, items: [{ trainingStatus: 'pending' }] });
    expect(r.unmet).toContain('certificates_issued');
  });
  it('blocks when training order has no items', () => {
    const r = evaluateOrderCompletion({ ...base, items: [] });
    expect(r.unmet).toContain('certificates_issued');
  });
  it('skips certificate check for non-training serviceType', () => {
    const r = evaluateOrderCompletion({
      ...base, serviceType: 'document_development', items: []
    });
    expect(r.ready).toBe(true);
  });
});
```

- [ ] **Step 2:** Run — FAIL (module missing).
- [ ] **Step 3 (implement):**

```ts
import type { ServiceType, TrainingStatus } from '@prisma/client';

export type CompletionCondition =
  | 'documents_uploaded'
  | 'accounting_signed'
  | 'certificates_issued';

export type OrderCompletionInput = {
  serviceType: ServiceType;
  accountingSignedAt: Date | null;
  documents: ReadonlyArray<{ scanStatus: string }>;
  items: ReadonlyArray<{ trainingStatus: TrainingStatus }>;
};

export function isTrainingOrder(serviceType: ServiceType): boolean {
  return serviceType === 'training';
}

export function evaluateOrderCompletion(
  order: OrderCompletionInput
): { ready: boolean; unmet: CompletionCondition[] } {
  const unmet: CompletionCondition[] = [];
  if (!order.documents.some((d) => d.scanStatus === 'clean')) unmet.push('documents_uploaded');
  if (order.accountingSignedAt === null) unmet.push('accounting_signed');
  if (isTrainingOrder(order.serviceType)) {
    const allIssued =
      order.items.length > 0 && order.items.every((i) => i.trainingStatus === 'certificate_issued');
    if (!allIssued) unmet.push('certificates_issued');
  }
  return { ready: unmet.length === 0, unmet };
}
```

- [ ] **Step 4:** Run — PASS. `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(order): pure completion evaluator [B2]`.

### Task 3: `Order.accountingSignedAt` migration

**Files:** `prisma/schema.prisma`; migration `order_completion_fields`.

- [ ] Add `accountingSignedAt DateTime?` to `Order`. Migrate (`ALTER TABLE "Order" ADD COLUMN "accountingSignedAt" TIMESTAMP(3);`). Nullable — safe for existing rows, reversible. `prisma:generate`, `typecheck`, commit.

### Task 4: Lifecycle service — completion guard + reopen (B2)

**Files:** Create `src/lib/services/manager/orderLifecycle.ts`; integration test `services.manager.orderLifecycle.integration.test.ts` (also covers B3).

Explicit transition map on `Order.status` (`OrderStatus`):
```
new           → in_progress
in_progress   → waiting_client | completed
waiting_client→ in_progress
completed     → in_progress          (reopen; audited)
```

Service `transitionOrderLifecycle(prisma, session, { orderId, to, reason? })` → Result:
- errors: `'not_found' | 'forbidden' | 'invalid_transition' | 'completion_conditions_unmet' | 'reason_required'`.
- auth: `getCompanyTeamVisibility` + `canSeeOrder` (mirror `manager/status.ts`).
- `to === 'completed'`: load `serviceType, accountingSignedAt, documents{scanStatus}, items{trainingStatus}`; `evaluateOrderCompletion`; if not ready → `{ ok:false, error:'completion_conditions_unmet', unmet }`.
- `to === 'waiting_client'`: require non-empty `reason` (else `reason_required`); store `returnReason` (Task 6).
- leaving `waiting_client` → clear `returnReason` to `null`.
- audit `order_lifecycle_changed` with before/after (+ reason). Reopen (`completed → in_progress`) audited the same way.

- [ ] **Step 1 (failing integration tests):** in a real-`PrismaClient` file — seed Company/Org/Order; assert:
  - `new → in_progress` ok.
  - `in_progress → completed` blocked (`completion_conditions_unmet`, unmet lists the gaps) when conditions unmet.
  - after attaching a clean doc, setting `accountingSignedAt`, and issuing all certs → `completed` ok; `AuditLog` row `order_lifecycle_changed` exists.
  - `completed → in_progress` ok and audited (reopen).
  - `in_progress → waiting_client` without reason → `reason_required`; with reason → ok and `returnReason` persisted.
  - `waiting_client → in_progress` clears `returnReason`.
  - illegal jump (e.g. `new → completed`) → `invalid_transition`.
  - foreign order the manager can't see → `forbidden`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement per interface above (allowed-transitions object literal; no direct `update({status})` outside this service).
- [ ] **Step 4:** Run — PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** Commit `feat(order): lifecycle state machine w/ guarded completion + reopen [B2]`.

### Task 5: Manager checkbox — `setOrderAccountingSigned`

**Files:** add to `orderLifecycle.ts` (or a sibling); covered by the integration test.

- [ ] `setOrderAccountingSigned(prisma, session, { orderId, signed })` — auth as above; set/clear `accountingSignedAt`; audit `order_accounting_signed`. Test toggling on/off. Commit within B2.

---

## B3 — Approval / return-to-client loop

### Task 6: `Order.returnReason` migration + wire into lifecycle

**Files:** `prisma/schema.prisma`; migration `order_return_reason`. Lifecycle behaviour already specified in Task 4 (`waiting_client` reason store/clear).

- [ ] Add `returnReason String?` to `Order`. Migrate (`ALTER TABLE "Order" ADD COLUMN "returnReason" TEXT;`). Nullable, reversible. `prisma:generate`.
- [ ] Extend the integration test with the full **cycle**: submit (`new`) → `in_progress` → `waiting_client` (reason stored) → client edits → `in_progress` (reason cleared). Assert `returnReason` transitions and audit rows.
- [ ] `typecheck`, `lint`, commit `feat(order): waiting_client return-with-reason cycle [B3]`.

---

## B4 — Distribution

### Task 7: Resolver + auto-assign + manual + self-assign

**Files:** Create `src/lib/services/manager/distribution.ts`; integration test `services.manager.distribution.integration.test.ts`. Modify `src/server-actions/admin/manager.ts`; create `src/server-actions/manager/claimOrder.ts` and `src/server-actions/manager/assignOrderManager.ts`.

**`resolveAutoManager(prisma, { organizationId, partnerId })` → `string | null`:**
1. active `OrganizationManager` for `organizationId`; if exactly one → its `userId`.
2. else if none and `partnerId`: distinct active `OrganizationManager.userId` across orgs where `org.partnerId === partnerId`; if exactly one distinct → it.
3. else `null`.

**`autoAssignOrder(prisma, { orderId, actorUserId })`** — no-op if `managerId` already set; else apply `resolveAutoManager`; audit `order_auto_assigned` when applied.

**`assignOrderManager(prisma, session, { orderId, managerUserId })`** (shared admin + leader manual):
- validate candidate (`role==='manager'`, active) when non-null; `order_not_found`; no-op when unchanged; audit `order_manager_changed`. Admin authorized by caller; leader authorized by same-company check.

**`claimOrder(prisma, session, { orderId })`** (manager self-assign):
- load order; `managerId` set and `!== session.sub` → `already_assigned`; `=== session.sub` → no-op ok; else set `managerId = session.sub`, audit `order_self_assigned`. (An order is "закреплена" iff `managerId` points to another manager — auto-assign already stamps `managerId` for attached orgs, so this is sufficient.)

- [ ] **Step 1 (failing tests):**
  - auto-assign: org with single active `OrganizationManager` → `autoAssignOrder` sets that manager; org with none but partner-linked single manager → resolves via partner; ambiguous (two managers) → stays null.
  - manual: `assignOrderManager` sets `managerId`; invalid candidate → `invalid_manager`.
  - self-assign: unassigned order → `claimOrder` sets self; order assigned to another → `already_assigned`; already self → no-op.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement services; refactor `assignOrderManagerAction` to delegate to `assignOrderManager`; add thin `claimOrderAction` (`requireManager`) and `assignOrderManagerLeaderAction` (`requireManagerLeader` + same-company guard).
- [ ] **Step 4:** Run — PASS; `typecheck`, `lint`.
- [ ] **Step 5:** Commit `feat(order): attachment auto-assign, shared manual assign, self-assign guard [B4]`.

---

## B5 — Enforce user limits

### Task 8: Config constants

**Files:** Create `src/lib/config/teamLimits.ts`; test `config.teamLimits.unit.test.ts`.

```ts
/** §14 ТЗ: лимиты контактных лиц. */
export const MAX_ORGANIZATION_USERS = 10;
export const MAX_PARTNER_USERS = 5;
```
- [ ] Unit test asserts the two constants. Commit.

### Task 9: Enforce in `inviteMember` chokepoints

**Files:** Modify `organization/team.ts`, `partner/team.ts`, `admin/users/mutations.ts`; integration test `services.team.limits.integration.test.ts`.

- Org (`organization/team.ts inviteMember`): inside the transaction, before creating/reactivating an **active** membership, `count OrganizationUser where { organizationId, isActive:true }`; if `>= MAX_ORGANIZATION_USERS` → throw `OrgMemberError('member_limit_reached')`. Add code to `OrgMemberErrorCode`. (Skip the count on the `already_member` path — that's an existing active member, no delta.)
- Partner (`partner/team.ts inviteMember`): before create, `count PartnerUser where { partnerId, isActive:true }`; if `>= MAX_PARTNER_USERS` → `{ ok:false, error:'member_limit_reached' }`. Add code to the union.
- Admin (`admin/users/mutations.ts createUser`, partner branch): same partner count before `partnerUser.create`; add `member_limit_reached` to `AdminUserErrorCode`.

- [ ] **Step 1 (failing integration test):** seed org with 10 active users → 11th `inviteMember` → `member_limit_reached`; seed partner with 5 active users → 6th `inviteMember` → `member_limit_reached`. Also assert a **deactivated** member doesn't count (reactivation up to the cap allowed, beyond it blocked).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement counts + error codes; map codes in the API route / server-action (partner route: `member_limit_reached` → 422; org action: surfaces in `OrgMemberErrorCode`).
- [ ] **Step 4:** Run — PASS; `typecheck`, `lint`.
- [ ] **Step 5:** Commit `feat(team): enforce org(10)/partner(5) user limits [B5]`.

---

## B6 — Configurable required fields (OPTIONAL, separate track)

`CustomFieldDefinition.required` already exists. Wiring runtime enforcement into order creation is a **separate track** — do not include unless explicitly requested (avoids scope bloat per task note). Left as a follow-up.

---

## Self-Review

- **Spec coverage:** B1 serviceType (T1) ✓; B2 completion guard + reopen audit (T2–T5) ✓; B3 waiting_client+reason cycle (T4/T6) ✓; B4 auto/manual/self-assign (T7) ✓; B5 limits (T8–T9) ✓; B6 explicitly deferred ✓.
- **No placeholders:** interfaces and error codes fully named; every test lists concrete assertions.
- **Type consistency:** `serviceType: ServiceType`, `evaluateOrderCompletion`, `CompletionCondition`, `transitionOrderLifecycle`, `resolveAutoManager/autoAssignOrder/assignOrderManager/claimOrder`, `member_limit_reached`, `MAX_ORGANIZATION_USERS/MAX_PARTNER_USERS` used consistently across tasks.
- **Constraints honoured:** transitions via explicit-map service only (no stray `update({status})`); additive nullable/defaulted migrations (reversible); no commission/money edits; every task ships tests.

## Final verification
`npm run typecheck` · `npm run lint` · `npm run test` · `npm run gate` · `npx prisma migrate status`.
