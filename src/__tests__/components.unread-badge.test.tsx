// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

const { useClientResource } = vi.hoisted(() => ({ useClientResource: vi.fn() }));
vi.mock('@/hooks/useClientResource', () => ({ useClientResource }));

import { UnreadBadge } from '@/components/chat/unread-badge';

describe('UnreadBadge', () => {
  beforeEach(() => {
    useClientResource.mockReset();
  });

  it('renders nothing when count is 0', () => {
    useClientResource.mockReturnValue({ data: 0 });
    const { container } = render(React.createElement(UnreadBadge));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when count is undefined/null', () => {
    useClientResource.mockReturnValue({ data: null });
    const { container } = render(React.createElement(UnreadBadge));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when count is negative', () => {
    useClientResource.mockReturnValue({ data: -1 });
    const { container } = render(React.createElement(UnreadBadge));
    expect(container.innerHTML).toBe('');
  });

  it('renders the badge with the count when positive', () => {
    useClientResource.mockReturnValue({ data: 5 });
    render(React.createElement(UnreadBadge));
    const badge = screen.getByLabelText('Непрочитанные сообщения');
    expect(badge.textContent).toBe('5');
  });

  it('passes select() that defaults count to 0 when the API payload omits it', () => {
    let capturedSelect: ((d: unknown) => number) | undefined;
    useClientResource.mockImplementation(
      (_url: string, opts: { select: (d: unknown) => number }) => {
        capturedSelect = opts.select;
        return { data: 0 };
      }
    );
    render(React.createElement(UnreadBadge));
    expect(capturedSelect).toBeDefined();
    expect(capturedSelect!({})).toBe(0);
    expect(capturedSelect!({ count: 3 })).toBe(3);
  });
});
