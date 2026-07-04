import { vi } from 'vitest';

/**
 * Shared next/navigation sentinels for server-component page tests.
 *
 * Usage in a test file:
 *   import { nav } from './helpers/serverComponentMocks';
 *   vi.mock('next/navigation', () => ({ redirect: nav.redirect, notFound: nav.notFound }));
 *
 * `redirect`/`notFound` in real Next.js throw a special internal error to
 * unwind rendering; these sentinels reproduce that "throws" contract so
 * `await expect(Page(...)).rejects.toThrow(...)` assertions work the same
 * way against the mock as they would against the real thing. Assert on the
 * thrown message (e.g. `REDIRECT:/login`) to pin down the redirect target.
 *
 * If a test also needs `useRouter` (client components rendered inside a
 * page, e.g. LoginForm/ResetPasswordForm), extend the mock factory in that
 * test file: `vi.mock('next/navigation', () => ({ ...nav, useRouter: () => ({ push: vi.fn() }) }))`.
 */
export const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  })
}));
