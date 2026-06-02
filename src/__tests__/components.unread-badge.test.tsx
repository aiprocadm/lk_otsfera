/**
 * Minimal smoke-test for UnreadBadge.
 *
 * We use renderToString (server-side render) as the existing component tests do.
 * useEffect does NOT run in renderToString, so the initial count is 0 and the
 * component renders null — that's the expected initial state (renders nothing
 * until the first poll resolves in the browser). The test verifies:
 *   1. The component renders without throwing.
 *   2. Its initial output contains no count badge (count=0 → null).
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react'; // needed for vitest classic JSX transform (CLAUDE.md §11)
import { UnreadBadge } from '@/components/chat/unread-badge';

describe('UnreadBadge', () => {
  it('renders without throwing', () => {
    expect(() => {
      renderToString(React.createElement(UnreadBadge));
    }).not.toThrow();
  });

  it('produces no visible badge content in its initial (count=0) state', () => {
    const html = renderToString(React.createElement(UnreadBadge));
    // count starts at 0, so the component returns null and renders nothing
    expect(html).toBe('');
  });

  it('is exported as a function (component)', async () => {
    const mod = await import('@/components/chat/unread-badge');
    expect(typeof mod.UnreadBadge).toBe('function');
  });
});
