# Organization Finance Hub + `leader` Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/organization/finance` (KPI + payment ledger for all members; intermediary-commission block gated to admin+leader) and introduce an org `leader` role (sees commission + manages team, with privilege-escalation guards).

**Architecture:** Sibling `organization-*` page/components over a new `organization/finance.ts` service (read-only aggregates of existing `Order`/`Payment`; commission via reuse of `commission/calculator.ts`). The `leader` role is a new `roleInOrg` string value (no schema migration) threaded through policies, the team service/guards, and the team UI. Field-level commission gating is server-side: the service function is only called for admin/leader, so members never receive the data.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript strict, Prisma 5 + PostgreSQL, Vitest (unit + integration), server actions.

**Spec:** [2026-06-04-organization-finance-hub-design.md](../specs/2026-06-04-organization-finance-hub-design.md)

**Decisions locked in brainstorm:** commission = live-calc (`vatMode: 'full'`, labeled estimate); `leader` = extended (commission + team management); invite-as-leader allowed; leader manages only `member`/`leader`, never `admin`; commission block = aggregate + native `<details>` per-order table; no schema migration.

---

## File Structure

**Create:**
- `src/lib/services/organization/finance.ts` — finance service (KPIs, payment ledger, intermediary commission). Owns its return types.
- `src/components/organization/org-finance-kpis.tsx` — presentational KPI grid (reuses `StatCard`).
- `src/components/organization/org-finance-payments.tsx` — presentational payment ledger table.
- `src/components/organization/org-finance-commission.tsx` — presentational commission block (admin/leader only).
- `src/app/organization/finance/page.tsx` — server component page; field-level gates commission.
- `src/__tests__/services.organization.finance.test.ts` — integration tests for the finance service.

**Modify:**
- `src/lib/auth/jwt.ts:19` — widen `OrgRoleInOrg`.
- `src/lib/auth/organizationPolicy.ts` — add `isOrgLeader`, `canSeeIntermediaryCommission`.
- `src/lib/auth/requireRole.ts` — add `requireOrganizationAdminOrLeader`.
- `src/lib/auth/orgPageContext.ts` — widen `viewerRole`.
- `src/components/organization/org-app-shell.tsx` — widen `viewerRole` prop type.
- `src/components/organization/org-sidebar.tsx` — widen types + add "Финансы" nav item.
- `src/lib/services/organization/team.ts` — `'leader'` support + privilege-escalation guards + `requires_admin` code.
- `src/server-actions/organization/team.ts` — leader guard + `actorRole` threading + widen zod enums.
- `src/components/organization/team-table.tsx` — 3-way role control gated by viewer role.
- `src/components/organization/invite-org-user-form.tsx` — add `leader` option + `requires_admin` label.
- `src/app/organization/team/page.tsx` — allow leader; pass viewerRole to table.
- `src/__tests__/auth.organizationPolicy.test.ts` — tests for new policies.
- `src/__tests__/auth.requireRole.organization.test.ts` — test new guard.
- `src/__tests__/services.organization.team.test.ts` — privesc guard tests.
- `src/__tests__/server-actions.organization.team.test.ts` — leader action tests.
- `src/__tests__/components.org-sidebar.test.tsx` — update nav-link counts.

---

## Task 1: Widen `OrgRoleInOrg` + org policies

**Files:**
- Modify: `src/lib/auth/jwt.ts:19`
- Modify: `src/lib/auth/organizationPolicy.ts`
- Test: `src/__tests__/auth.organizationPolicy.test.ts`

