/**
 * M6 — тесты презентационных компонентов поиска: GET-форма и группированная
 * выдача (спека 2026-07-18 §4, §7).
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { vi } from 'vitest';

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

import { SearchForm } from '@/components/search/search-form';
import { SearchResults } from '@/components/search/search-results';
import type { SearchGroup } from '@/lib/services/search/globalSearch';

describe('SearchForm', () => {
  it('GET-форма на action с полем q и кнопкой', () => {
    const html = renderToString(
      React.createElement(SearchForm, { action: '/manager/search', initialQuery: 'ромашка' })
    );
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/manager/search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="ромашка"');
    expect(html).toContain('Найти');
  });

  it('без initialQuery поле пустое', () => {
    const html = renderToString(React.createElement(SearchForm, { action: '/leader/search' }));
    expect(html).toContain('action="/leader/search"');
    expect(html).toContain('value=""');
  });
});

function group(over: Partial<SearchGroup> = {}): SearchGroup {
  return {
    key: 'orders',
    labelRu: 'Заказы',
    limited: false,
    hits: [
      {
        id: 'o1',
        title: 'Обучение ОТ',
        subtitle: 'З-42 · ООО Ромашка',
        href: '/manager/orders/o1',
        date: new Date('2026-07-01T00:00:00Z'),
      },
    ],
    ...over,
  };
}

describe('SearchResults', () => {
  it('пустая выдача → «ничего не найдено» с запросом', () => {
    const html = renderToString(
      React.createElement(SearchResults, { groups: [], query: 'ромашка' })
    );
    expect(html).toContain('ничего не найдено');
    expect(html).toContain('ромашка');
  });

  it('группа: заголовок, счётчик, хит со ссылкой, подзаголовком и датой', () => {
    const html = renderToString(
      React.createElement(SearchResults, { groups: [group()], query: 'от' })
    );
    expect(html).toContain('Заказы');
    expect(html).toContain('href="/manager/orders/o1"');
    expect(html).toContain('Обучение ОТ');
    expect(html).toContain('З-42 · ООО Ромашка');
    expect(html).not.toContain('Показаны первые');
  });

  it('хит без subtitle/date не рендерит пустые строки', () => {
    const g = group({
      hits: [{ id: 'x', title: 'Т', subtitle: null, href: '/manager/tasks', date: null }],
    });
    const html = renderToString(React.createElement(SearchResults, { groups: [g], query: 'т' }));
    expect(html).toContain('href="/manager/tasks"');
  });

  it('limited → подпись «Показаны первые N»', () => {
    const html = renderToString(
      React.createElement(SearchResults, { groups: [group({ limited: true })], query: 'от' })
    );
    // renderToString вставляет комментарии-маркеры между текстом и {N} — матчим по частям.
    expect(html).toContain('Показаны первые');
    expect(html).toContain('уточните запрос');
  });
});
