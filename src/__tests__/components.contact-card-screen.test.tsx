// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

// Дочерние клиентские компоненты — заглушки, печатающие свои пропсы: карточка
// проверяется как раскладка и передача данных, интерактив — в своих тестах.
vi.mock('@/components/manager/contacts/archive-contact-button', () => ({
  ArchiveContactButton: (props: { contactId: string; isArchived: boolean }) =>
    React.createElement('button', {
      'data-testid': 'archive-button',
      'data-contact': props.contactId,
      'data-archived': String(props.isArchived),
    }),
}));
vi.mock('@/components/manager/contacts/contact-channels', () => ({
  ContactChannels: (props: {
    cabinet: string;
    contactId: string;
    contactName: string;
    channels: unknown[];
  }) =>
    React.createElement('section', {
      'data-testid': 'contact-channels',
      'data-cabinet': props.cabinet,
      'data-contact': props.contactId,
      'data-name': props.contactName,
      'data-count': String(props.channels.length),
    }),
}));
vi.mock('@/components/manager/contacts/contact-form-dialog', () => ({
  ContactFormDialog: (props: {
    cabinet: string;
    mode: string;
    orgOptions: unknown[];
    contact?: Record<string, unknown>;
  }) =>
    React.createElement('button', {
      'data-testid': 'contact-form-dialog',
      'data-cabinet': props.cabinet,
      'data-mode': props.mode,
      'data-orgs': String(props.orgOptions.length),
      'data-contact': JSON.stringify(props.contact ?? null),
    }),
}));
vi.mock('@/components/manager/contacts/contact-tab-list', () => ({
  ContactTabList: (props: {
    cabinet: string;
    tab: string;
    items: unknown[];
    total: number;
    skip: number;
    basePath: string;
    searchParams: Record<string, unknown>;
  }) =>
    React.createElement('div', {
      'data-testid': 'contact-tab-list',
      'data-cabinet': props.cabinet,
      'data-tab': props.tab,
      'data-items': String(props.items.length),
      'data-total': String(props.total),
      'data-skip': String(props.skip),
      'data-base': props.basePath,
      'data-sp': JSON.stringify(props.searchParams),
    }),
}));
vi.mock('@/components/manager/contacts/create-lead-from-contact-button', () => ({
  CreateLeadFromContactButton: (props: { contactId: string }) =>
    React.createElement('button', {
      'data-testid': 'create-lead',
      'data-contact': props.contactId,
    }),
}));
vi.mock('@/components/manager/contacts/merge-contacts-dialog', () => ({
  MergeContactsButton: (props: { cabinet: string; primaryId: string; primaryName: string }) =>
    React.createElement('button', {
      'data-testid': 'merge-button',
      'data-cabinet': props.cabinet,
      'data-primary': props.primaryId,
      'data-name': props.primaryName,
    }),
}));

import { ContactCardScreen } from '@/components/manager/contacts/contact-card-screen';
import type { ContactCardTab } from '@/lib/navigation/contactCardTabs';
import type { ContactsCabinet } from '@/lib/navigation/contactsHrefs';
import type { ContactTabItem, ContactTabKey, ContactView } from '@/lib/services/contacts/get';

/**
 * Карточка контакта (этап 1 ТЗ 12.09.2026, `У-179`, `Р-23`; спека
 * 2026-09-12-stage1-contacts-and-notes-design §3.3 и §3.12): крошки, шапка с
 * реквизитами, «Написать» (ссылка / неактивная с причиной / нет у
 * администратора), «Создать лид» (нет у администратора и у архивного),
 * «Изменить · Объединить · В архив», заметка, блок каналов, вкладки со
 * счётчиками и содержимое активной вкладки.
 */
const TABS: ContactCardTab[] = [
  { key: 'dialogs', label: 'Диалоги', flag: 'inbound_messaging' },
  { key: 'calls', label: 'Звонки', flag: 'telephony_mango' },
  { key: 'inbound', label: 'Входящие письма', flag: 'inbound_messaging' },
  { key: 'deals', label: 'Сделки', flag: 'deals_pipeline' },
  { key: 'orders', label: 'Заказы' },
  { key: 'history', label: 'История' },
];

function contact(overrides: Partial<ContactView> = {}): ContactView {
  return {
    id: 'c1',
    name: 'Иванов Иван',
    position: 'Директор',
    note: 'Звонить после обеда',
    isArchived: false,
    mergedIntoId: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-10T10:00:00Z'),
    organization: { id: 'o1', name: 'Ромашка' },
    user: { id: 'u1', name: 'Иван', email: 'ivan@romashka.ru' },
    channels: [{ id: 'ch1', type: 'telegram', value: '@ivanov', isPrimary: true, locked: false }],
    messengerChannels: ['telegram'],
    counts: { dialogs: 2, calls: 3, inbound: 4, deals: 5, orders: 6 },
    ...overrides,
  };
}

