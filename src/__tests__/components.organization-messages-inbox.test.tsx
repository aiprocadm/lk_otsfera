import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrganizationMessagesInbox } from '@/components/organization/organization-messages-inbox';

const CURRENT_USER = 'user-org-1';

const THREAD_A = {
  id: 'thread-org-a',
  orderId: 'order-org-a',
  side: 'org' as const,
  orderNumber: 'ОЗ-0001',
  orderTitle: 'Поставка серверного оборудования',
  lastMessageAt: new Date('2024-04-01T10:00:00Z'),
  unread: false
};

const THREAD_B = {
  id: 'thread-org-b',
  orderId: 'order-org-b',
  side: 'org' as const,
  orderNumber: 'ОЗ-0002',
  orderTitle: 'Монтаж сетевой инфраструктуры',
  lastMessageAt: new Date('2024-04-02T12:00:00Z'),
  unread: true
};

describe('OrganizationMessagesInbox', () => {
  it('shows "Нет переписок" when threads array is empty', () => {
    const html = renderToString(
      React.createElement(OrganizationMessagesInbox, { threads: [], currentUserId: CURRENT_USER })
    );
    expect(html).toContain('Нет переписок');
  });

  it('renders both thread order labels when two threads are provided', () => {
    const html = renderToString(
      React.createElement(OrganizationMessagesInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER
      })
    );
    expect(html).toContain('Поставка серверного оборудования');
    expect(html).toContain('Монтаж сетевой инфраструктуры');
  });

  it('renders order numbers for each thread', () => {
    const html = renderToString(
      React.createElement(OrganizationMessagesInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER
      })
    );
    expect(html).toContain('ОЗ-0001');
    expect(html).toContain('ОЗ-0002');
  });

  it('renders an unread indicator for threads with unread=true', () => {
    const html = renderToString(
      React.createElement(OrganizationMessagesInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER
      })
    );
    // THREAD_B has unread=true — the dot element should be present
    expect(html).toContain('data-unread="true"');
  });

  it('unread dot count equals number of unread threads (read thread shows none)', () => {
    const html = renderToString(
      React.createElement(OrganizationMessagesInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER
      })
    );
    // Only THREAD_B is unread — exactly one dot, THREAD_A (unread=false) shows none
    const occurrences = html.split('data-unread="true"').length - 1;
    expect(occurrences).toBe(1);
  });
});
