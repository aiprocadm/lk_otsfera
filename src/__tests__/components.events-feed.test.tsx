import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

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

import { EventsFeed } from '@/components/partner/events-feed';
import type { DashboardEvent } from '@/lib/services/partner/dashboard';

describe('EventsFeed', () => {
  it('renders the empty-state message', () => {
    const html = renderToString(React.createElement(EventsFeed, { events: [] }));
    expect(html).toContain('Пока тут пусто');
  });

  it('order_updated event with a ref renders a Link to the deal', () => {
    const events: DashboardEvent[] = [
      {
        kind: 'order_updated',
        at: new Date('2026-01-01T10:00:00Z'),
        title: 'Заказ обновлён',
        ref: { kind: 'order', id: 'o1' },
      },
    ];
    const html = renderToString(React.createElement(EventsFeed, { events }));
    expect(html).toContain('href="/partner/orders/o1"');
    expect(html).toContain('Заказ обновлён');
  });

  it('payment_received event without a ref renders a plain span (no link)', () => {
    const events: DashboardEvent[] = [
      { kind: 'payment_received', at: new Date('2026-01-01T10:00:00Z'), title: 'Платёж получен' },
    ];
    const html = renderToString(React.createElement(EventsFeed, { events }));
    expect(html).not.toContain('<a ');
    expect(html).toContain('Платёж получен');
  });
});
