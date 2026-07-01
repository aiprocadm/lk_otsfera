# Track B (P1) — close-out

**Plan:** [2026-07-01-track-b-orders-distribution-limits.md](2026-07-01-track-b-orders-distribution-limits.md)
**Date shipped:** 2026-07-01
**Branch:** `claude/1c-cursor-store-and-replay`

## What shipped

### B1 — Universal service type
- `enum ServiceType { training, document_development }`, `Order.serviceType @default(training)`.
- Migration `20260701130507_order_service_type` (additive `CREATE TYPE` + `ADD COLUMN ... DEFAULT 'training'`; existing orders unchanged).
- Training-specificity is centralised in `isTrainingOrder()` (only the certificate completion condition is training-gated).

### B2 — Completion by all conditions (+ reopen)
- Pure evaluator `src/lib/orders/completion.ts` (`evaluateOrderCompletion`): `documents_uploaded` (≥1 clean scan) · `accounting_signed` (`Order.accountingSignedAt`) · `certificates_issued` (training-only: every `OrderItem.trainingStatus='certificate_issued'`).
- **Lifecycle state machine on the previously-dormant `Order.status` axis** — `src/lib/services/manager/orderLifecycle.ts` with an explicit allowed-transitions map. `→ completed` is guarded by the evaluator; `completed → in_progress` reopen is allowed and audited (`order_lifecycle_changed`). `executionStatus`/commission logic untouched.
- Manager checkbox `setOrderAccountingSigned` (§21 "галочка").
- Migration `20260701131528_order_completion_and_return_fields` (`accountingSignedAt`, `returnReason` — nullable).
- Server-action `src/server-actions/manager/orderLifecycle.ts`.

### B3 — Approval / return-to-client loop
- `in_progress → waiting_client` requires a non-empty reason (stored in `Order.returnReason`); leaving `waiting_client` clears it. Full cycle covered.

### B4 — Distribution
- `src/lib/services/manager/distribution.ts`: `resolveAutoManager` (unique active `OrganizationManager` for the org, else unique via the partner's orgs), `assignOrderManager` (shared admin + leader manual; **candidate company-restricted for leaders**), `claimOrder` (self-assign, **scope-guarded**).
- **Auto-assignment is wired into production**: the 1C order writer (`oneCSync/writers.ts`) sets `managerId` at creation via `resolveAutoManager` (best-effort — a resolver failure never blocks the import).
- Admin per-order assign action refactored to the shared service; new leader assign + manager self-assign server-actions (`src/server-actions/manager/orderAssignment.ts`).

### B5 — User limits
- `src/lib/config/teamLimits.ts`: `MAX_ORGANIZATION_USERS=10`, `MAX_PARTNER_USERS=5`.
- Enforced in `organization/team.ts` + `partner/team.ts` `inviteMember` and `admin/users/mutations.ts` `createUser` (partner branch); error code `member_limit_reached`. Active-only count (deactivated members don't occupy a slot).

### B6 — Deferred (as planned)
- Configurable required fields left as a separate track (`CustomFieldDefinition.required` already exists; no runtime enforcement wired).

## Adversarial review (multi-agent) — findings fixed

A 4-dimension review (correctness/security/spec/coverage) + per-finding verification surfaced issues the tests missed:

1. **[HIGH, fixed] `claimOrder` cross-company IDOR (C8 break).** Self-assign had no scope check — any manager could claim any unassigned order in another company, and the claim itself grants `canSeeOrder`. Fixed: load `companyId/organizationId`, gate on `canSeeOrder(session, order, teamMode)` before mutating; new `forbidden` code + tests.
2. **[MEDIUM, fixed] Leader manual-assign didn't validate the candidate manager's company.** A leader could attach a foreign-company manager to their order. Fixed: `assignOrderManager` gains `restrictToCompanyId` (leader passes `session.companyId`; admin omits it → Model A preserved) + tests.
3. **[MEDIUM, fixed] B4 auto-assign was dead code.** `autoAssignOrder`/`resolveAutoManager` had no production caller. Fixed: `resolveAutoManager` wired into the 1C order-create path; the redundant `autoAssignOrder` wrapper removed (it also introduced an audit-actor problem in the system-driven sync path).
4. **[LOW, documented] Limit checks are count-then-create (TOCTOU).** A rare +1 overshoot is possible under strictly-concurrent invites. Accepted as a soft seat-cap (not a security boundary); documented in-code. A true fix needs `Serializable` isolation + retry handling, which the codebase does not use anywhere and is out of this track's scope.

Two findings were correctly rejected by verification (resolveAutoManager candidate role-check; reactivation-at-cap coverage).

## Verification
- `npm run typecheck` ✓ · `npm run lint` (`--max-warnings=0`) ✓
- Unit suite ✓ · integration tier ✓ (against the live migrated `cabinet` DB)
- New tests: `orders.completion.unit`, `services.manager.orderLifecycle.unit`, `services.manager.distribution.unit`, `services.team.limits.integration`, `config.teamLimits.unit`, `server-actions.manager.orderLifecycle`, `server-actions.manager.orderAssignment`; updates to `services.partner.team.unit`, `services.admin.users`, `services.organization.unit`, `oneCSync.writers`.

## Known environment note
`npm run gate` could not spin its Docker Postgres: host port 5432/5433 are held by unrelated containers (`infra-postgres-1`). The gate's test step (`test:integration`) was run directly against the migrated local DB instead. In a clean environment (or after freeing the port) `npm run gate` runs unchanged.
