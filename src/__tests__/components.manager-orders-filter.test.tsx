import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';

describe('ManagerOrdersFilter', () => {
  it('поле поиска name="search" и action ведёт на basePath', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, {
        initial: { search: 'abc' },
        basePath: '/leader',
      })
    );
    expect(html).toContain('name="search"');
    expect(html).toContain('action="/leader/orders"');
    expect(html).toContain('value="abc"');
  });
  it('basePath по умолчанию /manager', () => {
    const html = renderToString(React.createElement(ManagerOrdersFilter, { initial: {} }));
    expect(html).toContain('action="/manager/orders"');
  });

  it('этап 4 ТЗ 13.10.2026 (`Р-4-3`): поиск внутри фокуса его не сбрасывает', () => {
    const withFocus = renderToString(
      React.createElement(ManagerOrdersFilter, { initial: { focus: 'overdue' } })
    );
    expect(withFocus).toContain('type="hidden" name="focus" value="overdue"');
    const without = renderToString(React.createElement(ManagerOrdersFilter, { initial: {} }));
    expect(without).not.toContain('name="focus"');
  });

  it('без активных фильтров ссылка "Сбросить" не рендерится', () => {
    const html = renderToString(React.createElement(ManagerOrdersFilter, { initial: {} }));
    expect(html).not.toContain('Сбросить');
  });

  it('с активным фильтром (search) рендерится ссылка "Сбросить" на {basePath}/orders', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, {
        initial: { search: 'abc' },
        basePath: '/leader',
      })
    );
    expect(html).toContain('Сбросить');
    expect(html).toContain('href="/leader/orders"');
  });

  it('чекбокс «Без менеджера» name="unassigned" value="1", по умолчанию не отмечен', () => {
    const html = renderToString(React.createElement(ManagerOrdersFilter, { initial: {} }));
    expect(html).toContain('Без менеджера');
    expect(html).toContain('name="unassigned"');
    expect(html).toContain('value="1"');
    // точный атрибут checked="" — голое 'checked' ловило бы и подстроки в классах/текстах
    expect(html).not.toContain('checked=""');
  });

  it('чекбокс отмечен при initial.unassigned="1" и активирует «Сбросить»', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, { initial: { unassigned: '1' } })
    );
    expect(html).toContain('checked=""');
    expect(html).toContain('Сбросить');
    expect(html).toContain('href="/manager/orders"');
  });

  it('рендерит опции рабочих статусов и финансов', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, {
        initial: { statusId: 'st-1', financialStatus: 'billed' },
        statuses: [{ id: 'st-1', label: 'Принято в работу' }],
      })
    );
    // §10 ТЗ v0.5: фильтр по рабочему статусу из справочника, а не по
    // операционному (тот убран из интерфейса, решение Q3).
    expect(html).toContain('Принято в работу');
    expect(html).toContain('value="st-1" selected');
    expect(html).toContain('value="billed" selected');
  });

  it('`У-350`: организаций списком нет — она ищется строкой поиска', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersFilter, { initial: { organizationId: 'g1' } })
    );
    expect(html).not.toContain('name="organizationId"');
    expect(html).not.toContain('Все организации');
    expect(html).toContain('placeholder="Поиск по названию, номеру заказа и организации…"');
    // Старая закладка с ?organizationId= — фильтр активен, «Сбросить» видна.
    expect(html).toContain('Сбросить');
  });
});
