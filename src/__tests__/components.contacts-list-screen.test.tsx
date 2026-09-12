// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/components/manager/contacts/contact-form-dialog', () => ({
  ContactFormDialog: (props: { cabinet: string; mode: string; orgOptions: unknown[] }) =>
    React.createElement(
      'button',
      { 'data-testid': 'contact-form-dialog', 'data-cabinet': props.cabinet },
      `${props.mode}:${props.orgOptions.length}`
    ),
}));

import { ContactsListScreen } from '@/components/manager/contacts/contacts-list-screen';
import { fmtDate } from '@/lib/format';
import type { ContactListItem } from '@/lib/services/contacts/list';
import type { ParsedContactListQuery } from '@/lib/services/contacts/listQuery';

/**
 * Экран «Контакты» (этап 1 ТЗ 12.09.2026, `У-178`, `Р-23`; спека
 * 2026-09-12-stage1-contacts-and-notes-design §3.3): шапка с кнопкой
 * «Добавить контакт», пустые состояния (без фильтра и под фильтром), таблица и
 * карточки с ссылками в СВОЙ кабинет, значки каналов, «Показаны N из M» и
 * постраничность.
 */
function query(overrides: Partial<ParsedContactListQuery> = {}): ParsedContactListQuery {
  return {
    filters: { scope: 'all', sort: 'name', page: 1 },
    q: '',
    scope: 'all',
    sort: 'name',
    page: 1,
    skip: 0,
    ...overrides,
  };
}

const ORGS = [
  { id: 'o1', name: 'Ромашка' },
  { id: 'o2', name: 'Лютик' },
];

const FULL: ContactListItem = {
  id: 'c1',
  name: 'Иванов Иван',
  position: 'Директор',
  organization: { id: 'o1', name: 'Ромашка' },
  channels: [
    { id: 'ch1', type: 'phone', value: '+7 921 000-00-00', isPrimary: true },
    { id: 'ch2', type: 'telegram', value: '@ivanov', isPrimary: false },
  ],
  isArchived: true,
  updatedAt: new Date('2026-09-10T10:00:00Z'),
};

const BARE: ContactListItem = {
  id: 'c2',
  name: 'Петров Пётр',
  position: null,
  organization: null,
  channels: [],
  isArchived: false,
  updatedAt: new Date('2026-09-11T10:00:00Z'),
};

function renderScreen(
  items: ContactListItem[],
  opts: { q?: Partial<ParsedContactListQuery>; total?: number; cabinet?: 'manager' | 'admin' } = {}
) {
  return render(
    <ContactsListScreen
      cabinet={opts.cabinet ?? 'manager'}
      query={query(opts.q)}
      items={items}
      total={opts.total ?? items.length}
      searchParams={{}}
      orgOptions={ORGS}
    />
  );
}

describe('ContactsListScreen — пустые состояния', () => {
  it('без фильтра: объяснение, откуда берутся контакты, и кнопка в шапке и в пустом состоянии', () => {
    const { container } = renderScreen([]);
    expect(container.textContent).toContain('Контакты');
    expect(container.textContent).toContain('Люди, с которыми вы общаетесь');
    expect(container.textContent).toContain('Контактов пока нет — добавьте первого');
    expect(container.textContent).toContain('из входящих писем и звонков');
    const dialogs = screen.getAllByTestId('contact-form-dialog');
    expect(dialogs).toHaveLength(2);
    expect(dialogs.map((d) => d.textContent)).toEqual(['create:2', 'create:2']);
    expect(dialogs[0].getAttribute('data-cabinet')).toBe('manager');
    // Таблицы и подписи «Показаны» нет; страниц ≤ 1 — пагинатора тоже нет.
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain('Показаны');
    expect(container.textContent).not.toContain('Страница');
  });

  it('под поиском — другое объяснение', () => {
    const { container } = renderScreen([], { q: { q: 'иван' } });
    expect(container.textContent).toContain('Под этот фильтр контактов нет');
    expect(container.textContent).not.toContain('Контактов пока нет');
  });

  it('под фильтром без поиска — тоже «под фильтр»', () => {
    const { container } = renderScreen([], { q: { scope: 'archived' } });
    expect(container.textContent).toContain('Под этот фильтр контактов нет');
  });
});

describe('ContactsListScreen — список', () => {
  it('таблица: имя со ссылкой в свой кабинет, архивный значок, должность, организация, каналы, дата', () => {
    const { container } = renderScreen([FULL, BARE]);
    const table = container.querySelector('table')!;
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);

    const [full, bare] = rows;
    expect(within(full).getByRole('link', { name: 'Иванов Иван' }).getAttribute('href')).toBe(
      '/manager/contacts/c1'
    );
    expect(within(full).getByText('В архиве')).toBeTruthy();
    expect(within(full).getByText('Директор')).toBeTruthy();
    expect(within(full).getByRole('link', { name: 'Ромашка' }).getAttribute('href')).toBe(
      '/manager/organizations/o1'
    );
    expect(within(full).getByText('Телефон: +7 921 000-00-00')).toBeTruthy();
    expect(within(full).getByText('Telegram: @ivanov')).toBeTruthy();
    expect(within(full).getByText(fmtDate(FULL.updatedAt))).toBeTruthy();

    expect(within(bare).getByRole('link', { name: 'Петров Пётр' }).getAttribute('href')).toBe(
      '/manager/contacts/c2'
    );
    expect(within(bare).queryByText('В архиве')).toBeNull();
    expect(within(bare).getByText('Без организации')).toBeTruthy();
    // Нет должности и каналов — прочерки, а не пустые ячейки.
    expect(within(bare).getAllByText('—')).toHaveLength(2);

    expect(container.textContent).toContain('Показаны 2 из 2');
    expect(container.textContent).not.toContain('Страница');
  });

  it('карточки на телефоне повторяют данные таблицы и ведут в кабинет сессии', () => {
    const { container } = renderScreen([FULL, BARE], { cabinet: 'admin' });
    const cards = within(container.querySelector('ul.md\\:hidden')!).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const [full, bare] = cards;
    expect(within(full).getByRole('link', { name: 'Иванов Иван' }).getAttribute('href')).toBe(
      '/admin/contacts/c1'
    );
    expect(within(full).getByRole('link', { name: 'Ромашка' }).getAttribute('href')).toBe(
      '/admin/organizations/o1'
    );
    expect(within(full).getByText('Директор')).toBeTruthy();
    expect(within(full).getByText('Telegram: @ivanov')).toBeTruthy();
    // Пустая должность — прочерк строки карточки; пустые каналы — прочерк значков.
    expect(within(bare).getByText('Без организации')).toBeTruthy();
    expect(within(bare).getAllByText('—')).toHaveLength(2);
    expect(screen.getAllByTestId('contact-form-dialog')[0].getAttribute('data-cabinet')).toBe(
      'admin'
    );
  });

  it('вторая страница: «Показаны skip+N из M» и пагинатор по 50', () => {
    const { container } = renderScreen([FULL, BARE], { q: { skip: 50, page: 2 }, total: 120 });
    expect(container.textContent).toContain('Показаны 52 из 120');
    expect(container.textContent).toContain('Страница 2 из 3 · 120 всего');
    expect(screen.getByRole('link', { name: 'Назад' }).getAttribute('href')).toBe(
      '/manager/contacts?take=50'
    );
    expect(screen.getByRole('link', { name: 'Вперёд' }).getAttribute('href')).toBe(
      '/manager/contacts?take=50&skip=100'
    );
  });
});
