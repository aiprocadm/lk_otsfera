# throw→Result Contract — волна 2 — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development (или executing-plans). Шаги — чекбоксы `- [ ]`.

**Goal:** привести 8 бросающих сервисов к §3 Result-контракту (см. spec `2026-06-28-throw-to-result-wave2-design.md`). Роуты/server-actions — тонкий маппинг. Поведение (HTTP-статусы, логика) не меняется; коды нормализуются в lowercase.

**Эталоны:** `admin/users/mutations.ts` (Pattern B в сервисе), волна-1 `organization/team.ts` + `partner/leads.ts`.

## Recipe (как в волне 1)

- **Pattern A** (throw до `$transaction`): `if (bad) return { ok: false, error: 'code' }`; happy → `return { ok: true, ...data }`.
- **Pattern B** (throw внутри `$transaction`): typed class + `try { return {ok:true, ...} } catch (e) { if (e instanceof XError) return {ok:false, error: e.code}; throw e; }`.
- **Caller:** `const res = await doX(...); if (!res.ok) return map(res.error); /* use res.<field> */`.
- **Тест:** `.rejects.toThrow(/CODE/)` → `expect(res).toEqual({ ok:false, error:'code' })`; happy-path читает `res.<field>` + `res.ok === true`.

---

## Task 1: Локализация (12 кодов)

- [ ] **Step 1.** В `src/lib/errors/messages.ts` добавить в `RU` коды из spec §6 (`email_taken`, `org_not_found`, `user_not_found`, `role_conflict`, `already_assigned`, `invalid_status`, `partner_not_found`, `period_overlap`, `duplicate_slug`, `duplicate_email`, `admin_role_via_ui`, `role_transition_forbidden`).
- [ ] **Step 2.** В `src/__tests__/lib.errorMessages.test.ts` добавить тест, что все 12 → не fallback.
- [ ] **Step 3.** `npx vitest run --mode=unit src/__tests__/lib.errorMessages.test.ts` → PASS.
- [ ] **Step 4.** Commit `feat(errors): localize wave-2 throw→Result codes`.

---

## Phase 1 — Flavor 1 (bare Error → Result, Pattern A)

### Task 2: `partner/team`
**Files:** `src/lib/services/partner/team.ts`; `src/app/api/partner/team/route.ts`, `.../[userId]/route.ts`; tests `services.partner.team.unit.test.ts`, `services.partner.team.test.ts`, `api.partner.team.test.ts`.

- [ ] `inviteMember` → `{ ok:true; user; partnerUser } | { ok:false; error:'org_out_of_scope'|'email_taken' }` (оба throw до tx).
- [ ] `assignOrgs` → `{ ok:true; partnerUser } | { ok:false; error:'org_out_of_scope' }`.
- [ ] `deactivateMember` → `{ ok:true; partnerUser } | { ok:false; error:'not_found'|'last_admin_protected' }`.
- [ ] Роуты: POST `/partner/team` (409 email_taken / 422 org_out_of_scope), PUT `[userId]` (422/404), DELETE `[userId]` (409 last_admin_protected / 404). Убрать `.startsWith`.
- [ ] Тесты → Result. typecheck. Commit `refactor(partner/team): throw→Result (§3) + thin routes`.

### Task 3: `manager/leadLifecycle`
**Files:** `src/lib/services/manager/leadLifecycle.ts`; `src/app/api/manager/leads/[id]/route.ts`; tests `services.manager.leadLifecycle.unit.test.ts`, `services.manager.leadLifecycle.test.ts`/`.unit2`, `api.manager.leads.test.ts`.

- [ ] `loadLead` → вернуть `Lead | null` (вместо throw); каждый caller проверяет null → `{ ok:false, error:'not_found' }`.
- [ ] `assignLead`/`setLeadStatus`/`rejectLead` → `{ ok:true; lead } | { ok:false; error:'not_found'|'lifecycle_violation' }`.
- [ ] `promoteLead` → `{ ok:true; order; lead } | { ok:false; error:'not_found'|'lifecycle_violation' }` (все guards до tx).
- [ ] Роут PATCH `/manager/leads/[id]`: убрать `mapError`; `not_found`→404, `lifecycle_violation`→409.
- [ ] Тесты → Result. typecheck. Commit `refactor(manager/leadLifecycle): throw→Result (§3) + thin route`.

### Task 4: `commission/statement`
**Files:** `src/lib/services/commission/statement.ts`; `src/app/api/partner/finance/statements/route.ts`; tests `services.commission.statement.unit.test.ts`, `services.commission.statement.test.ts`, `api.partner.finance.test.ts`.

- [ ] Конвертировать **только** два pre-tx throw: `PARTNER_NOT_FOUND`→`return {ok:false,error:'partner_not_found'}`, `PERIOD_OVERLAP`→`return {ok:false,error:'period_overlap'}`. **Внутренний P2002-catch в tx не трогать.**
- [ ] Сигнатура → `{ ok:true; ...CalculateStatementResult } | { ok:false; error:'partner_not_found'|'period_overlap' }`.
- [ ] Роут POST `/partner/finance/statements`: добавить маппинг `partner_not_found`→404, `period_overlap`→409.
- [ ] Проверить остальных вызывателей `calculateStatementForPartner` (worker `calculate-monthly-commissions`, seed) — обновить под Result (читают `res.ok`/`res.statement`).
- [ ] Тесты → Result. typecheck. Commit `refactor(commission/statement): throw→Result (§3)`.

