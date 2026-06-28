# throw→Result Contract Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert six throwing service functions to the §3 stable Result contract with normalized lowercase error codes, making routes/server-actions thin mappers.

**Architecture:** Each public service function returns `Promise<{ ok: true; ...data } | { ok: false; error: <CodeUnion> }>`. Domain checks that run *before* a `$transaction` return `{ ok: false, error }` directly. Functions that throw *inside* a `$transaction` keep a typed error class thrown internally and catch it at the function boundary (C4 invariant — boundary-catch is the only safe shape for in-transaction throws). Unexpected errors are re-thrown, never swallowed. Callers replace `try/catch` + `err.message.startsWith(...)` string-matching with `if (!res.ok) return map(res.error)`.

**Tech Stack:** TypeScript 5 (strict), Next.js 15 App Router, Prisma 5, Vitest. Reference for the target pattern: `src/lib/services/admin/users/mutations.ts`.

**Source spec:** `docs/superpowers/specs/2026-06-28-throw-to-result-contract-design.md`

---

## Conversion Recipe (read once; tasks reference this)

**Pattern A — direct return (checks before any `$transaction`).** Used by `rateOverride`, `leads`, `enrollments`, `teamVisibility`, `commission/lifecycle`.

```ts
// BEFORE
export async function doX(...): Promise<Lead> {
  if (bad) throw new Error('SOME_CODE');
  return prisma.lead.create({ ... });
}
// AFTER
export async function doX(...): Promise<{ ok: true; lead: Lead } | { ok: false; error: 'some_code' }> {
  if (bad) return { ok: false, error: 'some_code' };
  const lead = await prisma.lead.create({ ... });
  return { ok: true, lead };
}
```

**Pattern B — boundary-catch (throws happen inside `$transaction`).** Used by `organization/team` only.

```ts
export async function doX(...): Promise<{ ok: true; ...data } | { ok: false; error: XCode }> {
  try {
    return { ok: true, ...(await prisma.$transaction(async (tx) => { /* throws XError internally */ })) };
  } catch (e) {
    if (e instanceof XError) return { ok: false, error: e.code };
    throw e; // unexpected → re-throw
  }
}
```

**Caller mapping (routes).** Replace the `try/catch`:
```ts
const res = await doX(...);
if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapStatus(res.error) });
// ...use res.<data>
```

**Test transformation.** `.rejects.toThrow(/CODE/)` → assert the returned Result:
```ts
const res = await doX(...);
expect(res).toEqual({ ok: false, error: 'code' });
```
Happy-path tests previously reading the bare return value must now read `res.<field>` and assert `res.ok === true`.

---

## File Map

| File | Change |
|---|---|
| `src/lib/errors/messages.ts` | Add 10 codes (Task 1) |
| `src/__tests__/lib.errorMessages.test.ts` | Cover new codes (Task 1) |
| `src/lib/services/partner/rateOverride.ts` | Pattern A (Task 2) |
| `src/app/api/partner/portfolio/[orgId]/rate/route.ts` | add mapping (Task 2) |
| `src/server-actions/admin/organizations.ts` | simplify `setOrgRateOverrideAction` (Task 2) |
| `src/lib/services/partner/leads.ts` | Pattern A: `createLead`, `withdrawLead` (Task 3) |
| `src/app/api/partner/leads/route.ts`, `.../[id]/route.ts` | thin mapping (Task 3) |
| `src/lib/services/enrollments/submit.ts` | Pattern A (Task 4) |
| `src/app/api/enrollments/route.ts` | thin mapping (Task 4) |
| `src/lib/services/manager/teamVisibility.ts` | Pattern A (Task 5) |
| `src/server-actions/manager/teamVisibility.ts` | handle `company_not_found` (Task 5) |
| `src/lib/services/commission/lifecycle.ts` | Pattern A (Task 6) |
| `src/app/api/partner/finance/statements/[id]/route.ts` | thin mapping (Task 6) |
| `src/lib/services/organization/team.ts` | Pattern B (Task 7) |
| `src/server-actions/organization/team.ts` | drop `mapMemberError` try/catch (Task 7) |
| matching `src/__tests__/*` | per task |

---

## Task 1: Localize the new error codes

**Files:**
- Modify: `src/lib/errors/messages.ts`
- Test: `src/__tests__/lib.errorMessages.test.ts`

