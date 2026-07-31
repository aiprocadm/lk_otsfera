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

import { OrgEventsFeed } from '@/components/organization/org-events-feed';
import type { OrgEvent } from '@/lib/services/organization/dashboard';

describe('OrgEventsFeed', () => {
  it('renders empty state when there are no events', () => {
    const html = renderToString(React.createElement(OrgEventsFeed, { events: [] }));
    expect(html).toContain('Пока тут пусто');
  });

  it('renders a linked event with orderId (document_published)', () => {
    const events: OrgEvent[] = [
      {
        id: 'e1',
        kind: 'document_published',
        title: 'Загружен акт',
        orderId: 'o1',
        at: new Date('2026-01-05T10:00:00Z'),
      },
    ];
    const html = renderToString(React.createElement(OrgEventsFeed, { events }));
    expect(html).toContain('href="/organization/orders/o1"');
    expect(html).toContain('📄');
    expect(html).toContain('Загружен акт');
  });

  it('renders a plain span when orderId is null (comment_posted)', () => {
    const events: OrgEvent[] = [
      {
        id: 'e2',
        kind: 'comment_posted',
        title: 'Новый комментарий',
        orderId: null,
        at: new Date('2026-01-06T10:00:00Z'),
      },
    ];
    const html = renderToString(React.createElement(OrgEventsFeed, { events }));
    expect(html).not.toContain('<a');
    expect(html).toContain('💬');
  });

  it('renders payment_received and order_status_changed icons', () => {
    const events: OrgEvent[] = [
      {
        id: 'e3',
        kind: 'payment_received',
        title: 'Оплата получена',
        orderId: 'o3',
        at: new Date('2026-01-07T10:00:00Z'),
      },
      {
        id: 'e4',
        kind: 'order_status_changed',
        title: 'Статус изменён',
        orderId: 'o4',
        at: new Date('2026-01-08T10:00:00Z'),
      },
    ];
    const html = renderToString(React.createElement(OrgEventsFeed, { events }));
    expect(html).toContain('💰');
    expect(html).toContain('📋');
  });
});
