import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

import { BackLink } from '@/components/ui/back-link';

describe('BackLink', () => {
  it('рендерит «← <label>» со ссылкой', () => {
    const html = renderToString(
      React.createElement(BackLink, { href: '/partner/deals', label: 'Все заказы' })
    );
    expect(html).toContain('href="/partner/deals"');
    expect(html).toContain('← Все заказы');
  });
});