- [ ] **Step 1: Add the codes.** In `src/lib/errors/messages.ts`, inside the `RU` object, append (after the last existing entry):

```ts
  org_out_of_scope: 'Организация вне вашей зоны видимости.',
  already_rejected: 'Заявка уже отклонена.',
  already_promoted: 'Заявка уже переведена в заказ.',
  rate_out_of_range: 'Ставка должна быть в диапазоне (0, 1).',
  company_not_found: 'Компания не найдена.',
  requires_admin: 'Действие доступно только администратору организации.',
  already_member: 'Пользователь уже состоит в организации.',
  last_admin_protected: 'Нельзя удалить последнего администратора организации.',
  self_action_forbidden: 'Нельзя выполнить это действие над собой.',
  lifecycle_violation: 'Недопустимый переход статуса.'
```

- [ ] **Step 2: Add a coverage test.** In `src/__tests__/lib.errorMessages.test.ts`, add:

```ts
it('maps the throw→Result migration codes to Russian', () => {
  for (const code of [
    'org_out_of_scope', 'already_rejected', 'already_promoted', 'rate_out_of_range',
    'company_not_found', 'requires_admin', 'already_member', 'last_admin_protected',
    'self_action_forbidden', 'lifecycle_violation'
  ]) {
    expect(errorMessageRu(code)).not.toBe('Произошла ошибка.');
  }
});
```

- [ ] **Step 3: Run the test.** `npx vitest run --mode=unit src/__tests__/lib.errorMessages.test.ts` → PASS.
- [ ] **Step 4: Commit.** `git add src/lib/errors/messages.ts src/__tests__/lib.errorMessages.test.ts && git commit -m "feat(errors): localize throw→Result migration codes"`

---

## Task 2: `partner/rateOverride` (worked example, Pattern A)

**Files:**
- Modify: `src/lib/services/partner/rateOverride.ts`
- Modify: `src/app/api/partner/portfolio/[orgId]/rate/route.ts`
- Modify: `src/server-actions/admin/organizations.ts`
- Test: `src/__tests__/services.partner.rateOverride.unit.test.ts`, `src/__tests__/services.partner.rateOverride.test.ts` (integration), `src/__tests__/api.partner.portfolio.rate.test.ts`, `src/__tests__/server-actions.admin.organizations.test.ts`

- [ ] **Step 1: Rewrite the service.** Replace the bodies in `rateOverride.ts`:

```ts
export async function setOrgCommissionRate(
  prisma: PrismaClient,
  input: SetRateInput
): Promise<{ ok: true } | { ok: false; error: 'rate_out_of_range' | 'not_found' }> {
  if (!(input.newRate > 0 && input.newRate < 1)) {
    return { ok: false, error: 'rate_out_of_range' };
  }
  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, partnerId: input.partnerId },
    select: { id: true, partnerCommissionRate: true }
  });
  if (!org) return { ok: false, error: 'not_found' };

  await prisma.$transaction(async (tx) => {
    // ...unchanged update + recordAudit...
  });
  return { ok: true };
}

export async function clearOrgCommissionRate(
  prisma: PrismaClient,
  input: { organizationId: string; partnerId: string; reason: string; changedByUserId: string }
): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, partnerId: input.partnerId },
    select: { id: true, partnerCommissionRate: true }
  });
  if (!org) return { ok: false, error: 'not_found' };

  await prisma.$transaction(async (tx) => {
    // ...unchanged update + recordAudit...
  });
  return { ok: true };
}
```

- [ ] **Step 2: Update the route.** In `.../rate/route.ts`, replace the call block (lines ~39-49):

```ts
  const res = rate === null
    ? await clearOrgCommissionRate(prisma, { organizationId: orgId, partnerId, reason, changedByUserId: session.sub })
    : await setOrgCommissionRate(prisma, { organizationId: orgId, partnerId, newRate: rate, reason, changedByUserId: session.sub });

  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : 422;
    return NextResponse.json({ error: res.error }, { status });
  }
  return new NextResponse(null, { status: 204 });
```

- [ ] **Step 3: Simplify the server-action.** In `src/server-actions/admin/organizations.ts`, `setOrgRateOverrideAction`: remove the `try/catch` around the rate calls and the now-dead `RATE_OUT_OF_RANGE`/`NOT_FOUND` arms of `mapErr` for this path. Replace the `try { ... } catch (e) { return mapErr(e); }` (lines ~97-120) with:

