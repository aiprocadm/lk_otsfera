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

const { listCalls } = vi.hoisted(() => ({ listCalls: vi.fn() }));
vi.mock('@/lib/services/telephony/listCalls', () => ({ listCalls }));

const { listOrganizations } = vi.hoisted(() => ({ listOrganizations: vi.fn() }));
vi.mock('@/lib/services/manager/organizations', () => ({ listOrganizations }));

vi.mock('@/components/manager/calls-filters', () => ({
  CallsFiltersBar: (props: { direction?: string }) =>
    React.createElement('div', { 'data-testid': 'calls-filters' }, String(props.direction))
}));

vi.mock('@/components/manager/calls-list', () => ({
  CallsList: (props: { items: unknown[]; orgs?: unknown[]; contactsEnabled?: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'calls-list', 'data-contacts-enabled': String(!!props.contactsEnabled) },
      JSON.stringify(props.items),
      JSON.stringify(props.orgs ?? [])
    )
}));

import ManagerCallsPage from '@/app/manager/calls/page';

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

// Флаги в этих тестах контролируются точечно: `telephony_mango` гейтит саму
// страницу (см. §5 CLAUDE.md), `contacts` — Task 10 (call-triage форма).
// Дефолт для не указанных флагов — false, чтобы старые тесты (которые ставили
// один общий mockReturnValue(true)) не начинали тянуть listOrganizations.
function mockFlags(flags: Record<string, boolean>) {
  isFeatureEnabled.mockImplementation((flag: string) => flags[flag] ?? false);
}

describe('ManagerCallsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    isFeatureEnabled.mockReset();
    listCalls.mockReset();
    listOrganizations.mockReset();
    listOrganizations.mockResolvedValue([]);
  });

  it('flag telephony_mango выключен → notFound', async () => {
    mockFlags({ telephony_mango: false });
    await expect(
      ManagerCallsPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('NOTFOUND');
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('без параметров: page=1, фильтры пустые', async () => {
    mockFlags({ telephony_mango: true });
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [], total: 0 });

    const { container } = await renderServerComponent(
      ManagerCallsPage({ searchParams: Promise.resolve({}) })
    );

    expect(listCalls).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
    expect(container.textContent).toContain('Звонки');
  });

  it('direction=inbound + orgId + page=3 прокидываются в фильтры', async () => {
    mockFlags({ telephony_mango: true });
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [{ id: 'call1' }], total: 60 });

    const { container } = await renderServerComponent(
      ManagerCallsPage({
        searchParams: Promise.resolve({ direction: 'inbound', orgId: 'org-1', page: '3' })
      })
    );

    expect(listCalls).toHaveBeenCalledWith({}, SESSION, {
      direction: 'inbound',
      orgId: 'org-1',
      page: 3,
      pageSize: 25
    });
    expect(container.textContent).toContain('call1');
  });

  it('direction=outbound проходит второй ногой OR', async () => {
    mockFlags({ telephony_mango: true });
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [], total: 0 });

    await renderServerComponent(
      ManagerCallsPage({ searchParams: Promise.resolve({ direction: 'outbound' }) })
    );

    expect(listCalls).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ direction: 'outbound' })
    );
  });

  it('нераспознанный direction отбрасывается, кривой page → 1', async () => {
    mockFlags({ telephony_mango: true });
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [], total: 0 });

    await renderServerComponent(
      ManagerCallsPage({ searchParams: Promise.resolve({ direction: 'sideways', page: 'abc' }) })
    );

    const filters = listCalls.mock.calls[0][2];
    expect(filters.direction).toBeUndefined();
    expect(filters.page).toBe(1);
  });

  it('flag contacts выключен → orgs не грузятся, contactsEnabled=false', async () => {
    mockFlags({ telephony_mango: true, contacts: false });
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [], total: 0 });

    const { container } = await renderServerComponent(
      ManagerCallsPage({ searchParams: Promise.resolve({}) })
    );

    expect(listOrganizations).not.toHaveBeenCalled();
    const list = container.querySelector('[data-testid="calls-list"]');
    expect(list?.getAttribute('data-contacts-enabled')).toBe('false');
  });

  it('flag contacts включён → orgs менеджера грузятся и прокидываются в CallsList', async () => {
    mockFlags({ telephony_mango: true, contacts: true });
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [], total: 0 });
    listOrganizations.mockResolvedValue([{ id: 'o1', name: 'ООО Ромашка' }]);

    const { container } = await renderServerComponent(
      ManagerCallsPage({ searchParams: Promise.resolve({}) })
    );

    expect(listOrganizations).toHaveBeenCalledWith({}, SESSION);
    const list = container.querySelector('[data-testid="calls-list"]');
    expect(list?.getAttribute('data-contacts-enabled')).toBe('true');
    expect(list?.textContent).toContain('ООО Ромашка');
  });
});
