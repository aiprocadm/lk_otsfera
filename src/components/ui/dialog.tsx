'use client';

import React, { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  // input[type=hidden] НЕ фокусируем: он матчится как input, попадает первым в
  // pickInitialFocus (первый form control), а .focus() по нему — no-op. Фокус
  // тогда остаётся там, куда его поставил showModal() — на кнопке «Закрыть».
  // Ловится e2e organization-team-modal-focus-trap.
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const FORM_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-3xl',
};

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

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: DialogSize;
  busy?: boolean;
  closeOnBackdrop?: boolean;
  error?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
};

/**
 * Shared modal primitive built on the native <dialog> element. The browser
 * provides focus-trap, Escape, inert background, top-layer rendering and
 * focus-restore; this component bridges the declarative `open` prop to the
 * imperative showModal()/close() API, applies the project's form-control-first
 * initial focus, and renders two always-present aria-live regions for feedback.
 */
export function Dialog({
  open,
  onClose,
  title,
  size = 'md',
  busy = false,
  closeOnBackdrop = true,
  error,
  notice,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  // Declarative `open` -> imperative <dialog>. Guard on el.open: showModal()
  // throws if already open, and React 19 StrictMode double-invokes dev effects.
  useEffect(() => {
    const el = dialogRef.current;
    /* v8 ignore next -- defensive: the ref is unconditionally attached to the always-rendered <dialog>, so el is never null once this effect runs post-commit */
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      pickInitialFocus<HTMLElement>(focusables, el).focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // If we unmount while open (parent stops rendering us), close natively so the
  // browser restores focus to the invoker.
  useEffect(() => {
    const el = dialogRef.current;
    return () => {
      if (el && el.open) el.close();
    };
  }, []);

  function handleCancel(e: React.SyntheticEvent<HTMLDialogElement>) {
    // `cancel` fires on Escape. Always preventDefault so React stays the single
    // source of truth for `open`; drive the close through onClose unless busy.
    e.preventDefault();
    if (!busy) onClose();
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current && !busy && closeOnBackdrop) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      className={`m-auto w-full ${SIZE_CLASS[size]} rounded-xl p-0 shadow-xl backdrop:bg-black/40`}
    >
      <div className="p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-lg font-semibold text-[#111111]">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            aria-label="Закрыть"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div
          role="alert"
          aria-live="assertive"
          className={
            error
              ? 'mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2'
              : 'sr-only'
          }
        >
          {error}
        </div>
        <div
          role="status"
          aria-live="polite"
          className={
            notice
              ? 'mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2'
              : 'sr-only'
          }
        >
          {notice}
        </div>

        {children}
      </div>
    </dialog>
  );
}
