// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerCallsPage from '@/app/manager/calls/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listCalls } = vi.hoisted(() => ({ listCalls: vi.fn() }));
vi.mock('@/lib/services/telephony/listCalls', () => ({ listCalls }));

const { listOrganizations } = vi.hoisted(() => ({ listOrganizations: vi.fn() }));
vi.mock('@/lib/services/manager/organizations', () => ({ listOrganizations }));

vi.mock('@/components/manager/calls-filters', () => ({
  CallsFiltersBar: (props: { direction?: string; orgId?: string; children?: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'calls-filters' },
      `${String(props.direction)}|${String(props.orgId)}`,
      props.children
    ),
}));

vi.mock('@/components/manager/calls-org-filter', () => ({
  CallsOrgFilter: (props: {
    orgs: { id: string; name: string }[];
    orgId?: string;
    direction?: string;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'calls-org-filter' },
      JSON.stringify({ orgs: props.orgs, orgId: props.orgId, direction: props.direction })
    ),
}));

vi.mock('@/components/manager/calls-list', () => ({
  CallsList: (props: { items: unknown[]; orgs?: unknown[]; contactsEnabled?: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'calls-list', 'data-contacts-enabled': String(!!props.contactsEnabled) },
      JSON.stringify(props.items),
      JSON.stringify(props.orgs ?? [])
    ),
}));

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

// Флаги в этих тестах контролируются точечно: `telephony_mango` гейтит саму
// страницу (см. §5 CLAUDE.md), `contacts` — Task 10 (call-triage форма в
// CallsList). Дефолт для не указанных флагов — false. Организации после merge
// с parity-веткой грузятся БЕЗУСЛОВНО (org-фильтр журнала), флаг `contacts`
// влияет только на contactsEnabled-проп CallsList.
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
    await expect(ManagerCallsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NOTFOUND'
    );
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
    expect(listOrganizations).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Звонки');
  });

  it('direction=inbound + orgId + skip=50 → page=3 в фильтрах', async () => {
    mockFlags({ telephony_mango: true });
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [{ id: 'call1' }], total: 60 });

    const { container } = await renderServerComponent(
      ManagerCallsPage({
        searchParams: Promise.resolve({ direction: 'inbound', orgId: 'org-1', skip: '50' }),
      })
    );

    expect(listCalls).toHaveBeenCalledWith({}, SESSION, {
      direction: 'inbound',
      orgId: 'org-1',
      page: 3,
      pageSize: 25,
    });
    expect(container.textContent).toContain('call1');
  });

  it('ссылка пагинатора реально меняет выборку (total > pageSize)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [], total: 60 });

    // страница 1: пагинатор строит ссылку «Вперёд»
    const { container } = await renderServerComponent(
      ManagerCallsPage({ searchParams: Promise.resolve({ orgId: 'org-1' }) })
    );
    const next = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === 'Вперёд'
    );
    expect(next).toBeDefined();

    // переходим по ссылке: её query-параметры парсятся страницей в page=2
    const qs = new URLSearchParams((next as HTMLAnchorElement).getAttribute('href')!.split('?')[1]);
    const spFromLink = Object.fromEntries(qs.entries());
    listCalls.mockClear();
    await renderServerComponent(ManagerCallsPage({ searchParams: Promise.resolve(spFromLink) }));
    expect(listCalls).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ page: 2, orgId: 'org-1' })
    );
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

  it('нераспознанный direction отбрасывается (и в фильтрах, и в UI), кривой skip → page 1', async () => {
    mockFlags({ telephony_mango: true });
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [], total: 0 });

    const { getByTestId } = await renderServerComponent(
      ManagerCallsPage({ searchParams: Promise.resolve({ direction: 'sideways', skip: 'abc' }) })
    );

    const filters = listCalls.mock.calls[0][2];
    expect(filters.direction).toBeUndefined();
    expect(filters.page).toBe(1);
    // в UI-фильтры уходит валидированный direction, а не сырой sp.direction
    expect(getByTestId('calls-filters').textContent).toContain('undefined|undefined');
    expect(JSON.parse(getByTestId('calls-org-filter').textContent ?? '').direction).toBeUndefined();
  });

  it('orgs из listOrganizations и orgId/direction прокидываются в CallsOrgFilter', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [], total: 0 });
    listOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Альфа' }]);

    const { getByTestId } = await renderServerComponent(
      ManagerCallsPage({
        searchParams: Promise.resolve({ orgId: 'org-1', direction: 'inbound' }),
      })
    );

    const payload = JSON.parse(getByTestId('calls-org-filter').textContent ?? '');
    expect(payload).toEqual({
      orgs: [{ id: 'org-1', name: 'Альфа' }],
      orgId: 'org-1',
      direction: 'inbound',
    });
    // бар направлений тоже получает orgId для сохранения его в ссылках
    expect(getByTestId('calls-filters').textContent).toContain('inbound|org-1');
  });

  it('listOrganizations выполняется параллельно с listCalls (Promise.all)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    let callsResolved = false;
    listCalls.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            callsResolved = true;
            resolve({ items: [], total: 0 });
          }, 0);
        })
    );
    listOrganizations.mockImplementation(async () => {
      // при последовательном `await listCalls(...)` сюда пришли бы уже после resolve
      expect(callsResolved).toBe(false);
      return [];
    });

    await renderServerComponent(ManagerCallsPage({ searchParams: Promise.resolve({}) }));
    expect(listOrganizations).toHaveBeenCalledTimes(1);
  });

  it('flag contacts выключен → contactsEnabled=false в CallsList (orgs всё равно грузятся для org-фильтра)', async () => {
    mockFlags({ telephony_mango: true, contacts: false });
    requireManager.mockResolvedValue(SESSION);
    listCalls.mockResolvedValue({ items: [], total: 0 });

    const { container } = await renderServerComponent(
      ManagerCallsPage({ searchParams: Promise.resolve({}) })
    );

    expect(listOrganizations).toHaveBeenCalledWith({}, SESSION);
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
