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

import { StatCard } from '@/components/dashboard/stat-card';

describe('StatCard', () => {
  it('без href рендерится как div (не ссылка)', () => {
    const html = renderToString(React.createElement(StatCard, { title: 'Заказы', value: 5 }));
    expect(html).not.toContain('<a ');
  });
  it('с href вся плитка — ссылка', () => {
    const html = renderToString(
      React.createElement(StatCard, { title: 'Заказы', value: 5, href: '/manager/orders' })
    );
    expect(html).toContain('href="/manager/orders"');
    expect(html).toContain('Заказы');
  });
});
