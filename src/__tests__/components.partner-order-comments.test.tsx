import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { OrderComments } from '@/components/partner/order-comments';
import type { PartnerOrderCommentRow } from '@/lib/services/partner/orderDetail';

describe('OrderComments', () => {
  it('renders the empty message and no count badge when there are no comments', () => {
    const html = renderToString(
      React.createElement(OrderComments, { comments: [], orderId: 'o1' })
    );
    expect(html).toContain('Комментариев пока нет');
    expect(html).not.toContain('(<!-- -->');
  });

  it('renders a comment list with author initial, name, body and count', () => {
    const comments: PartnerOrderCommentRow[] = [
      {
        id: 'c1',
        body: 'Привет мир',
        createdAt: new Date('2026-01-01T10:00:00Z'),
        authorName: 'Иван Петров',
      },
    ];
    const html = renderToString(React.createElement(OrderComments, { comments, orderId: 'o1' }));
    expect(html).toContain('Привет мир');
    expect(html).toContain('Иван Петров');
    expect(html).toContain('>И<');
    expect(html).toContain('(<!-- -->1<!-- -->)');
  });

  it('always renders the AddCommentForm textarea', () => {
    const html = renderToString(
      React.createElement(OrderComments, { comments: [], orderId: 'o1' })
    );
    expect(html).toContain('<textarea');
    expect(html).toContain('Отправить');
  });
});
