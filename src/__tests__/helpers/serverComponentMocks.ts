/**
 * Recipe (not a runtime helper) for next/navigation sentinels in a
 * server-component page test.
 *
 * `vi.hoisted` + `vi.mock` calls are hoisted by Vite above **all** of a test
 * file's own imports — including an import of a shared factory from this
 * module. That means neither a shared hoisted object nor a shared factory
 * function can be imported and then referenced inside `vi.mock('next/navigation', ...)`:
 * by the time the mock factory runs, the import binding is not yet
 * initialized ("Cannot access '...' before initialization" / TDZ). There is
 * no working cross-file shortcut for this — each test file must declare its
 * own `vi.hoisted` + `vi.mock('next/navigation', ...)` inline. Copy this
 * snippet into each new page test:
 *
 *   import { describe, it, expect, vi } from 'vitest';
 *
 *   const nav = vi.hoisted(() => ({
 *     redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
 *     notFound: vi.fn(() => { throw new Error('NOT_FOUND'); })
 *   }));
 *   vi.mock('next/navigation', () => nav);
 *
 * `redirect`/`notFound` in real Next.js throw a special internal error to
 * unwind rendering; these sentinels reproduce that "throws" contract so
 * `expect(() => Page(...)).toThrow(...)` /
 * `await expect(Page(...)).rejects.toThrow(...)` assertions work the same
 * way against the mock as against the real thing. Assert on the thrown
 * message (e.g. `REDIRECT:/login`) to pin down the redirect target.
 *
 * If a test also needs `useRouter` (client components rendered inside a
 * page, e.g. LoginForm/ResetPasswordForm), extend the object literal in the
 * same factory: `vi.mock('next/navigation', () => ({ ...nav, useRouter: () => ({ push: vi.fn() }) }))`.
 *
 * This file intentionally has no runtime export — it exists purely to give
 * the recipe a stable, discoverable location next to renderServerComponent.
 */
export {};
