# Phase 8 — Manager Cabinet — DONE

**Дата завершения:** 2026-05-27
**Base commit:** `eafe5be` (test(worker.oneCSync): robust cleanup walks full FK graph) — после PR #56 merge
**Head commit:** `bce380a` (test(e2e): visual regression specs for manager dashboard, orders, documents + seed manager fixture)
**Branch:** `claude/manager-cabinet-phase8`
**Связанные PR:** #57 (Phases 8.0–8.4), #58 (Phases 8.5+8.6), #59 (a11y followup), #63 (manager docs route fix + CLAUDE.md)
**Spec:** [manager-cabinet-design.md](../specs/2026-05-26-manager-cabinet-design.md)

## Что готово

### Часть 1 — Phase 8.0 Foundation (PR #57)
- Migration `20260527100000_organization_manager` (`9b868f2`): новая таблица `OrganizationManager` (join: user × organization, mirror of `OrganizationUser`); индексы на `Comment(authorId, orderId)` для historical-comment RBAC path; `Order.executionStatus` ENUM активирован (`pending|in_progress|completed|cancelled|on_hold`).
- `src/lib/auth/managerPolicy.ts` (`6768481`): three-way RBAC — per-order (Order.managerId), per-org (OrganizationManager join), historical-comment (через Comment.authorId). `managerOrderScopeFilter` объединяет три пути.
- `src/lib/auth/requireRole.ts` (`bfbb282`): `requireManager()`, `requireManagerForOrg(orgId)`, `requireManagerForOrder(orderId)` — server-side guards.
- `src/lib/auth/login.ts` (`02e5a5b`): load `managedOrgIds` в session payload при login (для manager role).
- `src/lib/auth/policy.ts` refactor (`7a5a8f7`): manager branches переписаны с `OrganizationUser`-as-manager (wrong model) на `OrganizationManager` + `Order.managerId` через `managerPolicy.ts`.
- **Phase 8 фикс side-bug**: `/api/notifications/route.ts` (`f95e154`) — тот же legacy bug, найден в code review, пофикшен в этом PR.

### Часть 2 — Phase 8.1 Shell + Dashboard (PR #57)
- `src/components/manager/manager-app-shell.tsx` (`37da7bb`): server component с `requireManager()`, передаёт session + managedOrgIds в sidebar.
- `src/components/manager/manager-sidebar.tsx`: 6-item sidebar (Дашборд / Заказы / Документы / Организации / Студенты / Сообщения).
- `src/components/manager/manager-kpi-grid.tsx`, `manager-attention-list.tsx`, `manager-events-feed.tsx` (`d4efaf3`): dashboard widgets.
- `src/lib/services/manager/dashboard.ts` (`8c3f0ab`): сервис с KPI / attention / events для managed scope.
- `src/app/manager/dashboard/page.tsx` (`b480f77`): реальный dashboard (не stub).

### Часть 3 — Phase 8.2 Orders + status change (PR #57)
- `src/lib/services/manager/orders.ts` (`8ab06c6`): list/get с three-way RBAC scope.
- `src/lib/services/manager/status.ts` + `src/server-actions/manager/transitionOrderStatus.ts` (`4ee8d3c`): manager-settable transitions (`pending → in_progress → completed`).
- Components: `manager-orders-filter.tsx` (`1d355c9`), `manager-orders-table.tsx`, `manager-order-header.tsx`, `manager-order-amounts.tsx`, `manager-order-timeline.tsx`, `manager-payments-list.tsx`, `manager-status-change-form.tsx` (`21c7ad2`).
- Pages: `src/app/manager/orders/page.tsx` (`067c66d`), `[id]/page.tsx` (`4601e3e`).

### Часть 4 — Phase 8.3 Documents + Organizations + Students (PR #57)
- `src/lib/services/manager/documents.ts` (`cb32b9c`): list + signed-url download + hide-infected logic.
- `src/lib/services/manager/organizations.ts` (`442cb5c`): index/detail service.
- `src/lib/services/manager/students.ts` (`7910d87`): list scoped via `managedOrgIds`.
- Pages: `manager/documents/page.tsx` (`2f335bb`), `manager/organizations/page.tsx`, `manager/organizations/[id]/page.tsx`, `manager/students/page.tsx` (`7910d87`).
- API: `GET /api/manager/documents/[id]/download` (`cb32b9c`).

