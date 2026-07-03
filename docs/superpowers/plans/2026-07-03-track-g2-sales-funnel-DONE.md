# Track G2 — Воронка продаж / канбан — DONE

**Дата:** 2026-07-03
**Plan:** [2026-07-03-track-g2-sales-funnel.md](2026-07-03-track-g2-sales-funnel.md) · **Spec:** [../specs/2026-07-03-track-g2-sales-funnel-design.md](../specs/2026-07-03-track-g2-sales-funnel-design.md)
**Branch:** `claude/mystifying-raman-96e2e5` (поверх G1)

## Что отгружено

AmoCRM-style канбан-воронка над `Lead`/`LeadStatus`: enforcement G1 `leads`-охвата, настраиваемые стадии (словарь `FunnelStage` поверх якорей), drag-drop доска, промоут→Order.

**Инвариант (как G1):** нет профиля → `listManagerLeads` team-wide байт-в-байт (регресс зелёный); профиль → leads-scope. Стадии: нет кастомных → дефолтные код-константа. Лиды single-tenant (нет `companyId`) — company-floor не применяется (задокументировано в коде).

### G2.1 — Флаг + leads-scope
- `sales_funnel` (opt-in) в 3 точках (featureFlags + middleware `FEATURE_PREFIXES`).
- `leadWhereForLevel(session, level)` + `canSeeLead` в `accessProfile.ts` (own=assignedManagerId; assigned=+managedOrgIds; all=team-wide). Enforced в `listManagerLeads` (session-опция; route прокидывает).

### G2.2 — Модель стадий
- `FunnelStage` (company-scoped, `statusAnchor: LeadStatus`, position, isTerminal) + `Lead.funnelStageId` (SET NULL). Миграция `20260703120000_funnel_stage` (аддитивная).
- `DEFAULT_FUNNEL_STAGES` (5 стадий) + `resolveFunnelStages` (кастомные или дефолты) + `stageForLead` в `lib/funnel/stages.ts`.

### G2.3 — Доска + move
- `getFunnelBoard` (лиды по колонкам-стадиям, в рамках leads-scope) + `moveFunnelLead` (диспетчер: intra-anchor → `funnelStageId`; смена якоря → lifecycle `setLeadStatus`/`promoteLead`/`rejectLead`; ошибки `org_required`/`reason_required`/`lifecycle_violation`/`invalid_stage`; scope-guard `canSeeLead` → not_found).

### G2.4 — Стадии CRUD
- `access/funnelStages.ts` (list/create/update/delete): company-scoped (IDOR → not_found), роль-гейт (admin|leader → forbidden), `position_taken` на `@@unique([companyId, position])`, аудит (`funnel_stage_*`; `funnel_stage` в `AuditEntity`).

### G2.5 — Server-actions + UI
- `server-actions/funnel/index.ts` — move + stage CRUD (`requireSession` + сервис энфорсит).
- `components/funnel/funnel-board.tsx` — канбан (нативный HTML5 drag-drop; drop → move; reason-диалог для «Отказа»; toast+refresh). `stage-config.tsx` — CRUD стадий (leader).
- Страницы `/leader/funnel` (доска + конфиг, `requireManagerLeader`) и `/manager/funnel` (доска, `requireManager`), обе `notFound()` при выключенном флаге. Nav «📈 Воронка» (leader+manager, `flag: 'sales_funnel'`).

## Проверка

```
npm run typecheck                        # 0 errors
npm run lint                             # 0 warnings / 0 errors
npm run test:unit                        # весь слой (см. финальный прогон)
prisma migrate deploy                    # 20260703120000_funnel_stage применена, 0 drift
integration (Postgres): 20 passed
  · services.manager.leads.scope (own/assigned/all/no-profile/AND)   5/5
  · services.funnel.board (dispatch/promote/reject/org_required/…)   8/8
  · services.access.funnelStages (CRUD/IDOR/position_taken/SET NULL) 7/7
+ unit: funnel.stages (4) · server-actions.funnel (8) · auth.accessProfile leadWhereForLevel (3)
+ обновлены inventory-тесты (nav/sidebar leader+manager, featureFlags) под доп. флаг/пункт
```
**Browser-render (authoritative server-HTML):** `/leader/funnel` → 200, title «Воронка продаж», 5 колонок (Новый лид→Отказ), 3 seeded-карточки, секция «Стадии воронки», draggable-карточки, **вложенных `<tr>`: 0**.

## Сознательно вне scope (следующие итерации)
1. **Быстрое добавление лида менеджером** — `Lead.partnerId` обязателен; direct-лид без партнёра требует модельного решения. Доска пока管ирует существующие (партнёрские) лиды.
2. **Материализация дефолтов при первой кастомной стадии** — сейчас создание 1-й кастомной стадии заменяет весь набор (config-UI предупреждает). Bulk-seed дефолтов в кастомные — follow-up.
3. **Реордер стадий drag-drop** — сейчас через поле «Позиция» (unique) в диалоге.
4. **G3** (внутренние задачи/канбан), **G4** (CRM-карточка организации), **отделы** — отдельные под-треки.

## Заметки окружения
Поднят Docker-Postgres (порт 5432) + `.env` с preview-флагами (вкл. `FEATURE_SALES_FUNNEL=on`); оба gitignored/локальные.
