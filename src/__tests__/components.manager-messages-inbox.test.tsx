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

import { ManagerMessagesInbox } from '@/components/manager/manager-messages-inbox';
import type { ManagerInboxItem } from '@/lib/services/manager/messages';

function makeItem(overrides: {
  id?: string;
  body?: string;
  author?: { role: string; name: string | null; email: string };
  order?: { id: string; orderNumber: string | null; title: string };
}): ManagerInboxItem {
  return {
    id: 'c1',
    body: 'Короткое сообщение',
    createdAt: new Date('2026-05-01T10:00:00Z'),
    author: { id: 'u1', role: 'organization', name: 'Анна', email: 'anna@example.com' },
    order: { id: 'o1', orderNumber: 'A-1', title: 'Заказ X' },
    ...overrides,
  } as unknown as ManagerInboxItem;
}

describe('ManagerMessagesInbox', () => {
  it('empty: renders empty-state', () => {
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows: [], nextCursor: null })
    );
    expect(html).toContain('Сообщения появятся, когда клиент напишет');
  });

  it('groups consecutive rows on the same order under a single header', () => {
    const rows = [makeItem({ id: 'c1' }), makeItem({ id: 'c2' })];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    const headerCount = (html.match(/Открыть заказ →/g) ?? []).length;
    expect(headerCount).toBe(1);
  });

  it('non-adjacent rows on the same order get separate group headers', () => {
    const rows = [
      makeItem({ id: 'c1', order: { id: 'o1', orderNumber: 'A-1', title: 'Заказ X' } }),
      makeItem({ id: 'c2', order: { id: 'o2', orderNumber: 'A-2', title: 'Заказ Y' } }),
      makeItem({ id: 'c3', order: { id: 'o1', orderNumber: 'A-1', title: 'Заказ X' } }),
    ];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    const headerCount = (html.match(/Открыть заказ →/g) ?? []).length;
    expect(headerCount).toBe(3);
  });

  it('organization author: blue tone/label', () => {
    const rows = [makeItem({ author: { role: 'organization', name: 'Анна', email: 'a@x.com' } })];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('bg-blue-500');
    expect(html).toContain('Организация');
  });

  it('leader author: оранжевый тон и подпись «Руководитель» (ТЗ 2026-08-17)', () => {
    const rows = [makeItem({ author: { role: 'leader', name: 'Лев', email: 'l@x.com' } })];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('bg-[#F97316]');
    expect(html).toContain('Руководитель');
  });

  it('manager author: orange tone/label', () => {
    const rows = [makeItem({ author: { role: 'manager', name: 'Пётр', email: 'p@x.com' } })];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('bg-[#F97316]');
    expect(html).toContain('Менеджер');
  });

  it('unknown role falls back to gray tone with role as label', () => {
    const rows = [makeItem({ author: { role: 'partner', name: 'X', email: 'x@x.com' } })];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('bg-gray-400');
    expect(html).toContain('>partner<');
  });

  it('author with no name: falls back to email for display + initials', () => {
    const rows = [
      makeItem({ author: { role: 'organization', name: null, email: 'nikita@example.com' } }),
    ];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('nikita@example.com');
    expect(html).toContain('NI');
  });

  it('empty name and email: initials fall back to "?"', () => {
    const rows = [makeItem({ author: { role: 'organization', name: '   ', email: '' } })];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('>?<');
  });

  it('single-word name: initials fall back to first two chars', () => {
    const rows = [
      makeItem({ author: { role: 'organization', name: 'Мадонна', email: 'm@x.com' } }),
    ];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('МА');
  });

  it('two-word name: initials use first letter of each word', () => {
    const rows = [
      makeItem({ author: { role: 'organization', name: 'Анна Иванова', email: 'a@x.com' } }),
    ];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('АИ');
  });

  it('truncates long body text with an ellipsis', () => {
    const longBody = 'x'.repeat(250);
    const rows = [makeItem({ body: longBody })];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('…');
    expect(html).not.toContain('x'.repeat(250));
  });

  it('short body text is rendered as-is (no ellipsis)', () => {
    const rows = [makeItem({ body: 'коротко' })];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('коротко');
    expect(html).not.toContain('коротко…');
  });

  it('renders orderNumber — fallback when null', () => {
    const rows = [makeItem({ order: { id: 'o1', orderNumber: null, title: 'Заказ X' } })];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).toContain('—');
  });

  it('renders "Дальше" link with cursor when nextCursor is set', () => {
    const rows = [makeItem({})];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: 'cur1' })
    );
    expect(html).toContain('Дальше');
    expect(html).toContain('cursor=cur1');
  });

  it('does not render "Дальше" link when nextCursor is null', () => {
    const rows = [makeItem({})];
    const html = renderToString(
      React.createElement(ManagerMessagesInbox, { rows, nextCursor: null })
    );
    expect(html).not.toContain('Дальше');
  });
});