### Часть 5 — Phase 8.4 Write paths + Notifications (PR #57)
- `src/lib/services/manager/uploads.ts` + form `manager-doc-upload-form.tsx` + route `/api/manager/documents/[id]/upload` (`3c24d8e`): Supabase Storage + ClamAV scan queue + audit.
- `src/lib/services/manager/messages.ts` + `manager-messages-inbox.tsx` + `/manager/messages/page.tsx` (`ddbfec2`): inbox.
- `/api/comments/route.ts` (`53b3d40`): `viewer='manager'` branch; trigger `notifyOrgUsers` (org-side `manager_replied` template).
- `src/lib/notifications.ts` (`03ec43b`): `notifyManagers` helper с three-way recipient resolver + **invariant**: visibility set === notification set.
- Hooks (`e77bf27`, `f85173e`, `437968e`): org comments → `notifyManagers(comment_from_org)`; sync-payments → `notifyManagers(order_marked_paid_by_1c)`; transitionOrderStatus → `notifyManagers(order_status_changed)` other-managers.
- Email templates (`4fe1ce9`): `manager/comment_from_org`, `manager/document_uploaded_by_org`, `manager/order_marked_paid_by_1c`, `manager/order_status_changed` + `organization/manager_replied`.

### Часть 6 — Phase 8.5 Admin assign UI (PR #58)
- `src/lib/services/manager/team.ts` (`0200814`): `listManagersForOrg` — active + archived assignments.
- `src/lib/services/manager/invite.ts` (`b94e46c`): mode-discriminated `createAndAssignManager` (`'existing' | 'new'`) + `deactivateAssignment` / `reactivateAssignment` с in-place reactivation (вместо unique-constraint violation).
- `src/server-actions/admin/manager.ts` (`f212ef3`): 4 actions:
  - `assignOrInviteManagerAction({ mode: 'existing' | 'new', ... })`
  - `deactivateManagerAssignmentAction`
  - `reactivateManagerAssignmentAction`
  - `assignOrderManagerAction` (для per-order RBAC path)
- Components:
  - `src/components/admin/managers-block.tsx` (`04829aa`): server component, рендерит active + archived assignments на `/admin/organizations/[id]`.
  - `assign-or-invite-manager-form.tsx`: client modal с tabs (existing / pick-or-invite-new), invite URL + copy fallback.
  - `assign-order-manager-form.tsx` (`1c8e297`): on `/admin/orders/[id]`. Минимальный `/admin/orders/[id]` page restored (план assumed exists; не существовал).
- Email template: `manager/invite.tsx` + `sendManagerInviteEmail` wired в admin action.
- `AuditEntity` union gains `organization_manager`.

### Часть 7 — Phase 8.6 Feature flag + Polish (PR #58)
- `src/lib/featureFlags.ts` (`4b0d870`): `manager_cabinet` opt-in (default off).
- `src/middleware.ts`: `/manager/*` 404 когда flag off.
- `src/lib/navigation/cabinet.ts`: `navByRole.manager` gets `flag: 'manager_cabinet'` on every item.
- `prisma/seed.ts`: добавляет `manager@demo.local` fixture.

### Часть 8 — Playwright snapshots (PR #58)
- `manager-dashboard.spec.ts`, `manager-orders.spec.ts`, `manager-documents.spec.ts` (`bce380a`).
- `auth.setup.ts`: third setup block logins manager → `playwright-report/.auth/manager.json`.
- `playwright.config.ts`: `mgr-desktop` / `mgr-mobile` projects.
- **Baselines NOT committed** — generated on first staged run (как Phase 5).

### Часть 9 — A11y followup (PR #59, не основной Phase 8)
- Live regions on manager/admin form feedback + modal labelling and Escape (`f898248`, `185b433`).

### Часть 10 — Manager docs route fix (PR #63)
- Rename param `[orderId]` → `[id]` в `/api/manager/documents/[id]/upload` (`b5a6fc9`).
- **Latent bug**: Next.js requires identical slug names at the same path level; PR #58 broke это рядом с existing `/api/manager/documents/[id]/download`. Не пойман `next build` — нужен `next dev` boot check (добавлен в release checklist через PR #65).
- Дополнительно в PR #63: root CLAUDE.md для агентов + Husky-based test discipline.

## Проверка состояния

```
npm run typecheck   # 0 errors
npm run lint        # 0 new warnings (4 pre-existing `unused session` в admin/* untouched)
npm test            # 956 / 956 passing
npm run build       # successful, новые роуты:
                    # /manager/dashboard, /manager/orders, /manager/orders/[id]
                    # /manager/documents, /manager/organizations, /manager/organizations/[id]
                    # /manager/students, /manager/messages
                    # /api/manager/documents/[id]/{download,upload}
                    # /admin/orders/[id], expanded /admin/organizations/[id]
```

## Что НЕ готово (operator-driven, post-merge)