```ts
  const res = clear
    ? await clearOrgCommissionRate(prisma, { organizationId, partnerId, reason, changedByUserId: session.sub })
    : ratePercent !== undefined
      ? await setOrgCommissionRate(prisma, { organizationId, partnerId, newRate: ratePercent / 100, reason, changedByUserId: session.sub })
      : ({ ok: false as const, error: 'validation' as const });

  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/admin/organizations/${organizationId}`);
  return { ok: true };
```

Keep `mapErr` only if `updateOrganizationAction` still uses it (it does — leave that path untouched). The `Failure` union already includes `rate_out_of_range` and `validation`; no type change needed.

- [ ] **Step 4: Update unit tests.** In `services.partner.rateOverride.unit.test.ts`, convert the three throw assertions:

```ts
// rate out of range (was .rejects.toThrow('RATE_OUT_OF_RANGE'))
expect(await setOrgCommissionRate(makePrisma(null), { organizationId: 'o1', partnerId: 'p1', newRate: -0.1, reason: 'x', changedByUserId: 'u1' }))
  .toEqual({ ok: false, error: 'rate_out_of_range' });
// rate >= 1 — same shape with newRate: 1
// not found (was .rejects.toThrow('NOT_FOUND')) with newRate: 0.1
expect(await setOrgCommissionRate(makePrisma(null), { organizationId: 'o1', partnerId: 'p1', newRate: 0.1, reason: 'x', changedByUserId: 'u1' }))
  .toEqual({ ok: false, error: 'not_found' });
// clearOrgCommissionRate not-found:
expect(await clearOrgCommissionRate(makePrisma(null), { organizationId: 'o1', partnerId: 'p1', reason: 'x', changedByUserId: 'u1' }))
  .toEqual({ ok: false, error: 'not_found' });
```
The happy-path audit tests stay valid (they don't read the return value) but add `expect(res.ok).toBe(true)` where a return is captured.

- [ ] **Step 5: Update integration + route + server-action tests.** In `services.partner.rateOverride.test.ts`, `api.partner.portfolio.rate.test.ts`, `server-actions.admin.organizations.test.ts`: any assertion expecting a throw or expecting old UPPER codes → expect Result `{ ok: false, error: 'not_found' | 'rate_out_of_range' }` / route status 404|422. (Server-action already returns `not_found`/`rate_out_of_range`, so those assertions likely already pass — verify.)

- [ ] **Step 6: Verify.** Run:
```
npm run typecheck
npx vitest run --mode=unit src/__tests__/services.partner.rateOverride.unit.test.ts src/__tests__/api.partner.portfolio.rate.test.ts src/__tests__/server-actions.admin.organizations.test.ts
```
Expected: typecheck clean, tests PASS. (Integration test `services.partner.rateOverride.test.ts` runs under live PG in Task 8.)

- [ ] **Step 7: Commit.** `git add -A && git commit -m "refactor(rateOverride): throw→Result (§3) + thin callers"`

---

## Task 3: `partner/leads` (Pattern A)

**Files:**
- Modify: `src/lib/services/partner/leads.ts`
- Modify: `src/app/api/partner/leads/route.ts`, `src/app/api/partner/leads/[id]/route.ts`
- Test: `src/__tests__/services.partner.leads.unit.test.ts`, `src/__tests__/services.partner.leads.test.ts`, `src/__tests__/api.partner.leads.test.ts`

- [ ] **Step 1: Convert `createLead`.** New signature + body tail:

```ts
export async function createLead(
  prisma: PrismaClient,
  input: CreateLeadInput
): Promise<{ ok: true; lead: Lead } | { ok: false; error: 'org_out_of_scope' }> {
  if (input.organizationId) {
    const org = await prisma.organization.findFirst({
      where: { id: input.organizationId, partnerId: input.partnerId },
      select: { id: true }
    });
    if (!org) return { ok: false, error: 'org_out_of_scope' };
  }
  const lead = await prisma.lead.create({ data: { /* unchanged */ } });
  return { ok: true, lead };
}
```

- [ ] **Step 2: Convert `withdrawLead`.**

```ts
export async function withdrawLead(
  prisma: PrismaClient,
  args: WithdrawLeadArgs
): Promise<{ ok: true; lead: Lead } | { ok: false; error: 'not_found' | 'already_rejected' | 'already_promoted' }> {
  const lead = await prisma.lead.findFirst({ /* unchanged where */ select: { id: true, status: true } });
  if (!lead) return { ok: false, error: 'not_found' };
  if (lead.status === 'rejected') return { ok: false, error: 'already_rejected' };
  if (lead.status === 'promoted_to_order') return { ok: false, error: 'already_promoted' };
  const updated = await prisma.lead.update({ where: { id: lead.id }, data: { status: 'rejected', rejectedReason: args.reason.trim() || 'Отозван партнёром' } });
  return { ok: true, lead: updated };
}
```

- [ ] **Step 3: Update POST `/partner/leads`.** Replace the `try/catch` (lines ~102-137) with:

```ts
  const created = await createLead(prisma, { /* unchanged args */ });
  if (!created.ok) {
    const status = created.error === 'org_out_of_scope' ? 422 : 400;
    return NextResponse.json({ error: created.error }, { status });
  }
  const lead = created.lead;
  await recordAudit(prisma, { /* unchanged, using lead.* */ });
  return NextResponse.json({ id: lead.id, status: lead.status }, { status: 201 });
