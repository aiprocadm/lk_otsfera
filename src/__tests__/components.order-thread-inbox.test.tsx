import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrderThreadInbox } from '@/components/chat/order-thread-inbox';

const CURRENT_USER = 'user-1';

const THREAD_A = {
  id: 'thread-a',
  orderId: 'order-a',
  side: 'partner' as const,
  orderNumber: 'ПЗ-0001',
  orderTitle: 'Поставка оборудования',
  lastMessageAt: new Date('2024-03-01T10:00:00Z'),
  unread: false
};

const THREAD_B = {
  id: 'thread-b',
  orderId: 'order-b',
  side: 'partner' as const,
  orderNumber: 'ПЗ-0002',
  orderTitle: 'Монтажные работы',
  lastMessageAt: new Date('2024-03-02T12:00:00Z'),
  unread: true
};

const THREAD_ORG = {
  id: 'thread-org-1',
  orderId: 'order-1',
  side: 'org' as const,
  orderNumber: 'ПЗ-0010',
  orderTitle: 'Поставка компрессоров',
  lastMessageAt: new Date('2024-04-01T10:00:00Z'),
  unread: false
};

const THREAD_ORG_UNREAD = {
  id: 'thread-org-2',
  orderId: 'order-2',
  side: 'org' as const,
  orderNumber: 'ПЗ-0011',
  orderTitle: 'Монтаж оборудования',
  lastMessageAt: new Date('2024-04-03T08:00:00Z'),
  unread: true
};

describe('OrderThreadInbox variant=role (partner/org)', () => {
  it('shows "Нет переписок" when threads array is empty', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    expect(html).toContain('Нет переписок');
  });

  it('renders both thread order labels', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    expect(html).toContain('Поставка оборудования');
    expect(html).toContain('Монтажные работы');
  });

  it('renders order numbers for each thread', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    expect(html).toContain('ПЗ-0001');
    expect(html).toContain('ПЗ-0002');
  });

  it('renders unread indicator only for unread threads', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    const occurrences = html.split('data-unread="true"').length - 1;
    expect(occurrences).toBe(1);
  });

  it('does NOT render side badges in role variant', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_ORG, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'role'
      })
    );
    expect(html).not.toContain('Заказчик');
    expect(html).not.toContain('Партнёр');
  });
});

describe('OrderThreadInbox variant=team (manager/admin)', () => {
  it('shows "Нет переписок" when threads array is empty', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [],
        currentUserId: CURRENT_USER,
        variant: 'team'
      })
    );
    expect(html).toContain('Нет переписок');
  });

  it('renders side badge "Заказчик" for org thread and "Партнёр" for partner thread', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_ORG, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'team'
      })
    );
    expect(html).toContain('Заказчик');
    expect(html).toContain('Партнёр');
  });

  it('renders order labels and numbers', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_ORG, THREAD_B],
        currentUserId: CURRENT_USER,
        variant: 'team'
      })
    );
    expect(html).toContain('Поставка компрессоров');
    expect(html).toContain('ПЗ-0010');
  });

  it('renders as many unread dots as there are unread threads', () => {
    const html = renderToString(
      React.createElement(OrderThreadInbox, {
        threads: [THREAD_ORG, THREAD_B, THREAD_ORG_UNREAD],
        currentUserId: CURRENT_USER,
        variant: 'team'
      })
    );
    const count = html.split('data-unread="true"').length - 1;
    expect(count).toBe(2);
    // Badges must survive alongside the multi-unread scenario (parity with old team-chat test)
    expect(html).toContain('Заказчик');
    expect(html).toContain('Партнёр');
  });
});