const TAB_ITEMS: ContactTabItem[] = [
  {
    kind: 'dialogs',
    id: 'd1',
    at: new Date('2026-09-10T10:00:00Z'),
    title: 'Telegram · Иван',
    subtitle: null,
    status: null,
  },
];

function renderCard(
  opts: {
    cabinet?: ContactsCabinet;
    contact?: ContactView;
    messengersEnabled?: boolean;
    activeTab?: ContactTabKey;
  } = {}
) {
  return render(
    <ContactCardScreen
      cabinet={opts.cabinet ?? 'manager'}
      contact={opts.contact ?? contact()}
      tabs={TABS}
      activeTab={opts.activeTab ?? 'dialogs'}
      tabItems={TAB_ITEMS}
      tabTotal={7}
      skip={0}
      searchParams={{ tab: opts.activeTab ?? 'dialogs' }}
      orgOptions={[{ id: 'o1', name: 'Ромашка' }]}
      messengersEnabled={opts.messengersEnabled ?? true}
    />
  );
}

describe('ContactCardScreen — менеджер, полный контакт', () => {
  it('крошки, шапка с реквизитами, заметка, блок каналов и содержимое вкладки', () => {
    const { container } = renderCard();

    const crumbs = within(screen.getByRole('navigation', { name: 'Хлебные крошки' }));
    expect(crumbs.getByRole('link', { name: 'Контакты' }).getAttribute('href')).toBe(
      '/manager/contacts'
    );
    expect(crumbs.getByText('Иванов Иван').getAttribute('aria-current')).toBe('page');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Иванов Иван');
    expect(screen.queryByText('В архиве')).toBeNull();
    const subtitle = screen.getByRole('heading', { level: 1 }).nextElementSibling!;
    expect(subtitle.textContent).toBe(
      'Директор · Ромашка · пользователь кабинета ivan@romashka.ru'
    );
    expect(
      within(subtitle as HTMLElement)
        .getByRole('link', { name: 'Ромашка' })
        .getAttribute('href')
    ).toBe('/manager/organizations/o1');
    expect(screen.getByText('Звонить после обеда')).toBeTruthy();

    const channels = screen.getByTestId('contact-channels');
    expect(channels.getAttribute('data-cabinet')).toBe('manager');
    expect(channels.getAttribute('data-contact')).toBe('c1');
    expect(channels.getAttribute('data-name')).toBe('Иванов Иван');
    expect(channels.getAttribute('data-count')).toBe('1');

    const list = screen.getByTestId('contact-tab-list');
    expect(list.getAttribute('data-cabinet')).toBe('manager');
    expect(list.getAttribute('data-tab')).toBe('dialogs');
    expect(list.getAttribute('data-items')).toBe('1');
    expect(list.getAttribute('data-total')).toBe('7');
    expect(list.getAttribute('data-skip')).toBe('0');
    expect(list.getAttribute('data-base')).toBe('/manager/contacts/c1');
    expect(list.getAttribute('data-sp')).toBe('{"tab":"dialogs"}');
    expect(container.querySelector('nav[aria-label="Вкладки контакта"]')).toBeTruthy();
  });

  it('«Написать» — ссылка в мессенджеры с предвыбором; «Создать лид», «Изменить», «Объединить», «В архив»', () => {
    renderCard();
    const write = screen.getByRole('link', { name: 'Написать' });
    expect(write.getAttribute('href')).toBe('/manager/messengers?new=c1');
    expect(screen.getByTestId('create-lead').getAttribute('data-contact')).toBe('c1');

    const edit = screen.getByTestId('contact-form-dialog');
    expect(edit.getAttribute('data-cabinet')).toBe('manager');
    expect(edit.getAttribute('data-mode')).toBe('edit');
    expect(edit.getAttribute('data-orgs')).toBe('1');
    expect(JSON.parse(edit.getAttribute('data-contact')!)).toEqual({
      id: 'c1',
      name: 'Иванов Иван',
      position: 'Директор',
      note: 'Звонить после обеда',
      organizationId: 'o1',
    });

    const merge = screen.getByTestId('merge-button');
    expect(merge.getAttribute('data-cabinet')).toBe('manager');
    expect(merge.getAttribute('data-primary')).toBe('c1');
    expect(merge.getAttribute('data-name')).toBe('Иванов Иван');

    const archive = screen.getByTestId('archive-button');
    expect(archive.getAttribute('data-contact')).toBe('c1');
    expect(archive.getAttribute('data-archived')).toBe('false');
  });

  it('вкладки: ссылки с ?tab=, счётчики у всех кроме «Истории», активная помечена', () => {
    renderCard({ activeTab: 'orders' });
    const nav = within(screen.getByRole('navigation', { name: 'Вкладки контакта' }));
    const expectTab = (key: ContactTabKey, label: string, count: string | null) => {
      const tab = screen.getByTestId(`contact-tab-${key}`);
      expect(tab.getAttribute('href')).toBe(`/manager/contacts/c1?tab=${key}`);
      expect(tab.textContent).toBe(count === null ? label : `${label}${count}`);
      expect(tab.getAttribute('data-active')).toBe(key === 'orders' ? 'true' : 'false');
      return tab;
    };
    expectTab('dialogs', 'Диалоги', '2');
    expectTab('calls', 'Звонки', '3');
    expectTab('inbound', 'Входящие письма', '4');
    expectTab('deals', 'Сделки', '5');
    const active = expectTab('orders', 'Заказы', '6');
    expect(active.className).toContain('border-[#F97316]');
    const history = expectTab('history', 'История', null);
    expect(history.className).toContain('border-transparent');
    expect(nav.getAllByRole('link')).toHaveLength(6);
  });
});