### Task 5: `enrollments/lifecycle`
**Files:** `src/lib/services/enrollments/lifecycle.ts`; `src/app/api/enrollments/[id]/route.ts`; tests `services.enrollments.unit2.test.ts`, `services.enrollments.test.ts`, `api.enrollments.test.ts`.

- [ ] `loadRequest` → `EnrollmentRequest | null`.
- [ ] `approveEnrollment`/`rejectEnrollment` → `{ ok:true; request } | { ok:false; error:'not_found'|'lifecycle_violation' }`.
- [ ] `markProvisioned` → `… | { ok:false; error:'not_found'|'lifecycle_violation'|'validation' }`.
- [ ] Роут PATCH `/enrollments/[id]`: убрать `mapError`; `validation`→400, `not_found`→404, `lifecycle_violation`→409.
- [ ] Тесты → Result. typecheck. Commit `refactor(enrollments/lifecycle): throw→Result (§3) + thin route`.

---

## Phase 2 — Flavor 2 (boundary-catch в сервис, Pattern B)

### Task 6: `manager/status`
**Files:** `src/lib/services/manager/status.ts`; `src/server-actions/manager/transitionOrderStatus.ts`; tests `services.manager.status.unit.test.ts`, `server-actions.manager.status.test.ts`.

- [ ] `transitionOrderStatus` (throws до tx) → Pattern A: `{ ok:true; changed } | { ok:false; error:'invalid_status'|'not_found'|'forbidden' }`. Сохранить `ManagerStatusError`? Можно убрать класс (throws все до tx) — заменить на прямой return. Best-effort notify не трогать.
- [ ] Server-action: убрать `instanceof ManagerStatusError`-catch; вернуть `res` напрямую.
- [ ] Тесты → Result. typecheck. Commit `refactor(manager/status): throw→Result (§3), catch out of action`.

### Task 7: `manager/invite`
**Files:** `src/lib/services/manager/invite.ts`; `src/server-actions/admin/manager.ts`; tests `services.manager.invite.test.ts`, `server-actions.admin.manager.test.ts`.

- [ ] `createAndAssignManager` (throws `ManagerInviteError` внутри tx) → Pattern B: boundary-catch в сервисе, вернуть `{ ok:true; ... } | { ok:false; error: ManagerInviteErrorCode }`. Сохранить класс + внутренние throws.
- [ ] Server-action: убрать `instanceof`-catch; `res` напрямую. (`deactivateAssignment`/`reactivateAssignment` уже Result — не трогать.)
- [ ] Тесты → Result. typecheck. Commit `refactor(manager/invite): boundary-catch into service (§3)`.

### Task 8: `admin/organizations`
**Files:** `src/lib/services/admin/organizations.ts`; `src/server-actions/admin/organizations.ts`; tests `services.admin.organizations.test.ts`, `server-actions.admin.organizations.test.ts`.

- [ ] `updateOrganization` (throws `AdminOrgError` внутри tx) → Pattern B в сервисе: `{ ok:true } | { ok:false; error: AdminOrgErrorCode }`.
- [ ] Server-action `updateOrganizationAction`: убрать `instanceof AdminOrgError`-catch; `res` напрямую. Сохранить `setOrgRateOverrideAction` (уже Result из волны 1).
- [ ] Тесты → Result. typecheck. Commit `refactor(admin/organizations): boundary-catch into service (§3)`.

### Task 9: `admin/partners`
**Files:** `src/lib/services/admin/partners.ts`; `src/server-actions/admin/partners.ts`; tests `services.admin.partners.test.ts`, `server-actions.admin.partners.test.ts`.

- [ ] `updatePartner`/`deactivatePartner`/`reactivatePartner`/`createPartnerWithAdmin` (throws `AdminPartnerError` внутри tx) → Pattern B в сервисе.
- [ ] Server-action: убрать `mapErr`/`instanceof`-catch; `res` напрямую.
- [ ] Тесты → Result. typecheck. Commit `refactor(admin/partners): boundary-catch into service (§3)`.

---

## Task 10: Полная верификация

- [ ] `npm run typecheck` чисто; `npm run lint` чисто.
- [ ] `npm run test:unit` зелёный. Grep остаточных UPPER-кодов в callers/tests затронутых сервисов.
- [ ] Integration (live PG) по затронутым: `partner/team`, `manager/leadLifecycle`, `commission/statement`, `enrollments`, `manager/invite`, `admin/organizations`, `admin/partners`.
- [ ] Close-out `2026-06-28-throw-to-result-wave2-DONE.md`. Push + PR.

## Self-review
- Все 8 сервисов + локализация + вызыватели + тесты покрыты задачами 1–9; верификация — 10. ✓
- Поведение сохранено: HTTP-статусы те же, меняются только коды тела (lowercase). ✓
- Уже-compliant (`admin/users`, `manager/invite.{de,re}activate`) — не трогаем, только локализация их кодов в Task 1. ✓
