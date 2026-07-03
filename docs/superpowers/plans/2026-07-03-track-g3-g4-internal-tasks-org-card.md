# Track G3 + G4 — внутренние задачи/канбан + CRM-карточка организации — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development (RED→GREEN на каждый шаг). **Design:** [../specs/2026-07-03-track-g3-g4-internal-tasks-org-card-design.md](../specs/2026-07-03-track-g3-g4-internal-tasks-org-card-design.md)

**Goal:** Внутренний канбан задач (настраиваемые колонки, привязки, исполнители) + CRM-карточка организации-накопитель, оба видны только внутри компании.

**Инвариант:** флаг `internal_tasks` OFF → 0 новых путей, регресс зелёный. Company-floor (C8) держится в обоих teamMode. G4 — только чтение поверх существующих scope; комиссия скрыта в менеджерском контуре.

**Tech:** Next.js 15 · React 19 · TS strict · Prisma 5 + Postgres · Vitest. Паттерны — из G1/G2 (см. spec §2).

---

## File Structure

**Новые (G3 backend):**
- `prisma/migrations/20260703140000_internal_tasks/migration.sql`
- `src/lib/tasks/columns.ts` — DEFAULT_TASK_COLUMNS + resolveTaskColumns + columnForTask
- `src/lib/services/tasks/board.ts` — listTaskBoard + moveTask
- `src/lib/services/tasks/tasks.ts` — createTask/updateTask/deleteTask/assignTask
- `src/lib/services/tasks/columns.ts` — TaskColumn CRUD (клон access/funnelStages.ts)
- `src/server-actions/tasks/index.ts`

**Модифицируемые (G3 backend):**
- `prisma/schema.prisma` — TaskStatus/TaskPriority enums, TaskColumn/Task/TaskAssignee, back-relations, AccessProfile.tasksScope
- `src/lib/auth/accessProfile.ts` — tasks в AccessObjectType/SessionAccessProfile/schema/Row/toSessionAccessProfile + taskWhereForLevel + canSeeTask
- `src/lib/services/access/profiles.ts` — tasks в Input/inputSchema/toColumns/list/update-before-select
- `src/server-actions/access/profiles.ts` — readInput tasks
- `src/lib/auth/audit.ts` — 'task','task_column'
- `src/lib/featureFlags.ts` — internal_tasks
- `src/middleware.ts` — FEATURE_PREFIXES
- `src/lib/navigation/cabinet.ts` — nav items
- `src/components/access/role-editor.tsx` — OBJECT_TYPES += tasks

**Новые (G3 UI):** `src/components/tasks/{task-board,task-dialog,column-config}.tsx`, `src/app/manager/tasks/page.tsx`, `src/app/leader/tasks/page.tsx`

**Новые (G4):** `src/lib/services/manager/organizationCard.ts`, `src/components/manager/org-card-tabs.tsx`; модиф. `src/app/manager/organizations/[id]/page.tsx`, `src/lib/services/manager/{documents,messages}.ts` (+organizationId filter)

**Тесты:** `src/__tests__/tasks.columns.unit.test.ts`, `accessProfile.tasks.unit.test.ts`, `server-actions.tasks.test.ts`, `services.tasks.board.integration.test.ts`, `services.tasks.columns.integration.test.ts`, `services.tasks.isolation.test.ts`, `services.organizationCard.integration.test.ts`

---

## G3.1 — Схема + миграция

- [ ] Добавить enums `TaskStatus`/`TaskPriority` + модели `TaskColumn`/`Task`/`TaskAssignee` + `AccessProfile.tasksScope` + back-relations (Company/User/Order/Organization) — код в spec §3.
- [ ] `npm run prisma:generate`; `npm run typecheck` (ожид. ошибки в accessProfile до G3.6 — ок пока изолированно).
- [ ] Написать `migration.sql` вручную (CREATE TYPE TaskStatus/TaskPriority; CreateTable TaskColumn/Task/TaskAssignee; AlterTable AccessProfile ADD tasksScope; индексы; FK — company CASCADE, column/order/org SET NULL, createdBy RESTRICT-default, assignee CASCADE). Rollback-блок в шапке.
- [ ] `prisma migrate deploy` против локального Postgres; `prisma migrate status` → 0 drift.
- [ ] Commit: `feat(tasks): TaskStatus/TaskColumn/Task/TaskAssignee models + migration [G3.1]`

## G3.2 — Библиотека колонок (TDD, unit)

- [ ] RED: `tasks.columns.unit.test.ts` — `DEFAULT_TASK_COLUMNS` (4 колонки, done=isDoneColumn); `columnForTask` explicit-id / anchor-fallback / undefined-при-нет-совпадения.
- [ ] GREEN: `src/lib/tasks/columns.ts` (spec §4).
- [ ] `vitest run tasks.columns.unit` зелёный. Commit: `feat(tasks): default columns + resolver lib [G3.2]`

## G3.3 — AccessProfile.tasks (9 точек, TDD unit + typecheck)

- [ ] RED: `accessProfile.tasks.unit.test.ts` — `taskWhereForLevel` all/own/assigned + company-floor + null-company sentinel; `canSeeTask` зеркало.
- [ ] GREEN: accessProfile.ts (type/schema/Row/toSessionAccessProfile/taskWhereForLevel/canSeeTask) + services/access/profiles.ts + server-actions/access/profiles.ts + role-editor OBJECT_TYPES.
- [ ] `vitest run accessProfile.tasks.unit` + `typecheck` зелёные. Commit: `feat(access): tasksScope on AccessProfile + taskWhereForLevel/canSeeTask [G3.3]`

