# Track G2 (P2) — Воронка продаж / канбан

> REQUIRED SUB-SKILL: superpowers:test-driven-development. **Design:** [../specs/2026-07-03-track-g2-sales-funnel-design.md](../specs/2026-07-03-track-g2-sales-funnel-design.md).

**Goal:** AmoCRM-style канбан-воронка над `Lead`/`LeadStatus`: enforcement G1 `leads`-охвата, настраиваемые стадии (словарь `FunnelStage` поверх якорей), drag-drop доска, быстрое добавление, промоут→Order.

**Инвариант (как G1):** нет профиля → legacy team-wide `listManagerLeads` байт-в-байт (регресс зелёный); профиль → leads-scope + company-floor. Стадии: нет кастомных → дефолтные (код-константа); есть → словарь.

## Задачи

### G2.1 — Флаг + leads-scope (бэкенд, TDD)
- [ ] `sales_funnel` (opt-in) в `featureFlags.ts` (FEATURE_FLAGS + OPT_IN) + middleware `FEATURE_PREFIXES` (`/leader/funnel`, `/manager/funnel`).
- [ ] `leadWhereForLevel(session, level)` в `accessProfile.ts` (company-floor через `partner.companyId`/`organization.companyId`; own=assignedManagerId==sub; assigned=+managedOrgIds; all=company-floor). Unit-тест.
- [ ] Enforce в `listManagerLeads`: профиль → `leadWhereForLevel(session, profile.leads)`; нет профиля → legacy (без фильтра). Регресс `manager.leads*` зелёный. Integration-тест.

### G2.2 — Модель настраиваемых стадий (бэкенд)
- [ ] `FunnelStage { id, companyId, name, position, statusAnchor: LeadStatus, color?, isTerminal }` + `@@unique([companyId, position])`; `Lead.funnelStageId String?` + relation. Миграция аддитивная.
- [ ] `DEFAULT_FUNNEL_STAGES` код-константа (Новый лид=new, В работе=in_review, Квалифицирован=qualified, Передано в работу=promoted_to_order[term], Отказ=rejected[term]).
- [ ] `resolveFunnelStages(prisma, companyId)` → кастомные или дефолтные (синтетические id `default:<anchor>`). Unit-тест на дефолты.

### G2.3 — Сервис доски + move (бэкенд, TDD)
- [ ] `getFunnelBoard(prisma, session)` → `{ stages, cards: Lead[] по stage }` в рамках leads-scope. Карта: `funnelStageId` или дефолтная стадия по `status`. Integration.
- [ ] `moveFunnelLead(prisma, session, {leadId, toStageId, reason?})` → если target-anchor ≠ status: lifecycle (`setLeadStatus`/`promoteLead`/`rejectLead`, ошибки `org_required`/`reason_required`/`lifecycle_violation`); иначе — только `funnelStageId`. Company/scope-guard (`canSeeLead`). Integration.

### G2.4 — Стадии CRUD (бэкенд, TDD)
- [ ] Сервис `access/funnelStages.ts` (по образцу `access/profiles.ts`): list/create/update/delete + reorder. Company-scoped, роль-гейт (admin|leader), аудит (`funnel_stage_*`). Integration.

### G2.5 — Server-actions + UI (канбан + конфиг)
- [ ] `src/server-actions/funnel/` — moveFunnelLeadAction, createLeadAction(quick-add), stage CRUD actions. Unit-тесты.
- [ ] `src/components/funnel/funnel-board.tsx` — канбан (нативный HTML5 drag-drop; колонки=стадии, карточки=лиды; quick-add; toast+refresh). `stage-config.tsx` — CRUD стадий (по образцу role-editor).
- [ ] Страницы `/leader/funnel` (+ `/manager/funnel`), nav-пункт «Воронка» (флаг `sales_funnel`). Флаг-гейт page + middleware.
- [ ] Обновить inventory-тесты (nav/sidebar/featureFlags) под доп. флаг/пункт.

## Verification
`typecheck` · `lint` · `test:unit` · integration (Postgres up: board/move/scope/stages) · browser-render канбана.

## PR-split
Всё в одной ветке (пользователь выбрал «всё G2 сразу»); коммиты по под-задачам G2.1–G2.5.
