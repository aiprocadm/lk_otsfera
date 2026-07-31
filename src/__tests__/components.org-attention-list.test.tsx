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

import { OrgAttentionList } from '@/components/organization/org-attention-list';
import type { OrgAttention } from '@/lib/services/organization/dashboard';

describe('OrgAttentionList', () => {
  it('renders empty state when there are no items', () => {
    const data: OrgAttention = { items: [] };
    const html = renderToString(React.createElement(OrgAttentionList, { data }));
    expect(html).toContain('Всё под контролем');
  });

  it('renders a linked urgent item with meta (billed_unpaid, orderId present)', () => {
    const data: OrgAttention = {
      items: [
        {
          id: '1',
          kind: 'billed_unpaid',
          title: 'Счёт №1',
          severity: 'urgent',
          orderId: 'o1',
          meta: '10 000 ₽',
        },
      ],
    };
    const html = renderToString(React.createElement(OrgAttentionList, { data }));
    expect(html).toContain('href="/organization/orders/o1"');
    expect(html).toContain('text-red-700');
    expect(html).toContain('💳');
    expect(html).toContain('10 000 ₽');
  });

  it('renders a non-urgent item without orderId as plain span (no link) and no meta', () => {
    const data: OrgAttention = {
      items: [
        {
          id: '2',
          kind: 'unsigned_act',
          title: 'Акт не подписан',
          severity: 'warn',
          orderId: null,
        },
      ],
    };
    const html = renderToString(React.createElement(OrgAttentionList, { data }));
    expect(html).not.toContain('<a');
    expect(html).toContain('text-gray-700');
    expect(html).toContain('✍');
    expect(html).toContain('Акт не подписан');
  });

  it('renders an urgent item without orderId as a red-toned plain span (no link)', () => {
    const data: OrgAttention = {
      items: [
        { id: '4', kind: 'unsigned_act', title: 'Срочный акт', severity: 'urgent', orderId: null },
      ],
    };
    const html = renderToString(React.createElement(OrgAttentionList, { data }));
    expect(html).not.toContain('<a');
    expect(html).toContain('text-red-700');
    expect(html).toContain('Срочный акт');
  });

  it('renders completed_open kind icon', () => {
    const data: OrgAttention = {
      items: [
        {
          id: '3',
          kind: 'completed_open',
          title: 'Завершён, не закрыт',
          severity: 'warn',
          orderId: 'o2',
        },
      ],
    };
    const html = renderToString(React.createElement(OrgAttentionList, { data }));
    expect(html).toContain('✅');
  });
});
