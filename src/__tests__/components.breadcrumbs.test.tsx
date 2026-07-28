import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Breadcrumbs } from '@/components/ui';

/**
 * Этап 11 PR-2 (ФТ-15.6) — презентационные крошки.
 * Инвариант доступности: текущая страница помечена aria-current и не ссылка.
 */

describe('Breadcrumbs', () => {
  it('пустой список ничего не рисует', () => {
    expect(renderToStaticMarkup(<Breadcrumbs items={[]} />)).toBe('');
  });

  it('промежуточные крошки — ссылки, последняя — текущая страница', () => {
    const html = renderToStaticMarkup(
      <Breadcrumbs
        items={[
          { label: 'Заказы', href: '/manager/orders' },
          { label: 'Заказ №5', href: null }
        ]}
      />
    );
    expect(html).toContain('href="/manager/orders"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Заказ №5');
    // Текущая крошка не должна быть ссылкой.
    expect(html).not.toContain('href="null"');
  });

  it('навигация подписана для скринридера, разделители от него скрыты', () => {
    const html = renderToStaticMarkup(
      <Breadcrumbs
        items={[
          { label: 'Лиды', href: '/manager/leads' },
          { label: 'Лид', href: null }
        ]}
      />
    );
    expect(html).toContain('aria-label="Хлебные крошки"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('перед первой крошкой разделителя нет', () => {
    const html = renderToStaticMarkup(<Breadcrumbs items={[{ label: 'Один', href: null }]} />);
    expect(html).not.toContain('aria-hidden="true"');
  });
});