- [ ] **Step 1: Write failing tests** — in `src/__tests__/auth.organizationPolicy.test.ts`, add `isOrgLeader` and `canSeeIntermediaryCommission` to the **existing** import from `@/lib/auth/organizationPolicy` (lines 2-10), then append (reusing the file's existing `s()` helper — do NOT redeclare it):

```ts
describe('isOrgLeader', () => {
  const session = s([
    { organizationId: 'A', roleInOrg: 'leader', isActive: true },
    { organizationId: 'B', roleInOrg: 'admin', isActive: true }
  ]);
  it('true only for active leader membership in the org', () => {
    expect(isOrgLeader(session, 'A')).toBe(true);
    expect(isOrgLeader(session, 'B')).toBe(false); // admin is not leader
    expect(isOrgLeader(session, 'X')).toBe(false);
  });
});

describe('canSeeIntermediaryCommission', () => {
  const session = s([
    { organizationId: 'A', roleInOrg: 'admin', isActive: true },
    { organizationId: 'B', roleInOrg: 'leader', isActive: true },
    { organizationId: 'C', roleInOrg: 'member', isActive: true }
  ]);
  it('true for admin and leader, false for member', () => {
    expect(canSeeIntermediaryCommission(session, 'A')).toBe(true);
    expect(canSeeIntermediaryCommission(session, 'B')).toBe(true);
    expect(canSeeIntermediaryCommission(session, 'C')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run src/__tests__/auth.organizationPolicy.test.ts`
Expected: FAIL — `isOrgLeader`/`canSeeIntermediaryCommission` not exported; and `roleInOrg: 'leader'` is a type error against `OrgRoleInOrg`.

- [ ] **Step 3: Widen the type** — in `src/lib/auth/jwt.ts`, change line 19:

```ts
export type OrgRoleInOrg = 'admin' | 'leader' | 'member';
```

- [ ] **Step 4: Add policy helpers** — in `src/lib/auth/organizationPolicy.ts`, after `isOrgAdmin` (around line 13) add:

```ts
export function isOrgLeader(session: SessionPayload, orgId: string): boolean {
  return !!session.organizationMemberships?.some(
    (m) => m.isActive && m.organizationId === orgId && m.roleInOrg === 'leader'
  );
}

export function canSeeIntermediaryCommission(session: SessionPayload, orgId: string): boolean {
  return isOrgAdmin(session, orgId) || isOrgLeader(session, orgId);
}
```

- [ ] **Step 5: Run, verify PASS**

Run: `npx vitest run src/__tests__/auth.organizationPolicy.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/jwt.ts src/lib/auth/organizationPolicy.ts src/__tests__/auth.organizationPolicy.test.ts
git commit -m "feat(org): add 'leader' role type + isOrgLeader/canSeeIntermediaryCommission policies"
```

---

## Task 2: Widen `viewerRole` plumbing

**Files:**
- Modify: `src/lib/auth/orgPageContext.ts:14,53`
- Modify: `src/components/organization/org-app-shell.tsx:9`
- Modify: `src/components/organization/org-sidebar.tsx:20,26`

No new test — this is type widening; verified by `typecheck` + existing sidebar tests staying green (link counts unchanged in this task).

- [ ] **Step 1: Widen `OrgPageContext.viewerRole` + compute leader** — in `src/lib/auth/orgPageContext.ts`:

Change the import on line 4 to include `isOrgLeader`:

```ts
import { activeOrgIds, isOrgAdmin, isOrgLeader } from '@/lib/auth/organizationPolicy';
```

Change the type (line 14):

```ts
  viewerRole: 'admin' | 'leader' | 'member';
```

Change the return value (line 53):

```ts
    viewerRole: isOrgAdmin(session, activeOrgId)
      ? 'admin'
      : isOrgLeader(session, activeOrgId)
        ? 'leader'
        : 'member'
```

- [ ] **Step 2: Widen `OrgAppShell` prop** — in `src/components/organization/org-app-shell.tsx`, line 9:

```ts
  viewerRole: 'admin' | 'leader' | 'member';
```

- [ ] **Step 3: Widen `OrgSidebar` types** — in `src/components/organization/org-sidebar.tsx`:

`OrgSidebarMembership.roleInOrg` (line 20):

```ts
  roleInOrg: 'admin' | 'leader' | 'member';
```

`OrgSidebar` prop `viewerRole` (line 26):

```ts
  viewerRole: 'admin' | 'leader' | 'member';
```

- [ ] **Step 4: Run typecheck + sidebar test**

Run: `npm run typecheck && npx vitest run src/__tests__/components.org-sidebar.test.tsx`
Expected: typecheck clean; sidebar test PASS (5 admin / 4 member links — unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/orgPageContext.ts src/components/organization/org-app-shell.tsx src/components/organization/org-sidebar.tsx
git commit -m "feat(org): thread 'leader' through viewerRole (context + shell + sidebar types)"
```

---

## Task 3: `requireOrganizationAdminOrLeader` guard

**Files:**
- Modify: `src/lib/auth/requireRole.ts` (after `requireOrganizationAdmin`, ~line 44)
- Test: `src/__tests__/auth.requireRole.organization.test.ts`

- [ ] **Step 1: Write failing test** — in `src/__tests__/auth.requireRole.organization.test.ts`, add `requireOrganizationAdminOrLeader` to the import on line 11, then append (matching the file's existing `getSession.mockResolvedValue` + `NEXT_REDIRECT` sentinel pattern):

```ts
const ORG_LEADER: SessionPayload = {
  sub: 'u-7',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'leader', isActive: true }]
};

