// @vitest-environment jsdom
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * Awaits an async server component and renders its element in jsdom.
 *
 * Widened to `ReactNode` (not just `ReactElement`) because several pages
 * legitimately return `null` from an early-return guard branch (e.g.
 * `src/app/student/redirect/page.tsx` returns `null` when there is no
 * session) — that is a real, testable branch, not an error case.
 */
export async function renderServerComponent(
  node: ReactNode | Promise<ReactNode>
): Promise<ReturnType<typeof render>> {
  return render(await node as ReactElement);
}
