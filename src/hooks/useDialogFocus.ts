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
 * should have tabIndex={-1} so it can receive fallback focus when no
 * focusable children exist.
 *
 * Initial-focus preference order (WAI-ARIA APG: form dialogs):
 *   first INPUT/TEXTAREA/SELECT -> first submit button -> first focusable -> panel itself.
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
