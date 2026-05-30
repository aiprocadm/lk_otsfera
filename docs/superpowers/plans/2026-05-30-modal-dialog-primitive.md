# Modal `<Dialog>` Primitive + a11y Migration + Guardrail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 7 hand-rolled modals with one native-`<dialog>`-based `<Dialog>` primitive, migrate all of them, delete `useDialogFocus`, and add an ESLint guardrail that blocks future hand-rolled modals.

**Architecture:** A single controlled `<Dialog>` component (`src/components/ui/dialog.tsx`) wraps native `<dialog>` + `showModal()`. The browser supplies focus-trap, Escape, inert background, top-layer rendering, and focus-restore; the component adds the declarative↔imperative bridge, the project's form-control-first initial-focus order, and two always-present `aria-live` regions. All modals become plain `open`/`onClose` state. An ESLint `no-restricted-syntax` rule (with the primitive file exempted) forbids raw `<dialog>` / `role="dialog"` / `aria-modal` elsewhere.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript 5 (strict) · Vitest (`environment: node`, `renderToString`) · Playwright · Tailwind · ESLint flat config.

**Spec:** [2026-05-30-modal-dialog-primitive-design.md](../specs/2026-05-30-modal-dialog-primitive-design.md)

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/ui/dialog.tsx` | **new** — the primitive + exported `pickInitialFocus` pure helper |
| `src/__tests__/components.ui-dialog.test.tsx` | **new** — Vitest: `pickInitialFocus` unit tests + `<Dialog>` SSR structural tests |
| `src/components/organization/invite-org-user-form.tsx` | migrate (div exemplar) + fix unlabeled invite-URL |
| `src/components/partner/lead-withdraw-button.tsx` | migrate (native exemplar) |
| `src/components/partner/invite-customer-admin-form.tsx` | migrate (div) + fix unlabeled invite-URL |
| `src/components/admin/assign-or-invite-manager-form.tsx` | migrate (div, mode-tabs) + fix unlabeled invite-URL |
| `src/components/admin/audit-diff-dialog.tsx` | migrate (div, read-only) |
| `src/components/partner/invite-member-form.tsx` | migrate (native, multi-field) |
| `src/components/partner/member-row-actions.tsx` | migrate (native, **two** dialogs) |
| `src/__tests__/components.admin-audit-diff-dialog.test.tsx` | remove the now-dead `useDialogFocus` mock |
| `src/hooks/useDialogFocus.ts` | **delete** |
| `src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts` | extend (div case + inert assertion) |
| `src/e2e/snapshots/leads-dialog-a11y.spec.ts` | **new** — native case (partner project) |
| `eslint.config.mjs` | add `no-restricted-syntax` guardrail + primitive override |

**Migration-task convention (read this):** Tasks 1–2 and the two exemplars (Tasks 3–4) carry **complete code**. Tasks 6–10 are mechanical migrations of files the executor will open and edit — they give a **precise per-file recipe** (exact removals + exact `<Dialog>` props + the file-specific shape) and reference the matching exemplar, rather than re-pasting ~1000 lines of near-duplicate component bodies. This is a deliberate DRY/usability choice; each recipe is concrete enough to execute without guessing.

---

## Task 1: `pickInitialFocus` pure helper (TDD)

**Files:**
- Create: `src/components/ui/dialog.tsx`
- Create test: `src/__tests__/components.ui-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/components.ui-dialog.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { pickInitialFocus } from '@/components/ui/dialog';

type El = { tagName: string; getAttribute: (n: string) => string | null };
const make = (tagName: string, type?: string): El => ({
  tagName,
  getAttribute: (n) => (n === 'type' ? (type ?? null) : null)
});