describe('requireOrganizationAdminOrLeader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns session for admin of requested org', async () => {
    getSession.mockResolvedValue(ORG_ADMIN_A);
    await expect(requireOrganizationAdminOrLeader('org-A')).resolves.toEqual(ORG_ADMIN_A);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('returns session for leader of requested org', async () => {
    getSession.mockResolvedValue(ORG_LEADER);
    await expect(requireOrganizationAdminOrLeader('org-1')).resolves.toEqual(ORG_LEADER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden for member', async () => {
    getSession.mockResolvedValue(ORG_MEMBER);
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(requireOrganizationAdminOrLeader('org-1')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run src/__tests__/auth.requireRole.organization.test.ts`
Expected: FAIL — `requireOrganizationAdminOrLeader` not exported.

- [ ] **Step 3: Implement guard** — in `src/lib/auth/requireRole.ts`, after `requireOrganizationAdmin`:

```ts
export async function requireOrganizationAdminOrLeader(orgId?: string): Promise<SessionPayload> {
  const session = await requireOrganization();
  const memberships = session.organizationMemberships ?? [];
  const ok = memberships.some(
    (m) =>
      m.isActive &&
      (m.roleInOrg === 'admin' || m.roleInOrg === 'leader') &&
      (!orgId || m.organizationId === orgId)
  );
  if (!ok) redirect('/forbidden');
  return session;
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run src/__tests__/auth.requireRole.organization.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/requireRole.ts src/__tests__/auth.requireRole.organization.test.ts
git commit -m "feat(org): requireOrganizationAdminOrLeader guard"
```

---

## Task 4: Team service — `'leader'` + privilege-escalation guards

**Files:**
- Modify: `src/lib/services/organization/team.ts`
- Test: `src/__tests__/services.organization.team.test.ts` (integration; extend)

- [ ] **Step 1: Write failing integration tests** — append a new `describe` block to `src/__tests__/services.organization.team.test.ts` (reuses the file's existing `prisma`, `orgId`, `memberOrgUserId`, `secondAdminOrgUserId`, `actorAdminUserId` fixtures rebuilt by `ensureMemberships` in `beforeEach`):

```ts
describe('leader privilege-escalation guards', () => {
  it('leader cannot promote a member to admin', async () => {
    await expect(
      updateMemberRole(prisma, orgId, memberOrgUserId, 'admin', actorAdminUserId, 'leader')
    ).rejects.toMatchObject({ code: 'requires_admin' });
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.roleInOrg).toBe('member'); // untouched
  });

  it('leader cannot change the role of an existing admin', async () => {
    await expect(
      updateMemberRole(prisma, orgId, secondAdminOrgUserId, 'member', actorAdminUserId, 'leader')
    ).rejects.toMatchObject({ code: 'requires_admin' });
  });

  it('leader cannot deactivate an admin', async () => {
    await expect(
      deactivateMember(prisma, orgId, secondAdminOrgUserId, actorAdminUserId, 'leader')
    ).rejects.toMatchObject({ code: 'requires_admin' });
  });

  it('leader CAN promote a member to leader', async () => {
    await updateMemberRole(prisma, orgId, memberOrgUserId, 'leader', actorAdminUserId, 'leader');
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.roleInOrg).toBe('leader');
  });

  it('leader cannot invite a new admin', async () => {
    await expect(
      inviteMember(
        prisma,
        { organizationId: orgId, email: `team-leadinvite-${Date.now()}@t.local`, name: 'X', roleInOrg: 'admin' },
        actorAdminUserId,
        {},
        'leader'
      )
    ).rejects.toMatchObject({ code: 'requires_admin' });
  });

  it('admin (default actorRole) is unrestricted — promotes member to admin', async () => {
    await updateMemberRole(prisma, orgId, memberOrgUserId, 'admin', actorAdminUserId);
    const row = await prisma.organizationUser.findUnique({ where: { id: memberOrgUserId } });
    expect(row?.roleInOrg).toBe('admin');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (needs live Postgres — `npm run test:integration` or `npm run gate`)

Run: `npm run test:integration -- services.organization.team`
Expected: FAIL — `updateMemberRole`/etc. reject extra `actorRole` arg as type error / `requires_admin` not thrown.

- [ ] **Step 3: Add `requires_admin` code + `'leader'` to `normaliseRole`** — in `src/lib/services/organization/team.ts`:

Extend the error union (line 5):

```ts
export type OrgMemberErrorCode =
  | 'already_member'
  | 'last_admin_protected'
  | 'self_action_forbidden'
  | 'requires_admin'
  | 'not_found';
```

Widen role types — `OrgMemberRow.roleInOrg` (line 25) and `InviteMemberInput.roleInOrg` (line 35):

```ts
  roleInOrg: 'admin' | 'leader' | 'member';
```

Replace `normaliseRole` (lines 44-46):

```ts
function normaliseRole(value: string | null | undefined): 'admin' | 'leader' | 'member' {
  if (value === 'admin') return 'admin';
  if (value === 'leader') return 'leader';
  return 'member';
}
```

- [ ] **Step 4: Thread `actorRole` + guards into mutations** — in `src/lib/services/organization/team.ts`:

Import the role type at the top (add to the existing `@prisma/client` import line is not possible — `OrgRoleInOrg` lives in jwt). Add:

```ts
import type { OrgRoleInOrg } from '@/lib/auth/jwt';
```

`inviteMember` — add a 5th param and an early guard. Change the signature:

```ts
export async function inviteMember(
  prisma: PrismaClient,
  args: InviteMemberInput,
  actorUserId: string,
  audit: InviteMemberAuditMeta = {},
  actorRole: OrgRoleInOrg = 'admin'
): Promise<InviteMemberResult> {
  if (actorRole === 'leader' && args.roleInOrg === 'admin') {
    throw new OrgMemberError('requires_admin');
  }
  return prisma.$transaction(async (tx) => {
```

`updateMemberRole` — add a 6th param and guard after the self-check (insert immediately after the `self_action_forbidden` throw block, before the no-op `return`):

```ts
export async function updateMemberRole(
  prisma: PrismaClient,
  organizationId: string,
  orgUserId: string,
  newRole: 'admin' | 'leader' | 'member',
  actorUserId: string,
  actorRole: OrgRoleInOrg = 'admin'
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const target = await loadOrgUserOrThrow(tx, organizationId, orgUserId);
    if (target.userId === actorUserId) {
      throw new OrgMemberError('self_action_forbidden');
    }
    const currentRole = normaliseRole(target.roleInOrg);
    if (actorRole === 'leader' && (currentRole === 'admin' || newRole === 'admin')) {
      throw new OrgMemberError('requires_admin');
    }
    if (currentRole === newRole) return; // no-op
    // ... existing last-admin check + update + audit unchanged
```

`deactivateMember` and `reactivateMember` — add a 5th param and guard after the self-check:

```ts
export async function deactivateMember(
  prisma: PrismaClient,
  organizationId: string,
  orgUserId: string,
  actorUserId: string,
  actorRole: OrgRoleInOrg = 'admin'
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const target = await loadOrgUserOrThrow(tx, organizationId, orgUserId);
    if (target.userId === actorUserId) {
      throw new OrgMemberError('self_action_forbidden');
    }
    if (actorRole === 'leader' && normaliseRole(target.roleInOrg) === 'admin') {
      throw new OrgMemberError('requires_admin');
    }
    // ... existing isActive no-op + last-admin check + update + audit unchanged
```

Apply the identical `actorRole` param + `requires_admin` guard (after the self-check) to `reactivateMember`.

> The `'admin'` default keeps all existing callers/tests (which omit `actorRole`) behaving exactly as before; only the server action passes a real `actorRole`. The server action's `requireOrganizationAdminOrLeader` guard already blocks members entirely, so the in-service guard only needs to constrain leaders away from admin rows.

- [ ] **Step 5: Run, verify PASS**

Run: `npm run test:integration -- services.organization.team`
Expected: PASS (existing + new leader tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/organization/team.ts src/__tests__/services.organization.team.test.ts
git commit -m "feat(org): team service supports 'leader' + privilege-escalation guards (requires_admin)"
```

---

## Task 5: Server action — leader guard + `actorRole` threading

**Files:**
- Modify: `src/server-actions/organization/team.ts`
- Test: `src/__tests__/server-actions.organization.team.test.ts` (extend)

- [ ] **Step 1: Write failing tests** — append to `src/__tests__/server-actions.organization.team.test.ts`. Add `isOrgAdmin` + the leader guard to the hoisted mocks and a new describe:

In the `vi.hoisted` block add `requireOrganizationAdminOrLeader: vi.fn()` and `isOrgAdmin: vi.fn()`; extend the `@/lib/auth/requireRole` mock to export both `requireOrganizationAdmin` and `requireOrganizationAdminOrLeader`; mock `@/lib/auth/organizationPolicy` to export `isOrgAdmin`. Then:

```ts
describe('leader actor threads actorRole', () => {
  it('passes actorRole="leader" to updateMemberRole when actor is a leader', async () => {
    requireOrganizationAdminOrLeader.mockResolvedValue({
      sub: 'leader-1',
      organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'leader', isActive: true }]
    });
    isOrgAdmin.mockReturnValue(false);
    updateMemberRole.mockResolvedValue(undefined);

    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-9', newRole: 'leader' })
    );
    expect(res).toEqual({ ok: true });
    expect(updateMemberRole).toHaveBeenCalledWith(
      expect.anything(), 'org-1', 'ou-9', 'leader', 'leader-1', 'leader'
    );
  });

  it('maps requires_admin error to {ok:false, error:requires_admin}', async () => {
    requireOrganizationAdminOrLeader.mockResolvedValue({
      sub: 'leader-1',
      organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'leader', isActive: true }]
    });
    isOrgAdmin.mockReturnValue(false);
    updateMemberRole.mockRejectedValue(new OrgMemberError('requires_admin'));

    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-9', newRole: 'admin' })
    );
    expect(res).toEqual({ ok: false, error: 'requires_admin' });
  });

  it('accepts roleInOrg=leader in the invite schema', async () => {
    requireOrganizationAdminOrLeader.mockResolvedValue({ sub: 'admin-1', name: 'A', organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: true }] });
    isOrgAdmin.mockReturnValue(true);
    inviteMember.mockResolvedValue({ user: { id: 'u', email: 'l@t.local' }, inviteUrl: null, alreadyHasPassword: true });
    const res = await inviteOrgMemberAction(
      fd({ organizationId: 'org-1', email: 'l@t.local', name: 'L', roleInOrg: 'leader' })
    );
    expect(res).toMatchObject({ ok: true });
    expect(inviteMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roleInOrg: 'leader' }),
      'admin-1',
      { source: 'organization' },
      'admin'
    );
  });
});
```

> Update the existing `beforeEach` so `requireOrganizationAdminOrLeader` also has a default `mockResolvedValue` (admin actor), mirroring the existing `requireOrganizationAdmin` default, so prior tests keep passing.

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run src/__tests__/server-actions.organization.team.test.ts`
Expected: FAIL — actions still use `requireOrganizationAdmin`, don't pass `actorRole`, and reject `leader` in zod.

