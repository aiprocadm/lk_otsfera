// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

import { OrgHistorySection } from '@/components/organization/org-history-section';
import { fmtDateTime } from '@/lib/format';
import type { ContactsCabinet } from '@/lib/navigation/contactsHrefs';
import {
  orgHistoryTypesFor,
  type OrgHistoryItem,
  type OrgHistoryType,
} from '@/lib/services/organization/orgHistory';

/**
 * Вкладка «История» карточки организации (этап 1 ТЗ 12.09.2026, `У-184`;
 * спека 2026-09-12-stage1-contacts-and-notes-design §3.8): пилюли фильтра по
 * типу с адресами `?tab=history&type=…`, разные пустые состояния с типом и без,
 * строки ленты со ссылками по виду события и кабинету (администратору
 * мессенджеры, звонки и письма недоступны), прочерки вместо пустых полей,
 * подпись «Показаны N из M» с просьбой выбрать тип в режиме «верх ленты».
 */
const TYPES = orgHistoryTypesFor(() => true);

function item(overrides: Partial<OrgHistoryItem> & { kind: OrgHistoryType }): OrgHistoryItem {
  return {
    id: `${overrides.kind}-1`,
    at: new Date('2026-09-10T09:00:00Z'),
    title: `Событие ${overrides.kind}`,
    subtitle: 'подробности',
    actor: 'Иван Иванов',
    ...overrides,
  };
}

const ITEMS: OrgHistoryItem[] = [
  item({ kind: 'audit', title: 'Организация изменена', actor: null, subtitle: null }),
  item({ kind: 'note', title: 'Заметка: договорились о скидке' }),
  item({ kind: 'dialog', id: 'd1', title: 'Telegram: Пётр Петров', actor: 'Пётр Петров' }),
  item({ kind: 'call', title: 'Входящий звонок' }),
  item({ kind: 'inbound', title: 'Письмо: счёт на оплату' }),
];

function renderSection(
  overrides: Partial<React.ComponentProps<typeof OrgHistorySection>> & {
    cabinet?: ContactsCabinet;
  } = {}
) {
  const cabinet = overrides.cabinet ?? 'manager';
  return render(
    <OrgHistorySection
      cabinet={cabinet}
      basePath={`/${cabinet}/organizations/o1`}
      searchParams={{ tab: 'history' }}
      types={TYPES}
      activeType={null}
      items={ITEMS}
      total={ITEMS.length}
      skip={0}
      mode="top"
      {...overrides}
    />
  );
}

function pill(name: string): HTMLElement {
  return screen.getByRole('link', { name });
}

/** Ссылка на заголовок события — в таблице и в карточке одна и та же; `null`, если её нет. */
function titleHref(title: string): string | null {
  const links = screen.queryAllByRole('link', { name: title });
  if (links.length === 0) {
    expect(screen.getAllByText(title)).toHaveLength(2);
    return null;
  }
  expect(links).toHaveLength(2);
  expect(links[1].getAttribute('href')).toBe(links[0].getAttribute('href'));
  return links[0].getAttribute('href');
}

describe('OrgHistorySection — пилюли типов', () => {
  it('«Все типы» и типы ведут на `?tab=history[&type=…]`; активна «Все типы»', () => {
    renderSection();
    expect(pill('Все типы').getAttribute('href')).toBe('/manager/organizations/o1?tab=history');
    expect(pill('Все типы').getAttribute('aria-current')).toBe('true');
    for (const t of TYPES) {
      expect(pill(t.label).getAttribute('href')).toBe(
        `/manager/organizations/o1?tab=history&type=${t.key}`
      );
      expect(pill(t.label).getAttribute('aria-current')).toBeNull();
    }
  });

  it('с выбранным типом активна его пилюля, «Все типы» — нет', () => {
    renderSection({ activeType: 'call', mode: 'exact' });
    expect(pill('Звонки').getAttribute('aria-current')).toBe('true');
    expect(pill('Звонки').className).toContain('bg-orange-500');
    expect(pill('Все типы').getAttribute('aria-current')).toBeNull();
    expect(pill('Заметки').getAttribute('aria-current')).toBeNull();
  });
});

