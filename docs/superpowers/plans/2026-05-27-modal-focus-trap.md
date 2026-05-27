# Modal Focus Trap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add focus trap + focus restore to the three sibling invite modals (admin/organization/partner) via a `useDialogFocus(open)` hook. No new dependencies.

**Architecture:** A small React hook (~50 lines) that owns three responsibilities — initial focus into the modal, Tab/Shift+Tab wrap inside the modal, and focus restore to the trigger on close. Tested with one Playwright e2e spec on the simplest of the three modals (the org-team invite form); the hook is applied to all three. The other two modals are verified manually because their structure is identical from the hook's perspective.

**Tech Stack:** React 19, TypeScript, Next.js 15, Playwright 1.60 (already in project).

**Spec:** [docs/superpowers/specs/2026-05-27-modal-focus-trap-design.md](../specs/2026-05-27-modal-focus-trap-design.md)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/hooks/useDialogFocus.ts` | **new** | Hook: initial focus, Tab-wrap, focus restore |
| `src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts` | **new** | Playwright e2e covering the four focus behaviours |
| `src/components/organization/invite-org-user-form.tsx` | modify | Wire `useDialogFocus`, add `ref` + `tabIndex={-1}` |
| `src/components/partner/invite-customer-admin-form.tsx` | modify | Same wiring |
| `src/components/admin/assign-or-invite-manager-form.tsx` | modify | Same wiring |

Naming note: the e2e file lives in `src/e2e/snapshots/` and is prefixed `organization-` so Playwright's existing `org-desktop`/`org-mobile` projects pick it up without a config change. It happens to test a11y behaviour rather than visual snapshots, but the file path convention is consistent.

---

## Task 1: Failing Playwright spec

**Files:**
- Create: `src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
import { test, expect } from '@playwright/test';

const TRIGGER = 'button:has-text("Пригласить участника")';
const EMAIL_INPUT = 'input[name="email"]';
const SUBMIT = 'button[type="submit"]';
const CLOSE_X = 'button[aria-label="Закрыть"]';

test.describe('invite-org-user-form: focus management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/organization/team');
    await page.waitForLoadState('networkidle');
  });

  test('initial focus moves into modal on open', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await expect(page.locator(EMAIL_INPUT)).toBeFocused();
  });

  test('Tab from last focusable wraps to first', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await page.locator(SUBMIT).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator(CLOSE_X)).toBeFocused();
  });

  test('Shift+Tab from first focusable (close ×) wraps to last (submit)', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await page.locator(CLOSE_X).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator(SUBMIT)).toBeFocused();
  });

  test('focus restores to trigger after Escape', async ({ page }) => {
    await page.locator(TRIGGER).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(EMAIL_INPUT)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator(TRIGGER)).toBeFocused();
  });
});
```

Note on the wrap-direction tests: in the rendered DOM, the close `×` button comes *before* the email input (it's the first focusable in the panel). So `Tab` from submit wraps to `×`, and `Shift+Tab` from `×` wraps to submit. The "initial focus" test expects email — the hook picks the first form-control (INPUT/TEXTAREA/SELECT) over the close × per WAI-ARIA APG guidance for form dialogs (see Task 2 step 1 for the preference order). This matches user expectation: opening "Пригласить участника" should land cursor in the email field, not on the close affordance.

- [ ] **Step 2: Run spec, confirm it fails (no hook yet)**

Make sure the dev server can start (port 3000 free).

Run: `npx playwright test src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts --project=org-desktop`

Expected: All 4 tests fail. The "initial focus" test fails because focus stays on the trigger button after click. The Tab/Shift+Tab tests fail because focus moves to URL bar / outside the modal. The Escape-restore test fails because focus lands on `<body>`.

This confirms the spec actually exercises the behaviour we're about to build.

---

## Task 2: Implement `useDialogFocus` hook

**Files:**
- Create: `src/hooks/useDialogFocus.ts`

- [ ] **Step 1: Write the hook**

```ts
'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const FORM_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Manages focus for a modal dialog:
 * - on open: stores the previously-focused element, then moves focus into the panel
 * - while open: traps Tab/Shift+Tab inside the panel (wraps at the ends)
 * - on close (or unmount): restores focus to the previously-focused element
 *
 * Returns a ref intended for the modal's inner panel element. The panel
 * should have `tabIndex={-1}` so it can receive fallback focus when no
 * focusable children exist.
 *
 * Initial-focus preference order (WAI-ARIA APG: form dialogs):
 *   first INPUT/TEXTAREA/SELECT → first submit button → first focusable → panel itself.
 * The close (×) button is therefore skipped on open even though it is
 * typically the first focusable in DOM order — landing initial focus on a
 * close affordance signals the wrong intent for an invite/form dialog.
 */
