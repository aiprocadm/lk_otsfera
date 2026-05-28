# Housekeeping sweep — plan close-outs, CLAUDE.md §8, README cabinet status — design

**Date:** 2026-05-28
**Author:** Claude (session-driven, opus-4-7)
**Status:** Approved (design step), pending implementation
**Related:** PRs #46, #50, #52, #55, #56, #57, #58, #62 (delivered work that lacks close-out docs); CLAUDE.md §8 (plan-rename rule)

## Problem

Three small but compounding hygiene gaps make the repo harder to read for any agent or human looking at it cold:

1. **Six shipped plans lack `-DONE.md` close-outs.** `phase3`, `phase5`, `organization-phase7`, `manager-phase8`, `modal-focus-trap` are merged to `main` (see PR list below), and `admin-cabinet-mvp` is partially shipped (only sub-phases 6.0–6.2 of 8). For Phases 0/1/2/4 the convention is "long plan stays, short close-out is added next to it" (see [phase4-DONE.md](../plans/2026-05-22-partner-cabinet-phase4-DONE.md) as the canonical example). The newer plans broke the streak.

2. **CLAUDE.md §8 contradicts actual practice.** The rule says "после завершения файл плана **переименовывается** в `*-DONE.md`". Practice says "**рядом** создаётся короткий close-out". The contradiction is silent today, but a future agent reading CLAUDE.md literally would rename (= delete the planning record). The contract has to match the practice.

3. **README has no `Cabinet rollout status`.** The "New cabinets (MVP)" section lists `/partner/dashboard` and `/organization/dashboard` but is missing `/manager/dashboard`, and nowhere documents that `organization_cabinet` and `manager_cabinet` are gated by opt-in feature flags. An operator checking why `/manager/dashboard` returns 404 in prod cannot find the answer in README.

## Goal

Close all three gaps in one atomic PR with two coherent commits. Keep edits scoped to documentation — no code changes, no test impact, no behavioural change for any user.

After this PR:
- A future agent reads `docs/superpowers/plans/` and can immediately tell what's shipped, what's partial, and what's planned-but-not-started.
- CLAUDE.md §8 matches the actual workflow (and includes the `-PARTIAL.md` extension for partial close-outs).
- README has a single table that answers "which cabinet exists, which routes does it own, and is it gated?" — for both operators and new contributors.

## Non-goals

- No retroactive close-outs for Phase 0/1/2/4 (already have `-DONE.md` siblings — leave as-is).
- No removal of the long planning docs (`phase3.md`, `phase5.md`, etc.) — they are intentional historical records of "what we planned" vs. what shipped.
- No remote-branch cleanup, no lint sweep, no test re-runs. Those are out of "Standard" scope (see brainstorming Q2).
- No new commands, hooks, or skills introduced.
- Pages 6.3–6.7 of the admin cabinet (users/partners/orgs CRUD, audit viewer, manual QA) are **explicitly out of scope** — `-PARTIAL.md` only documents that they are not started.

## Design

### Section 1 — Close-out document template

Copied 1:1 from the structure of `2026-05-22-partner-cabinet-phase4-DONE.md`. Sections in fixed order:

```
# <Phase Name> — DONE        (or "— PARTIAL")

**Дата завершения:** YYYY-MM-DD
**Base commit:** <sha> (<commit subject>)
**Head commit:** <sha> (<commit subject>)
**Branch:** <branch>
**Связанные PR:** #N, #M

## Что готово
### Часть 1 — <тема>
- bullet с коммитом
...

## Проверка состояния
```
npm run typecheck   # 0 errors at head commit
npm run lint        # 0 warnings at head commit
npm test            # <X passed> at head commit
npm run build       # successful, <изменения routes>
```

## Что НЕ готово (следующая фаза)
- bullet

## Сознательные упрощения (не баги)
1. ...

## Метрики
- Коммитов: N
- Новых файлов: N
- Изменённых файлов: N
- Новых тестов: N

## Deviations от плана
1. ...

## Test plan (выполнено)
- [x] typecheck
- [x] lint
- ...
```

**For `-PARTIAL.md` close-outs**, the document includes an additional top-level section right after "Связанные PR":