describe('ContactCardScreen — «Написать» неактивна с причиной', () => {
  it('мессенджеры выключены → кнопка заблокирована, причина — про настройки', () => {
    renderCard({ messengersEnabled: false });
    expect(screen.queryByRole('link', { name: 'Написать' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Написать' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Мессенджеры не подключены — включает администратор в настройках');
  });

  it('контакт в архиве → причина про архив; нет «Создать лид» и «Объединить», есть значок', () => {
    renderCard({ contact: contact({ isArchived: true }) });
    const button = screen.getByRole('button', { name: 'Написать' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Контакт в архиве — верните его, чтобы написать');
    expect(screen.queryByTestId('create-lead')).toBeNull();
    expect(screen.queryByTestId('merge-button')).toBeNull();
    expect(screen.getByTestId('archive-button').getAttribute('data-archived')).toBe('true');
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('В архиве')).toBeTruthy();
  });

  it('нет канала мессенджера → причина про канал; руководитель ходит в кабинет менеджера', () => {
    renderCard({
      cabinet: 'leader',
      contact: contact({
        position: null,
        note: null,
        organization: null,
        user: null,
        channels: [],
        messengerChannels: [],
      }),
    });
    const button = screen.getByRole('button', { name: 'Написать' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(
      'У контакта нет мессенджера — добавьте канал Telegram, MAX или WhatsApp'
    );
    // Без должности, организации и пользователя — подзаголовок из одного слова.
    const subtitle = screen.getByRole('heading', { level: 1 }).nextElementSibling!;
    expect(subtitle.textContent).toBe('Без организации');
    expect(screen.queryByText('Звонить после обеда')).toBeNull();
    // Ссылки — в кабинет руководителя, форма правки — без организации.
    expect(
      within(screen.getByRole('navigation', { name: 'Хлебные крошки' }))
        .getByRole('link', { name: 'Контакты' })
        .getAttribute('href')
    ).toBe('/leader/contacts');
    expect(screen.getByTestId('contact-tab-dialogs').getAttribute('href')).toBe(
      '/leader/contacts/c1?tab=dialogs'
    );
    expect(
      JSON.parse(screen.getByTestId('contact-form-dialog').getAttribute('data-contact')!)
    ).toEqual({
      id: 'c1',
      name: 'Иванов Иван',
      position: null,
      note: null,
      organizationId: null,
    });
    expect(screen.getByTestId('create-lead')).toBeTruthy();
    expect(screen.getByTestId('merge-button').getAttribute('data-cabinet')).toBe('leader');
  });
});

describe('ContactCardScreen — администратор', () => {
  it('переписку и лиды не ведёт: ни «Написать», ни «Создать лид»; правка, объединение и архив есть', () => {
    renderCard({ cabinet: 'admin' });
    expect(screen.queryByRole('link', { name: 'Написать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Написать' })).toBeNull();
    expect(screen.queryByTestId('create-lead')).toBeNull();
    expect(screen.getByTestId('contact-form-dialog').getAttribute('data-cabinet')).toBe('admin');
    expect(screen.getByTestId('merge-button').getAttribute('data-cabinet')).toBe('admin');
    expect(screen.getByTestId('archive-button')).toBeTruthy();
    expect(
      within(screen.getByRole('navigation', { name: 'Хлебные крошки' }))
        .getByRole('link', { name: 'Контакты' })
        .getAttribute('href')
    ).toBe('/admin/contacts');
    expect(screen.getByTestId('contact-tab-list').getAttribute('data-base')).toBe(
      '/admin/contacts/c1'
    );
  });
});
