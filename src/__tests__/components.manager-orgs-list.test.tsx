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

import { ManagerOrgsList } from '@/components/manager/manager-orgs-list';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';

describe('ManagerOrgsList', () => {
  it('empty: renders the empty-state message', () => {
    const html = renderToString(React.createElement(ManagerOrgsList, { orgs: [] }));
    expect(html).toContain('Вам пока не назначено ни одной организации');
  });

  it('non-empty: renders a row linking to /manager/organizations/{id}', () => {
    const orgs: ManagerOrgListRow[] = [
      { id: 'org1', name: 'ООО Ромашка', _count: { orders: 4, students: 9 } } as ManagerOrgListRow,
    ];
    const html = renderToString(React.createElement(ManagerOrgsList, { orgs }));
    expect(html).toContain('href="/manager/organizations/org1"');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('4');
    expect(html).toContain('9');
  });
});

/**
 * Отбор «без ИНН» (`У-94`).
 *
 * Отбор — **ссылка, а не кнопка**: отобранным списком можно поделиться, а
 * «назад» в браузере работает. Состояние живёт в адресе, а не в памяти
 * страницы, — иначе ссылка на «организации без ИНН» открывала бы полный
 * список у того, кому её прислали.
 */
describe('ManagerOrgsList — отбор «без ИНН»', () => {
  const html = (props: Record<string, unknown>) =>
    renderToString(React.createElement(ManagerOrgsList, { orgs: [], ...props } as never)).replace(
      /<!-- -->/g,
      ''
    );

  it('отбор выключен — ссылка включает его', () => {
    const out = html({});

    expect(out).toContain('href="/manager/organizations?inn=without"');
    expect(out).not.toContain('aria-current');
  });

  it('отбор включён — та же ссылка его снимает и помечена как текущая', () => {
    const out = html({ withoutInn: true });

    expect(out).toContain('href="/manager/organizations"');
    expect(out).toContain('aria-current="true"');
  });

  it('пустой список объясняет РАЗНОЕ в зависимости от отбора', () => {
    // «Вам ничего не назначено» и «все реквизиты заполнены» — новости разные,
    // и общий текст отправил бы человека искать не ту причину.
    expect(html({})).toContain('Вам пока не назначено ни одной организации');
    expect(html({ withoutInn: true })).toContain('Организаций без ИНН нет');
  });

  it('у руководителя отбор ведёт в его кабинет', () => {
    const out = html({ basePath: '/leader/organizations' });

    expect(out).toContain('href="/leader/organizations?inn=without"');
  });
});