```
## Статус фаз
- [x] <sub-phase> — <one-line summary> — PR #N
- [x] ...
- [ ] <sub-phase> — NOT STARTED
- [ ] ...

**Решение:** <why subsequent phases were not started; pointer to decision context>
```

### Section 2 — Six close-out documents to create

| New file | Source plan | Head commit | PR(s) | Type |
|---|---|---|---|---|
| `2026-05-21-partner-cabinet-phase3-DONE.md` | `phase3.md` | `447777b` | #45, #46 | DONE |
| `2026-05-22-partner-cabinet-phase5-DONE.md` | `phase5.md` | `05529e3` | #48, #49, #50 | DONE |
| `2026-05-24-admin-cabinet-mvp-PARTIAL.md` | `admin-cabinet-mvp.md` | `7091855` | #51, #52 | **PARTIAL** |
| `2026-05-25-organization-cabinet-phase7-DONE.md` | `organization-cabinet-phase7.md` | `7655706` | #55, #56 | DONE |
| `2026-05-26-manager-cabinet-phase8-DONE.md` | `manager-cabinet-phase8.md` | `bce380a` | #57, #58 | DONE |
| `2026-05-27-modal-focus-trap-DONE.md` | `modal-focus-trap.md` | `28238db` | #61 (spec), #62 (impl) | DONE |

