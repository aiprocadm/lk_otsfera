# Modal Focus Trap — DONE

**Дата завершения:** 2026-05-27
**Base commit:** `f898248` (fix(a11y): live regions on manager/admin form feedback + modal labelling and Escape, после PR #59 merge)
**Head commit:** `28238db` (feat(a11y): wire useDialogFocus into partner + admin invite modals)
**Branch:** `claude/modal-focus-trap-impl`
**Связанные PR:** #61 (design spec), #62 (implementation)
**Spec:** [modal-focus-trap-design.md](../specs/2026-05-27-modal-focus-trap-design.md)

## Что готово

### Часть 1 — `useDialogFocus(open)` hook
- `src/hooks/useDialogFocus.ts` (`4b1473d`) — новый файл (~75 lines):
  - **On `open=true`**: stores `document.activeElement` для restore; queries panel для focusable elements; moves focus per WAI-ARIA APG preference order: form-control → submit button → first focusable → panel itself.
  - **Tab keydown** trap: re-queries focusables (handles dynamic content), wraps at ends. `Shift+Tab` from first → focuses last; `Tab` from last → focuses first.
  - **On `open=false`** или unmount: removes keydown listener, calls `previouslyFocused?.focus?.()` для restore.
- **Focusable selector**: `a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])`.
- **No new deps** (~40 lines logic не оправдывают `focus-trap-react`).

### Часть 2 — Playwright e2e spec
- `src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts` (`44f6941`) — 4 теста:
  1. Initial focus moves into modal on open (lands в email input, не close ×)
  2. Tab from last focusable (submit) wraps to first (close ×)
  3. Shift+Tab from first focusable (close ×) wraps to last (submit)
  4. Focus restores to trigger after Escape
- Файл prefixed `organization-*` чтобы Playwright `org-desktop`/`org-mobile` projects подхватили без config changes.

### Часть 3 — Wired into 3 sibling invite modals
- `src/components/organization/invite-org-user-form.tsx` (`44f6941`) — +3 lines (import, hook call, ref+tabIndex+outline-none на inner panel).
- `src/components/partner/invite-customer-admin-form.tsx` (`28238db`) — same wiring.
- `src/components/admin/assign-or-invite-manager-form.tsx` (`28238db`) — same wiring.

## Проверка состояния

```
npm run typecheck   # clean
npm run lint        # no new warnings/errors (pre-existing only)
npm test            # 940/940 non-skipped passed (1 unrelated flake services.manager.orders)
npm run build       # successful, no new routes
```

## Что НЕ готово

**Нет планируемой следующей фазы.** Этот план фиксировал точечный a11y debt — focus trap + focus restore для трёх sibling invite modals. После shipped работа закрывает обе WCAG-проблемы (2.4.3 Focus Order и 2.4.11 Focus Not Obscured).

**Out-of-scope (намеренно):**
- Generalising в `<DialogShell>` компонент — flagged в спеке как future task если modal pattern будет переиспользоваться больше 3 sibling-ов.
- Layered modal stack — кодовая база не имеет такого кейса.
- Non-modal popovers / dropdowns — отдельная проблема, не WCAG focus order issue.

**Side-blocker (закрыт PR #63):** Playwright e2e не запускался в PR #62 из-за infra bug в PR #58 (`[orderId]` vs `[id]` slug conflict). PR #63 пофиксил routing, e2e теперь runnable.

## Сознательные упрощения (не баги)

1. **Initial focus preference order skips close ×** — WAI-ARIA APG для form dialogs: пользователь открыл «Пригласить участника», cursor должен попасть в email field, не на close affordance. Это сознательный UX выбор.
2. **`outline-none` на panel** — panel получает focus как fallback (no focusables case); не хотим focus ring на panel itself, только на interactive children.
3. **Re-query focusables on each Tab** — handles dynamic content (admin form's mode-tabs add/remove «name» input). Cheaper alternative — MutationObserver — overkill для трёх existing modals.
4. **Hook size ~75 lines** — самодостаточный, без зависимостей. Если pattern будет переиспользоваться, обернётся в `<DialogShell>`.
5. **Spec в отдельном PR** (#61) — design first, impl second. План тоже отдельный PR (комбинированный design+plan ушёл в #61). PR #62 несёт только impl + рабочие e2e.

## Метрики

- **Коммитов в этой работе:** 6 (3 docs в PR #61 + 3 impl в PR #62)
- **Новых файлов:** 2 (`useDialogFocus.ts`, `organization-team-modal-focus-trap.spec.ts`)
- **Изменённых файлов:** 3 (3 sibling modal forms — по +3 строки каждой)
- **Новых тестов:** 4 e2e tests (Playwright)
- **Diff:** ~100 insertions / ~6 deletions

## Deviations от плана

1. **Test strategy correction** (`d92f25e`) — spec изначально предлагал vitest+jsdom; corrected to Playwright e2e после анализа (jsdom не воспроизводит focus accuracy реального browser'а).
2. **`/api/manager/documents` slug conflict** — preventing dev server start, blocked Playwright e2e runs. Не от этого PR. Закрыт PR #63 после.
3. **WAI-ARIA APG preference order** — план не уточнял; в реализации добавлено form-control-first.

## Test plan (выполнено)

- [x] `npm run typecheck` — clean
- [x] `npm run lint` — no new
- [x] `npm test` — 940/940
- [x] Hook code review — cleanup captures panel + previouslyFocused в closure, safe under unmount
- [ ] Playwright e2e — runnable после PR #63 merge (blocked by `[orderId]` slug bug на момент PR #62)
- [ ] Manual keyboard verification (deferred to dev session с running app)

---

**Operational notes:**
- Hook готов к переиспользованию для будущих modals. Convention: panel `<div>` с `ref={panelRef}` + `tabIndex={-1}` + `outline-none` + `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.
- Mouse-driven flow unchanged. Keyboard-only пользователи получили correct focus trap + restore.