```

- [ ] **Step 4: Update PATCH `/partner/leads/[id]`.** Replace the `try/catch` (lines ~69-95) with:

```ts
  const res = await withdrawLead(prisma, { /* unchanged args */ });
  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: res.error }, { status });
  }
  const lead = res.lead;
  await recordAudit(prisma, { /* unchanged, using lead.* */ });
  return NextResponse.json({ id: lead.id, status: lead.status });
```

- [ ] **Step 5: Update tests.** In the three test files, convert `.rejects.toThrow(/ORG_OUT_OF_SCOPE|NOT_FOUND|ALREADY_REJECTED|ALREADY_PROMOTED/)` to Result assertions (`expect(res).toEqual({ ok: false, error: 'org_out_of_scope' })` etc.), and update happy-path assertions to read `res.lead.*` and check `res.ok`. In `api.partner.leads.test.ts`, status codes are unchanged (422/404/409); update the response body `error` field expectations to the lowercase codes.

- [ ] **Step 6: Verify.** `npm run typecheck && npx vitest run --mode=unit src/__tests__/services.partner.leads.unit.test.ts src/__tests__/api.partner.leads.test.ts` → PASS.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "refactor(partner/leads): throw→Result (§3) + thin routes"`

---

## Task 4: `enrollments/submit` (Pattern A, + missing test)

**Files:**
- Modify: `src/lib/services/enrollments/submit.ts`
- Modify: `src/app/api/enrollments/route.ts`
- Test: `src/__tests__/services.enrollments.unit2.test.ts` (add submit cases), `src/__tests__/api.enrollments.test.ts`

- [ ] **Step 1: Convert the service.** New signature; replace each `throw`:

```ts
export async function submitEnrollmentRequest(
  prisma: PrismaClient,
  session: SessionPayload,
  input: SubmitEnrollmentInput
): Promise<{ ok: true; request: EnrollmentRequest } | { ok: false; error: 'forbidden' | 'validation' }> {
  if (!canSubmitEnrollments(session)) return { ok: false, error: 'forbidden' };
  const studentName = input.studentName?.trim();
  const studentEmail = input.studentEmail?.trim();
  const courseTitle = input.courseTitle?.trim();
  if (!studentName || !studentEmail || !courseTitle) return { ok: false, error: 'validation' };
  // ...partner/organization scope checks: `throw new Error('FORBIDDEN: ...')` → `return { ok: false, error: 'forbidden' }`
  const created = await prisma.enrollmentRequest.create({ /* unchanged */ });
  await recordAudit(prisma, { /* unchanged */ });
  return { ok: true, request: created };
}
```

- [ ] **Step 2: Update the route.** Remove `mapError` + `try/catch` (lines ~12-18, ~29-40):

```ts
  const res = await submitEnrollmentRequest(prisma, session, {
    studentName: String(body.studentName ?? ''),
    studentEmail: String(body.studentEmail ?? ''),
    courseTitle: String(body.courseTitle ?? ''),
    organizationId: body.organizationId ?? null,
    note: body.note ?? null
  });
  if (!res.ok) {
    const status = res.error === 'validation' ? 400 : 403;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ id: res.request.id }, { status: 201 });
```

