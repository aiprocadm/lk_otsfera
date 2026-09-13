// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

// Форма контакта — заглушка: проверяем, что вкладка передаёт ей уже выбранную организацию.
vi.mock('@/components/manager/contacts/contact-form-dialog', () => ({
  ContactFormDialog: (props: {
    cabinet: string;
    mode: string;
    orgOptions: unknown[];
    defaultOrganizationId?: string;
  }) =>
    React.createElement(
      'button',
      { type: 'button', 'data-testid': 'contact-form-dialog', 'data-cabinet': props.cabinet },
      `${props.mode}:${props.defaultOrganizationId ?? 'нет'}:${props.orgOptions.length}`
    ),
}));

import { OrgContactsSection } from '@/components/organization/org-contacts-section';
import { fmtDate } from '@/lib/format';
import { CONTACT_CHANNEL_LABELS } from '@/lib/services/contacts/channelLabels';
import type { ContactListItem } from '@/lib/services/contacts/list';

/**
 * Вкладка «Контакты» карточки организации (этап 1 ТЗ 12.09.2026, `У-182`;
 * спека 2026-09-12-stage1-contacts-and-notes-design §3.7): кнопка «Добавить
 * контакт» с предвыбранной организацией, пустое состояние, таблица и мобильные
 * карточки со ссылками в карточку контакта СВОЕГО кабинета, значки каналов с
 * подписями типов, «Показаны N из M» и постраничность.
 */
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
  organization: { id: 'o1', name: 'Ромашка' },
  channels: [],
  isArchived: false,
  updatedAt: new Date('2026-09-11T10:00:00Z'),
};

function renderSection(
  items: ContactListItem[],
  opts: { total?: number; skip?: number; cabinet?: 'manager' | 'leader' | 'admin' } = {}
) {
  const cabinet = opts.cabinet ?? 'manager';
  return render(
    <OrgContactsSection
      cabinet={cabinet}
      organizationId="o1"
      items={items}
      total={opts.total ?? items.length}
      skip={opts.skip ?? 0}
      basePath={`/${cabinet}/organizations/o1`}
      searchParams={{ tab: 'contacts' }}
      orgOptions={ORGS}
    />
  );
}

function table(): HTMLElement {
  return screen.getByRole('table');
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('ul.md\\:hidden > li'));
}

describe('OrgContactsSection — пусто', () => {
  it('подсказка и кнопка «Добавить контакт» (в шапке и в пустом состоянии) с предвыбранной организацией', () => {
    renderSection([]);
    expect(screen.getByText(/У организации пока нет контактов/).textContent).toContain(
      'будут находить карточку сами'
    );
    const stubs = screen.getAllByTestId('contact-form-dialog');
    expect(stubs).toHaveLength(2);
    for (const stub of stubs) {
      expect(stub.textContent).toBe('create:o1:2');
      expect(stub.getAttribute('data-cabinet')).toBe('manager');
    }
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/Показаны/)).toBeNull();
    // Одна страница — постраничности нет.
    expect(screen.queryByText(/Страница/)).toBeNull();
  });
});

describe('OrgContactsSection — список', () => {
  it('ссылки ведут в карточку контакта своего кабинета; бейдж «В архиве» только у архивного', () => {
    renderSection([FULL, BARE]);
    // Кнопка добавления — одна, в шапке.
    expect(screen.getAllByTestId('contact-form-dialog')).toHaveLength(1);
    // Таблица и мобильные карточки: по ссылке на каждого в каждом виде.
    const ivan = screen.getAllByRole('link', { name: 'Иванов Иван' });
    expect(ivan).toHaveLength(2);
    for (const a of ivan) expect(a.getAttribute('href')).toBe('/manager/contacts/c1');
    expect(screen.getAllByRole('link', { name: 'Петров Пётр' })[0].getAttribute('href')).toBe(
      '/manager/contacts/c2'
    );
    const rows = within(table()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).queryByText('В архиве')).not.toBeNull();
    expect(within(rows[1]).queryByText('В архиве')).toBeNull();
  });

  it('таблица: должность и каналы с подписями типов; без должности и каналов — прочерки; дата обновления', () => {
    renderSection([FULL, BARE]);
    const rows = within(table()).getAllByRole('row').slice(1);
    const cellsOf = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((td) => td.textContent);
    expect(cellsOf(rows[0])).toEqual([
      'Иванов ИванВ архиве',
      'Директор',
      `${CONTACT_CHANNEL_LABELS.phone}: +7 921 000-00-00${CONTACT_CHANNEL_LABELS.telegram}: @ivanov`,
      fmtDate(FULL.updatedAt),
    ]);
    expect(cellsOf(rows[1])).toEqual(['Петров Пётр', '—', '—', fmtDate(BARE.updatedAt)]);
  });

  it('мобильные карточки: значения каналов через « · », пустые поля — прочерк', () => {
    renderSection([FULL, BARE]);
    const rowsOf = (card: HTMLElement) =>
      Array.from(card.querySelectorAll('dd')).map((dd) => dd.textContent);
    const [full, bare] = cards();
    expect(rowsOf(full)).toEqual([
      'Директор',
      '+7 921 000-00-00 · @ivanov',
      fmtDate(FULL.updatedAt),
    ]);
    expect(rowsOf(bare)).toEqual(['—', '—', fmtDate(BARE.updatedAt)]);
  });

  it('«Показаны N из M» и постраничность по 50 с сохранением вкладки в адресе', () => {
    renderSection([FULL, BARE], { total: 120, skip: 50 });
    expect(screen.getByText(/^Показаны/).textContent).toBe('Показаны 52 из 120');
    expect(screen.getByText('Страница 2 из 3 · 120 всего')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Назад' }).getAttribute('href')).toBe(
      '/manager/organizations/o1?tab=contacts&take=50'
    );
    expect(screen.getByRole('link', { name: 'Вперёд' }).getAttribute('href')).toBe(
      '/manager/organizations/o1?tab=contacts&take=50&skip=100'
    );
  });

  it('N не превышает M, если страница длиннее остатка', () => {
    renderSection([FULL, BARE], { total: 1 });
    expect(screen.getByText(/^Показаны/).textContent).toBe('Показаны 1 из 1');
  });

  it('кабинет администратора: ссылки в /admin/contacts, форма получает тот же кабинет', () => {
    renderSection([BARE], { cabinet: 'admin' });
    expect(screen.getAllByRole('link', { name: 'Петров Пётр' })[0].getAttribute('href')).toBe(
      '/admin/contacts/c2'
    );
    expect(screen.getByTestId('contact-form-dialog').getAttribute('data-cabinet')).toBe('admin');
  });
});