describe('pickInitialFocus', () => {
  const panel = make('DIALOG');

  it('prefers the first form control', () => {
    const input = make('INPUT');
    expect(pickInitialFocus([make('A'), input, make('BUTTON', 'submit')], panel)).toBe(input);
  });

  it('falls back to the submit button when there is no form control', () => {
    const submit = make('BUTTON', 'submit');
    expect(pickInitialFocus([make('A'), submit, make('BUTTON', 'button')], panel)).toBe(submit);
  });

  it('falls back to the first focusable when neither', () => {
    const link = make('A');
    expect(pickInitialFocus([link, make('BUTTON', 'button')], panel)).toBe(link);
  });

  it('falls back to the panel when there are no focusables', () => {
    expect(pickInitialFocus([], panel)).toBe(panel);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --mode=unit src/__tests__/components.ui-dialog.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/ui/dialog"` (file does not exist yet).

- [ ] **Step 3: Create `dialog.tsx` with the pure helper only**

Create `src/components/ui/dialog.tsx`:

```tsx
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --mode=unit src/__tests__/components.ui-dialog.test.tsx`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/dialog.tsx src/__tests__/components.ui-dialog.test.tsx
git commit -m "feat(ui): pickInitialFocus helper for Dialog primitive

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `<Dialog>` component (TDD on SSR structure)

**Files:**
- Modify: `src/components/ui/dialog.tsx`
- Modify test: `src/__tests__/components.ui-dialog.test.tsx`

- [ ] **Step 1: Add the failing SSR structural tests**

First, add these three imports to the **top** of `src/__tests__/components.ui-dialog.test.tsx` (alongside the existing imports — ES module imports must stay at the top or ESLint `import/first` fails):

```tsx
import { renderToString } from 'react-dom/server';
import React from 'react';
import { Dialog } from '@/components/ui/dialog';
```

Then append this `describe` block at the **end** of the same file:

```tsx
describe('Dialog (SSR structural contract)', () => {
  it('wires an accessible name from the title', () => {
    const html = renderToString(
      React.createElement(Dialog, { open: true, onClose: () => {}, title: 'Заголовок' }, 'тело')
    );
    expect(html).toContain('aria-labelledby');
    expect(html).toContain('Заголовок');
    expect(html).toContain('тело');
    expect(html).toContain('aria-label="Закрыть"');
  });

  it('renders the error into an assertive live region', () => {
    const html = renderToString(
      React.createElement(Dialog, { open: true, onClose: () => {}, title: 'T', error: 'Сломалось' }, null)
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Сломалось');
  });

  it('renders the notice into a polite live region', () => {
    const html = renderToString(
      React.createElement(Dialog, { open: true, onClose: () => {}, title: 'T', notice: 'Готово' }, null)
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Готово');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --mode=unit src/__tests__/components.ui-dialog.test.tsx`
Expected: FAIL — `Dialog` is not exported from `@/components/ui/dialog`.

- [ ] **Step 3: Implement `<Dialog>`**

Edit `src/components/ui/dialog.tsx` — change the first line and append the component. Replace the top `'use client';` line with the full imports + size map, and add `Dialog` after `pickInitialFocus`. Final file:

```tsx
'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const FORM_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-3xl'
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
  children
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  // Declarative `open` -> imperative <dialog>. Guard on el.open: showModal()
  // throws if already open, and React 19 StrictMode double-invokes dev effects.
  useEffect(() => {
    const el = dialogRef.current;
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
            onClick={() => { if (!busy) onClose(); }}
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --mode=unit src/__tests__/components.ui-dialog.test.tsx`
Expected: PASS — 7 passed (4 pickInitialFocus + 3 Dialog).

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck`
Expected: 0 errors.

```bash
git add src/components/ui/dialog.tsx src/__tests__/components.ui-dialog.test.tsx
git commit -m "feat(ui): native-<dialog> Dialog primitive (focus, Escape, inert, live regions)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Migrate `invite-org-user-form` (div exemplar) + fix invite-URL label

**Files:**
- Modify: `src/components/organization/invite-org-user-form.tsx`

This is the reference migration for all div-based modals.

- [ ] **Step 1: Replace the component with the migrated version**

Full new `src/components/organization/invite-org-user-form.tsx`:

```tsx
'use client';

import { useCallback, useState, useTransition } from 'react';
import { inviteOrgMemberAction } from '@/server-actions/organization/team';
import { Dialog } from '@/components/ui/dialog';

const ERROR_LABELS: Record<string, string> = {
  validation: 'Проверьте формат email и заполненность полей.',
  already_member: 'Этот пользователь уже состоит в организации.',
  last_admin_protected: 'Нельзя оставить организацию без активного администратора.',
  self_action_forbidden: 'Нельзя выполнить это действие над собой.',
  not_found: 'Запись не найдена.',
  forbidden: 'Нет прав на это действие.'
};

type SuccessState = {
  email: string;
  inviteUrl: string | null;
  alreadyHasPassword: boolean;
};

export function InviteOrgUserForm({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = useCallback(() => {
    setError(null);
    setSuccess(null);
    setCopied(false);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();
    const formData = new FormData(e.currentTarget);
    formData.set('organizationId', organizationId);
    const email = String(formData.get('email') ?? '');

    startTransition(async () => {
      const res = await inviteOrgMemberAction(formData);
      if (res.ok) {
        setSuccess({
          email,
          inviteUrl: res.inviteUrl,
          alreadyHasPassword: res.alreadyHasPassword
        });
      } else {
        setError(ERROR_LABELS[res.error] ?? `Ошибка: ${res.error}`);
      }
    });
  }

  async function copyInvite() {
    if (!success?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(success.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-HTTPS contexts — fall through silently.
    }
  }

  return (
    <>
      <button
        type='button'
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C]'
      >
        Пригласить участника
      </button>

      <Dialog
        open={open}
        onClose={close}
        title='Пригласить участника'
        size='md'
        busy={pending}
        error={error}
      >
        {success ? (
          <div className='space-y-3'>
            {success.alreadyHasPassword ? (
              <p className='text-sm text-gray-700'>
                Пользователь <strong>{success.email}</strong> уже зарегистрирован
                на платформе — доступ к организации предоставлен. Письмо не
                отправляли.
              </p>
            ) : (
              <>
                <p className='text-sm text-gray-700'>
                  Письмо приглашения отправлено на{' '}
                  <strong>{success.email}</strong>. Если письмо не дошло,
                  перешлите ссылку вручную:
                </p>
                <div className='flex gap-2 items-center'>
                  <input
                    readOnly
                    aria-label='Ссылка приглашения'
                    value={success.inviteUrl ?? ''}
                    className='flex-1 text-xs font-mono border border-gray-200 rounded px-2 py-1.5 bg-gray-50'
                  />
                  <button
                    type='button'
                    onClick={copyInvite}
                    className='px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 whitespace-nowrap'
                  >
                    {copied ? 'Скопировано ✓' : 'Скопировать'}
                  </button>
                </div>
              </>
            )}
            <div className='flex justify-end pt-2'>
              <button
                type='button'
                onClick={close}
                className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
              >
                Закрыть
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className='space-y-3'>
            <label className='block'>
              <span className='block text-sm font-medium text-gray-700 mb-1'>Email</span>
              <input
                type='email'
                name='email'
                required
                autoComplete='email'
                className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
              />
            </label>
            <label className='block'>
              <span className='block text-sm font-medium text-gray-700 mb-1'>Имя</span>
              <input
                type='text'
                name='name'
                required
                minLength={1}
                maxLength={200}
                className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
              />
            </label>
            <label className='block'>
              <span className='block text-sm font-medium text-gray-700 mb-1'>Роль</span>
              <select
                name='roleInOrg'
                defaultValue='member'
                className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#F97316]'
              >
                <option value='member'>Сотрудник</option>
                <option value='admin'>Администратор</option>
              </select>
            </label>

            <div className='flex justify-end gap-2 pt-2'>
              <button
                type='button'
                onClick={close}
                className='px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50'
              >
                Отмена
              </button>
              <button
                type='submit'
                disabled={pending}
                className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
              >
                {pending ? 'Отправляем…' : 'Пригласить'}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
```

**What changed (the div-migration recipe):** removed `useDialogFocus` import + `panelRef`; removed the Escape `useEffect`; removed the overlay `<div>` + panel `<div>` + manual header (now the `<Dialog>`); removed the inline `{error && <div role='alert'>}` (now `error={error}` prop); added `aria-label='Ссылка приглашения'` to the read-only invite-URL input; added `busy={pending}` so Escape/backdrop can't close mid-submit.

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/organization/invite-org-user-form.tsx
git commit -m "refactor(a11y): migrate org invite modal to <Dialog>; label invite URL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Migrate `lead-withdraw-button` (native exemplar)

**Files:**
- Modify: `src/components/partner/lead-withdraw-button.tsx`

This is the reference migration for native-`<dialog>` modals.

- [ ] **Step 1: Replace the component with the migrated version**

Full new `src/components/partner/lead-withdraw-button.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';

export function LeadWithdrawButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setReason('');
    setError(null);
    setOpen(true);
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/partner/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw', reason: reason.trim() })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'ALREADY_REJECTED') setError('Заявка уже отклонена');
        else if (body.error === 'ALREADY_PROMOTED') setError('Заявка уже конвертирована в заказ');
        else setError(body.error ?? 'Не удалось отозвать заявку');
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type='button'
        onClick={openDialog}
        className='px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700'
      >
        Отозвать
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title='Отозвать заявку'
        size='md'
        busy={submitting}
        error={error}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitting) submit();
          }}
          className='space-y-4'
        >
          <p className='text-xs text-gray-500'>
            Действие нельзя отменить. Заявка перейдёт в статус «Отклонена».
          </p>

          <label className='block'>
            <span className='text-sm text-gray-700'>Причина (необязательно)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316] resize-y'
              placeholder='Клиент отказался / выбрали другого подрядчика…'
            />
          </label>

          <div className='flex justify-end gap-2 pt-2 border-t border-gray-100'>
            <button
              type='button'
              onClick={() => setOpen(false)}
              className='px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50'
              disabled={submitting}
            >
              Отмена
            </button>
            <button
              type='submit'
              disabled={submitting}
              className='px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50'
            >
              {submitting ? 'Отзываем…' : 'Отозвать'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
```

**What changed (the native-migration recipe):** removed `useRef`/`dialogRef`; replaced `dialogRef.current?.showModal()`/`.close()` with `open` state + `setOpen(...)`; dropped `method='dialog'` (no native form-dialog coupling); moved the inline `<h3>` title into the `title` prop; moved the bare feedback `<div>` (which had **no role**) into the `error` prop; added `busy={submitting}`.

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck`
Expected: 0 errors.

```bash
git add src/components/partner/lead-withdraw-button.tsx
git commit -m "refactor(a11y): migrate lead-withdraw modal to <Dialog>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Playwright a11y validation (manual e2e tier)

**Files:**
- Modify: `src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts`
- Create: `src/e2e/snapshots/leads-dialog-a11y.spec.ts`

> Playwright is the project's **manual** tier (`npm run e2e:visual`, needs `npm run dev` + seed). These specs validate the two migrated exemplars. Verify exact route/trigger selectors against the current seed when running.

- [ ] **Step 1: Read the existing org spec**

Read `src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts`. Its existing assertions (initial focus on the email field, Tab/Shift+Tab wrap, focus-restore-to-trigger on Escape) still hold after Task 3 — `<Dialog>` preserves all of them. Keep them.

- [ ] **Step 2: Add an inert-background assertion to the org spec**

Append a test to the existing `describe` block (adjust the trigger name / open step to match the file's existing helpers):

```ts
test('фон inert: фоновую ссылку нельзя сфокусировать пока модалка открыта', async ({ page }) => {
  await page.goto('/organization/team');
  await page.getByRole('button', { name: 'Пригласить участника' }).click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });

  // showModal() makes the rest of the document inert: a programmatic focus on a
  // background link must NOT move focus out of the dialog.
  const movedToBackground = await page.evaluate(() => {
    const bgLink = document.querySelector('nav a[href], header a[href]') as HTMLElement | null;
    bgLink?.focus();
    return !!bgLink && document.activeElement === bgLink;
  });
  expect(movedToBackground).toBe(false);
});
```

- [ ] **Step 3: Create the partner (native-case) spec**

Create `src/e2e/snapshots/leads-dialog-a11y.spec.ts` (no `manager-`/`organization-` prefix → partner project):

```ts
import { test, expect } from '@playwright/test';

// Validates the native-<dialog>-migrated lead-withdraw modal (Task 4).
// Adjust the leads URL + trigger if the seed differs.
test.describe('lead-withdraw dialog a11y', () => {
  test('open -> Escape closes and restores focus to trigger', async ({ page }) => {
    await page.goto('/partner/leads');
    const trigger = page.getByRole('button', { name: 'Отозвать' }).first();
    await trigger.click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
```

- [ ] **Step 4: Run the e2e suite (manual)**

Run (needs dev server on :3000 + seed): `npm run e2e:visual`
Expected: org focus-trap spec (incl. new inert test) and the new leads-dialog spec pass. If a selector/route differs from the seed, fix the selector — not the component.

- [ ] **Step 5: Commit**

```bash
git add src/e2e/snapshots/organization-team-modal-focus-trap.spec.ts src/e2e/snapshots/leads-dialog-a11y.spec.ts
git commit -m "test(e2e): a11y specs for <Dialog> (inert background + native case)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Migrate `invite-customer-admin-form` (div)

**Files:**
- Modify: `src/components/partner/invite-customer-admin-form.tsx`

Apply the **div-migration recipe from Task 3** to this file. It is structurally identical to the org form (same success/error/copy logic) with these file-specific differences:

- [ ] **Step 1: Apply the migration**
  - Keep imports `invitePartnerOrgAdminAction`, `inviteAdminOrgAdminAction`, the `runInvite` helper, `ERROR_LABELS`, `SuccessState`, and the `{ organizationId, label, source }` props — unchanged.
  - Remove: `import { useDialogFocus }`, `panelRef`, the Escape `useEffect`, the overlay `<div role='dialog' …>` + panel `<div>` + the manual `<h2>`/× header, and the inline `{error && <div role='alert'>}`.
  - Keep the trigger `<button … onClick={() => { reset(); setOpen(true); }}>{label}</button>` (className `px-3 py-1.5 …`).
  - Wrap the body in:
    ```tsx
    <Dialog open={open} onClose={close} title='Пригласить администратора заказчика' size='md' busy={pending} error={error}>
      {success ? ( /* unchanged success block */ ) : ( /* unchanged <form onSubmit={onSubmit}> minus the inline error div */ )}
    </Dialog>
    ```
  - In the success block's read-only invite-URL `<input readOnly value={success.inviteUrl ?? ''} … />`, add `aria-label='Ссылка приглашения'`.
  - Add `import { Dialog } from '@/components/ui/dialog';`.

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck`
Expected: 0 errors.

```bash
git add src/components/partner/invite-customer-admin-form.tsx
git commit -m "refactor(a11y): migrate customer-admin invite modal to <Dialog>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Migrate `assign-or-invite-manager-form` (div, mode-tabs)

**Files:**
- Modify: `src/components/admin/assign-or-invite-manager-form.tsx`

Apply the **div-migration recipe from Task 3**, with these file-specific differences:

- [ ] **Step 1: Apply the migration**
  - Keep: `assignOrInviteManagerAction` import, `Mode` type, `mode` state, `ERROR_LABELS`, `SuccessState` (incl. `reactivated`), `onSubmit`, `copyInvite`.
  - `close` must still reset mode: keep `const close = useCallback(() => { setOpen(false); setMode('existing'); reset(); }, [reset]);`
  - Remove `useDialogFocus`/`panelRef`/Escape `useEffect`/overlay+panel+header/inline error div.
  - Wrap the body in `<Dialog open={open} onClose={close} title='Назначить менеджера' size='md' busy={pending} error={error}>`.
  - The **mode-tabs** `<div role='tablist'>…</div>` and the conditional `{mode === 'new' && <label>…Имя…</label>}` stay **inside `children`** (in the `<form>`), unchanged.
  - Add `aria-label='Ссылка приглашения'` to the success invite-URL input.
  - Add `import { Dialog } from '@/components/ui/dialog';`.

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck`
Expected: 0 errors.

```bash
git add src/components/admin/assign-or-invite-manager-form.tsx
git commit -m "refactor(a11y): migrate assign-manager modal to <Dialog>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Migrate `audit-diff-dialog` (div, read-only) + fix its test

**Files:**
- Modify: `src/components/admin/audit-diff-dialog.tsx`
- Modify: `src/__tests__/components.admin-audit-diff-dialog.test.tsx`

- [ ] **Step 1: Migrate the component**

Keep the masking helpers (`SENSITIVE_KEY_REGEX`, `maskValue`, `maskedJsonString`, `maskedExtraJsonString`) and the `{ row, onClose }` props **unchanged**. Replace the render with a `<Dialog>` wrapper. New `AuditDiffDialog`:

```tsx
export function AuditDiffDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const before = maskedJsonString(row.meta, ['before']);
  const after = maskedJsonString(row.meta, ['after']);
  const extras = maskedExtraJsonString(row.meta, ['before', 'after']);

  return (
    <Dialog open onClose={onClose} title={`${row.action} · ${row.entity}`} size='xl'>
      <div className='text-xs text-gray-500 mb-4 -mt-2'>{row.id}</div>

      <div className='grid grid-cols-2 gap-3 text-xs'>
        <div>
          <div className='font-medium text-gray-700 mb-1'>До</div>
          <pre className='bg-gray-50 border border-gray-200 rounded p-3 font-mono whitespace-pre-wrap overflow-auto max-h-[40vh]'>
            {before || '—'}
          </pre>
        </div>
        <div>
          <div className='font-medium text-gray-700 mb-1'>После</div>
          <pre className='bg-gray-50 border border-gray-200 rounded p-3 font-mono whitespace-pre-wrap overflow-auto max-h-[40vh]'>
            {after || '—'}
          </pre>
        </div>
      </div>

      {extras && (
        <div className='mt-4'>
          <div className='text-xs font-medium text-gray-700 mb-1'>Прочие meta-поля</div>
          <pre className='bg-gray-50 border border-gray-200 rounded p-3 font-mono text-xs whitespace-pre-wrap overflow-auto max-h-[20vh]'>
            {extras}
          </pre>
        </div>
      )}

      <div className='flex justify-end pt-4'>
        <button
          type='button'
          onClick={onClose}
          className='px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50'
        >
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}
```

Update the imports at the top of the file to:

```tsx
'use client';
import type { AuditRow } from '@/lib/services/admin/auditLog';
import { Dialog } from '@/components/ui/dialog';
```

(Remove `React`/`useEffect`/`useDialogFocus` imports — no longer used. `open` is constant `true` because the parent conditionally mounts this component; the primitive's unmount-close effect restores focus when the parent unmounts it.)

- [ ] **Step 2: Remove the dead `useDialogFocus` mock from the test**

In `src/__tests__/components.admin-audit-diff-dialog.test.tsx`, delete these lines (the hook is gone after migration):

```tsx
// useDialogFocus uses useEffect + useRef — stubs out for SSR rendering in tests
vi.mock('@/hooks/useDialogFocus', () => ({
  useDialogFocus: () => ({ current: null })
}));
```

Also drop the now-unused `vi` from the import: change `import { describe, it, expect, vi } from 'vitest';` to `import { describe, it, expect } from 'vitest';`.

- [ ] **Step 3: Run the audit-diff test**

Run: `npx vitest run --mode=unit src/__tests__/components.admin-audit-diff-dialog.test.tsx`
Expected: PASS — 3 passed (masking + "Прочие meta-поля" assertions hold; content still renders inside `<Dialog>`).

- [ ] **Step 4: typecheck + commit**

Run: `npm run typecheck`
Expected: 0 errors.

```bash
git add src/components/admin/audit-diff-dialog.tsx src/__tests__/components.admin-audit-diff-dialog.test.tsx
git commit -m "refactor(a11y): migrate audit-diff dialog to <Dialog>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Migrate `invite-member-form` (native, multi-field)

**Files:**
- Modify: `src/components/partner/invite-member-form.tsx`

Apply the **native-migration recipe from Task 4**, with these file-specific differences:

- [ ] **Step 1: Apply the migration**
  - Keep: `useRouter`, all state (`email`, `name`, `roleInPartner`, `allOrgs`, `selected`, `submitting`, `error`), `toggleOrg`, `submit`, the `valid` computed flag, and the `RoleOption` sub-component — unchanged.
  - Replace `useRef`/`dialogRef` with `const [open, setOpen] = useState(false);`.
  - `open()` function → rename to `openDialog()` (avoid shadowing the state); it resets fields then `setOpen(true)`. The trigger button calls `openDialog`.
  - In `submit()`, replace `dialogRef.current?.close()` with `setOpen(false)`.
  - Wrap the form body in `<Dialog open={open} onClose={() => setOpen(false)} title='Пригласить сотрудника' size='lg' busy={submitting} error={error}>`.
  - The `<form onSubmit={…}>` stays in `children` but drop `method='dialog'`. Keep the helper `<p>` subtitle, the Имя/Email inputs, both `<fieldset>`s (role radios + org checkboxes), and the footer buttons (the Cancel button → `onClick={() => setOpen(false)}`). Remove the inline `{error && <div>}`.
  - Add `import { Dialog } from '@/components/ui/dialog';`; remove the `useRef` import.

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck`
Expected: 0 errors.

```bash
git add src/components/partner/invite-member-form.tsx
git commit -m "refactor(a11y): migrate partner invite-member modal to <Dialog>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Migrate `member-row-actions` (native, TWO dialogs)

**Files:**
- Modify: `src/components/partner/member-row-actions.tsx`

This component renders **two** native dialogs (edit-access + deactivate). Each becomes its own `<Dialog>` with its own `open` state.

- [ ] **Step 1: Apply the migration**
  - Replace the two refs with two booleans: `const [editOpen, setEditOpen] = useState(false);` and `const [deactivateOpen, setDeactivateOpen] = useState(false);`. Remove `useRef`.
  - Keep `selected`, `allOrgs`, `submitting`, `error`, `toggleOrg`, `saveOrgs`, `deactivate` — unchanged except the close calls.
  - `openEdit()`: resets `selected`/`allOrgs`/`error` then `setEditOpen(true)`.
  - Deactivate trigger button `onClick`: `() => { setError(null); setDeactivateOpen(true); }`.
  - In `saveOrgs()` replace `editDialogRef.current?.close()` → `setEditOpen(false)`. In `deactivate()` replace `deactivateDialogRef.current?.close()` → `setDeactivateOpen(false)`.
  - Edit dialog → `<Dialog open={editOpen} onClose={() => setEditOpen(false)} title='Доступ к организациям' size='lg' busy={submitting} error={error}>` wrapping the `<form onSubmit>` (drop `method='dialog'`; the `{name}` subtitle `<p>`, the all-orgs checkbox, the per-org list, footer buttons stay; Cancel → `setEditOpen(false)`; remove inline error div).
  - Deactivate dialog → `<Dialog open={deactivateOpen} onClose={() => setDeactivateOpen(false)} title='Деактивировать сотрудника?' size='md' busy={submitting} error={error}>` wrapping the confirm body (the `<p>` warning + footer; Cancel → `setDeactivateOpen(false)`; the «Деактивировать» button keeps `onClick={deactivate}`; remove inline error div).
  - Add `import { Dialog } from '@/components/ui/dialog';`; remove the `useRef` import.

  Note: the two dialogs share one `error` state — fine, only one is ever open at a time, and each trigger clears `error` on open.

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck`
Expected: 0 errors.

```bash
git add src/components/partner/member-row-actions.tsx
git commit -m "refactor(a11y): migrate member-row-actions (2 modals) to <Dialog>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Delete `useDialogFocus`

**Files:**
- Delete: `src/hooks/useDialogFocus.ts`

- [ ] **Step 1: Verify there are no remaining references**

Run: `git grep -n "useDialogFocus" -- src/ ':!src/hooks/useDialogFocus.ts'`
Expected: **no output** (all 4 consumers migrated in Tasks 3, 6, 7, 8; the test mock removed in Task 8). If anything prints, migrate that reference before continuing.

- [ ] **Step 2: Delete the hook**

```bash
git rm src/hooks/useDialogFocus.ts
```

- [ ] **Step 3: typecheck + unit tests**

Run: `npm run typecheck && npm run test:unit`
Expected: typecheck 0 errors; full unit suite green.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(a11y): delete useDialogFocus (folded into <Dialog>)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: ESLint guardrail

**Files:**
- Modify: `eslint.config.mjs`

- [ ] **Step 1: Add the rule + primitive override**

Replace the contents of `eslint.config.mjs` with:

```js
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const NO_HANDROLLED_MODAL = [
  'error',
  {
    selector: "JSXOpeningElement[name.name='dialog']",
    message: 'Use the shared <Dialog> primitive (src/components/ui/dialog.tsx) instead of a raw <dialog>.'
  },
  {
    selector: "JSXAttribute[name.name='role'][value.value='dialog']",
    message: 'Use the shared <Dialog> primitive instead of hand-rolling role="dialog".'
  },
  {
    selector: "JSXAttribute[name.name='aria-modal']",
    message: 'Use the shared <Dialog> primitive instead of hand-rolling aria-modal.'
  }
];

export default [
  ...coreWebVitals,
  ...typescript,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': NO_HANDROLLED_MODAL
    }
  },
  {
    // The primitive is the one place allowed to use the native <dialog> element.
    files: ['src/components/ui/dialog.tsx'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    files: ['src/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
];
```

- [ ] **Step 2: Verify the guardrail catches a hand-rolled modal**

Temporarily add `<div role="dialog" />` to any non-primitive component (e.g. top of `src/components/partner/lead-withdraw-button.tsx` render), then run:

Run: `npm run lint`
Expected: FAIL on that file — "Use the shared <Dialog> primitive instead of hand-rolling role=\"dialog\"." Remove the temporary line afterward.

- [ ] **Step 3: Verify lint is green on the migrated tree**

Run: `npm run lint`
Expected: 0 errors (all modals migrated; primitive exempted).

- [ ] **Step 4: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(lint): guardrail — forbid hand-rolled modals outside <Dialog>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Final verification

- [ ] **Step 1: Full local gate**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Expected: typecheck 0 errors; lint 0 errors; unit suite green (includes the 7 new `components.ui-dialog` tests and the unchanged audit-diff tests).

- [ ] **Step 2: Manual keyboard pass (all 7 modals)**

With `npm run dev` + seed, for each modal — org invite (`/organization/team`), customer-admin invite, assign-manager (`/admin/organizations/[id]`), audit-diff (`/admin/audit` → row detail), invite-member + member-row-actions (`/partner/team`), lead-withdraw (`/partner/leads`):
  - Open with the keyboard; initial focus lands on the first field (or the confirm button for confirm-only dialogs).
  - Tab/Shift+Tab stays trapped inside.
  - A background link cannot be focused while open (inert).
  - Escape closes and focus returns to the trigger.
  - On submit-in-flight, Escape/backdrop do not close.
  - Error feedback appears in the red region and is announced.

- [ ] **Step 3: (Optional) Playwright**

Run: `npm run e2e:visual`
Expected: org focus-trap + leads-dialog a11y specs pass (needs dev + seed).

- [ ] **Step 4: Open the PR**

```bash
git push -u origin claude/modal-dialog-primitive
gh pr create --base main --title "a11y: shared <Dialog> primitive + migrate 7 modals + guardrail" --body "Implements docs/superpowers/specs/2026-05-30-modal-dialog-primitive-design.md. Native-<dialog> primitive (focus-trap, Escape, inert background, focus-restore from the browser; form-control-first focus + persistent aria-live regions added). Migrates all 7 modals, deletes useDialogFocus, adds an ESLint guardrail against future hand-rolled modals."
```

---

## Notes for the executor

- **Why native `<dialog>`:** the browser gives focus-trap, Escape, **inert background**, top-layer rendering, and focus-restore for free — closing the inert-background gap the 2026-05-27 focus-trap work deferred. Do not re-add manual focus-trapping.
- **Test environment is `node`** (`vitest.config.ts`): `renderToString` only, no DOM/focus. That is why behavior is checked in Playwright (manual) and only `pickInitialFocus` + SSR structure are unit-tested. Do **not** add `jsdom`.
- **`busy` blocks closing** (Escape + backdrop + ×) so a modal can't be dismissed mid-submit; every migration wires `busy` to its in-flight flag (`pending`/`submitting`).
- **`error`/`notice` props** feed two always-rendered `aria-live` regions — never reintroduce a conditionally-mounted error `<div>` inside a modal body.
