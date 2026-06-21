import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children)
}));
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';

describe('ManagerOrdersFilter', () => {
  it('поле поиска name="search" и action ведёт на basePath', () => {
    const html = renderToString(React.createElement(ManagerOrdersFilter, {
      orgs: [], initial: { search: 'abc' }, basePath: '/leader'
    }));
    expect(html).toContain('name="search"');
    expect(html).toContain('action="/leader/orders"');
    expect(html).toContain('value="abc"');
  });
  it('basePath по умолчанию /manager', () => {
    const html = renderToString(React.createElement(ManagerOrdersFilter, { orgs: [], initial: {} }));
    expect(html).toContain('action="/manager/orders"');
  });
});