- **Staged rollout** — `FEATURE_MANAGER_CABINET=0` на merge (Stage 0 — dark launch).
- **Stage 1** (staging): `FEATURE_MANAGER_CABINET=1`, `npx prisma migrate deploy`, `npx prisma db seed`, `FEATURE_MANAGER_CABINET=1 npm run e2e:visual -- --update-snapshots` для baselines, commit baselines.
- **Stage 1 manual smoke** (spec §10.1, 12 шагов):
  1. admin invites manager → 2. reset password → 3. login → 4. dashboard → 5. orders list → 6. per-order assignment activates visibility → 7. org user comment notifies manager → 8. manager replies, org gets email → 9. manager changes status, org + other manager notified → 10. manager uploads PDF, org notified → 11. RBAC 404 on out-of-scope order → 12. comments-history persists after deactivation; deactivation shrinks scope on next login.
- **Stage 2 pilot**: enable for 3–5 real managers, monitor 1–2 weeks.
- **Stage 3 full rollout** once stable.

## Сознательные упрощения (не баги)

1. **`ExecutionStatus` enum** — `pending|in_progress|completed|cancelled|on_hold`, не план's `new|closed`. Адаптировано через все tasks.
2. **`Comment.authorRole` doesn't exist** — derived через `comment.author.role` JOIN. Documented as future denormalization candidate (spec §11).
3. **`Order.managerId` never populated** до Phase 8.5 admin assign UI — per-order RBAC path активируется только когда `assignOrderManagerAction` будет реально использован.
4. **`DocumentsList` reuse** через narrow optional props (`downloadEndpointBase`) — no `viewer` prop (per `feedback-component-reuse` memory).
5. **In-place reactivation** в `reactivateAssignment` вместо нового OrganizationManager row — избегает unique-constraint violation, сохраняет audit chain.
6. **Three-way recipient resolver invariant** — visibility set === notification set, защищает от notification leak (test в `notifications.invariant.test.ts`).
7. **No feature flag в PR #57** — план не требовал; добавлен в PR #58. Mitigation: no `role='manager'` user existed в prod (только seed для Phase 8.6).
8. **Baselines NOT committed** — generated on first staged Linux/Chromium run.

## Метрики

- **Коммитов в Phase 8:** 30+ commits across PRs #57 (~30) + #58 (~7) + #59 (a11y) + #63 (fix)
- **Новых файлов:** ~45 (manager services×6, manager components×12, manager pages×8, server-actions×2, admin components×3, email templates×5, requireRole expansion, managerPolicy, OrganizationManager migration, +3 snapshot specs, auth setup expansion)
- **Изменённых файлов:** ~25 (policy.ts refactor, login.ts, notifications.ts, /api/comments, /api/notifications, sync-payments, sync-orders, navigation, featureFlags, middleware, playwright.config, seed, AuditEntity)
- **Новых тестов:** +120+ (956 vs ~836)
- **Diff vs phase8 base:** ~2190 insertions / ~9 deletions (PR #58 alone)

## Deviations от плана

1. **`/api/manager/documents/[orderId]/upload`** изначально создан с `[orderId]` slug — конфликт с существующим `[id]/download` на том же пути. Не пойман `next build`, появился только в `next dev`. Фикс в PR #63: переименование в `[id]`.
2. **`Order.executionStatus` enum** — план говорил `new|closed`; реальная схема (`pending|in_progress|completed|cancelled|on_hold`) шире.
3. **Side-fix `/api/notifications`** route — план не упоминал; обнаружен в code review (тот же legacy `OrganizationUser`-as-manager bug).
4. **`/admin/orders/[id]` page restored** — план assumed existed; пришлось создать минимальный shell.
5. **Manager docs route fix отдельным PR** (#63) после merge основного — latent infra bug.
6. **A11y follow-up в отдельном PR** (#59) — план не включал; flagged как out-of-scope в PR #58 review.

## Test plan (выполнено)

- [x] `npm run typecheck` — 0 errors
- [x] `npm run lint` — 0 new warnings
- [x] `npm test` — 956/956 passing
- [x] `npm run build` — successful, 10 новых manager routes
- [x] `OrganizationManager` migration safety review (Prisma не использует `CREATE INDEX CONCURRENTLY` — flagged in code-review, ack'd)
- [x] Spot-check three-way RBAC в `managerPolicy.canSeeOrder` (per-order / per-org / comments-history)
- [x] `notifyManagers` recipient set === visibility set (test в `notifications.invariant.test.ts`)
- [ ] Stage 1 staging enablement (operator-driven)
- [ ] Stage 1 manual smoke (12 шагов, operator-driven)
- [ ] Stage 2 pilot (operator-driven)

---

**Operational notes:**
- **Migration safety**: `Comment(authorId, orderId)` index added без `CREATE INDEX CONCURRENTLY` (Prisma limitation). На пустой/малой проде безопасно; на больших таблицах может lock'нуть.
- **Default-off feature flag**: prod safety net — manager cabinet не reachable пока `FEATURE_MANAGER_CABINET=1`.

**Следующая фаза:** Operator-driven staged rollout. После завершения Stage 3 (full prod) — переключение flag на default-on или удаление gate.
