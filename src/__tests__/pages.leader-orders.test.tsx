// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
// §10 ТЗ v0.5: страница подтягивает статусы для фильтра — мокаем сервис
// обычной функцией (в файлах есть сброс моков).
vi.mock('@/lib/services/orderStatuses', () => ({
  getOrderedStatuses: async () => [
    { id: 'st-1', label: 'Принято в работу', isActive: true },
    { id: 'st-2', label: 'Выключенный', isActive: false }
  ]
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listOrders } = vi.hoisted(() => ({ listOrders: vi.fn() }));
vi.mock('@/lib/services/manager/orders', () => ({ listOrders }));

const { listOrganizations } = vi.hoisted(() => ({ listOrganizations: vi.fn() }));
vi.mock('@/lib/services/manager/organizations', () => ({ listOrganizations }));

vi.mock('@/components/manager/manager-orders-filter', () => ({
  ManagerOrdersFilter: (props: { orgs: unknown[]; initial: unknown; basePath?: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'orders-filter' },
      props.basePath,
      JSON.stringify(props.orgs),
      JSON.stringify(props.initial)
    )
}));

vi.mock('@/components/manager/manager-orders-table', () => ({
  ManagerOrdersTable: (props: { rows: unknown[]; nextCursor: string | null; basePath?: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'orders-table' },
      props.basePath,
      String(props.nextCursor),
      JSON.stringify(props.rows)
    )
}));

vi.mock('@/components/manager/manager-orders-card-list', () => ({
  ManagerOrdersCardList: (props: { rows: unknown[]; basePath?: string }) =>
    React.createElement('div', { 'data-testid': 'orders-cards' }, props.basePath, JSON.stringify(props.rows))
}));

import LeaderOrdersPage from '@/app/leader/orders/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'leader' as const, companyId: 'c1' };

describe('LeaderOrdersPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    listOrders.mockReset();
    listOrganizations.mockReset();
  });

  it('lists company-wide orders (teamModeOverride:true) with empty searchParams and passes leader basePath through', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    listOrders.mockResolvedValue({ rows: [{ id: 'o1' }], nextCursor: null });
    listOrganizations.mockResolvedValue([{ id: 'org1', name: 'Org' }]);

    const { container } = await renderServerComponent(
      LeaderOrdersPage({ searchParams: Promise.resolve({}) })
    );

    expect(listOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: SESSION, teamModeOverride: true })
    );
    expect(listOrganizations).toHaveBeenCalledWith({}, SESSION, true);
    expect(container.textContent).toContain('Заказы');
    expect(container.textContent).toContain('/leader');
  });

  it('forwards search/filter query params to listOrders and renders a nextCursor', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    listOrders.mockResolvedValue({ rows: [], nextCursor: 'cursor-2' });
    listOrganizations.mockResolvedValue([]);

    const sp = {
      search: 'test',
      executionStatus: 'in_progress',
      financialStatus: 'not_billed',
      organizationId: 'org1',
      cursor: 'cursor-1'
    };

    const { container } = await renderServerComponent(
      LeaderOrdersPage({ searchParams: Promise.resolve(sp) })
    );

    expect(listOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: SESSION, teamModeOverride: true, ...sp })
    );
    expect(container.textContent).toContain('cursor-2');
  });

  it('парсит ?unassigned=1 в boolean для listOrders (teamModeOverride сохраняется)', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    listOrders.mockResolvedValue({ rows: [], nextCursor: null });
    listOrganizations.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      LeaderOrdersPage({ searchParams: Promise.resolve({ unassigned: '1' }) })
    );

    expect(listOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: SESSION, teamModeOverride: true, unassigned: true })
    );
    expect(container.textContent).toContain('"unassigned":"1"');
  });
});

// ─── Этап 9 PR-3 (ФТ-12.2): кнопка выгрузки заказов у руководителя ───────────

describe('LeaderOrdersPage — выгрузка в Excel', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    listOrders.mockReset();
    listOrganizations.mockReset();
    requireManagerLeader.mockResolvedValue(SESSION);
    listOrders.mockResolvedValue({ rows: [], nextCursor: null });
    listOrganizations.mockResolvedValue([]);
  });

  it('ссылка несёт scope=company (company-wide режим кабинета) и фильтры', async () => {
    const { container } = await renderServerComponent(
      LeaderOrdersPage({ searchParams: Promise.resolve({ search: 'abc', financialStatus: 'paid' }) })
    );
    const href = container
      .querySelector('a[href*="/api/manager/orders/export"]')!
      .getAttribute('href')!;
    expect(href).toContain('scope=company');
    expect(href).toContain('search=abc');
    expect(href).toContain('financialStatus=paid');
  });
});
