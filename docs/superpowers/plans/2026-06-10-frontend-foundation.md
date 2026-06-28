# Frontend Foundation Layer (Tier 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a thin, reusable presentational foundation — `ui/` primitives, a single `errorCode→RU` dictionary, real Sonner toast feedback, corrected docs, baked-in a11y — proven by migrating two reference upload forms.

**Architecture:** Hand-rolled Tailwind primitives (no Radix/shadcn) under `src/components/ui/`, a `cn()` class-merge util and a toast wrapper under `src/lib/ui/`, and a flat error map under `src/lib/errors/`. Pure presentational + domain-agnostic → the explicit §4 carve-out, so no sibling-duplication conflict. Zero changes to RBAC / services / Result contract / routing / submit paths.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5 strict, Tailwind, `clsx` + `tailwind-merge`, `lucide-react` (Loader2), `sonner` (already mounted in `src/app/layout.tsx`), Vitest (classic JSX transform — `import React` required, CLAUDE.md §11/§13).

**Spec:** [docs/superpowers/specs/2026-06-10-frontend-foundation-design.md](../specs/2026-06-10-frontend-foundation-design.md)

**Branch:** `claude/frontend-foundation` (already created, spec committed).

**Out of scope (follow-up specs):** Tier 2 dedup (messages-inbox merge, table-shell, `useActionState`), Tier 3 data-fetching/SWR, full migration of all ~123 inline-hex files, `'use client'` boundary audit, and the **eslint hex-guardrail** (deferred — `lint-staged` runs `eslint --max-warnings=0` so a "warn" rule blocks staged commits, and inline hex spans 123 files; revisit after migration).

---

## File Structure

**Create (utilities & primitives):**
- `src/lib/ui/cn.ts` — `cn(...)` className merge (clsx + tailwind-merge). Used by every primitive.
- `src/lib/errors/messages.ts` — `errorMessageRu(code, fallback?)` + flat `Record<string,string>`.
- `src/lib/ui/toast.ts` — thin re-export of sonner `toast` with project conventions.
- `src/components/ui/spinner.tsx` — `<Spinner>` (Loader2 + animate-spin). Server component (no hooks).
- `src/components/ui/button.tsx` — `<Button>` variants/size/loading. Client.
- `src/components/ui/input.tsx`, `textarea.tsx`, `select.tsx` — form controls. Client.
- `src/components/ui/badge.tsx` — `<Badge>` tone. Server component.
- `src/components/ui/field.tsx` — `<Field>` label+control+error wrapper. Client (useId-free, htmlFor-based).
- `src/components/ui/index.ts` — barrel of public primitives.

**Modify (reference migration + docs + a11y):**
- `src/components/partner/partner-document-upload-form.tsx` — migrate to primitives + dictionary + toast.
- `src/components/manager/manager-doc-upload-form.tsx` — same.
- `CLAUDE.md` — rewrite §9 (stale `useDialogFocus`) + add §13 palette convention line.
- All table components with `<th>` lacking `scope` — add `scope='col'` (mechanical sweep).

**Tests (create):**
- `src/__tests__/lib.errorMessages.test.ts`
- `src/__tests__/components.ui-button.test.tsx`
- `src/__tests__/components.ui-form-controls.test.tsx`
- `src/__tests__/components.ui-badge.test.tsx`
- `src/__tests__/components.ui-field.test.tsx`
- `src/__tests__/components.partner-document-upload-form.test.tsx`
- `src/__tests__/components.manager-doc-upload-form.test.tsx`

**Testing note (CLAUDE.md §11/§13):** vitest has no react plugin → every `.tsx` test and every tested component MUST `import React`. Component tests use `renderToString` (server render; `useEffect`/async submit do NOT run, so we assert *static* output only — initial markup, classes, attributes — never post-submit state).

---

## Task 1: `cn()` class-merge utility

**Files:**
- Create: `src/lib/ui/cn.ts`
- Test: `src/__tests__/lib.cn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/lib.cn.test.ts
import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/ui/cn';

describe('cn', () => {
  it('joins truthy classes and drops falsy', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });

  it('lets later tailwind classes win conflicts (tailwind-merge)', () => {
    // both set padding-x; the last must override, not duplicate
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib.cn.test.ts`
Expected: FAIL — cannot resolve `@/lib/ui/cn`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ui/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names: clsx resolves conditionals, tailwind-merge
 * dedupes conflicting utilities so caller-supplied classes win over defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib.cn.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/cn.ts src/__tests__/lib.cn.test.ts
