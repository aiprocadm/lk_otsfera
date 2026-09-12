// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerContactsPage from '@/app/manager/contacts/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listContacts, listContactOrgOptions, canUseContacts } = vi.hoisted(() => ({
  listContacts: vi.fn(),
  listContactOrgOptions: vi.fn(),
  canUseContacts: vi.fn(),
}));
// `CONTACT_LIST_PAGE` нужен разборщику адреса — берём настоящий, подменяем только сервис.
vi.mock('@/lib/services/contacts/list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/contacts/list')>()),
  listContacts,
}));
vi.mock('@/lib/services/contacts/orgOptions', () => ({ listContactOrgOptions }));
vi.mock('@/lib/services/contacts/scope', () => ({ canUseContacts }));

// Презентационный компонент печатает ключевые пропсы в data-атрибуты —
// страница проверяется как тонкий слой «гард → сервис → пропсы».
vi.mock('@/components/manager/contacts/contacts-list-screen', () => ({
  ContactsListScreen: (props: {
    cabinet: string;
    query: unknown;
    items: { id: string }[];
    total: number;
    searchParams: unknown;
    orgOptions: { id: string }[];
  }) =>
    React.createElement('div', {
      'data-testid': 'contacts-list-screen',
      'data-cabinet': props.cabinet,
      'data-query': JSON.stringify(props.query),
      'data-items': props.items.map((i) => i.id).join(','),
      'data-total': String(props.total),
      'data-sp': JSON.stringify(props.searchParams),
      'data-org-options': props.orgOptions.map((o) => o.id).join(','),
    }),
}));

const SESSION = { sub: 'm1', role: 'manager' as const, companyId: 'c1' };

/**
 * Страница «Контакты» кабинета менеджера (этап 1 ТЗ 12.09.2026, `У-178`; спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3):
 * флаг `contacts` закрывает страницу до похода за сессией, право `crm.contacts`
 * — второй гард; `teamMode` читается свежим из базы и уходит в оба сервиса;
 * адрес разбирается в фильтры; отказ сервиса — 404, а не пустой экран.
 */
describe('ManagerContactsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    canUseContacts.mockReturnValue(true);
    getCompanyTeamVisibility.mockResolvedValue(true);
    listContacts.mockResolvedValue({ ok: true, items: [], total: 0, page: 1, pageSize: 50 });
    listContactOrgOptions.mockResolvedValue([]);
  });

  it('флаг contacts выключен → notFound без обращения к сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(ManagerContactsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
    expect(requireManager).not.toHaveBeenCalled();
    expect(listContacts).not.toHaveBeenCalled();
  });

  it('нет права crm.contacts → notFound без похода в сервисы', async () => {
    canUseContacts.mockReturnValue(false);
    await expect(ManagerContactsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
    expect(canUseContacts).toHaveBeenCalledWith(SESSION);
    expect(listContacts).not.toHaveBeenCalled();
    expect(listContactOrgOptions).not.toHaveBeenCalled();
  });

  it('отказ сервиса списка → notFound', async () => {
    listContacts.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(ManagerContactsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
  });

  it('без параметров: teamMode из базы, фильтры по умолчанию, пропсы экрана', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    listContacts.mockResolvedValue({
      ok: true,
      items: [{ id: 'k1' }, { id: 'k2' }],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    listContactOrgOptions.mockResolvedValue([{ id: 'o1', name: 'Ромашка' }]);
    const { container } = await renderServerComponent(
      ManagerContactsPage({ searchParams: Promise.resolve({}) })
    );
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(listContacts).toHaveBeenCalledWith({}, SESSION, false, {
      scope: 'all',
      sort: 'name',
      page: 1,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, false);
    const screen = container.querySelector('[data-testid="contacts-list-screen"]')!;
    expect(screen.getAttribute('data-cabinet')).toBe('manager');
    expect(screen.getAttribute('data-items')).toBe('k1,k2');
    expect(screen.getAttribute('data-total')).toBe('2');
    expect(screen.getAttribute('data-org-options')).toBe('o1');
    expect(screen.getAttribute('data-sp')).toBe('{}');
    expect(JSON.parse(screen.getAttribute('data-query')!)).toEqual({
      filters: { scope: 'all', sort: 'name', page: 1 },
      q: '',
      scope: 'all',
      sort: 'name',
      page: 1,
      skip: 0,
    });
  });

  it('параметры адреса уходят в фильтры сервиса; teamMode=true передаётся обоим сервисам', async () => {
    const sp = { q: ' Иван ', scope: 'with_org', sort: 'updated', skip: '100' };
    const { container } = await renderServerComponent(
      ManagerContactsPage({ searchParams: Promise.resolve(sp) })
    );
    expect(listContacts).toHaveBeenCalledWith({}, SESSION, true, {
      q: 'Иван',
      scope: 'with_org',
      sort: 'updated',
      page: 3,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, true);
    const screen = container.querySelector('[data-testid="contacts-list-screen"]')!;
    // Экран получает сырые параметры адреса — для пагинатора и ссылок.
    expect(JSON.parse(screen.getAttribute('data-sp')!)).toEqual(sp);
    expect(JSON.parse(screen.getAttribute('data-query')!)).toMatchObject({
      q: 'Иван',
      page: 3,
      skip: 100,
    });
  });
});