describe('OrgHistorySection — пусто', () => {
  it('без типа — «ничего не происходило», без таблицы и подписи', () => {
    renderSection({ items: [], total: 0 });
    expect(
      screen.getByText(
        'По этой организации ещё ничего не происходило: ни действий, ни заметок, ни переписки.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/Показаны/)).toBeNull();
  });

  it('с типом — «событий этого типа не было»', () => {
    renderSection({ items: [], total: 0, activeType: 'note', mode: 'exact' });
    expect(screen.getByText('Событий этого типа по организации ещё не было.')).toBeTruthy();
  });
});

describe('OrgHistorySection — строки ленты', () => {
  it('менеджер: заметка → вкладка заметок, диалог → мессенджеры, звонок → звонки, письмо → входящие, журнал — без ссылки', () => {
    renderSection();
    expect(titleHref('Заметка: договорились о скидке')).toBe('/manager/organizations/o1?tab=notes');
    expect(titleHref('Telegram: Пётр Петров')).toBe('/manager/messengers/d1');
    expect(titleHref('Входящий звонок')).toBe('/manager/calls');
    expect(titleHref('Письмо: счёт на оплату')).toBe('/manager/inbox');
    expect(titleHref('Организация изменена')).toBeNull();
  });

  it('руководитель — «играющий тренер»: заметка в своём кабинете, остальное в менеджерском', () => {
    renderSection({ cabinet: 'leader' });
    expect(titleHref('Заметка: договорились о скидке')).toBe('/leader/organizations/o1?tab=notes');
    expect(titleHref('Telegram: Пётр Петров')).toBe('/manager/messengers/d1');
    expect(titleHref('Входящий звонок')).toBe('/manager/calls');
    expect(titleHref('Письмо: счёт на оплату')).toBe('/manager/inbox');
  });

  it('администратор: диалоги, звонки и письма без ссылки; заметка — в свой кабинет', () => {
    renderSection({ cabinet: 'admin' });
    expect(titleHref('Заметка: договорились о скидке')).toBe('/admin/organizations/o1?tab=notes');
    expect(titleHref('Telegram: Пётр Петров')).toBeNull();
    expect(titleHref('Входящий звонок')).toBeNull();
    expect(titleHref('Письмо: счёт на оплату')).toBeNull();
    expect(titleHref('Организация изменена')).toBeNull();
  });

  it('таблица: «Когда», «Кто», «Подробности»; пустые — прочерк', () => {
    renderSection();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(ITEMS.length);
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((td) => td.textContent);
    const when = fmtDateTime(new Date('2026-09-10T09:00:00Z'));
    expect(cells(rows[0])).toEqual([when, 'Организация изменена', '—', '—']);
    expect(cells(rows[2])).toEqual([when, 'Telegram: Пётр Петров', 'Пётр Петров', 'подробности']);
  });

  it('мобильные карточки: те же поля, пустые — прочерк', () => {
    renderSection();
    const cards = Array.from(document.querySelectorAll<HTMLElement>('ul.md\\:hidden > li'));
    expect(cards).toHaveLength(ITEMS.length);
    const values = (card: HTMLElement) =>
      Array.from(card.querySelectorAll('dd')).map((dd) => dd.textContent);
    const when = fmtDateTime(new Date('2026-09-10T09:00:00Z'));
    expect(values(cards[0])).toEqual([when, '—', '—']);
    expect(values(cards[1])).toEqual([when, 'Иван Иванов', 'подробности']);
  });
});

describe('OrgHistorySection — подпись и постраничность', () => {
  it('режим «верх ленты», событий больше показанных → просьба выбрать тип', () => {
    renderSection({ total: 7 });
    expect(screen.getByText(/^Показаны/).textContent).toBe(
      'Показаны 5 из 7 — чтобы листать глубже, выберите тип'
    );
  });

  it('режим «верх ленты», показано всё → без хвоста', () => {
    renderSection({ total: 5 });
    expect(screen.getByText(/^Показаны/).textContent).toBe('Показаны 5 из 5');
  });

  it('точный режим с типом: хвоста нет, страницы по 20 с типом в адресе', () => {
    renderSection({
      activeType: 'audit',
      mode: 'exact',
      total: 45,
      skip: 20,
      searchParams: { tab: 'history', type: 'audit' },
    });
    expect(screen.getByText(/^Показаны/).textContent).toBe('Показаны 25 из 45');
    expect(screen.getByText('Страница 2 из 3 · 45 всего')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Назад' }).getAttribute('href')).toBe(
      '/manager/organizations/o1?tab=history&type=audit&take=20'
    );
    expect(screen.getByRole('link', { name: 'Вперёд' }).getAttribute('href')).toBe(
      '/manager/organizations/o1?tab=history&type=audit&take=20&skip=40'
    );
  });

  it('N не превышает M', () => {
    renderSection({ total: 3, mode: 'exact', activeType: 'note' });
    expect(screen.getByText(/^Показаны/).textContent).toBe('Показаны 3 из 3');
  });
});
