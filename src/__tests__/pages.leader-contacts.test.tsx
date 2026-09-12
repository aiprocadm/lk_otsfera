// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import LeaderContactsPage from '@/app/leader/contacts/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

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

const SESSION = { sub: 'l1', role: 'leader' as const, companyId: 'c1' };

/**
 * Страница «Контакты» кабинета руководителя (этап 1 ТЗ 12.09.2026, `У-178`;
 * спека docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3):
 * те же два гарда, что у менеджера, но `teamMode` всегда `true` — руководитель
 * смотрит на всю компанию, как `/leader/organizations` (`У-101`); тумблер
 * компании из базы не читается вовсе.
 */
describe('LeaderContactsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    canUseContacts.mockReturnValue(true);
    listContacts.mockResolvedValue({ ok: true, items: [], total: 0, page: 1, pageSize: 50 });
    listContactOrgOptions.mockResolvedValue([]);
  });

  it('флаг contacts выключен → notFound без обращения к сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(LeaderContactsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
    expect(requireManagerLeader).not.toHaveBeenCalled();
    expect(listContacts).not.toHaveBeenCalled();
  });

  it('нет права crm.contacts → notFound без похода в сервисы', async () => {
    canUseContacts.mockReturnValue(false);
    await expect(LeaderContactsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
    expect(canUseContacts).toHaveBeenCalledWith(SESSION);
    expect(listContacts).not.toHaveBeenCalled();
  });

  it('отказ сервиса списка → notFound', async () => {
    listContacts.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(LeaderContactsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
  });

  it('teamMode всегда true, кабинет leader, пропсы экрана', async () => {
    listContacts.mockResolvedValue({
      ok: true,
      items: [{ id: 'k1' }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    listContactOrgOptions.mockResolvedValue([
      { id: 'o1', name: 'Ромашка' },
      { id: 'o2', name: 'Лютик' },
    ]);
    const sp = { q: 'Пётр', scope: 'archived', skip: '50' };
    const { container } = await renderServerComponent(
      LeaderContactsPage({ searchParams: Promise.resolve(sp) })
    );
    expect(listContacts).toHaveBeenCalledWith({}, SESSION, true, {
      q: 'Пётр',
      scope: 'archived',
      sort: 'name',
      page: 2,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, true);
    const screen = container.querySelector('[data-testid="contacts-list-screen"]')!;
    expect(screen.getAttribute('data-cabinet')).toBe('leader');
    expect(screen.getAttribute('data-items')).toBe('k1');
    expect(screen.getAttribute('data-total')).toBe('1');
    expect(screen.getAttribute('data-org-options')).toBe('o1,o2');
    expect(JSON.parse(screen.getAttribute('data-sp')!)).toEqual(sp);
    expect(JSON.parse(screen.getAttribute('data-query')!)).toMatchObject({
      q: 'Пётр',
      scope: 'archived',
      page: 2,
      skip: 50,
    });
  });
});
