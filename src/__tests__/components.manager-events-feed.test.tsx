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

import { ManagerEventsFeed } from '@/components/manager/manager-events-feed';
import type { EventItem } from '@/lib/services/manager/dashboard';

describe('ManagerEventsFeed', () => {
  it('empty: renders the empty-state message', () => {
    const html = renderToString(React.createElement(ManagerEventsFeed, { events: [] }));
    expect(html).toContain('Нет событий за последний период');
  });

  it('event with href: wraps content in a Link', () => {
    const events: EventItem[] = [
      {
        id: 'e1',
        kind: 'document',
        text: 'Документ загружен',
        when: new Date('2026-05-01T10:00:00Z'),
        href: '/manager/orders/1',
      },
    ];
    const html = renderToString(React.createElement(ManagerEventsFeed, { events }));
    expect(html).toContain('href="/manager/orders/1"');
    expect(html).toContain('Документ загружен');
  });

  it('event without href: renders a plain div (no link)', () => {
    const events: EventItem[] = [
      {
        id: 'e2',
        kind: 'system',
        text: 'Системное событие',
        when: new Date('2026-05-01T10:00:00Z'),
      },
    ];
    const html = renderToString(React.createElement(ManagerEventsFeed, { events }));
    expect(html).not.toContain('<a ');
    expect(html).toContain('Системное событие');
  });
});
