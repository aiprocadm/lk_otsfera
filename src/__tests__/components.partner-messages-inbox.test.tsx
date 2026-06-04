import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { PartnerMessagesInbox } from '@/components/partner/partner-messages-inbox';

const CURRENT_USER = 'user-partner-1';

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

describe('PartnerMessagesInbox', () => {
  it('shows "Нет переписок" when threads array is empty', () => {
    const html = renderToString(
      React.createElement(PartnerMessagesInbox, { threads: [], currentUserId: CURRENT_USER })
    );
    expect(html).toContain('Нет переписок');
  });

  it('renders both thread order labels when two threads are provided', () => {
    const html = renderToString(
      React.createElement(PartnerMessagesInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER
      })
    );
    expect(html).toContain('Поставка оборудования');
    expect(html).toContain('Монтажные работы');
  });

  it('renders order numbers for each thread', () => {
    const html = renderToString(
      React.createElement(PartnerMessagesInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER
      })
    );
    expect(html).toContain('ПЗ-0001');
    expect(html).toContain('ПЗ-0002');
  });

  it('renders an unread indicator for threads with unread=true', () => {
    const html = renderToString(
      React.createElement(PartnerMessagesInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER
      })
    );
    // THREAD_B has unread=true — the dot element should be present
    expect(html).toContain('data-unread="true"');
  });

  it('does not render an unread indicator for a read thread (unread=false)', () => {
    const html = renderToString(
      React.createElement(PartnerMessagesInbox, {
        threads: [THREAD_A, THREAD_B],
        currentUserId: CURRENT_USER
      })
    );
    // Only THREAD_B is unread — the dot must appear exactly once,
    // proving THREAD_A (unread=false) does NOT get an indicator.
    const occurrences = html.split('data-unread="true"').length - 1;
    expect(occurrences).toBe(1);
  });
});