- [ ] **Step 3: Add the missing service test.** In `src/__tests__/services.enrollments.unit2.test.ts` add cases asserting: forbidden role → `{ ok: false, error: 'forbidden' }`; missing fields → `{ ok: false, error: 'validation' }`; partner org out of scope → `{ ok: false, error: 'forbidden' }`; happy path → `res.ok === true` with `res.request.id`. Mock `prisma.organization.findFirst`, `prisma.enrollmentRequest.create`, and `@/lib/auth/audit` per the `vi.hoisted` pattern in sibling tests.

- [ ] **Step 4: Update route test.** In `api.enrollments.test.ts`, replace throw-driven expectations with Result-driven status (400 for `validation`, 403 for `forbidden`) and body `{ error: 'validation' | 'forbidden' }`.

- [ ] **Step 5: Verify.** `npm run typecheck && npx vitest run --mode=unit src/__tests__/services.enrollments.unit2.test.ts src/__tests__/api.enrollments.test.ts` → PASS.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "refactor(enrollments/submit): throw→Result (§3) + add service test"`

---

## Task 5: `manager/teamVisibility` (Pattern A, fixes unhandled-throw bug)

**Files:**
- Modify: `src/lib/services/manager/teamVisibility.ts`
- Modify: `src/server-actions/manager/teamVisibility.ts`
- Test: `src/__tests__/services.manager.teamVisibility.unit.test.ts`, `src/__tests__/server-actions.manager.teamVisibility.test.ts`

- [ ] **Step 1: Convert the service.**

```ts
export async function setTeamVisibility(
  prisma: PrismaClient,
  actorUserId: string,
  companyId: string,
  enabled: boolean
): Promise<{ ok: true; changed: boolean } | { ok: false; error: 'company_not_found' }> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { managerTeamVisibility: true } });
  if (!company) return { ok: false, error: 'company_not_found' };
  if (company.managerTeamVisibility === enabled) return { ok: true, changed: false };
  await prisma.company.update({ where: { id: companyId }, data: { managerTeamVisibility: enabled } });
  await recordAudit(prisma, { /* unchanged */ });
  return { ok: true, changed: true };
}
```

- [ ] **Step 2: Update the server-action.** In `src/server-actions/manager/teamVisibility.ts`, the call to `setTeamVisibility(...)` now returns a Result. Keep the existing session-level `no_company` guard. After the call:

```ts
  const res = await setTeamVisibility(prisma, session.sub, session.companyId, enabled);
  if (!res.ok) return { ok: false, error: res.error }; // company_not_found (was an unhandled throw)
  revalidatePath('/manager/team');
  revalidatePath('/manager/dashboard');
  return { ok: true, changed: res.changed };
