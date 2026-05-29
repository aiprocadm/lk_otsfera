'use client';

const FORM_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

type FocusableLike = { tagName: string; getAttribute(name: string): string | null };

/**
 * Initial-focus preference (WAI-ARIA APG, form dialogs):
 * first form control -> first submit button -> first focusable -> fallback.
 * Pure + DOM-agnostic so it is unit-testable under Vitest's `node` environment.
 */
export function pickInitialFocus<T extends FocusableLike>(focusables: T[], fallback: T): T {
  const control = focusables.find((el) => FORM_CONTROL_TAGS.has(el.tagName));
  if (control) return control;
  const submit = focusables.find(
    (el) => el.tagName === 'BUTTON' && el.getAttribute('type') === 'submit'
  );
  if (submit) return submit;
  return focusables[0] ?? fallback;
}
