import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Paginator } from '@/components/ui/paginator';

describe('Paginator', () => {
  it('возвращает пусто при ≤1 странице', () => {
    const html = renderToString(
      React.createElement(Paginator, {
        basePath: '/x',
        searchParams: {},
        take: 25,
        skip: 0,
        total: 10,
      })
    );
    expect(html).toBe('');
  });

  it('первая страница (60/25): «Вперёд» есть, «Назад» нет, «Страница 1 из 3»', () => {
    const html = renderToString(
      React.createElement(Paginator, {
        basePath: '/organization/orders',
        searchParams: { search: 'abc' },
        take: 25,
        skip: 0,
        total: 60,
      })
    );
    expect(html).toContain('Вперёд');
    expect(html).not.toContain('Назад');
    expect(html).toContain('Страница 1 из 3');
  });

  it('средняя страница: обе кнопки; текущие query-параметры сохранены', () => {
    const html = renderToString(
      React.createElement(Paginator, {
        basePath: '/organization/orders',
        searchParams: { search: 'abc', org: 'o1' },
        take: 25,
        skip: 25,
        total: 60,
      })
    );
    expect(html).toContain('Назад');
    expect(html).toContain('Вперёд');
    expect(html).toContain('search=abc');
    expect(html).toContain('org=o1');
    expect(html).toContain('/organization/orders?');
  });

  it('последняя страница: «Назад» есть, «Вперёд» нет', () => {
    const html = renderToString(
      React.createElement(Paginator, {
        basePath: '/partner/orders',
        searchParams: {},
        take: 25,
        skip: 50,
        total: 60,
      })
    );
    expect(html).toContain('Назад');
    expect(html).not.toContain('Вперёд');
    expect(html).toContain('Страница 3 из 3');
  });

  it('игнорирует уже присутствующие в searchParams ключи take/skip при перестроении ссылки', () => {
    const html = renderToString(
      React.createElement(Paginator, {
        basePath: '/organization/orders',
        searchParams: { take: '999', skip: '999', search: 'abc' },
        take: 25,
        skip: 25,
        total: 60,
      })
    );
    // Стейл take/skip из searchParams не должны просочиться в ссылку —
    // используются только вычисленные take/targetSkip.
    expect(html).not.toContain('take=999');
    expect(html).not.toContain('skip=999');
    expect(html).toContain('take=25');
    expect(html).toContain('search=abc');
  });
});
