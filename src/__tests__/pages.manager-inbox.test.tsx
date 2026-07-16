// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  }
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listInbox, listOrganizations } = vi.hoisted(() => ({
  listInbox: vi.fn(),
  listOrganizations: vi.fn()
}));
vi.mock('@/lib/services/inbound/listInbox', () => ({ listInbox }));
vi.mock('@/lib/services/manager/organizations', () => ({ listOrganizations }));

vi.mock('@/components/manager/inbox-filters', () => ({
  InboxFiltersBar: (props: { channel?: string; status?: string }) =>
    React.createElement('div', { 'data-testid': 'inbox-filters' }, String(props.channel), String(props.status))
}));

vi.mock('@/components/manager/inbox-list', () => ({
  InboxList: (props: { items: unknown[]; organizations: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'inbox-list' },
      JSON.stringify(props.items),
      JSON.stringify(props.organizations)
    )
}));

import ManagerInboxPage from '@/app/manager/inbox/page';

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

describe('ManagerInboxPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    isFeatureEnabled.mockReset();
    listInbox.mockReset();
    listOrganizations.mockReset();
  });

  it('flag inbound_messaging выключен → notFound', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(
      ManagerInboxPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('NOTFOUND');
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('без параметров: page=1, фильтры пустые, организации прокидываются в список', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listInbox.mockResolvedValue({ items: [{ id: 'msg1' }], total: 1 });
    listOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Орг' }]);

    const { container } = await renderServerComponent(
      ManagerInboxPage({ searchParams: Promise.resolve({}) })
    );

    expect(listInbox).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
    expect(container.textContent).toContain('Обращения');
    expect(container.textContent).toContain('msg1');
    expect(container.textContent).toContain('org-1');
  });

  it.each(['unresolved', 'bound', 'archived'] as const)(
    'status=%s распознаётся и уходит в фильтры',
    async (status) => {
      isFeatureEnabled.mockReturnValue(true);
      requireManager.mockResolvedValue(SESSION);
      listInbox.mockResolvedValue({ items: [], total: 0 });
      listOrganizations.mockResolvedValue([]);

      await renderServerComponent(
        ManagerInboxPage({ searchParams: Promise.resolve({ status }) })
      );

      expect(listInbox).toHaveBeenCalledWith({}, SESSION, expect.objectContaining({ status }));
    }
  );

  it('нечисловой skip → page 1', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listInbox.mockResolvedValue({ items: [], total: 0 });
    listOrganizations.mockResolvedValue([]);

    await renderServerComponent(
      ManagerInboxPage({ searchParams: Promise.resolve({ skip: 'abc' }) })
    );

    expect(listInbox.mock.calls[0][2].page).toBe(1);
  });

  it('нераспознанный status отброшен; channel и skip проходят', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listInbox.mockResolvedValue({ items: [], total: 100 });
    listOrganizations.mockResolvedValue([]);

    await renderServerComponent(
      ManagerInboxPage({
        searchParams: Promise.resolve({ status: 'bogus', channel: 'telegram', skip: '25' })
      })
    );

    const filters = listInbox.mock.calls[0][2];
    expect(filters.status).toBeUndefined();
    expect(filters.channel).toBe('telegram');
    expect(filters.page).toBe(2);
  });

  it('ссылка пагинатора реально меняет выборку (total > pageSize)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listInbox.mockResolvedValue({ items: [], total: 60 });
    listOrganizations.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      ManagerInboxPage({ searchParams: Promise.resolve({ channel: 'telegram' }) })
    );
    const next = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === 'Вперёд'
    );
    expect(next).toBeDefined();

    const qs = new URLSearchParams((next as HTMLAnchorElement).getAttribute('href')!.split('?')[1]);
    const spFromLink = Object.fromEntries(qs.entries());
    listInbox.mockClear();
    await renderServerComponent(ManagerInboxPage({ searchParams: Promise.resolve(spFromLink) }));
    expect(listInbox).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ page: 2, channel: 'telegram' })
    );
  });
});
