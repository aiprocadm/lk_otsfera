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

import { ManagerAttentionList } from '@/components/manager/manager-attention-list';
import type { AttentionItem } from '@/lib/services/manager/dashboard';

describe('ManagerAttentionList', () => {
  it('empty: renders the rest message', () => {
    const html = renderToString(React.createElement(ManagerAttentionList, { items: [] }));
    expect(html).toContain('Ничего срочного');
  });

  it('urgent item: red dot + red text classes', () => {
    const items: AttentionItem[] = [
      {
        id: 'a1',
        kind: 'overdue',
        severity: 'urgent',
        message: 'Просрочен дедлайн',
        href: '/manager/orders/1',
      },
    ];
    const html = renderToString(React.createElement(ManagerAttentionList, { items }));
    expect(html).toContain('bg-red-500');
    expect(html).toContain('text-red-700');
    expect(html).toContain('Просрочен дедлайн');
    expect(html).toContain('href="/manager/orders/1"');
  });

  it('non-urgent item: amber dot + amber text classes', () => {
    const items: AttentionItem[] = [
      {
        id: 'a2',
        kind: 'stale',
        severity: 'warn',
        message: 'Нет ответа 3 дня',
        href: '/manager/orders/2',
      },
    ];
    const html = renderToString(React.createElement(ManagerAttentionList, { items }));
    expect(html).toContain('bg-amber-500');
    expect(html).toContain('text-amber-700');
  });
});
