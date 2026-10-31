import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

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

import { StatCard } from '@/components/dashboard/stat-card';

describe('StatCard', () => {
  it('без href рендерится как div (не ссылка)', () => {
    const html = renderToString(React.createElement(StatCard, { title: 'Заказы', value: 5 }));
    expect(html).not.toContain('<a ');
  });
  it('с href вся плитка — ссылка', () => {
    const html = renderToString(
      React.createElement(StatCard, { title: 'Заказы', value: 5, href: '/manager/orders' })
    );
    expect(html).toContain('href="/manager/orders"');
    expect(html).toContain('Заказы');
  });
  it('`У-345`: подпись под числом и оранжевое приглашение со стрелкой', () => {
    const html = renderToString(
      React.createElement(StatCard, {
        title: 'Долг клиентов',
        value: '600 ₽',
        hint: 'по выставленным заказам',
        hintLink: 'Отдельно по организациям',
      })
    );
    expect(html).toContain('по выставленным заказам');
    expect(html).toContain('Отдельно по организациям ›');
    expect(html).toContain('text-[#EA580C]');
  });
  it('на акцентной плитке подписи светлые — читаются на оранжевом', () => {
    const html = renderToString(
      React.createElement(StatCard, {
        title: 'Комиссия',
        value: '1 ₽',
        accent: true,
        hint: 'к выплате',
        hintLink: 'Подробнее',
      })
    );
    expect(html).toContain('text-orange-100');
    expect(html).not.toContain('text-[#EA580C]');
  });
  it('без подписей лишних строк нет', () => {
    const html = renderToString(React.createElement(StatCard, { title: 'Заказы', value: 5 }));
    expect(html).not.toContain('›');
    expect(html).not.toContain('text-xs text-gray-500');
  });
});