- [ ] **Step 3: Implement** — in `src/server-actions/organization/team.ts`:

Update imports:

```ts
import { requireOrganizationAdminOrLeader } from '@/lib/auth/requireRole';
import { isOrgAdmin } from '@/lib/auth/organizationPolicy';
```

Widen zod enums (lines 30 and 36):

```ts
  roleInOrg: z.enum(['admin', 'leader', 'member'])
```
```ts
  newRole: z.enum(['admin', 'leader', 'member'])
```

In each of the four actions, replace the guard line `const session = await requireOrganizationAdmin(parsed.data.organizationId);` with:

```ts
  const session = await requireOrganizationAdminOrLeader(parsed.data.organizationId);
  const actorRole = isOrgAdmin(session, parsed.data.organizationId) ? 'admin' : 'leader';
```

Pass `actorRole` as the trailing argument to each service call:
- `inviteMember(prisma, parsed.data, session.sub, { source: 'organization' }, actorRole)`
- `updateMemberRole(prisma, parsed.data.organizationId, parsed.data.orgUserId, parsed.data.newRole, session.sub, actorRole)`
- `deactivateMember(prisma, parsed.data.organizationId, parsed.data.orgUserId, session.sub, actorRole)`
- `reactivateMember(prisma, parsed.data.organizationId, parsed.data.orgUserId, session.sub, actorRole)`

(The `Failure` type already covers `requires_admin` via `OrgMemberErrorCode`; `mapMemberError` needs no change.)

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run src/__tests__/server-actions.organization.team.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server-actions/organization/team.ts src/__tests__/server-actions.organization.team.test.ts
git commit -m "feat(org): team server-actions allow leader actor + thread actorRole + leader role enum"
```

---

## Task 6: Team UI — leader role

**Files:**
- Modify: `src/app/organization/team/page.tsx:24`
- Modify: `src/components/organization/team-table.tsx`
- Modify: `src/components/organization/invite-org-user-form.tsx:7-14,158-168`

UI wiring — verified by `typecheck` + build; server-side enforcement is already tested in Tasks 4-5.

- [ ] **Step 1: Allow leader on the team page** — in `src/app/organization/team/page.tsx`, replace the guard (lines 21-26):

```tsx
  // Team management is admin/leader only — non-managers shouldn't reach this
  // page via direct URL. Sidebar already hides the link from members.
  if (ctx.viewerRole !== 'admin' && ctx.viewerRole !== 'leader') {
    redirect('/forbidden');
  }