```
Extend the action's Failure union to include `'company_not_found'` alongside `'no_company' | 'validation'`.

- [ ] **Step 3: Update tests.** In `services.manager.teamVisibility.unit.test.ts`: add a `company_not_found` case (`findUnique` → null) asserting `{ ok: false, error: 'company_not_found' }`; convert happy-path/no-op assertions to read `res.ok` + `res.changed`. In `server-actions.manager.teamVisibility.test.ts`: the existing happy-path mocks `setTeamVisibility.mockResolvedValue({ changed: true })` → change to `{ ok: true, changed: true }`; add a case where the service returns `{ ok: false, error: 'company_not_found' }` and assert the action returns the same.

- [ ] **Step 4: Verify.** `npm run typecheck && npx vitest run --mode=unit src/__tests__/services.manager.teamVisibility.unit.test.ts src/__tests__/server-actions.manager.teamVisibility.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "fix(manager/teamVisibility): throw→Result (§3), handle company_not_found"`

---

## Task 6: `commission/lifecycle` (Pattern A)

**Files:**
- Modify: `src/lib/services/commission/lifecycle.ts`
- Modify: `src/app/api/partner/finance/statements/[id]/route.ts`
- Test: `src/__tests__/services.commission.lifecycle.unit.test.ts`, and the statements route test (`src/__tests__/api.partner.finance.statements.*` / route test that exercises PATCH approve/markPaid)

- [ ] **Step 1: Convert `approveStatement`.** New signature; replace the three throws (all before the `$transaction`):

```ts
export async function approveStatement(
  prisma: PrismaClient,
  input: ApproveInput
): Promise<{ ok: true; statement: CommissionStatement } | { ok: false; error: 'not_found' | 'lifecycle_violation' }> {
  const statement = await prisma.commissionStatement.findFirst({ /* unchanged */ });
  if (!statement) return { ok: false, error: 'not_found' };
  if (statement.supersededBy) return { ok: false, error: 'lifecycle_violation' };
  if (statement.status !== 'draft') return { ok: false, error: 'lifecycle_violation' };
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => { /* unchanged carry-over logic */ });
  return { ok: true, statement: updated };
}
```

- [ ] **Step 2: Convert `markStatementPaid`.**

```ts
export async function markStatementPaid(
  prisma: PrismaClient,
  input: MarkPaidInput
): Promise<{ ok: true; statement: CommissionStatement } | { ok: false; error: 'forbidden' | 'not_found' | 'lifecycle_violation' }> {
  const payer = await prisma.user.findUnique({ where: { id: input.paidByUserId }, select: { role: true } });
  if (!payer) return { ok: false, error: 'forbidden' };
  if (payer.role !== 'admin') return { ok: false, error: 'forbidden' };
  const statement = await prisma.commissionStatement.findUnique({ /* unchanged */ });
  if (!statement) return { ok: false, error: 'not_found' };
  if (statement.supersededBy) return { ok: false, error: 'lifecycle_violation' };
  if (statement.status !== 'approved') return { ok: false, error: 'lifecycle_violation' };
  const paidAt = input.paidAt ?? new Date();
  const updated = await prisma.$transaction(async (tx) => { /* unchanged */ });
  return { ok: true, statement: updated };
}
```

- [ ] **Step 3: Update the route.** In `statements/[id]/route.ts` PATCH, replace both `try/catch` blocks. For `approve`:

```ts
    const res = await approveStatement(prisma, { statementId: id, partnerId: guard.value.partnerId, approvedByUserId: guard.value.sub });
    if (!res.ok) {
      const status = res.error === 'not_found' ? 404 : 409;
      return NextResponse.json({ error: res.error }, { status });
    }
    return NextResponse.json({ statement: res.statement });
```
For `markPaid`:
```ts
    const res = await markStatementPaid(prisma, { statementId: id, paidByUserId: session.sub });
    if (!res.ok) {
      const status = res.error === 'not_found' ? 404 : res.error === 'forbidden' ? 403 : 409;
      return NextResponse.json({ error: res.error }, { status });
    }
    return NextResponse.json({ statement: res.statement });
```

- [ ] **Step 4: Update tests.** In `services.commission.lifecycle.unit.test.ts`, convert all `.rejects.toThrow(/NOT_FOUND|LIFECYCLE_VIOLATION|FORBIDDEN/)` to Result assertions; happy-path now reads `res.statement` + `res.ok`. Update the route test PATCH expectations to the lowercase body codes (statuses 404/409/403 unchanged).

- [ ] **Step 5: Verify.** `npm run typecheck && npx vitest run --mode=unit src/__tests__/services.commission.lifecycle.unit.test.ts` plus the statements route test file → PASS.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "refactor(commission/lifecycle): throw→Result (§3) + thin route"`

---

## Task 7: `organization/team` (Pattern B — move boundary-catch into service)

**Files:**
- Modify: `src/lib/services/organization/team.ts`
- Modify: `src/server-actions/organization/team.ts`
- Test: `src/__tests__/services.organization.team.test.ts`, `src/__tests__/server-actions.organization.team.test.ts`

- [ ] **Step 1: Wrap each service function in boundary-catch.** Keep `OrgMemberError` and all internal `throw new OrgMemberError(...)` as-is (including those inside `$transaction`). Change each public function's signature and wrap its body. For `inviteMember`:

```ts
export async function inviteMember(
  prisma: PrismaClient,
  args: InviteMemberInput,
  actorUserId: string,
  audit: InviteMemberAuditMeta = {},
  actorRole: OrgRoleInOrg = 'admin'
): Promise<({ ok: true } & InviteMemberResult) | { ok: false; error: OrgMemberErrorCode }> {
  try {
    if (actorRole === 'leader' && args.roleInOrg === 'admin') {
      throw new OrgMemberError('requires_admin');
    }
    const result = await prisma.$transaction(async (tx) => { /* unchanged body, still throws OrgMemberError */ });
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof OrgMemberError) return { ok: false, error: e.code };
    throw e;
  }
}
```

