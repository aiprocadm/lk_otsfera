import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { TeamChatInbox } from '@/components/chat/team-chat-inbox';

const CURRENT_USER = 'user-manager-1';

const THREAD_ORG = {
  id: 'thread-org-1',
  orderId: 'order-1',
  side: 'org' as const,
  orderNumber: 'ПЗ-0010',
  orderTitle: 'Поставка компрессоров',
  lastMessageAt: new Date('2024-04-01T10:00:00Z'),
  unread: false
};

const THREAD_PARTNER = {
  id: 'thread-partner-1',
  orderId: 'order-1',
  side: 'partner' as const,
  orderNumber: 'ПЗ-0010',
  orderTitle: 'Поставка компрессоров',
  lastMessageAt: new Date('2024-04-02T12:00:00Z'),
  unread: true
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

describe('TeamChatInbox', () => {
  it('shows "Нет переписок" when threads array is empty', () => {
    const html = renderToString(
      React.createElement(TeamChatInbox, { threads: [], currentUserId: CURRENT_USER })
    );
    expect(html).toContain('Нет переписок');
  });

  it('renders order labels for both threads', () => {
    const html = renderToString(
      React.createElement(TeamChatInbox, {
        threads: [THREAD_ORG, THREAD_PARTNER],
        currentUserId: CURRENT_USER
      })
    );
    expect(html).toContain('Поставка компрессоров');
  });

  it('renders side badge "Заказчик" for org thread and "Партнёр" for partner thread', () => {
    const html = renderToString(
      React.createElement(TeamChatInbox, {
        threads: [THREAD_ORG, THREAD_PARTNER],
        currentUserId: CURRENT_USER
      })
    );
    expect(html).toContain('Заказчик');
    expect(html).toContain('Партнёр');
  });

  it('renders order number for each thread', () => {
    const html = renderToString(
      React.createElement(TeamChatInbox, {
        threads: [THREAD_ORG, THREAD_PARTNER],
        currentUserId: CURRENT_USER
      })
    );
    expect(html).toContain('ПЗ-0010');
  });

  it('renders unread dot only for unread threads', () => {
    // THREAD_PARTNER is unread, THREAD_ORG is not
    const html = renderToString(
      React.createElement(TeamChatInbox, {
        threads: [THREAD_ORG, THREAD_PARTNER],
        currentUserId: CURRENT_USER
      })
    );
    const count = html.split('data-unread="true"').length - 1;
    expect(count).toBe(1);
  });

  it('renders as many unread dots as there are unread threads', () => {
    // THREAD_PARTNER and THREAD_ORG_UNREAD are both unread
    const html = renderToString(
      React.createElement(TeamChatInbox, {
        threads: [THREAD_ORG, THREAD_PARTNER, THREAD_ORG_UNREAD],
        currentUserId: CURRENT_USER
      })
    );
    const count = html.split('data-unread="true"').length - 1;
    expect(count).toBe(2);
  });

  it('renders both "Заказчик" and "Партнёр" badges when both sides present', () => {
    const html = renderToString(
      React.createElement(TeamChatInbox, {
        threads: [THREAD_ORG, THREAD_PARTNER, THREAD_ORG_UNREAD],
        currentUserId: CURRENT_USER
      })
    );
    expect(html).toContain('Заказчик');
    expect(html).toContain('Партнёр');
  });
});
