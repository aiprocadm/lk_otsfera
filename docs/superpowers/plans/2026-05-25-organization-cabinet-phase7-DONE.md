# Phase 7 — Organization Cabinet — DONE

**Дата завершения:** 2026-05-26
**Base commit:** `7091855` (Merge pull request #51 from aiprocadm/claude/admin-cabinet-mvp)
**Head commit:** `7655706` (feat(flags): ORGANIZATION_CABINET feature flag gating /organization/*) для PR #55; `eafe5be` (test(worker.oneCSync): robust cleanup walks full FK graph) для PR #56
**Branch:** `claude/partner-cabinet-phase3` (та же сборная ветка)
**Связанные PR:** #46–#56 (cascade на основной ветке); ключевые: #55 (7.4 + 7.5 + Task 39), #56 (7.6 Task 38)

## Что готово

### Часть 1 — Phase 7.4 Comments write + Email notifications (Tasks 28–30, PR #55)
- `src/lib/notifications.ts` — `notifyOrgUsers` helper (`3afdcd6`): fans out in-app Notification + best-effort Resend email to every active member of an organisation.
- 4 новых `sendOrg*Email` senders wrap templates landed in PR #54 (`comment_from_manager`, `payment_received`, `document_published`, `order_status_changed`).
- Worker notification hooks (`3bd7ef3`):
  - `sync-payments` → `payment_received` on new (non-refund) payments
  - `sync-documents` → `document_published` on new docs
  - `sync-orders` → `order_status_changed` when `financialStatus` diff detected on update (`executionStatus` is cabinet-owned and untouched by sync, no diff signal there)

### Часть 2 — Phase 7.5 Team + Invite (Tasks 31–37, PR #55)
- `src/lib/services/organization/team.ts` (`b82aaeb`): `listMembers`, `inviteMember` (transactional, reuses existing User by email, creates invite token if no password), `updateMemberRole`, `deactivateMember`, `reactivateMember`. Typed `OrgMemberError` codes: `already_member` / `last_admin_protected` / `self_action_forbidden` / `not_found`.
- **Invariant**: `assertNotLastActiveAdmin` excludes the candidate via `NOT { id }` so count reflects «admins after the operation».
- `src/lib/services/organization/invite.ts` (`e827020`): `createOrgAdminInvite` cross-cabinet shim с source-based policy — partner-admins только в свой portfolio; platform-admins anywhere. Tags audit row with `after.source`.
- `src/server-actions/organization/team.ts` (`2af685d`) — **первые `'use server'` actions в проекте**. Convention: `src/server-actions/<cabinet>/<feature>.ts`. Form-compatible void wrappers (`*FormAction`) рядом с typed Action functions.
- `src/app/organization/team/page.tsx` (`e2ec7d0`): admin-only, `TeamTable` (server-rendered rows с form actions) + `InviteOrgUserForm` (client-side modal с copy-to-clipboard invite URL).
- `/partner/portfolio/[orgId]` (`049c1db`) — «Customer access» block (read-only для partner-managers, invite button для partner-admins).
- `/admin/organizations` + `/admin/organizations/[id]` (`8994c8d`) — с тем же Customer Access block через `inviteAdminOrgAdminAction` (source='admin').

### Часть 3 — Phase 7.6 Feature flag (Task 39, PR #55)
- `src/lib/featureFlags.ts` (`7655706`): новая convention `OPT_IN_FLAGS` set инвертирует default для `organization_cabinet` (unset env ⇒ disabled). Существующие default-true flags untouched.
- `src/middleware.ts`: `/organization` добавлен в `FEATURE_PREFIXES` — 404 если `FEATURE_ORGANIZATION_CABINET` не truthy.
- `.env.example` документирует новый flag.

### Часть 4 — Phase 7.6 Task 38 — Order.organizationId NOT NULL (PR #56)
- Migration `20260526132950_order_organization_id_required` (`f200d0c`): drops FK (был `ON DELETE SET NULL`, incompatible с required column), sets NOT NULL, recreates FK с `ON DELETE RESTRICT`.
- Obsolete `backfillOrderOrganizationId` service + script + test removed — schema enforces what backfill achieved. Recoverable from git history.
- 10+ test fixture files обновлены — thread `organizationId` через каждый `prisma.order.create`. Orphan-row test cases removed.
- `canSeeOrder` / `canSeeDocument` сохраняют null-checks как runtime belt-and-suspenders (plan principle).

### Часть 5 — Phase 7.6 Task 40 — Playwright snapshots (PR #56)
- `prisma/seed.ts`: provisions `org@demo.local` user с admin `OrganizationUser` membership в firstOrg.
- `src/e2e/auth.setup.ts` (`98f89b6`): второй setup block логинит organization admin → `playwright-report/.auth/organization.json`. **Side fix**: `<label>` элементы на `/login` без `htmlFor` — `getByLabel` не матчился; switched to `input[type="email"]`/`input[type="password"]`.
- `playwright.config.ts`: 2 новых проекта (`org-desktop`, `org-mobile`) scoped через `testMatch` regex к `snapshots/organization-*.spec.ts`. Existing partner projects используют negative-lookahead.
- 3 specs: `organization-dashboard`, `organization-orders`, `organization-documents` — full-page screenshots after `networkidle`.
- **6 baseline PNGs committed** (visually reviewed before commit) (`9b53e70`). Verifies sidebar shows admin-only «Команда», KPI grid + events feed populate from seed.

### Часть 6 — Phase 7.6 Task 41 partial — Robust test cleanup (PR #56)
- `cleanupOrgs` / `deletePartnerCascade` helpers в `worker.oneCSync.upsert.test.ts` (`eafe5be`): walks FK graph in reverse-topological order. `CommissionStatementItem` dies before `Order` and `CommissionStatement`. `OrganizationUser` + `Student` die before `Organization`.
- Fixes brittleness when tests run after seed populated demo data.

## Проверка состояния

```
npm run typecheck   # 0 errors
npm run lint        # 0 new warnings (4 pre-existing в /admin/* untouched)
npm test            # 680 passed across 100 files (+91 tests this PR)
npm run build       # successful; новые роуты:
                    # /organization/team
                    # /admin/organizations
                    # /admin/organizations/[id]
                    # middleware 40kB → 40.1kB (new prefix entry)
```

## Что НЕ готово (Phase 8+)

- **Phase 8** Manager cabinet — реверсная сторона диалога (см. [manager-cabinet-phase8-DONE.md](2026-05-26-manager-cabinet-phase8-DONE.md)).
- **Task 41 manual smoke walkthrough** (12 шагов из spec §8.1) — by definition человеческий, операторская задача:
  - admin invite → reset → login → dashboard → orders → order detail → comment → documents → download → students → team invite → RBAC sanity.
- **Operator-driven enablement** — `FEATURE_ORGANIZATION_CABINET=1` в staging пилоте → broader staging → production flip.

## Сознательные упрощения (не баги)

1. **`'use server'` convention** (`src/server-actions/<cabinet>/<feature>.ts`) установлена впервые — будущие cabinets должны её следовать.
2. **Form-compatible void wrappers** (`*FormAction`) рядом с typed Actions — нужны потому что `<form action={fn}>` TS narrow к `void`, а imperative `useTransition` ожидает typed return.
3. **`assertNotLastActiveAdmin` использует `NOT { id }`** — count отражает post-operation state, не pre-state. Защищает от race condition.
4. **Cross-cabinet invite** через `createOrgAdminInvite` с `source` discriminator — alternative было бы два endpoint'а, выбрали один helper с policy branch'ингом.
5. **Order.organizationId NOT NULL** — стронгая referential integrity, но bulk-delete code paths теперь должны reassign или delete orders перед удалением Organization. На данный момент таких code paths нет.
6. **Baselines committed** (в отличие от Phase 5, где они были `update-snapshots` only) — Phase 7 snapshots более стабильны (нет dev-mode badge), и были visually reviewed.

## Метрики

- **Коммитов в Phase 7 (PR #54, #55, #56):** ~22 (часть commits ушла в PR #54 ранее)
- **Новых файлов:** ~28 (team service + invite + server-actions + UI, organization layout/dashboard, admin orgs pages, feature flags expansion, 3 snapshot specs + 6 baselines + auth setup, robust cleanup helpers)
- **Новых тестов:** +91 (680 vs 589)
- **Diff:** ~4500 insertions / ~120 deletions

## Deviations от плана

1. **`invite-customer-admin-form.tsx` shared** между partner и admin контекстами через `source: 'partner' | 'admin'` prop. План разделял.
2. **`<label>` fix в auth.setup.ts** — latent a11y bug, не было в плане. Найден и пофикшен alongside snapshot work.
3. **6 baselines committed** — план говорил «captured on first CI run»; Phase 7 baselines стабильны (Linux/Chromium), пошли committed-first.
4. **Pre-existing `prisma/migrations/migration_lock.toml`** untracked across sessions — НЕ включён в этот PR (намеренно).
5. **Phase 7 split на 3 PR** (#54 → #55 → #56). План был на 2 PR. Фактически разделение: PR #54 templates+notifications setup, PR #55 actions+UI+flag, PR #56 NOT NULL migration+snapshots+cleanup.

## Test plan (выполнено)

- [x] `npx prisma migrate deploy` — NOT NULL migration applied
- [x] `npm run prisma:seed` — `org@demo.local` member firstOrg
- [x] `npm run typecheck && npm run build` — green
- [x] `npx vitest run --pool=threads --poolOptions.threads.maxThreads=4` — 99 файлов ✓ (Windows + Node + Vitest teardown segfault скрывает summary line, но per-file ✓)
- [x] Visual review 6 committed baselines под `src/e2e/snapshots/organization-*-snapshots/`
- [ ] Manual smoke walkthrough (12 шагов, operator-driven)

---

**Operational notes:**
- **Production deploy ordering**: NOT NULL migration assumes no NULL `organizationId` rows. Production must run backfill (preserved at `7655706~1` in git history) before applying.
- **FK delete-action change**: previously `Order.organizationId` был `ON DELETE SET NULL`; now `ON DELETE RESTRICT`. Stronger referential integrity, но bulk-delete code paths нужно adjust.

**Следующая фаза:** Phase 8 — Manager Cabinet (см. [manager-cabinet-phase8-DONE.md](2026-05-26-manager-cabinet-phase8-DONE.md)).
