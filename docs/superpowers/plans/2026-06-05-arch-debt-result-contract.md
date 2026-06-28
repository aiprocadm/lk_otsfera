# Arch-debt C4: error-contract → §3 Result-type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `admin/users.ts` and `partner/leadAttachments.ts` from throwing typed errors to the §3 Result contract (`{ ok: true; … } | { ok: false; error: code }`), updating every caller; routes/server-actions only map code → HTTP.

**Architecture:** Boundary `try/catch` — internal `throw new XError(...)` and `$transaction` rollback semantics stay; the public function wraps its body and converts the domain error class to a Result, re-throwing unexpected errors. admin/users → pure-code Result; leadAttachments → rich Result preserving `message`+`meta.scanReason` so route responses are byte-identical. Full per-function/per-caller detail in the **[spec](../specs/2026-06-05-arch-debt-result-contract-design.md)**.

**Tech Stack:** TypeScript 5 (strict). Gate = `npm run typecheck` (union-narrowing forces every caller branch) + `npm run lint` + service/api tests + full unit + `next build`.

**Atomicity note:** a contract change must land per-side in ONE commit (service + its callers + its tests together) — committing the service alone breaks `tsc` and the pre-commit hook blocks it.

---

### Task 1: admin/users.ts → §3 Result (atomic: service + server-action + tests)

**Files:**
- Modify: `src/lib/services/admin/users.ts` (createUser/updateUser/deactivateUser/reactivateUser → Result via boundary catch; add `type AdminUserFailure = { ok: false; error: AdminUserErrorCode }`)
- Modify: `src/server-actions/admin/users.ts` (drop `mapErr` + `AdminUserError` import; `const r = await svc(); if (!r.ok) return r;`)
- Modify (tests): `src/__tests__/services.admin.users.test.ts` (throw-assertions → Result assertions)
- Verify-only: `src/__tests__/server-actions.admin.users.test.ts` (external contract unchanged — should pass as-is)

- [ ] **Step 1:** Convert the 4 mutations in `admin/users.ts` to boundary-catch Result (signatures per spec table). Keep `AdminUserError` class + `AdminUserErrorCode` export. `getUser`/`listUsers` untouched.
- [ ] **Step 2:** Simplify `server-actions/admin/users.ts` — remove `mapErr`, remove `AdminUserError` value-import (keep `AdminUserErrorCode` type), rewrite 4 actions to `if (!r.ok) return r`.
- [ ] **Step 3:** Update `services.admin.users.test.ts` assertions to the Result contract.
- [ ] **Step 4:** `npm run typecheck` → PASS (catches any un-narrowed caller branch).
- [ ] **Step 5:** `npm run test:integration -- services.admin.users` and `npm run test:unit -- server-actions.admin.users` → PASS.
- [ ] **Step 6:** Commit: `refactor(admin): users service returns §3 Result instead of throwing (C4)`.

---

### Task 2: leadAttachments.ts → §3 rich Result (atomic: service + 3 routes + page + test)

**Files:**
- Modify: `src/lib/services/partner/leadAttachments.ts` (extract `LeadAttachmentErrorCode`; add `LeadAttachmentFailure`; 4 functions → Result via boundary `toFailure`; keep class + upload compensation)
- Modify: `src/app/api/partner/leads/[id]/attachments/route.ts` (GET+POST: `mapErrorToResponse`→`mapFailureToResponse`, Result-check)
- Modify: `src/app/api/partner/leads/[id]/attachments/[attachmentId]/route.ts` (DELETE)
- Modify: `src/app/api/partner/leads/[id]/attachments/[attachmentId]/download/route.ts` (GET, INFECTED→410)
- Modify: `src/app/partner/leads/[id]/page.tsx:47` (`const attRes = await listLeadAttachments(...); const attachments = attRes.ok ? attRes.rows : []`)
- Modify (test): `src/__tests__/api.partner.leads.attachments.test.ts` (only if it asserts service throws; route-response assertions stay)

- [ ] **Step 1:** Convert the 4 functions in `leadAttachments.ts` (signatures per spec). `mapFailureToResponse` reads `f.error`/`f.message`/`f.meta?.scanReason` — same statuses/bodies. Keep `LeadAttachmentError` class + the upload orphan-compensation inner try/catch.
- [ ] **Step 2:** Rewrite the 3 routes to Result-check (responses byte-identical) + the page line.
- [ ] **Step 3:** Update `api.partner.leads.attachments.test.ts` only where it touches the service contract directly.
- [ ] **Step 4:** `npm run typecheck` → PASS.
- [ ] **Step 5:** `npm run test:integration -- leadAttachments`-related + `npm run test:unit -- api.partner.leads.attachments` (or whichever layer it is) → PASS.
- [ ] **Step 6:** Commit: `refactor(partner): leadAttachments service returns §3 Result instead of throwing (C4)`.

---

### Task 3: Full gate

- [ ] **Step 1:** `rg -n "instanceof (AdminUserError|LeadAttachmentError)"` outside the two service files → no matches (callers no longer catch the class).
- [ ] **Step 2:** `npm run typecheck` clean · `npm run lint` clean.
- [ ] **Step 3:** `npm run test:unit` (full) → all pass.
- [ ] **Step 4:** `npm run test:integration -- "admin.users|leadAttachments|attachments"` → pass (touched services + routes).
- [ ] **Step 5:** `npm run build` → compiles.
- [ ] **Step 6:** Subagent review (spec adherence: rollback preserved, responses identical, no domain-error leaks to callers).

---

## Self-Review

- **Spec coverage:** both services + all callers (server-action, 3 routes, page) + 3 tests covered (Tasks 1-2); gate = Task 3. ✓
- **Atomicity:** each side commits service+callers+tests together (typecheck-green per commit). ✓
- **Behavior preserved:** HTTP statuses/bodies (incl. INFECTED 410 + scanReason), transaction rollback (boundary-catch), upload orphan-compensation — all unchanged by design. ✓
- **Out of scope:** getUser/listUsers (non-throwing reads), code renames, status/message changes. ✓