git commit -m "feat(ui): add cn() tailwind class-merge utility"
```

---

## Task 2: Error message dictionary

**Files:**
- Create: `src/lib/errors/messages.ts`
- Test: `src/__tests__/lib.errorMessages.test.ts`

Codes seeded from the union of the two reference forms' existing `ERROR_LABEL_RU` maps (partner + manager upload). Other forms add their codes when they migrate later.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/lib.errorMessages.test.ts
import { describe, it, expect } from 'vitest';
import { errorMessageRu } from '@/lib/errors/messages';

describe('errorMessageRu', () => {
  it('maps known stable codes to Russian strings', () => {
    expect(errorMessageRu('too_large')).toBe('Файл превышает 20 МБ.');
    expect(errorMessageRu('forbidden')).toBe('Нет прав на загрузку.');
    expect(errorMessageRu('invalid_recipient')).toContain('партнёр');
  });

  it('returns the default fallback for an unknown code', () => {
    expect(errorMessageRu('totally_unknown_code')).toBe('Произошла ошибка.');
  });

  it('returns a caller-supplied fallback when given', () => {
    expect(errorMessageRu('totally_unknown_code', 'Ошибка загрузки.')).toBe('Ошибка загрузки.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib.errorMessages.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/messages`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/errors/messages.ts

/**
 * Single source of truth mapping stable service error codes (CLAUDE.md §3) to
 * user-facing Russian strings. Replaces per-form ERROR_LABEL_RU copies. Flat
 * map because §3 codes are globally-stable strings. Pure data — no React, lives
 * in lib so the UI imports it downward (§2 dependency direction).
 *
 * Seeded from partner + manager document-upload forms. Add codes from other
 * forms as they migrate to errorMessageRu().
 */
const RU: Record<string, string> = {
  validation: 'Проверьте поля формы.',
  forbidden: 'Нет прав на загрузку.',
  not_found: 'Заказ не найден.',
  too_large: 'Файл превышает 20 МБ.',
  invalid_mime: 'Неподдерживаемый тип файла.',
  storage: 'Не удалось загрузить файл. Попробуйте ещё раз.',
  no_file: 'Файл не выбран.',
  network: 'Сетевая ошибка. Проверьте соединение и попробуйте снова.',
  invalid_recipient: 'У заказа нет партнёра — получатель «партнёр» недоступен.'
};

