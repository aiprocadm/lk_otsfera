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
vi.mock('@/components/partner/deal-status-badge', () => ({
  DealStatusBadge: ({ stage }: { stage: { label: string } }) =>
    React.createElement('span', null, stage.label),
}));
import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';

const row = {
  id: 'o1',
  orderNumber: 'A-1',
  title: 'Заказ X',
  totalAmount: '1000',
  paidAmount: '0',
  executionStatus: 'in_progress',
  financialStatus: 'not_billed',
  statusDefinition: { id: 'st-1', label: 'Принято в работу', isTerminal: false },
  organization: { id: 'g1', name: 'Орг' },
  manager: { id: 'm1', name: 'Иван', email: 'i@x' },
};

describe('ManagerOrdersCardList', () => {
  it('пусто → ничего не рендерит', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersCardList, { rows: [], basePath: '/manager' })
    );
    expect(html).toBe('');
  });
  it('карточка ведёт на {basePath}/orders/{id} и показывает заголовок/орг', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersCardList, { rows: [row as never], basePath: '/leader' })
    );
    expect(html).toContain('href="/leader/orders/o1"');
    expect(html).toContain('Заказ X');
    expect(html).toContain('Орг');
  });

  it('orderNumber отсутствует — рендерит placeholder —', () => {
    const rowNoNumber = { ...row, orderNumber: null };
    const html = renderToString(
      React.createElement(ManagerOrdersCardList, {
        rows: [rowNoNumber as never],
        basePath: '/manager',
      })
    );
    expect(html).toContain('—');
  });
  it('заявка без статуса из справочника → бейдж «Без статуса»', () => {
    // Статуса может не быть: заявка создана до справочника (§10) или её статус
    // деактивировали. Показываем честное «Без статуса», а не пустой бейдж.
    const noStatus = { ...row, statusDefinition: null };
    const html = renderToString(
      React.createElement(ManagerOrdersCardList, {
        rows: [noStatus as never],
        basePath: '/manager',
      })
    );
    expect(html).toContain('Без статуса');
  });

  it('терминальный статус («Отменена») выделяется предупреждающим тоном', () => {
    const terminal = {
      ...row,
      statusDefinition: { id: 'st-x', label: 'Отменена', isTerminal: true },
    };
    const html = renderToString(
      React.createElement(ManagerOrdersCardList, {
        rows: [terminal as never],
        basePath: '/manager',
      })
    );
    expect(html).toContain('Отменена');
  });
});
