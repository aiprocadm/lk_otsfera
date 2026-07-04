// @vitest-environment jsdom
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/** Awaits an async server component and renders its element in jsdom. */
export async function renderServerComponent(
  node: ReactElement | Promise<ReactElement>
): Promise<ReturnType<typeof render>> {
  return render(await node);
}