```

Pass `viewerRole` to the table (update the `<TeamTable .../>` usage, ~line 58):

```tsx
        <TeamTable
          members={members}
          organizationId={ctx.activeOrgId}
          currentUserId={ctx.session.sub}
          viewerRole={ctx.viewerRole}
        />
```

- [ ] **Step 2: 3-way role control in TeamTable** — replace `src/components/organization/team-table.tsx` entirely with:

```tsx
import {
  updateOrgMemberRoleFormAction,
  deactivateOrgMemberFormAction,
  reactivateOrgMemberFormAction
} from '@/server-actions/organization/team';
import type { OrgMemberRow } from '@/lib/services/organization/team';

type Props = {
  members: OrgMemberRow[];
  organizationId: string;
  currentUserId: string;
  viewerRole: 'admin' | 'leader' | 'member';
};

const ROLE_LABELS: Record<'admin' | 'leader' | 'member', string> = {
  admin: 'Администратор',
  leader: 'Руководитель',
  member: 'Сотрудник'
};

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function TeamTable({ members, organizationId, currentUserId, viewerRole }: Props) {
  if (members.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <p className='text-gray-500 text-sm'>
          В команде пока нет участников. Пригласите первого администратора через форму выше.
        </p>
      </div>
    );
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th className='px-4 py-2.5 font-medium text-gray-600'>ФИО</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Email</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Роль</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Статус</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Приглашён</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Действия</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => {
            const isSelf = m.userId === currentUserId;
            // A leader may manage only member/leader rows; admin may manage anyone.
            const canManageTarget = viewerRole === 'admin' || m.roleInOrg !== 'admin';
            return (
              <tr
                key={m.organizationUserId}
                className={`border-b border-gray-50 ${i === members.length - 1 ? 'border-b-0' : ''} ${
                  !m.isActive ? 'bg-gray-50/50 text-gray-400' : 'hover:bg-[#FFF7ED]'
                }`}
              >
                <td className='px-4 py-2.5 font-medium'>
                  {m.name}
                  {isSelf && <span className='ml-2 text-xs text-gray-400'>(это вы)</span>}
                </td>
                <td className='px-4 py-2.5'>{m.email}</td>
                <td className='px-4 py-2.5'>{ROLE_LABELS[m.roleInOrg]}</td>
                <td className='px-4 py-2.5'>
                  {m.isActive ? (
                    <span className='inline-flex items-center gap-1 text-green-700 text-xs'>
                      <span className='w-1.5 h-1.5 rounded-full bg-green-500' />
                      Активен
                    </span>
                  ) : (
                    <span className='inline-flex items-center gap-1 text-gray-500 text-xs'>
                      <span className='w-1.5 h-1.5 rounded-full bg-gray-400' />
                      Деактивирован
                    </span>
                  )}
                </td>
                <td className='px-4 py-2.5 text-gray-500'>{fmtDate(m.invitedAt)}</td>
                <td className='px-4 py-2.5 text-right'>
                  {isSelf || !canManageTarget ? (
                    <span className='text-xs text-gray-400'>—</span>
                  ) : (
                    <div className='inline-flex items-center gap-2'>
                      {m.isActive && (
                        <form action={updateOrgMemberRoleFormAction} className='inline-flex items-center gap-1'>
                          <input type='hidden' name='organizationId' value={organizationId} />
                          <input type='hidden' name='orgUserId' value={m.organizationUserId} />
                          <select
                            name='newRole'
                            defaultValue={m.roleInOrg}
                            className='text-xs border border-gray-200 rounded px-1.5 py-1 bg-white'
                          >
                            <option value='member'>Сотрудник</option>
                            <option value='leader'>Руководитель</option>
                            {viewerRole === 'admin' && <option value='admin'>Администратор</option>}
                          </select>
                          <button type='submit' className='px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50'>
                            Применить
                          </button>
                        </form>
                      )}
                      {m.isActive ? (
                        <form action={deactivateOrgMemberFormAction}>
                          <input type='hidden' name='organizationId' value={organizationId} />
                          <input type='hidden' name='orgUserId' value={m.organizationUserId} />
                          <button type='submit' className='px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50'>
                            Деактивировать
                          </button>
                        </form>
                      ) : (
                        <form action={reactivateOrgMemberFormAction}>
                          <input type='hidden' name='organizationId' value={organizationId} />
                          <input type='hidden' name='orgUserId' value={m.organizationUserId} />
                          <button type='submit' className='px-2 py-1 text-xs text-green-700 border border-green-200 rounded hover:bg-green-50'>
                            Возобновить
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Invite form — leader option + error label** — in `src/components/organization/invite-org-user-form.tsx`:

Add to `ERROR_LABELS` (after line 13):

```ts
  requires_admin: 'Только администратор может назначать или изменять администраторов.',
```

Add the `leader` option to the role `<select>` (between the member and admin options, ~line 166):

```tsx
                <option value='member'>Сотрудник</option>
                <option value='leader'>Руководитель</option>
                <option value='admin'>Администратор</option>
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/app/organization/team/page.tsx src/components/organization/team-table.tsx src/components/organization/invite-org-user-form.tsx
git commit -m "feat(org): team UI supports leader role (3-way control gated by viewer, invite option)"
```

---

## Task 7: Finance service

**Files:**
- Create: `src/lib/services/organization/finance.ts`
- Test: `src/__tests__/services.organization.finance.test.ts` (integration)

- [ ] **Step 1: Write failing integration test** — create `src/__tests__/services.organization.finance.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  getOrgFinanceKpis,
  listOrgPayments,
  getOrgIntermediaryCommission
} from '@/lib/services/organization/finance';

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgId: string;
const STAMP = Date.now();

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({ data: { name: `FinP-${STAMP}`, commissionRate: new Prisma.Decimal('0.1') } });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `FinC-${STAMP}` } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: { name: `FinOrg-${STAMP}`, partnerId, companyId, partnerCommissionRate: new Prisma.Decimal('0.15') }
  });
  orgId = org.id;

  // billed 100000 / paid 40000 (partially_paid) ; billed 50000 / paid 50000 (paid) ; not_billed 9999 (excluded)
  const o1 = await prisma.order.create({
    data: { title: 'O1', organizationId: orgId, companyId, financialStatus: 'partially_paid',
      totalAmount: new Prisma.Decimal('100000'), paidAmount: new Prisma.Decimal('40000'), vatIncluded: true }
  });
  const o2 = await prisma.order.create({
    data: { title: 'O2', organizationId: orgId, companyId, financialStatus: 'paid',
      totalAmount: new Prisma.Decimal('50000'), paidAmount: new Prisma.Decimal('50000'), vatIncluded: true }
  });
  await prisma.order.create({
    data: { title: 'O3', organizationId: orgId, companyId, financialStatus: 'not_billed',
      totalAmount: new Prisma.Decimal('9999'), paidAmount: new Prisma.Decimal('0'), vatIncluded: true }
  });
  await prisma.payment.create({ data: { orderId: o1.id, amount: new Prisma.Decimal('40000'), paidAt: new Date('2026-05-01'), method: 'bank' } });
  await prisma.payment.create({ data: { orderId: o2.id, amount: new Prisma.Decimal('50000'), paidAt: new Date('2026-05-10'), method: 'bank' } });
  await prisma.payment.create({ data: { orderId: o2.id, amount: new Prisma.Decimal('5000'), paidAt: new Date('2026-05-11'), isRefund: true, note: 'возврат' } });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { order: { organizationId: orgId } } });
  await prisma.order.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

describe('getOrgFinanceKpis', () => {
  it('sums billed/paid over billed-ish orders, excludes not_billed', async () => {
    const k = await getOrgFinanceKpis(prisma, orgId);
    expect(k.billed).toBe('150000.00');
    expect(k.paid).toBe('90000.00');
    expect(k.outstanding).toBe('60000.00');
  });
});

describe('listOrgPayments', () => {
  it('returns all payments (incl. refunds) newest-first with order ref', async () => {
    const rows = await listOrgPayments(prisma, { organizationId: orgId });
    expect(rows).toHaveLength(3);
    expect(rows[0].isRefund).toBe(true); // 2026-05-11 newest
    expect(rows.every((r) => typeof r.orderId === 'string')).toBe(true);
  });
});

describe('getOrgIntermediaryCommission', () => {
  it('uses org override rate (0.15) over partner default, vatMode full', async () => {
    const c = await getOrgIntermediaryCommission(prisma, orgId);
    expect(c.effectiveRate).toBe('0.15');
    // base = 100000 + 50000 = 150000 (not_billed excluded); commission = 150000 * 0.15
    expect(c.totalCommission).toBe('22500.00');
    expect(c.perOrder).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm run test:integration -- services.organization.finance`
Expected: FAIL — module `@/lib/services/organization/finance` not found.

- [ ] **Step 3: Implement the service** — create `src/lib/services/organization/finance.ts`:

```ts
import type { PrismaClient, FinancialStatus } from '@prisma/client';
import { calculateCommission, type OrderForCalc } from '@/lib/services/commission/calculator';

const BILLED_STATUSES: FinancialStatus[] = ['billed', 'partially_paid', 'paid'];

export type OrgFinanceKpis = { billed: string; paid: string; outstanding: string };

export async function getOrgFinanceKpis(
  prisma: PrismaClient,
  organizationId: string
): Promise<OrgFinanceKpis> {
  const orders = await prisma.order.findMany({
    where: { organizationId, financialStatus: { in: BILLED_STATUSES } },
    select: { totalAmount: true, paidAmount: true }
  });
  let billed = 0;
  let paid = 0;
  for (const o of orders) {
    billed += Number(o.totalAmount);
    paid += Number(o.paidAmount);
  }
  return { billed: billed.toFixed(2), paid: paid.toFixed(2), outstanding: (billed - paid).toFixed(2) };
}

export type OrgPaymentRow = {
  id: string;
  amount: string;
  paidAt: Date;
  method: string | null;
  isRefund: boolean;
  note: string | null;
  orderId: string;
  orderNumber: string | null;
};

export async function listOrgPayments(
  prisma: PrismaClient,
  opts: { organizationId: string; take?: number }
): Promise<OrgPaymentRow[]> {
  const rows = await prisma.payment.findMany({
    where: { order: { organizationId: opts.organizationId } },
    orderBy: { paidAt: 'desc' },
    take: opts.take ?? 50,
    select: {
      id: true,
      amount: true,
      paidAt: true,
      method: true,
      isRefund: true,
      note: true,
      order: { select: { id: true, orderNumber: true } }
    }
  });
  return rows.map((p) => ({
    id: p.id,
    amount: p.amount.toFixed(2),
    paidAt: p.paidAt,
    method: p.method,
    isRefund: p.isRefund,
    note: p.note,
    orderId: p.order.id,
    orderNumber: p.order.orderNumber
  }));
}

export type OrgCommissionOrderRow = { orderId: string; orderNumber: string | null; baseAmount: string; commissionAmount: string };
export type OrgIntermediaryCommission = { effectiveRate: string; totalCommission: string; perOrder: OrgCommissionOrderRow[] };

export async function getOrgIntermediaryCommission(
  prisma: PrismaClient,
  organizationId: string
): Promise<OrgIntermediaryCommission> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, partnerCommissionRate: true, partner: { select: { commissionRate: true } } }
  });
  if (!org) return { effectiveRate: '0', totalCommission: '0.00', perOrder: [] };

  const effectiveRate = org.partnerCommissionRate ?? org.partner.commissionRate;
  const orders = await prisma.order.findMany({
    where: { organizationId, financialStatus: { in: BILLED_STATUSES } },
    select: { id: true, orderNumber: true, totalAmount: true, vatIncluded: true, vatRate: true }
  });

  const forCalc: OrderForCalc[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    organizationName: org.name,
    totalAmount: o.totalAmount,
    vatIncluded: o.vatIncluded,
    vatRate: o.vatRate,
    rate: effectiveRate
  }));
  const result = calculateCommission(forCalc, { vatMode: 'full' });

  return {
    effectiveRate: effectiveRate.toString(),
    totalCommission: result.totals.totalCommissionAmount.toFixed(2),
    perOrder: result.items.map((i) => ({
      orderId: i.orderId,
      orderNumber: i.orderNumber,
      baseAmount: i.baseAmount.toFixed(2),
      commissionAmount: i.commissionAmount.toFixed(2)
    }))
  };
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm run test:integration -- services.organization.finance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/organization/finance.ts src/__tests__/services.organization.finance.test.ts
git commit -m "feat(org): finance service — KPIs, payment ledger, intermediary commission (live calc)"
```

---

## Task 8: Finance presentational components

**Files:**
- Create: `src/components/organization/org-finance-kpis.tsx`
- Create: `src/components/organization/org-finance-payments.tsx`
- Create: `src/components/organization/org-finance-commission.tsx`

Presentational, server-renderable. Verified by `typecheck` + the page test/build in Task 9.

- [ ] **Step 1: KPI grid** — create `src/components/organization/org-finance-kpis.tsx`:

```tsx
import { StatCard } from '@/components/dashboard/stat-card';
import type { OrgFinanceKpis } from '@/lib/services/organization/finance';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

export function OrgFinanceKpisGrid({ kpis }: { kpis: OrgFinanceKpis }) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-3'>
      <StatCard title='Выставлено' value={fmtMoney(kpis.billed)} />
      <StatCard title='Оплачено' value={fmtMoney(kpis.paid)} />
      <StatCard title='Задолженность' value={fmtMoney(kpis.outstanding)} accent />
    </div>
  );
}
```

- [ ] **Step 2: Payment ledger** — create `src/components/organization/org-finance-payments.tsx`:

```tsx
import Link from 'next/link';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}

export function OrgFinancePayments({ payments }: { payments: OrgPaymentRow[] }) {
  if (payments.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='text-4xl mb-3'>💸</div>
        <p className='text-gray-500 text-sm'>Платежей пока нет.</p>
      </div>
    );
  }
  return (
    <div className='space-y-3'>
      <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider'>История платежей</h2>
      <div className='bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-gray-100 bg-gray-50 text-left'>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Дата</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Заказ</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Способ</th>
              <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className='border-b border-gray-50 last:border-b-0 hover:bg-[#FFF7ED]'>
                <td className='px-4 py-2.5 text-gray-500'>{fmtDate(p.paidAt)}</td>
                <td className='px-4 py-2.5'>
                  <Link href={`/organization/orders/${p.orderId}`} className='text-[#F97316] hover:underline'>
                    {p.orderNumber ?? '—'}
                  </Link>
                </td>
                <td className='px-4 py-2.5 text-gray-600'>
                  {p.isRefund ? <span className='text-red-600'>Возврат</span> : (p.method ?? '—')}
                </td>
                <td className={`px-4 py-2.5 text-right font-medium ${p.isRefund ? 'text-red-600' : 'text-gray-800'}`}>
                  {p.isRefund ? '−' : ''}{fmtMoney(p.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commission block** — create `src/components/organization/org-finance-commission.tsx`:

```tsx
import type { OrgIntermediaryCommission } from '@/lib/services/organization/finance';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

export function OrgFinanceCommission({ data }: { data: OrgIntermediaryCommission }) {
  const ratePct = (Number(data.effectiveRate) * 100).toFixed(2);
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider'>Комиссия посредника</h2>
          <p className='text-xs text-gray-400 mt-0.5'>Оценка по текущей ставке · видно только руководству</p>
        </div>
        <div className='text-right'>
          <div className='text-2xl font-bold text-[#111111]'>{fmtMoney(data.totalCommission)}</div>
          <div className='text-xs text-gray-500'>ставка {ratePct}%</div>
        </div>
      </div>
      {data.perOrder.length > 0 && (
        <details className='text-sm'>
          <summary className='cursor-pointer text-gray-500 hover:text-gray-700 text-xs'>По заказам</summary>
          <table className='w-full mt-2'>
            <thead>
              <tr className='bg-gray-50 text-left'>
                <th className='px-3 py-1.5 font-medium text-gray-500'>Заказ</th>
                <th className='px-3 py-1.5 font-medium text-gray-500 text-right'>База</th>
                <th className='px-3 py-1.5 font-medium text-gray-500 text-right'>Комиссия</th>
              </tr>
            </thead>
            <tbody>
              {data.perOrder.map((o) => (
                <tr key={o.orderId} className='border-t border-gray-50'>
                  <td className='px-3 py-1.5 text-gray-700'>{o.orderNumber ?? '—'}</td>
                  <td className='px-3 py-1.5 text-right text-gray-500'>{fmtMoney(o.baseAmount)}</td>
                  <td className='px-3 py-1.5 text-right font-medium text-gray-700'>{fmtMoney(o.commissionAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/organization/org-finance-kpis.tsx src/components/organization/org-finance-payments.tsx src/components/organization/org-finance-commission.tsx
git commit -m "feat(org): finance presentational components (kpis, payments, commission)"
```

---

## Task 9: Finance page + nav item

**Files:**
- Create: `src/app/organization/finance/page.tsx`
- Modify: `src/components/organization/org-sidebar.tsx:9-15` (ITEMS)
- Modify: `src/__tests__/components.org-sidebar.test.tsx` (nav-link counts)

- [ ] **Step 1: Update sidebar nav-link count tests first (red)** — in `src/__tests__/components.org-sidebar.test.tsx`:

Change the admin test (lines 49 + 59) from 5 to 6:

```ts
  it('renders 6 nav links for admin viewer', () => {
```
```ts
    expect(matches).toHaveLength(6);
```

Change the member test (lines 63 + 73) from 4 to 5:

```ts
  it('renders 5 nav links for member viewer (hides Команда)', () => {
```
```ts
    expect(matches).toHaveLength(5);
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run src/__tests__/components.org-sidebar.test.tsx`
Expected: FAIL — still 5/4 links until the nav item is added.

- [ ] **Step 3: Add the nav item** — in `src/components/organization/org-sidebar.tsx`, add to `ITEMS` (after the `documents` entry, line 12):

```tsx
  { href: '/organization/finance', label: 'Финансы', icon: '₽' },
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run src/__tests__/components.org-sidebar.test.tsx`
Expected: PASS (6 admin / 5 member).

- [ ] **Step 5: Create the page (field-level gated)** — create `src/app/organization/finance/page.tsx`:

```tsx
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgFinanceKpisGrid } from '@/components/organization/org-finance-kpis';
import { OrgFinancePayments } from '@/components/organization/org-finance-payments';
import { OrgFinanceCommission } from '@/components/organization/org-finance-commission';
import {
  getOrgFinanceKpis,
  listOrgPayments,
  getOrgIntermediaryCommission
} from '@/lib/services/organization/finance';

export default async function OrganizationFinancePage({
  searchParams
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);
  const canSeeCommission = ctx.viewerRole === 'admin' || ctx.viewerRole === 'leader';

  const [kpis, payments, commission] = await Promise.all([
    getOrgFinanceKpis(prisma, ctx.activeOrgId),
    listOrgPayments(prisma, { organizationId: ctx.activeOrgId }),
    canSeeCommission ? getOrgIntermediaryCommission(prisma, ctx.activeOrgId) : Promise.resolve(null)
  ]);

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className='space-y-6'>
        <div>
          <h1 className='text-2xl font-semibold text-[#111111]'>Финансы</h1>
          <p className='text-sm text-gray-500 mt-1'>Платежи и задолженность по «{ctx.activeOrgName}»</p>
        </div>
        <OrgFinanceKpisGrid kpis={kpis} />
        {commission && <OrgFinanceCommission data={commission} />}
        <OrgFinancePayments payments={payments} />
      </div>
    </OrgAppShell>
  );
}
```

- [ ] **Step 6: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed; `/organization/finance` appears in the route list.

- [ ] **Step 7: Commit**

```bash
git add src/app/organization/finance/page.tsx src/components/organization/org-sidebar.tsx src/__tests__/components.org-sidebar.test.tsx
git commit -m "feat(org): /organization/finance page + sidebar nav item (commission gated to admin/leader)"
```

---

## Task 10: Full verification

- [ ] **Step 1: Unit layer**

Run: `npm run test:unit`
Expected: all PASS.

- [ ] **Step 2: Integration layer** (live Postgres or `npm run gate`)

Run: `npm run test:integration`
Expected: all PASS (new finance + team-leader tests included).

- [ ] **Step 3: Lint + typecheck + build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all clean.

- [ ] **Step 4: Manual smoke (optional, see spec gotchas)** — with `FEATURE` flags as needed and a seeded org with a partner rate + orders/payments: log in as an org **member** → `/organization/finance` shows KPIs + payments, **no** commission block; log in as **leader**/**admin** → commission block visible; Team page → leader can set member↔leader but the `admin` option is absent and admin rows are read-only.

---

## Self-Review (completed during planning)

- **Spec coverage:** KPI+ledger (Tasks 7-9) ✓; commission live-calc gated (Tasks 1,7,8,9) ✓; `leader` role type+policies (Task 1) ✓; guard (Task 3); team service + privesc (Task 4); server-action (Task 5); team UI (Task 6); nav + viewerRole (Tasks 2,9) ✓; no schema migration ✓; tests (Tasks 1,3,4,5,7,9) ✓.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `OrgRoleInOrg = 'admin'|'leader'|'member'` used uniformly; service types `OrgFinanceKpis`/`OrgPaymentRow`/`OrgIntermediaryCommission`/`OrgCommissionOrderRow` defined in Task 7 and consumed unchanged in Task 8/9; `OrgFinanceKpisGrid` component name consistent between Task 8 (definition) and Task 9 (import); `actorRole` trailing-param signatures consistent between Task 4 (service) and Task 5 (caller).

## Notes / Known Gotchas

- **Integration tests need live Postgres.** Use `npm run test:integration` (live DB) or `npm run gate` (ephemeral Docker). On this Windows box, dev Postgres holds `:5432` — see memory/README; if the gate hook hangs, run integration directly.
- **`fmtMoney` is intentionally inlined** per component (matches the partner-finance house pattern; no shared util exists).
- **Field-level gating is server-side**: the page calls `getOrgIntermediaryCommission` only for admin/leader, so members never receive commission data in the HTML. The enforceable unit is `canSeeIntermediaryCommission` (Task 1); the page wires it.
