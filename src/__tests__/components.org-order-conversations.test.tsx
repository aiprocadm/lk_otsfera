import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

import { OrgOrderConversations } from '@/components/organization/org-order-conversations';
import type { OrgOrderConversation } from '@/lib/services/organization/orderConversations';

/** `У-332`: «Сообщения → По заказам» у заказчика — список переписки по заказам. */

function row(over: Partial<OrgOrderConversation> = {}): OrgOrderConversation {
  return {
    orderId: 'o1',
    orderLabel: '2410-15',
    lastBody: 'В понедельник',
    lastAt: new Date('2026-10-26T09:00:00Z'),
    lastFromStaff: true,
    lastAuthorName: 'Менеджер',
    count: 2,
    ...over,
  };
}

const html = (rows: OrgOrderConversation[]) =>
  renderToStaticMarkup(React.createElement(OrgOrderConversations, { rows, orgId: 'org1' }));

describe('OrgOrderConversations', () => {
  it('строка ведёт в комментарии заказа и показывает, кто написал последним', () => {
    const out = html([row()]);
    expect(out).toContain('href="/organization/orders/o1?org=org1#comments"');
    expect(out).toContain('Заказ 2410-15');
    expect(out).toContain('Менеджер:');
    expect(out).toContain('В понедельник');
    expect(out).toContain('2 сообщения в переписке');
    expect(out).toContain('text-orange-700');
  });

  it('последнее слово за клиентом — без выделения цветом', () => {
    const out = html([row({ lastFromStaff: false, lastAuthorName: 'Ольга', count: 1 })]);
    expect(out).toContain('Ольга:');
    expect(out).not.toContain('text-orange-700');
    expect(out).toContain('1 сообщение в переписке');
  });

  it.each([
    [5, '5 сообщений'],
    [11, '11 сообщений'],
    [21, '21 сообщение'],
    [22, '22 сообщения'],
    [14, '14 сообщений'],
  ])('%i → «%s»', (count, text) => {
    expect(html([row({ count })])).toContain(`${text} в переписке`);
  });

  it('пусто — объясняет, где написать менеджеру, и ведёт к заказам', () => {
    const out = html([]);
    expect(out).toContain('Переписки по заказам пока нет');
    expect(out).toContain('href="/organization/orders?org=org1"');
    expect(out).toContain('Открыть заказы');
  });
});
