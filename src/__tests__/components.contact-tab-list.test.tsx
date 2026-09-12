// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ContactTabList } from '@/components/manager/contacts/contact-tab-list';
import { fmtDateTime } from '@/lib/format';
import type { ContactTabItem, ContactTabKey } from '@/lib/services/contacts/get';
import type { ContactsCabinet } from '@/lib/navigation/contactsHrefs';

/**
 * Содержимое вкладки карточки контакта (этап 1 ТЗ 12.09.2026, `У-179`, `У-74`;
 * спека 2026-09-12-stage1-contacts-and-notes-design §3.3): пустые состояния с
 * подсказкой на каждую вкладку, строка с ссылкой в кабинет сессии (у
 * администратора — без ссылки), прочерки вместо пустых полей, «Показаны N из M»
 * и постраничность по 20.
 */
function item(overrides: Partial<ContactTabItem> = {}): ContactTabItem {
  return {
    kind: 'dialogs',
    id: 'd1',
    at: new Date('2026-09-10T10:00:00Z'),
    title: 'Telegram · Иван',
    subtitle: 'нужен счёт',
    status: 'Открыт',
    ...overrides,
  };
}

function renderTab(
  items: ContactTabItem[],
  opts: { tab?: ContactTabKey; cabinet?: ContactsCabinet; total?: number; skip?: number } = {}
) {
  return render(
    <ContactTabList
      cabinet={opts.cabinet ?? 'manager'}
      tab={opts.tab ?? 'dialogs'}
      items={items}
      total={opts.total ?? items.length}
      skip={opts.skip ?? 0}
      basePath="/manager/contacts/c1"
      searchParams={{ tab: opts.tab ?? 'dialogs' }}
    />
  );
}

describe('ContactTabList — пусто', () => {
  it.each<[ContactTabKey, string]>([
    ['dialogs', 'напишите первым кнопкой «Написать»'],
    ['calls', 'Звонков с этим человеком ещё не было.'],
    ['inbound', 'Входящих писем от этого человека пока нет.'],
    ['deals', 'создайте лид и ведите его по воронке'],
    ['orders', 'Контакт заказа выбирается в карточке заказа.'],
    ['history', 'Действий с контактом ещё не было.'],
  ])('вкладка %s: «Здесь пока пусто» и подсказка, что сделать', (tab, hint) => {
    const { container } = renderTab([], { tab });
    expect(container.textContent).toContain('Здесь пока пусто');
    expect(container.textContent).toContain(hint);
    expect(container.querySelector('table')).toBeNull();
  });
});

describe('ContactTabList — строки', () => {
  it('менеджер: строка со ссылкой на диалог, подробности, состояние значком; пустые — прочерки', () => {
    const items = [
      item(),
      item({ kind: 'orders', id: 'o7', title: 'Заказ №7', subtitle: null, status: null }),
    ];
    const { container } = renderTab(items);
    const table = container.querySelector('table')!;
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);

    const [dialog, order] = rows;
    expect(within(dialog).getByText(fmtDateTime(items[0].at))).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Telegram · Иван' }).getAttribute('href')).toBe(
      '/manager/messengers/d1'
    );
    expect(within(dialog).getByText('нужен счёт')).toBeTruthy();
    expect(within(dialog).getByText('Открыт')).toBeTruthy();

    expect(within(order).getByRole('link', { name: 'Заказ №7' }).getAttribute('href')).toBe(
      '/manager/orders/o7'
    );
    expect(within(order).getAllByText('—')).toHaveLength(2);

    // Карточки для телефона — те же данные, пустые поля прочерком.
    const cards = within(container.querySelector('ul.md\\:hidden')!).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByRole('link', { name: 'Telegram · Иван' })).toBeTruthy();
    expect(within(cards[1]).getAllByText('—')).toHaveLength(2);

    expect(container.textContent).toContain('Показаны 2 из 2');
    expect(container.textContent).not.toContain('Страница');
  });

  it('администратор: у диалога нет раздела — заголовок без ссылки; история — без ссылки у всех', () => {
    const { container } = renderTab(
      [item(), item({ kind: 'history', id: 'a1', title: 'Контакт изменён' })],
      { cabinet: 'admin' }
    );
    expect(screen.queryByRole('link', { name: 'Telegram · Иван' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Контакт изменён' })).toBeNull();
    // Заголовок всё же показан — просто текстом (и в таблице, и в карточке).
    expect(screen.getAllByText('Telegram · Иван')).toHaveLength(2);
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('вторая страница: «Показаны skip+N из M» и пагинатор по 20 с сохранением вкладки', () => {
    const { container } = renderTab([item(), item({ id: 'd2' })], {
      tab: 'dialogs',
      total: 45,
      skip: 20,
    });
    expect(container.textContent).toContain('Показаны 22 из 45');
    expect(container.textContent).toContain('Страница 2 из 3 · 45 всего');
    expect(screen.getByRole('link', { name: 'Назад' }).getAttribute('href')).toBe(
      '/manager/contacts/c1?tab=dialogs&take=20'
    );
    expect(screen.getByRole('link', { name: 'Вперёд' }).getAttribute('href')).toBe(
      '/manager/contacts/c1?tab=dialogs&take=20&skip=40'
    );
  });
});