export function useDialogFocus(open: boolean): RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    );
    const initialTarget =
      focusables.find((el) => FORM_CONTROL_TAGS.has(el.tagName)) ??
      focusables.find(
        (el) => el.tagName === 'BUTTON' && el.getAttribute('type') === 'submit'
      ) ??
      focusables[0] ??
      panel;
    initialTarget.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener('keydown', onKeyDown);

    return () => {
      panel.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return panelRef;
}
```

- [ ] **Step 2: Typecheck the hook in isolation**

Run: `npm run typecheck`

Expected: 0 errors. (The hook file is self-contained; unused-but-defined exports are fine.)

- [ ] **Step 3: Commit the hook**

```bash
git add src/hooks/useDialogFocus.ts
git commit -m "feat(a11y): add useDialogFocus hook for modal focus trap + restore"
```

---

## Task 3: Wire hook into `invite-org-user-form` and verify e2e passes

**Files:**
- Modify: `src/components/organization/invite-org-user-form.tsx`

- [ ] **Step 1: Add import and ref**

In `invite-org-user-form.tsx`, add the import next to the existing React import:

```ts
import { useDialogFocus } from '@/hooks/useDialogFocus';
```

Inside the component body, after the `useTransition` line (~line 23), add:

```ts
const panelRef = useDialogFocus(open);
```

- [ ] **Step 2: Attach ref and tabIndex to inner panel**

Find the inner panel `<div>` (the one with `className='bg-white rounded-xl shadow-xl max-w-md w-full p-6'`, around line 101–104 in the current file). Change:

```tsx
<div
  className='bg-white rounded-xl shadow-xl max-w-md w-full p-6'
  onClick={(e) => e.stopPropagation()}
>
```

to:

```tsx
<div
  ref={panelRef}
  tabIndex={-1}
  className='bg-white rounded-xl shadow-xl max-w-md w-full p-6 outline-none'
  onClick={(e) => e.stopPropagation()}
>
```

The `outline-none` is added because the panel will receive focus as a fallback (no focusables case); we don't want a focus ring on the panel itself, only on its interactive children.

- [ ] **Step 3: Run Playwright spec — expect green**

Run: `npx playwright test src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts --project=org-desktop`

Expected: 4 passed.

If a test fails:
- Inspect the trace (`playwright-report/test-results/.../trace.zip` → `npx playwright show-trace <path>`).
- The most likely failure is the "Shift+Tab from close × wraps to last" — if the close `×` is not the first focusable (e.g. a hidden link is before it), the assertion will land on the wrong element. Open the modal in a browser via `npm run dev` + go to `/organization/team` → DevTools → inspect tab order to confirm.

- [ ] **Step 4: Commit**

```bash
git add src/components/organization/invite-org-user-form.tsx src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts
git commit -m "feat(a11y): wire useDialogFocus into org-team invite modal + e2e spec"
```

---

## Task 4: Wire hook into the other two invite modals

**Files:**
- Modify: `src/components/partner/invite-customer-admin-form.tsx`
- Modify: `src/components/admin/assign-or-invite-manager-form.tsx`

- [ ] **Step 1: Partner modal — add hook**

In `invite-customer-admin-form.tsx`, add the import:

```ts
import { useDialogFocus } from '@/hooks/useDialogFocus';
```

Inside the component (after `useTransition`), add:

```ts
const panelRef = useDialogFocus(open);
```

Find the inner panel `<div>` (around line 128–131, `className='bg-white rounded-xl shadow-xl max-w-md w-full p-6'`). Replace with:

```tsx
<div
  ref={panelRef}
  tabIndex={-1}
  className='bg-white rounded-xl shadow-xl max-w-md w-full p-6 outline-none'
  onClick={(e) => e.stopPropagation()}
>
```

- [ ] **Step 2: Admin modal — add hook**

In `assign-or-invite-manager-form.tsx`, add the import:

```ts
import { useDialogFocus } from '@/hooks/useDialogFocus';
```

Inside the component (after `useTransition`), add:

```ts
const panelRef = useDialogFocus(open);
```

Find the inner panel `<div>` (around line 109–112, `className='bg-white rounded-xl shadow-xl max-w-md w-full p-6'`). Replace with:

```tsx
<div
  ref={panelRef}
  tabIndex={-1}
  className='bg-white rounded-xl shadow-xl max-w-md w-full p-6 outline-none'
  onClick={(e) => e.stopPropagation()}