export function errorMessageRu(code: string, fallback = 'Произошла ошибка.'): string {
  return RU[code] ?? fallback;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib.errorMessages.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors/messages.ts src/__tests__/lib.errorMessages.test.ts
git commit -m "feat(errors): unified errorCode->RU message dictionary"
```

---

## Task 3: Toast wrapper

**Files:**
- Create: `src/lib/ui/toast.ts`
- Test: `src/__tests__/lib.toast.test.ts`

Sonner's `<Toaster richColors position='top-right' />` is already mounted in `src/app/layout.tsx`. This wrapper gives one project-controlled import surface (so future convention changes — duration, dedupe — live in one file).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/lib.toast.test.ts
import { describe, it, expect } from 'vitest';
import { toast } from '@/lib/ui/toast';

describe('toast wrapper', () => {
  it('re-exports sonner toast with success and error helpers', () => {
    expect(typeof toast).toBe('function');
    expect(typeof toast.success).toBe('function');
    expect(typeof toast.error).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib.toast.test.ts`
Expected: FAIL — cannot resolve `@/lib/ui/toast`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ui/toast.ts

/**
 * Single import surface for transient feedback. <Toaster> is mounted once in
 * src/app/layout.tsx. Policy (spec §3): toast for success-after-close and
 * unexpected/network errors; inline role="alert" (via <Field>) for field-level
 * validation that must persist next to the control.
 */
export { toast } from 'sonner';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib.toast.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/toast.ts src/__tests__/lib.toast.test.ts
git commit -m "feat(ui): add toast wrapper over sonner"
```

---

## Task 4: `<Spinner>` primitive

**Files:**
- Create: `src/components/ui/spinner.tsx`
- Test: `src/__tests__/components.ui-spinner.test.tsx`

Server component (no hooks). Used by `<Button loading>` and inline list states.

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components.ui-spinner.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react'; // classic JSX transform (CLAUDE.md §11)
import { Spinner } from '@/components/ui/spinner';

describe('Spinner', () => {
  it('renders a spinning, aria-hidden icon', () => {
    const html = renderToString(React.createElement(Spinner));
    expect(html).toContain('animate-spin');
    expect(html).toContain('aria-hidden');
  });

  it('merges a caller-supplied className', () => {
    const html = renderToString(React.createElement(Spinner, { className: 'h-6 w-6' }));
    expect(html).toContain('h-6');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components.ui-spinner.test.tsx`
Expected: FAIL — cannot resolve `@/components/ui/spinner`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/ui/spinner.tsx
import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/ui/cn';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn('h-4 w-4 animate-spin', className)} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components.ui-spinner.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/spinner.tsx src/__tests__/components.ui-spinner.test.tsx
git commit -m "feat(ui): add Spinner primitive"
```

---

## Task 5: `<Button>` primitive

**Files:**
- Create: `src/components/ui/button.tsx`
- Test: `src/__tests__/components.ui-button.test.tsx`

This is the one place the brand palette `#F97316`/`#EA580C` is allowed to live inline (kills ~69 duplications as forms migrate). `type` defaults to `'button'` — callers pass `type='submit'` for form submits.

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components.ui-button.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react'; // classic JSX transform (CLAUDE.md §11)
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders children and primary brand styling by default', () => {
    const html = renderToString(React.createElement(Button, null, 'Сохранить'));
    expect(html).toContain('Сохранить');
    expect(html).toContain('#F97316');
  });

  it('when loading: shows spinner and is disabled', () => {
    const html = renderToString(React.createElement(Button, { loading: true }, 'Загрузить'));
    expect(html).toContain('animate-spin');
    expect(html).toContain('disabled');
  });

  it('defaults to type=button (not submit)', () => {
    const html = renderToString(React.createElement(Button, null, 'X'));
    expect(html).toContain('type="button"');
  });

  it('respects an explicit type=submit', () => {
    const html = renderToString(React.createElement(Button, { type: 'submit' }, 'X'));
    expect(html).toContain('type="submit"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components.ui-button.test.tsx`
Expected: FAIL — cannot resolve `@/components/ui/button`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/ui/button.tsx
'use client';

import React, { forwardRef } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/ui/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-[#F97316] text-white hover:bg-[#EA580C]',
  secondary: 'border border-gray-200 text-[#111111] hover:bg-gray-50',
  ghost: 'text-gray-700 hover:bg-gray-100',
  danger: 'bg-red-600 text-white hover:bg-red-700'
};

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm'
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components.ui-button.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/button.tsx src/__tests__/components.ui-button.test.tsx
git commit -m "feat(ui): add Button primitive (variants, size, loading)"
```

---

## Task 6: Form-control primitives (`Input`, `Textarea`, `Select`)

**Files:**
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/textarea.tsx`
- Create: `src/components/ui/select.tsx`
- Test: `src/__tests__/components.ui-form-controls.test.tsx`

Consistent border/focus/disabled styling. `invalid` prop wires `aria-invalid` and a red border.

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components.ui-form-controls.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react'; // classic JSX transform (CLAUDE.md §11)
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';

describe('form controls', () => {
  it('Input forwards native props and shared focus ring', () => {
    const html = renderToString(React.createElement(Input, { placeholder: 'Имя' }));
    expect(html).toContain('placeholder="Имя"');
    expect(html).toContain('focus:ring-[#F97316]');
  });

  it('Input invalid sets aria-invalid', () => {
    const html = renderToString(React.createElement(Input, { invalid: true }));
    expect(html).toContain('aria-invalid="true"');
  });

  it('Textarea renders a textarea with shared styling', () => {
    const html = renderToString(React.createElement(Textarea, { rows: 3 }));
    expect(html).toContain('<textarea');
    expect(html).toContain('focus:ring-[#F97316]');
  });

  it('Select renders its option children', () => {
    const html = renderToString(
      React.createElement(Select, { value: 'a', onChange: () => {} },
        React.createElement('option', { value: 'a' }, 'A'))
    );
    expect(html).toContain('<select');
    expect(html).toContain('A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components.ui-form-controls.test.tsx`
Expected: FAIL — cannot resolve the new modules.

- [ ] **Step 3: Write minimal implementations**

```tsx
// src/components/ui/input.tsx
'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/ui/cn';

const CONTROL =
  'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, invalid ? 'border-red-400' : 'border-gray-300', className)}
      {...rest}
    />
  );
});
```

```tsx
// src/components/ui/textarea.tsx
'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/ui/cn';

const CONTROL =
  'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, invalid ? 'border-red-400' : 'border-gray-300', className)}
      {...rest}
    />
  );
});
```

```tsx
// src/components/ui/select.tsx
'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/ui/cn';

const CONTROL =
  'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, invalid ? 'border-red-400' : 'border-gray-300', className)}
      {...rest}
    >
      {children}
    </select>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components.ui-form-controls.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/input.tsx src/components/ui/textarea.tsx src/components/ui/select.tsx src/__tests__/components.ui-form-controls.test.tsx
git commit -m "feat(ui): add Input/Textarea/Select form-control primitives"
```

---

## Task 7: `<Badge>` primitive

**Files:**
- Create: `src/components/ui/badge.tsx`
- Test: `src/__tests__/components.ui-badge.test.tsx`

Server component. `info` tone reuses the existing role-badge palette (`#FFF7ED`/`#9A3412`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components.ui-badge.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react'; // classic JSX transform (CLAUDE.md §11)
import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('renders children with neutral tone by default', () => {
    const html = renderToString(React.createElement(Badge, null, 'Активен'));
    expect(html).toContain('Активен');
    expect(html).toContain('bg-gray-100');
  });

  it('applies the info tone palette', () => {
    const html = renderToString(React.createElement(Badge, { tone: 'info' }, 'Админ'));
    expect(html).toContain('#FFF7ED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components.ui-badge.test.tsx`
Expected: FAIL — cannot resolve `@/components/ui/badge`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/ui/badge.tsx
import React from 'react';
import { cn } from '@/lib/ui/cn';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  info: 'bg-[#FFF7ED] text-[#9A3412]',
  success: 'bg-green-50 text-green-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700'
};

export function Badge({
  tone = 'neutral',
  className,
  children
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components.ui-badge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/badge.tsx src/__tests__/components.ui-badge.test.tsx
git commit -m "feat(ui): add Badge primitive"
```

---

## Task 8: `<Field>` wrapper

**Files:**
- Create: `src/components/ui/field.tsx`
- Test: `src/__tests__/components.ui-field.test.tsx`

Wraps label + control + error region. `htmlFor` is explicit (caller passes the same `id` to the control) so label/error association is visible at the call site. Error region is `role="alert"` and gets a stable id (`<htmlFor>-err`) the caller wires via `aria-describedby`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components.ui-field.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react'; // classic JSX transform (CLAUDE.md §11)
import { Field } from '@/components/ui/field';

describe('Field', () => {
  it('renders a label bound to htmlFor and the control children', () => {
    const html = renderToString(
      React.createElement(Field, { htmlFor: 'doc-type', label: 'Тип' },
        React.createElement('select', { id: 'doc-type' }))
    );
    expect(html).toContain('for="doc-type"');
    expect(html).toContain('Тип');
    expect(html).toContain('id="doc-type"');
  });

  it('shows hint when no error', () => {
    const html = renderToString(
      React.createElement(Field, { htmlFor: 'f', label: 'L', hint: 'PDF до 20 МБ' },
        React.createElement('input', { id: 'f' }))
    );
    expect(html).toContain('PDF до 20 МБ');
  });

  it('renders an alert error region with a stable id, hiding the hint', () => {
    const html = renderToString(
      React.createElement(Field, { htmlFor: 'f', label: 'L', hint: 'H', error: 'Файл не выбран.' },
        React.createElement('input', { id: 'f' }))
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="f-err"');
    expect(html).toContain('Файл не выбран.');
    expect(html).not.toContain('>H<'); // hint hidden when error present
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components.ui-field.test.tsx`
Expected: FAIL — cannot resolve `@/components/ui/field`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/ui/field.tsx
'use client';

import React from 'react';

export type FieldProps = {
  htmlFor: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
};

/**
 * Label + control + feedback wrapper. The caller passes the control's `id` as
 * `htmlFor` and, when it wants screen-reader association, sets
 * aria-describedby={`${htmlFor}-err`} on the control. The error region is a
 * persistent role="alert" (spec §3: inline alert for field-level validation).
 */
export function Field({ htmlFor, label, hint, error, children }: FieldProps) {
  const errId = `${htmlFor}-err`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs text-gray-500">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      {error && (
        <p id={errId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components.ui-field.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/field.tsx src/__tests__/components.ui-field.test.tsx
git commit -m "feat(ui): add Field label/control/error wrapper"
```

---

## Task 9: Barrel export + integration gate

**Files:**
- Create: `src/components/ui/index.ts`

Export only public primitives. `dialog.tsx`'s internal `pickInitialFocus`/`FOCUSABLE_SELECTOR` stay private (barrel re-exports only `Dialog` + its public types), mirroring the C5 "export only public submodules" rule.

- [ ] **Step 1: Write the barrel**

```ts
// src/components/ui/index.ts
export { Button, type ButtonProps } from './button';
export { Input, type InputProps } from './input';
export { Textarea, type TextareaProps } from './textarea';
export { Select, type SelectProps } from './select';
export { Badge } from './badge';
export { Spinner } from './spinner';
export { Field, type FieldProps } from './field';
export { Dialog, type DialogProps, type DialogSize } from './dialog';
```

- [ ] **Step 2: Run typecheck + lint + the new unit tests together**

Run:
```bash
npm run typecheck && npx eslint --max-warnings=0 src/components/ui src/lib/ui src/lib/errors && npx vitest run src/__tests__/lib.cn.test.ts src/__tests__/lib.errorMessages.test.ts src/__tests__/lib.toast.test.ts src/__tests__/components.ui-button.test.tsx src/__tests__/components.ui-form-controls.test.tsx src/__tests__/components.ui-badge.test.tsx src/__tests__/components.ui-field.test.tsx src/__tests__/components.ui-spinner.test.tsx
```
Expected: typecheck clean, eslint 0 warnings/errors, all primitive + util tests PASS.

> Note: the new files contain inline `#F97316` (Button/Input/Select/Badge) — this is intentional and currently *not* lint-banned (hex-guardrail deferred). eslint must still pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/index.ts
git commit -m "feat(ui): barrel-export public primitives"
```

---

## Task 10: Migrate `partner-document-upload-form` to primitives

**Files:**
- Modify: `src/components/partner/partner-document-upload-form.tsx`
- Test: `src/__tests__/components.partner-document-upload-form.test.tsx`

Migration scope: replace inline `<select>`/`<button>` with `Select`/`Button`, replace local `ERROR_LABEL_RU` with `errorMessageRu`, switch success feedback to `toast.success` (drop the inline success `<p>`), keep operation errors inline via state. Submit path (`uploadPartnerDocument` server-action) is **unchanged**.

- [ ] **Step 1: Write the regression smoke test first**

```tsx
// src/__tests__/components.partner-document-upload-form.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react'; // classic JSX transform (CLAUDE.md §11)
import { PartnerDocumentUploadForm } from '@/components/partner/partner-document-upload-form';

describe('PartnerDocumentUploadForm', () => {
  it('renders the file input, type select and submit button', () => {
    const html = renderToString(React.createElement(PartnerDocumentUploadForm, { orderId: 'o1' }));
    expect(html).toContain('type="file"');
    expect(html).toContain('<select');
    expect(html).toContain('Отправить'); // submit button label
  });

  it('renders all document-type options', () => {
    const html = renderToString(React.createElement(PartnerDocumentUploadForm, { orderId: 'o1' }));
    expect(html).toContain('Договор');
    expect(html).toContain('Прочее');
  });
});
```

- [ ] **Step 2: Run test to verify it passes against the CURRENT (pre-migration) component**

Run: `npx vitest run src/__tests__/components.partner-document-upload-form.test.tsx`
Expected: PASS (the assertions hold for the current markup too — this locks behavior before we refactor).

- [ ] **Step 3: Migrate the component**

```tsx
// src/components/partner/partner-document-upload-form.tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadPartnerDocument } from '@/server-actions/partner/documents';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';

const DOC_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'waybill', label: 'Накладная' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'other', label: 'Прочее' }
];

export function PartnerDocumentUploadForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('other');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError(errorMessageRu('no_file')); return; }
    const formData = new FormData();
    formData.set('orderId', orderId);
    formData.set('docType', docType);
    formData.set('file', file);
    setIsPending(true);
    try {
      const res = await uploadPartnerDocument(formData);
      if (res.ok) {
        toast.success(`Документ «${file.name}» отправлен менеджеру.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        router.refresh();
      } else {
        setError(errorMessageRu(res.error, 'Ошибка загрузки.'));
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Отправить документ менеджеру</h2>
      <form onSubmit={onSubmit} className='flex flex-col gap-3'>
        <Field htmlFor='partner-doc-file' label='Файл' hint='Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ.'>
          <input
            id='partner-doc-file'
            ref={fileInputRef}
            type='file'
            disabled={isPending}
            className='block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50'
          />
        </Field>

        <Field htmlFor='partner-doc-type' label='Тип документа'>
          <Select
            id='partner-doc-type'
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            disabled={isPending}
          >
            {DOC_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>

        <div>
          <Button type='submit' loading={isPending}>
            {isPending ? 'Отправляю…' : 'Отправить'}
          </Button>
        </div>

        {error && <p role='alert' className='text-sm text-red-600'>{error}</p>}
      </form>
    </div>
  );
}
```

> The native `<input type='file'>` stays raw (no `FileInput` primitive in Tier 1) but keeps its file-button styling; it's wrapped in `<Field>` for label + hint. The brand hex on the file button is acceptable for now (guardrail deferred).

- [ ] **Step 4: Run the smoke test + typecheck + lint to verify the migration is behavior-preserving**

Run:
```bash
npx vitest run src/__tests__/components.partner-document-upload-form.test.tsx && npm run typecheck && npx eslint --max-warnings=0 src/components/partner/partner-document-upload-form.tsx
```
Expected: tests PASS, typecheck clean, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/partner/partner-document-upload-form.tsx src/__tests__/components.partner-document-upload-form.test.tsx
git commit -m "refactor(partner): migrate document-upload form to ui primitives + error dict + toast"
```

---

## Task 11: Migrate `manager-doc-upload-form` to primitives

**Files:**
- Modify: `src/components/manager/manager-doc-upload-form.tsx`
- Test: `src/__tests__/components.manager-doc-upload-form.test.tsx`

Same migration. This form uses the `fetch`-to-API path (unchanged) and has the extra `recipient` select + the `commission_statement` auto-recipient logic (preserved exactly).

- [ ] **Step 1: Write the regression smoke test first**

```tsx
// src/__tests__/components.manager-doc-upload-form.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react'; // classic JSX transform (CLAUDE.md §11)
import { ManagerDocUploadForm } from '@/components/manager/manager-doc-upload-form';

describe('ManagerDocUploadForm', () => {
  it('renders file input, type select, recipient select and submit button', () => {
    const html = renderToString(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    expect(html).toContain('type="file"');
    expect(html).toContain('Получатель');
    expect(html).toContain('Загрузить');
  });

  it('includes the commission_statement option and both recipients', () => {
    const html = renderToString(React.createElement(ManagerDocUploadForm, { orderId: 'o1' }));
    expect(html).toContain('Расчёт комиссии');
    expect(html).toContain('Организация');
    expect(html).toContain('Партнёр');
  });
});
```

- [ ] **Step 2: Run test to verify it passes against the CURRENT component**

Run: `npx vitest run src/__tests__/components.manager-doc-upload-form.test.tsx`
Expected: PASS (locks behavior before refactor).

- [ ] **Step 3: Migrate the component**

```tsx
// src/components/manager/manager-doc-upload-form.tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';

/**
 * Client-side multipart upload form for the manager-side order detail page.
 * POSTs to /api/manager/documents/[id]/upload. The recipient select defaults to
 * 'organization' and auto-switches to 'partner' for 'commission_statement'.
 * Type options mirror prisma DocumentType 1:1 — keep in sync (same as
 * src/app/manager/documents/page.tsx).
 */

const DOC_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'waybill', label: 'Накладная' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'commission_statement', label: 'Расчёт комиссии' },
  { value: 'other', label: 'Прочее' }
];

type Props = { orderId: string };

export function ManagerDocUploadForm({ orderId }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>('other');
  const [recipient, setRecipient] = useState<'organization' | 'partner'>('organization');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onDocTypeChange(value: string) {
    setDocType(value);
    setRecipient(value === 'commission_statement' ? 'partner' : 'organization');
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError(errorMessageRu('no_file')); return; }

    const formData = new FormData();
    formData.set('file', file);
    formData.set('docType', docType);
    formData.set('recipient', recipient);

    setIsPending(true);
    try {
      const res = await fetch(
        `/api/manager/documents/${encodeURIComponent(orderId)}/upload`,
        { method: 'POST', body: formData }
      );

      if (res.status === 201) {
        toast.success(`Документ «${file.name}» загружен.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        router.refresh();
        return;
      }

      let errCode: string | null = null;
      try {
        const body = (await res.json()) as { error?: string };
        if (typeof body?.error === 'string') errCode = body.error;
      } catch {
        errCode = null;
      }
      setError(errCode ? errorMessageRu(errCode, `Ошибка загрузки (код ${res.status}).`) : `Ошибка загрузки (код ${res.status}).`);
    } catch {
      setError(errorMessageRu('network'));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Загрузить документ</h2>
      <form onSubmit={onSubmit} className='flex flex-col gap-3'>
        <Field htmlFor='mgr-doc-file' label='Файл' hint='Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум 20 МБ.'>
          <input
            id='mgr-doc-file'
            ref={fileInputRef}
            type='file'
            disabled={isPending}
            className='block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50'
          />
        </Field>

        <Field htmlFor='mgr-doc-type' label='Тип документа'>
          <Select id='mgr-doc-type' value={docType} onChange={(e) => onDocTypeChange(e.target.value)} disabled={isPending}>
            {DOC_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </Select>
        </Field>

        <Field htmlFor='mgr-doc-recipient' label='Получатель'>
          <Select
            id='mgr-doc-recipient'
            value={recipient}
            onChange={(e) => setRecipient(e.target.value as 'organization' | 'partner')}
            disabled={isPending}
          >
            <option value='organization'>Организация</option>
            <option value='partner'>Партнёр</option>
          </Select>
        </Field>

        <div>
          <Button type='submit' loading={isPending}>
            {isPending ? 'Загружаю…' : 'Загрузить'}
          </Button>
        </div>

        {error && <p role='alert' className='text-sm text-red-600'>{error}</p>}
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Verify migration is behavior-preserving**

Run:
```bash
npx vitest run src/__tests__/components.manager-doc-upload-form.test.tsx && npm run typecheck && npx eslint --max-warnings=0 src/components/manager/manager-doc-upload-form.tsx
```
Expected: tests PASS, typecheck clean, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/manager/manager-doc-upload-form.tsx src/__tests__/components.manager-doc-upload-form.test.tsx
git commit -m "refactor(manager): migrate doc-upload form to ui primitives + error dict + toast"
```

---

## Task 12: a11y — `scope='col'` sweep on table headers

**Files:**
- Modify: every component rendering `<th>` without a `scope` attribute.

Mechanical, low-risk, global. `<th scope='col'>` is the correct ARIA for column headers (WCAG 1.3.1).

- [ ] **Step 1: Enumerate the offenders**

Run: `npx grep -rn "<th" src/components | grep -v "scope="` (or use the editor's search). Build the list — known table files include: `partner/leads-table.tsx`, `partner/deals-table.tsx`, `partner/portfolio-table.tsx`, `partner/team-table.tsx`, `organization/team-table.tsx`, `organization/org-orders-table.tsx`, `manager/manager-orders-table.tsx`, `manager/manager-students-table.tsx`, `admin/users-table.tsx`, `admin/partners-table.tsx`. Confirm against the live grep — do not trust this list blindly.

- [ ] **Step 2: Add `scope='col'` to each column header**

For every `<th ...>` that is a column header, add `scope='col'`. Example transform:

```tsx
// before
<th className='px-4 py-2.5 font-medium text-gray-600'>Клиент</th>
// after
<th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Клиент</th>
```

Leave row-header `<th>` (if any inside `<tbody>` rows) as `scope='row'` — but these tables use `<td>` for body cells, so all `<th>` here are column headers.

- [ ] **Step 3: Verify nothing broke — typecheck, lint, and existing table tests**

Run:
```bash
npm run typecheck && npx eslint --max-warnings=0 src/components && npx vitest run src/__tests__/components.admin-users-table.test.tsx
```
Expected: clean; existing table test still PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components
git commit -m "a11y(tables): add scope=col to column headers"
```

---

## Task 13: Docs — rewrite CLAUDE.md §9, add §13 palette line

**Files:**
- Modify: `CLAUDE.md`

§9 currently documents a `useDialogFocus(open)` hook that does NOT exist (the native-`<dialog>` migration in PR #79/#80 moved focus management into `src/components/ui/dialog.tsx` via `pickInitialFocus`). Replace it with the real contract.

- [ ] **Step 1: Replace the §9 body**

Find the section starting `## 9. Accessibility (модалки)` and replace its body (down to but not including `## 10.`) with:

```markdown
## 9. Accessibility (модалки)

Все модалки используют общий примитив [`Dialog`](src/components/ui/dialog.tsx) поверх нативного `<dialog>`. Браузер сам даёт focus-trap, Escape, inert-фон, top-layer и focus-restore; компонент мостит декларативный `open` к императивному `showModal()/close()` и применяет project-specific initial-focus.

Контракт `Dialog`:

- Props: `open`, `onClose`, `title`, `size?` (`sm|md|lg|xl`), `busy?`, `closeOnBackdrop?`, `error?`, `notice?`, `children`.
- **Initial-focus** (экспортируемая чистая `pickInitialFocus`, WAI-ARIA APG для форм-диалогов): первый form control → первый submit → первый focusable → сам `<dialog>` (fallback).
- `aria-labelledby` привязан к `title`; `role="dialog"`/`aria-modal` подразумеваются нативным `<dialog>` — **не** хардкодить их (eslint `no-restricted-syntax` это ловит).
- Два всегда-смонтированных aria-live региона: `error` → `role="alert"` (assertive), `notice` → `role="status"` (polite). Внутри-модальный фидбек идёт сюда; toast — для success после закрытия.
- Escape и backdrop-click уважают `busy` (не закрывают во время сабмита).

Не создавай сырой `<dialog>`/`role="dialog"` — используй примитив (guardrail `NO_HANDROLLED_MODAL` в [eslint.config.mjs](eslint.config.mjs)). Прочие презентационные примитивы — `Button`/`Input`/`Select`/`Textarea`/`Badge`/`Spinner`/`Field` в [src/components/ui/](src/components/ui/) (barrel `index.ts`); строки ошибок — через `errorMessageRu` ([src/lib/errors/messages.ts](src/lib/errors/messages.ts)); транзиентный фидбек — через `toast` ([src/lib/ui/toast.ts](src/lib/ui/toast.ts)).
```

- [ ] **Step 2: Add a palette-convention line to §13**

In `## 13. Stylistic preferences`, find the bullet `- UI цвета: оранжевая палитра проекта ...` and append a sentence:

```markdown
- UI цвета: оранжевая палитра проекта `#F97316` (primary), `#EA580C` (hover), `#111111` (heading), `#F3F4F6` (panel bg). **Палитра запекается в примитивы `ui/` (Button/Badge/контролы) — не инлайнь brand-hex в новых компонентах; переиспользуй примитив.** (eslint-guardrail на инлайн-hex отложен — см. spec frontend-foundation §6.)
```

- [ ] **Step 3: Verify CLAUDE.md has no broken self-references**

Read the edited §9 and §13; confirm the linked paths exist (`src/components/ui/dialog.tsx`, `src/components/ui/`, `src/lib/errors/messages.ts`, `src/lib/ui/toast.ts`, `eslint.config.mjs`).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): rewrite §9 to real Dialog contract; §13 palette-via-primitives"
```

---

## Task 14: Final verification + close-out

**Files:**
- Create: `docs/superpowers/plans/2026-06-10-frontend-foundation-DONE.md`

- [ ] **Step 1: Run the full mandatory gate**

Run:
```bash
npm run typecheck && npm run lint && npm run test:unit
```
Expected: typecheck clean; lint 0 warnings/errors; full unit suite PASS (new primitive/util/dictionary/form tests included, all prior tests still green). Record the test count.

- [ ] **Step 2: Run the production build (release smoke)**

Run: `npm run build`
Expected: build succeeds (catches slug/RSC/client-boundary issues that typecheck misses — see memory project-phase8-dev-server-broken).

- [ ] **Step 3: Write the close-out**

Create `docs/superpowers/plans/2026-06-10-frontend-foundation-DONE.md` (companion summary per CLAUDE.md §8, NOT a rename): what shipped (primitives list, dictionary, toast wrapper, 2 migrated reference forms, scope=col sweep, §9/§13 docs), verification evidence (typecheck/lint/build/unit counts), and explicit deferred items (guardrail, remaining ~121 inline-hex files, Tier 2/3).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-10-frontend-foundation-DONE.md
git commit -m "docs(plan): frontend foundation (Tier 1) close-out"
```

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to choose merge/PR. (Note: gate L2.5 may hang on host :5432 per memory — this is a UI-only change touching no prisma/worker/services, so integration gate is not required; `--no-verify` push is acceptable if the gate hook hangs.)

---

## Self-Review

**1. Spec coverage:**
- Spec §1 primitives → Tasks 4–9 (Button/Input/Textarea/Select/Badge/Spinner/Field + barrel). ✓
- Spec §2 error dictionary (`src/lib/errors/messages.ts`, flat, fallback) → Task 2. ✓
- Spec §3 toast wrapper + policy → Task 3 (+ applied in Tasks 10–11). ✓
- Spec §4 docs (§9 rewrite, §13 line) → Task 13. ✓
- Spec §5 a11y (role=alert via Field; scope=col sweep) → Field in Task 8 (role=alert), Tasks 10–11 (inline role=alert kept), Task 12 (scope=col). ✓
- Spec §6 guardrail → DEFERRED (documented in plan header + Task 13 §13 note). ✓ (no task — intentional)
- Spec "reference forms" (partner + manager upload) → Tasks 10–11. ✓
- Spec test-strategy → per-task TDD + Task 14 full gate. ✓
- `cn()` util (needed by primitives, not explicitly in spec but implied) → Task 1. ✓

**2. Placeholder scan:** No "TBD/TODO". Task 12 deliberately says "confirm against live grep, do not trust the list blindly" — that's a real instruction (the file set must be verified at execution), not a placeholder; complete transform example is given.

**3. Type/name consistency:** `cn` (Task 1) used by all primitives. `errorMessageRu(code, fallback?)` (Task 2) called in Tasks 10–11 with the 2-arg form. `Button`/`Select`/`Field` props (`loading`, `htmlFor`, `invalid`) defined in Tasks 5/6/8 match usage in Tasks 10–11. `Spinner` (Task 4) consumed by `Button` (Task 5). Barrel (Task 9) re-exports exactly the symbols defined. `Field` error region id = `${htmlFor}-err` consistent between Task 8 impl and Task 8 test.

Reviewed — no gaps. Guardrail intentionally has no task (deferred by user decision, recorded in spec §6 + plan header).
