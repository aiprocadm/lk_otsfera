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

import { AttentionList } from '@/components/partner/attention-list';
import type { Attention } from '@/lib/services/partner/dashboard';

const empty: Attention = { stuckOrders: [], overdueOrders: [] };

describe('AttentionList', () => {
  it('renders the all-clear message when everything is empty', () => {
    const html = renderToString(React.createElement(AttentionList, { data: empty }));
    expect(html).toContain('Всё под контролем');
  });

  it('renders a stuck order with updatedAt', () => {
    const data: Attention = {
      ...empty,
      stuckOrders: [
        {
          id: 'o1',
          title: 'Заказ А',
          updatedAt: new Date('2026-01-01'),
          deadline: null,
          totalAmount: '100',
          paidAmount: '0',
        },
      ],
    };
    const html = renderToString(React.createElement(AttentionList, { data }));
    expect(html).toContain('/partner/deals/o1');
    expect(html).toContain('Заказ А');
    expect(html).toContain('завис');
  });

  it('renders an overdue order with a deadline', () => {
    const data: Attention = {
      ...empty,
      overdueOrders: [
        {
          id: 'o2',
          title: 'Заказ Б',
          updatedAt: new Date('2026-01-01'),
          deadline: new Date('2026-02-01'),
          totalAmount: '100',
          paidAmount: '0',
        },
      ],
    };
    const html = renderToString(React.createElement(AttentionList, { data }));
    expect(html).toContain('Просрочка');
    expect(html).toContain('Заказ Б');
  });

  it('renders an overdue order with no deadline as em-dash', () => {
    const data: Attention = {
      ...empty,
      overdueOrders: [
        {
          id: 'o3',
          title: 'Заказ В',
          updatedAt: new Date('2026-01-01'),
          deadline: null,
          totalAmount: '100',
          paidAmount: '0',
        },
      ],
    };
    const html = renderToString(React.createElement(AttentionList, { data }));
    expect(html).toContain('до <!-- -->—');
  });
});
