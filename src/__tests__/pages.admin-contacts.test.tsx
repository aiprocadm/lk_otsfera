// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminContactsPage from '@/app/admin/contacts/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

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

const SESSION = { sub: 'a1', role: 'admin' as const, companyId: 'c1' };

/**
 * Страница «Контакты» кабинета администратора (этап 1 ТЗ 12.09.2026, `У-178`;
 * спека docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3):
 * те же два гарда; `teamMode` всегда `false` — администратор видит пол компании
 * (Model A), командная видимость для него смысла не имеет.
 */
describe('AdminContactsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireAdmin.mockResolvedValue(SESSION);
    canUseContacts.mockReturnValue(true);
    listContacts.mockResolvedValue({ ok: true, items: [], total: 0, page: 1, pageSize: 50 });
    listContactOrgOptions.mockResolvedValue([]);
  });

  it('флаг contacts выключен → notFound без обращения к сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(AdminContactsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(listContacts).not.toHaveBeenCalled();
  });

  it('нет права crm.contacts (нет компании) → notFound без похода в сервисы', async () => {
    canUseContacts.mockReturnValue(false);
    await expect(AdminContactsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
    expect(canUseContacts).toHaveBeenCalledWith(SESSION);
    expect(listContacts).not.toHaveBeenCalled();
  });

  it('отказ сервиса списка → notFound', async () => {
    listContacts.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(AdminContactsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
  });

  it('teamMode всегда false, кабинет admin, пропсы экрана', async () => {
    listContacts.mockResolvedValue({
      ok: true,
      items: [{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }],
      total: 3,
      page: 1,
      pageSize: 50,
    });
    listContactOrgOptions.mockResolvedValue([{ id: 'o1', name: 'Ромашка' }]);
    const sp = { scope: 'without_org', sort: 'updated' };
    const { container } = await renderServerComponent(
      AdminContactsPage({ searchParams: Promise.resolve(sp) })
    );
    expect(listContacts).toHaveBeenCalledWith({}, SESSION, false, {
      scope: 'without_org',
      sort: 'updated',
      page: 1,
    });
    expect(listContactOrgOptions).toHaveBeenCalledWith({}, SESSION, false);
    const screen = container.querySelector('[data-testid="contacts-list-screen"]')!;
    expect(screen.getAttribute('data-cabinet')).toBe('admin');
    expect(screen.getAttribute('data-items')).toBe('k1,k2,k3');
    expect(screen.getAttribute('data-total')).toBe('3');
    expect(screen.getAttribute('data-org-options')).toBe('o1');
    expect(JSON.parse(screen.getAttribute('data-sp')!)).toEqual(sp);
    expect(JSON.parse(screen.getAttribute('data-query')!)).toMatchObject({
      q: '',
      scope: 'without_org',
      sort: 'updated',
      page: 1,
      skip: 0,
    });
  });
});
