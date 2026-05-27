# Modal focus trap + focus restore — design

**Date:** 2026-05-27
**Author:** Claude (session-driven)
**Status:** Approved (design step), pending implementation
**Related:** PR #59, PR #60 (a11y baseline for invite modals); follow-up to the "Focus trap — out of scope" note in PR #60 body

## Problem

Three sibling invite modals share an identical accessibility pattern (after PR #59 + #60):
- `src/components/admin/assign-or-invite-manager-form.tsx`
- `src/components/organization/invite-org-user-form.tsx`
- `src/components/partner/invite-customer-admin-form.tsx`

They all have `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Escape-to-close, and a live region for errors. Two a11y debts remain:

1. **No focus trap.** When a modal is open, `Tab` walks focus through the modal's controls and then into the background page (header, sidebar, links). Keyboard and screen-reader users can land on controls visually obscured by the overlay.
2. **No focus restore.** When the modal closes, focus lands on `document.body`. The user who opened the modal with a keyboard activation of the trigger button is now disoriented — focus should return to the trigger.

Both are WCAG 2.4.3 (Focus Order) and 2.4.11 (Focus Not Obscured) concerns.

## Goal

Add focus trap + focus restore to the three invite modals with the smallest possible behavioural diff. No new dependencies. No refactor of the surrounding form logic. Future modals can opt in by calling the same hook.

## Non-goals

- Extracting a full `<DialogShell>` component (separate refactor — flagged as a future task in PR #60).
- Replacing the existing Escape handler in each form (already works; touching it would expand the diff for no gain).
- Layered modal stack (multiple simultaneously-open modals) — the codebase has no such case.
- Generalising for non-modal popovers/dropdowns — out of scope.

## Design

### `useDialogFocus(open)` hook

```ts
function useDialogFocus(open: boolean): React.RefObject<HTMLDivElement>;
```

- **Returns** a ref intended for the modal's inner panel element (the `bg-white rounded-xl ...` div, not the overlay).
- **On `open` becoming true:**
  1. Stores `document.activeElement` as the element to restore focus to on close.
  2. Queries the panel for focusable elements using the standard selector list (see below).
  3. Moves focus to the first focusable; if none exist, focuses the panel itself (requires `tabIndex={-1}`).
  4. Attaches a `keydown` listener to the panel.
- **On Tab keydown inside panel:**
  - Re-queries focusables (handles dynamic content like the admin form's mode-tabs that add/remove the "name" input).
  - If `Shift+Tab` and `document.activeElement === first` → `preventDefault()` and focus `last`.
  - If `Tab` (no shift) and `document.activeElement === last` → `preventDefault()` and focus `first`.
  - Other keys: pass through.
- **On `open` becoming false (or component unmount):**
  - Removes the keydown listener.
  - Calls `previouslyFocused?.focus?.()` to restore. If the element no longer exists in the DOM, the call is a no-op in all modern browsers.

### Focusable selector

```
a[href],
button:not([disabled]),
textarea:not([disabled]),
input:not([disabled]),
select:not([disabled]),
[tabindex]:not([tabindex="-1"])
```

This matches the standard WHATWG focusable-area criteria minus iframe/object (not used in modals here).

Note on hidden controls: `querySelectorAll` returns elements regardless of CSS visibility. In these modals there are no `display: none` / `visibility: hidden` toggles — conditional fields are mounted/unmounted via React (`mode === 'new' && <input name='name' />`), so unrendered controls are not in the DOM at all. The hook does not need its own visibility filter.

### File layout

```
src/hooks/useDialogFocus.ts                       (new — ~50 lines)
src/hooks/__tests__/useDialogFocus.test.tsx       (new — ~120 lines, 4 cases)
```

### Wiring into each modal

For each of the 3 forms:

1. `import { useDialogFocus } from '@/hooks/useDialogFocus';`
2. `const panelRef = useDialogFocus(open);`
3. Inner panel div gets `ref={panelRef} tabIndex={-1}`.

No other change. Existing `useEffect` for Escape is untouched.

## Tests

Component test using `@testing-library/react` (already in project — pattern: `*.test.tsx` next to component or in `__tests__`):

1. **Initial focus moves into modal**
   Render `<InviteOrgUserForm organizationId='x' />`, click the trigger, assert the first form input has focus.

2. **Tab from last focusable wraps to first**
   Open modal, focus the last button (Cancel/Submit), simulate `Tab`, assert focus is on the first input.

3. **Shift+Tab from first focusable wraps to last**
   Open modal, focus the first input, simulate `Shift+Tab`, assert focus is on the last interactive element.

4. **Focus restores to trigger after close**
   Render, focus + click trigger, then close via Escape, assert focus is on the trigger button.

Pick one of the three forms for the integration test (e.g. `invite-org-user-form` — the simplest one without mode-tabs). The hook itself is tested implicitly through this integration; a separate unit test of the hook is unnecessary because there is no useful test that doesn't render React.

## Risk

Low.
- No dependency added.
- No behavioural change for non-keyboard, non-AT users (mouse-driven flow unchanged).
- Existing 956 tests must still pass; new test count: +4.
- Worst plausible regression: a focusable element gets initial focus that the designer didn't intend. Mitigated by the test that asserts a specific element receives focus, plus manual keyboard verification.

## Out of scope (explicit)

- `focus-visible` ring polish — Tailwind defaults are sufficient and not the subject of this change.
- `aria-hidden` on background page content while modal is open — recommended by APG but requires a layout-level wrapper; deferred.
- Inert attribute on background — same reason as above.

## Rollout

1. Branch from `main`: `claude/modal-focus-trap`.
2. Implement hook + tests.
3. Wire into 3 forms.
4. `npm run typecheck && npm run lint && npm test` all green.
5. Manual keyboard verification of all 3 modals.
6. Open PR; reference this spec.