Each close-out is **populated from the commit body of its head commit + PR descriptions**, not from speculation. The "Что НЕ готово" section copies forward-looking notes the original plan flagged as deferred (the source plans all have explicit "follow-up" / "outside scope" subsections — see phase4-DONE's `Что НЕ готово (Phase 5+)` block for shape). For plans without a defined successor (e.g. `modal-focus-trap` — accessibility hardening, no Phase 9 lined up), the section reads "Нет планируемой следующей фазы" with a one-line scope note.

### Section 3 — Admin cabinet `-PARTIAL.md` specifics

The admin plan (`2026-05-24-admin-cabinet-mvp.md`) defines 8 sub-phases. Reality from PRs #51 + #52:

```
## Статус фаз

- [x] 6.0 — Foundation (password reset migrations, AdminAppShell scaffold) — PR #51, #52
- [x] 6.1 — Admin shell + sidebar + RBAC guards — PR #51, #52
- [x] 6.2 — Dashboard with platform-wide KPI — PR #51, #52
- [ ] 6.3 — Users management (list, edit, invite) — NOT STARTED
- [ ] 6.4 — Partners management (CRUD, rate overrides) — NOT STARTED
- [ ] 6.5 — Organizations management (CRUD, scope filters) — NOT STARTED
- [ ] 6.6 — Audit log viewer — NOT STARTED
- [ ] 6.7 — Polish + manual QA + Lighthouse — NOT STARTED

**Решение:** Phase 6.3–6.7 deferred — partner / organization / manager cabinets took priority (PRs #46, #55-#58). Resuming requires a fresh brainstorming session: requirements may have drifted (e.g. audit log viewer needs new event types added by Phase 7/8 work).
```

The `## Что НЕ готово` section in this file is the same list (sub-phases 6.3–6.7), restated as the explicit next-work pointer.

### Section 4 — CLAUDE.md §8 wording fix

**Before (current text):**

> 3. После завершения файл плана переименовывается в `*-DONE.md`.

**After:**

> 3. После завершения **рядом** с планом создаётся короткий close-out `<plan>-DONE.md` (см. эталон [partner-cabinet-phase4-DONE.md](docs/superpowers/plans/2026-05-22-partner-cabinet-phase4-DONE.md)) — план хранит «что планировали», close-out хранит «что отгрузили». Если работа отгружена частично, использовать суффикс `-PARTIAL.md` с явным блоком «Статус фаз» (см. эталон [admin-cabinet-mvp-PARTIAL.md](docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md)).

The link target `admin-cabinet-mvp-PARTIAL.md` is the new file from Section 2, so the cross-reference resolves after this PR lands.

### Section 5 — README "Cabinet rollout status" block

Inserted **after** the existing `## New cabinets (MVP)` section (line 131 of the current README), and the existing section gets one additional bullet for `/manager/dashboard`:

**Patch to existing section:**

```diff
 ## New cabinets (MVP)
 - `/partner/dashboard` — dashboard партнера с агрегированными метриками.
 - `/organization/dashboard` — dashboard организации.
+- `/manager/dashboard` — dashboard внутреннего менеджера Промтехносферы.
 - `/student` + `/student/redirect` — временный SSO-like переход во внешний LMS по signed JWT.
 - Middleware ограничивает доступ по ролям и изолирует кабинеты.
```

**New section to add directly after:**

```markdown
## Cabinet rollout status

| Cabinet | Маршрут | Feature flag | Default | Состояние |
|---|---|---|---|---|
| Partner | `/partner/*` | — | always on | Production (Phase 0–5 done) |
| Organization | `/organization/*` | `FEATURE_ORGANIZATION_CABINET` | **opt-in** (off) | Staged rollout (Phase 7 done, operator-driven enablement) |
| Manager | `/manager/*` | `FEATURE_MANAGER_CABINET` | **opt-in** (off) | Staged rollout (Phase 8 done, operator-driven enablement) |
| Admin | `/admin/*` | — | always on | Partial (Phase 6.0–6.2 done; sub-phases 6.3–6.7 not started — см. [admin-cabinet-mvp-PARTIAL.md](docs/superpowers/plans/2026-05-24-admin-cabinet-mvp-PARTIAL.md)) |
| Student | `/student/*` | — | always on | Production (bridge redirect) |

Opt-in флаги означают: код в `main`, но эндпоинты возвращают 404 пока env-флаг не выставлен в `1/true/on`. Это поэтапная раскатка по операторам — см. [src/lib/featureFlags.ts](src/lib/featureFlags.ts) для семантики флагов.
```

### Section 6 — Commit + PR strategy

- **Branch:** `chore/housekeeping-plan-closeouts` from `origin/main`.
- **Commit 1** — `docs(plans): close-out documents for shipped phases (phase3, phase5, phase7, phase8, modal-focus-trap) + admin PARTIAL`
  - Adds the 6 new files from Section 2.
- **Commit 2** — `docs(rules): align CLAUDE.md §8 with practice + cabinet rollout block in README`
  - Edits CLAUDE.md §8.
  - Inserts `/manager/dashboard` bullet in the existing `New cabinets (MVP)` README section.
  - Adds the new `Cabinet rollout status` README section.
- **Hooks:** pre-commit (`lint-staged + typecheck + test:changed`) trivially passes — only `.md` files in the changeset, no TypeScript impact.
- **PR:** Single PR titled `docs: housekeeping sweep — plan close-outs, CLAUDE.md §8, README cabinet status`, body summarises the three buckets + reasons.

## Verification

This is a docs-only PR. Verification criteria to satisfy at the PR head before merge:

- [ ] All six new `-DONE.md`/`-PARTIAL.md` files match the template in Section 1.
- [ ] Each "Head commit" referenced in a close-out resolves to a real commit on `main` (no fabricated SHAs).
- [ ] The `Cabinet rollout status` table is consistent with current [src/lib/featureFlags.ts](../../src/lib/featureFlags.ts) defaults (opt-in pair: organization, manager; opt-out for the rest).
- [ ] `npm run typecheck && npm run lint && npm test` still pass at the PR head (sanity check — no behavioural change expected).
- [ ] CLAUDE.md §8 cross-link to `admin-cabinet-mvp-PARTIAL.md` resolves (because the file exists in the same PR).

No new tests are added — there is nothing to test in documentation changes.

## Open questions

None remaining (resolved in brainstorming session 2026-05-28):

- Approach: single PR with two commits (Approach 1).
- Naming: `-DONE.md` for complete, `-PARTIAL.md` for partial.
- CLAUDE.md §8: update text, do not rename existing files.
- README: keep existing `New cabinets (MVP)` section, add new `Cabinet rollout status` section after it.

## References

- [CLAUDE.md §8 — Spec-first процесс](../../CLAUDE.md)
- [Phase 4 DONE — canonical close-out example](../plans/2026-05-22-partner-cabinet-phase4-DONE.md)
- [src/lib/featureFlags.ts — flag semantics](../../src/lib/featureFlags.ts)
- Memory notes: `reference-organization-plan.md`, `reference-manager-plan.md` (existing facts about staged rollout)