## G3.4 — Audit-сущности + флаг (3 точки)

- [ ] `audit.ts`: += 'task','task_column'. `featureFlags.ts`: internal_tasks в FEATURE_FLAGS+OPT_IN_FLAGS. `middleware.ts`: 2 FEATURE_PREFIXES. `cabinet.ts`: 2 nav items.
- [ ] Адаптировать inventory-тесты (featureFlags/navigation.cabinet/sidebar) — задачи ожидаемы при флаге ON.
- [ ] `vitest run` затронутых inventory зелёный. Commit: `feat(tasks): internal_tasks flag (3 points) + audit entities [G3.4]`

## G3.5 — Сервис колонок (TDD, integration)

- [ ] RED: `services.tasks.columns.integration.test.ts` — list/create/update/delete, position_taken, IDOR→not_found, роль-гейт (обычный manager→forbidden).
- [ ] GREEN: `src/lib/services/tasks/columns.ts` (клон access/funnelStages.ts; entity 'task_column'; TaskColumnView из lib/tasks/columns).
- [ ] Integration зелёный. Commit: `feat(tasks): TaskColumn CRUD service [G3.5]`

## G3.6 — Сервис задач + доска (TDD, integration)

- [ ] RED: `services.tasks.board.integration.test.ts` — listTaskBoard группировка по колонкам; createTask/updateTask/deleteTask/assignTask; moveTask (смена колонки; done→completedAt; scope-miss→not_found; invalid_column); привязка к order/org валидируется по companyId.
- [ ] GREEN: `board.ts` + `tasks.ts`.
- [ ] Integration зелёный. Commit: `feat(tasks): task board (list/move) + CRUD service [G3.6]`

## G3.7 — Server-actions (TDD, unit)

- [ ] RED: `server-actions.tasks.test.ts` — vi.hoisted+vi.mock; каждый action тонкий (service called with `{},SESSION,args`; revalidatePath('/manager/tasks','/leader/tasks')).
- [ ] GREEN: `src/server-actions/tasks/index.ts`.
- [ ] Unit зелёный. Commit: `feat(tasks): task server-actions [G3.7]`

## G3.8 — Isolation-контракт (integration)

- [ ] RED/GREEN: `services.tasks.isolation.test.ts` — partner/organization/student session → canSeeTask=false; нет клиентского service-пути; cross-company A/B → moveTask/updateTask возвращают not_found.
- [ ] Commit: `test(tasks): client-role + cross-company isolation contract [G3.8]`

## G3.9 — UI (канбан + диалог + конфиг + страницы + nav)

- [ ] `task-board.tsx` (клон funnel-board без reason), `task-dialog.tsx`, `column-config.tsx`.
- [ ] `/manager/tasks/page.tsx` (доска), `/leader/tasks/page.tsx` (доска+конфиг). requireManager/requireManagerLeader guard.
- [ ] Server-HTML проверка после логина (вложенных `<tr>`: 0). Commit: `feat(tasks): kanban board + task dialog + column config + pages [G3.9]`

## G4.1 — Org-filter в сервисах (TDD)

- [ ] `listDocuments`/`listIncomingComments`: Zod `organizationId?` + where `order.organizationId`. Тест на фильтр.
- [ ] Commit: `feat(manager): organizationId filter on documents/messages lists [G4.1]`

## G4.2 — getOrganizationCard (TDD, integration)

- [ ] RED: `services.organizationCard.integration.test.ts` — агрегация (orders/documents/payments/threads/kpis/реквизиты); IDOR чужая орг→null; комиссия=null без see_commission; C8 оба режима.
- [ ] GREEN: `src/lib/services/manager/organizationCard.ts` — узкий DTO (без finance-скаляров для менеджера), Promise.all, teamMode-aware scope.
- [ ] Commit: `feat(manager): getOrganizationCard aggregate service [G4.2]`

## G4.3 — Табовая страница

- [ ] `org-card-tabs.tsx` + расширить `/manager/organizations/[id]/page.tsx` (табы через `?tab=`; История/Заявки/Документы/Оплаты/Переписка/Реквизиты; loading/empty/error).
- [ ] Server-HTML проверка. Commit: `feat(manager): organization CRM card tabs [G4.3]`

## Final verification

- [ ] `npm run typecheck` (0), `npm run lint` (0), `npm run test:unit` (зелёный), integration затронутых (зелёный), `prisma migrate status` (0 drift).
- [ ] Close-out `-DONE.md` (или `-PARTIAL.md` если integration не прогнан end-to-end в worktree) с реальным выводом команд.

---

## Self-Review

- **Spec coverage:** G3.1–G3.9 покрывают spec §3–§7; G4.1–G4.3 покрывают §8. Флаг 3 точки — G3.4. Isolation §4 — G3.8. ✓
- **Type consistency:** `TaskColumnView`/`TaskStatus`/`TaskPriority` едины между schema/lib/services. `taskWhereForLevel`/`canSeeTask` имена совпадают spec↔plan. ✓
- **Placeholders:** нет — код в spec §3–§5, шаги TDD RED→GREEN явные. ✓