>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Run full Vitest suite**

Run: `npm test`

Expected: 956 passed (same count as before; we did not change behaviour the existing tests cover).

- [ ] **Step 5: Commit**

```bash
git add src/components/partner/invite-customer-admin-form.tsx src/components/admin/assign-or-invite-manager-form.tsx
git commit -m "feat(a11y): wire useDialogFocus into partner + admin invite modals"
```

---

## Task 5: Manual keyboard verification

This is a human check — the Playwright spec covers org-team; the other two modals are visually identical from the hook's perspective, but a 30-second keyboard walkthrough catches anything the spec missed.

**Setup:**
- [ ] **Step 1: Start dev server**

Run: `npm run dev`

Wait for `Ready in ...` log on `http://localhost:3000`.

**For each of the three modals:**

- [ ] **Step 2: Organization team invite**
  1. Log in as organization user (or use storageState from playwright `.auth/organization.json` if convenient).
  2. Navigate to `/organization/team`.
  3. Tab to the "Пригласить участника" button, press Enter.
  4. **Expect:** modal opens, focus is in the email input.
  5. Tab through fields until you reach "Пригласить" (submit) button.
  6. Press Tab once more.
  7. **Expect:** focus is on the close `×` button (wrap).
  8. Press Shift+Tab.
  9. **Expect:** focus is back on submit (wrap reverse).
  10. Press Escape.
  11. **Expect:** modal closes, focus is back on "Пригласить участника" trigger.

- [ ] **Step 3: Partner customers — invite admin**
  1. Log in as partner.
  2. Navigate to `/partner/customers/[some-id]`.
  3. Click the "Пригласить администратора" trigger.
  4. Repeat the same Tab / Shift+Tab / Escape checks as step 2.

- [ ] **Step 4: Admin assign-or-invite-manager**
  1. Log in as admin.
  2. Navigate to `/admin/organizations/[some-id]`.
  3. Click "Назначить менеджера" trigger.
  4. Repeat the same Tab / Shift+Tab / Escape checks.
  5. Extra: switch tabs ("Существующий" / "Пригласить нового"); confirm focus trap still works after the tab content changes (mode='new' adds the "name" input).

If any step fails: note the failure mode (focus stays put, focus escapes, focus restoration wrong) and read the hook again — most likely culprits are (a) the panel ref isn't attached to the right `<div>`, (b) Escape handler in the form sets `open=false` before the hook's cleanup runs (it shouldn't — React effect cleanup runs before next render).

---

## Task 6: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin claude/modal-focus-trap-impl
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --head claude/modal-focus-trap-impl --title "feat(a11y): modal focus trap + focus restore via useDialogFocus" --body "$(cat <<'EOF'
## Summary

Adds `useDialogFocus(open)` hook and wires it into the three invite modals
(admin / organization / partner). Resolves the focus-trap + focus-restore
debts flagged as out-of-scope in #60.

Implements the design from #61.

## What changes for users

- Tab/Shift+Tab now cycles only through controls inside the modal — focus
  never escapes to the background page.
- Closing the modal (Escape, ×, overlay, Cancel) returns focus to the
  trigger button that opened it.
- Mouse-driven flow is unchanged.

## Files

- `src/hooks/useDialogFocus.ts` — new (~50 lines)
- `src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts` — new (Playwright e2e, 4 cases)
- 3 modal components — ~3 lines each (import, hook call, `ref` + `tabIndex={-1}` + `outline-none` on the inner panel)

## Test plan

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test` — 956 passing (no behavioural change for existing tests)
- [x] `npx playwright test ...modal-focus-trap.spec.ts` — 4/4 passing
- [x] Manual keyboard verification on all three modals

## Why not focus-trap-react

Considered; ~40 lines of logic don't justify a new dependency. See spec
in [docs/superpowers/specs/2026-05-27-modal-focus-trap-design.md](docs/superpowers/specs/2026-05-27-modal-focus-trap-design.md).

## Related

- #59, #60 — a11y baseline (live regions, Escape, aria-labelledby)
- #61 — design spec for this work

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report PR URL to user, wrapped in `<pr-created>` tag.**

---

## Self-Review Notes

- Spec coverage: all 5 design requirements (initial focus, Tab wrap, Shift+Tab wrap, focus restore, all-three-modals applied) covered by Tasks 1–5.
- Placeholder scan: no TBD / TODO / "handle edge cases" left.
- Type consistency: `panelRef`, `useDialogFocus`, `open` all match across hook + 3 modal call sites.
- No assumed test infra: Playwright is already installed, no devDeps added.