For the three `Promise<void>` functions (`updateMemberRole`, `deactivateMember`, `reactivateMember`), change the return type to `Promise<{ ok: true } | { ok: false; error: OrgMemberErrorCode }>`, wrap the existing `await prisma.$transaction(...)` in `try { ...; return { ok: true }; } catch (e) { if (e instanceof OrgMemberError) return { ok: false, error: e.code }; throw e; }`. The internal no-op `return;` statements inside the transaction callback stay unchanged (they return from the callback, not the function).

- [ ] **Step 2: Simplify the server-action.** In `src/server-actions/organization/team.ts`, remove `mapMemberError` and the `try/catch` in all four actions. Each becomes:

```ts
  const res = await inviteMember(prisma, parsed.data, session.sub, { source: 'organization' }, actorRole);
  if (!res.ok) return { ok: false, error: res.error };
  // ...inviteMember: best-effort email using res.inviteUrl (move the email block out of the removed try)...
  revalidatePath('/organization/team');
  return { ok: true, user: res.user, inviteUrl: res.inviteUrl, alreadyHasPassword: res.alreadyHasPassword };
```
For the three void actions:
```ts
  const res = await updateMemberRole(prisma, parsed.data.organizationId, parsed.data.orgUserId, parsed.data.newRole, session.sub, actorRole);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/organization/team');
  return { ok: true };
```
Keep the `OrgMemberError` import only if still referenced; otherwise drop it but keep `type OrgMemberErrorCode` (used in the `Failure` union). Remove the now-unused `OrgMemberError` value import if ESLint flags it.

- [ ] **Step 3: Update service tests.** In `services.organization.team.test.ts`, convert every `.rejects.toThrow(OrgMemberError)` / `.rejects.toMatchObject({ code })` to `expect(res).toEqual({ ok: false, error: '<code>' })`. Happy-path assertions read `res.ok === true` and (for invite) `res.user` / `res.inviteUrl`.

- [ ] **Step 4: Update server-action tests.** In `server-actions.organization.team.test.ts`, the service mocks must now resolve Result values: `inviteMember.mockResolvedValue({ ok: true, user: {...}, inviteUrl: '...', alreadyHasPassword: false })`, and error cases `mockResolvedValue({ ok: false, error: 'requires_admin' })` (instead of `mockRejectedValue(new OrgMemberError(...))`). Assert the action returns the same Result.

- [ ] **Step 5: Verify.** `npm run typecheck && npx vitest run --mode=unit src/__tests__/services.organization.team.test.ts src/__tests__/server-actions.organization.team.test.ts` → PASS.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "refactor(organization/team): move boundary-catch into service (§3)"`

---

## Task 8: Full verification

- [ ] **Step 1: Static checks.** `npm run typecheck` → clean; `npm run lint` → no errors/warnings.
- [ ] **Step 2: Full unit slice.** `npm run test:unit` → all green. Fix any test files missed by the per-task edits (grep for residual UPPER codes: `git grep -nE "ORG_OUT_OF_SCOPE|ALREADY_REJECTED|ALREADY_PROMOTED|RATE_OUT_OF_RANGE|LIFECYCLE_VIOLATION|toThrow\('NOT_FOUND" -- 'src/__tests__/*'`).
- [ ] **Step 3: Integration (live PG).** Where Postgres is available: `npm run test:integration` (covers `services.partner.rateOverride.test.ts`, leads, organization/team, commission/lifecycle, enrollments integration). On this Windows box without Docker, run the integration files individually against the native PG per the project recipe, or defer to CI/owner.
- [ ] **Step 4: Push + PR.** Push the branch; open a PR to `main`. If the pre-push L2.5 gate hangs (Docker unavailable), use `git push --no-verify` only after Steps 1-2 are green (established practice, CLAUDE.md §6).

---

## Self-Review Notes

- **Spec coverage:** all 6 services + localization + caller updates + tests have tasks (Tasks 1-7); verification is Task 8. ✓
- **Behavior preserved:** HTTP statuses unchanged (only body `error` codes normalized to lowercase); logic untouched. ✓
- **Type consistency:** every converted function returns the discriminated union shown; callers read `res.<field>` only after `res.ok`. `organization/team` keeps `OrgMemberErrorCode` as the union member. ✓
- **No-op transaction returns** inside `organization/team` callbacks are intentionally left (they return from the `$transaction` callback; the outer function still resolves `{ ok: true }`). ✓
