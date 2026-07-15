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

  it('без активных фильтров ссылка "Сбросить" не рендерится', () => {
    const html = renderToString(React.createElement(ManagerOrdersFilter, { orgs: [], initial: {} }));
    expect(html).not.toContain('Сбросить');
  });

  it('с активным фильтром (search) рендерится ссылка "Сбросить" на {basePath}/orders', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, { orgs: [], initial: { search: 'abc' }, basePath: '/leader' })
    );
    expect(html).toContain('Сбросить');
    expect(html).toContain('href="/leader/orders"');
  });

  it('чекбокс «Без менеджера» name="unassigned" value="1", по умолчанию не отмечен', () => {
    const html = renderToString(React.createElement(ManagerOrdersFilter, { orgs: [], initial: {} }));
    expect(html).toContain('Без менеджера');
    expect(html).toContain('name="unassigned"');
    expect(html).toContain('value="1"');
    expect(html).not.toContain('checked');
  });

  it('чекбокс отмечен при initial.unassigned="1" и активирует «Сбросить»', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, { orgs: [], initial: { unassigned: '1' } })
    );
    expect(html).toContain('checked');
    expect(html).toContain('Сбросить');
    expect(html).toContain('href="/manager/orders"');
  });

  it('рендерит опции организаций и статусов исполнения/финансов', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, {
        orgs: [{ id: 'g1', name: 'Орг 1' }],
        initial: { executionStatus: 'pending', financialStatus: 'billed', organizationId: 'g1' }
      })
    );
    expect(html).toContain('Орг 1');
    expect(html).toContain('value="pending" selected');
    expect(html).toContain('value="billed" selected');
    expect(html).toContain('value="g1" selected');
  });
});
