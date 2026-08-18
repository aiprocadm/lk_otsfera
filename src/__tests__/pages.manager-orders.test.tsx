// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerOrdersPage from '@/app/manager/orders/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
// §10 ТЗ v0.5: страница подтягивает статусы для фильтра — мокаем сервис
// обычной функцией (в файлах есть сброс моков).
vi.mock('@/lib/services/orderStatuses', () => ({
  getOrderedStatuses: async () => [
    { id: 'st-1', label: 'Принято в работу', isActive: true },
    { id: 'st-2', label: 'Выключенный', isActive: false },
  ],
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listOrders } = vi.hoisted(() => ({ listOrders: vi.fn() }));
vi.mock('@/lib/services/manager/orders', () => ({ listOrders }));

const { listOrganizations } = vi.hoisted(() => ({ listOrganizations: vi.fn() }));
vi.mock('@/lib/services/manager/organizations', () => ({ listOrganizations }));

vi.mock('@/components/manager/manager-orders-filter', () => ({
  ManagerOrdersFilter: (props: { orgs: unknown[]; initial: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'orders-filter' },
      JSON.stringify(props.orgs),
      JSON.stringify(props.initial)
    ),
}));

vi.mock('@/components/manager/manager-orders-table', () => ({
  ManagerOrdersTable: (props: { rows: unknown[]; nextCursor: unknown; searchParams: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'orders-table' },
      JSON.stringify(props.rows),
      String(props.nextCursor),
      JSON.stringify(props.searchParams)
    ),
}));

vi.mock('@/components/manager/manager-orders-card-list', () => ({
  ManagerOrdersCardList: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'orders-card-list' }, JSON.stringify(props.rows)),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};

describe('ManagerOrdersPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listOrders.mockReset();
    listOrganizations.mockReset();
  });

  it('fetches orders + organizations in parallel with spread searchParams and renders them', async () => {
    requireManager.mockResolvedValue(SESSION);
    listOrders.mockResolvedValue({ rows: [{ id: 'o1' }], nextCursor: 'c2' });
    listOrganizations.mockResolvedValue([{ id: 'org1', name: 'Org' }]);

    const { container } = await renderServerComponent(
      ManagerOrdersPage({
        searchParams: Promise.resolve({ search: 'test', executionStatus: 'in_progress' }),
      })
    );

    expect(listOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: SESSION, search: 'test', executionStatus: 'in_progress' })
    );
    expect(listOrganizations).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Заказы');
    expect(container.textContent).toContain('o1');
    expect(container.textContent).toContain('Org');
  });

  it('renders with empty searchParams and empty results', async () => {
    requireManager.mockResolvedValue(SESSION);
    listOrders.mockResolvedValue({ rows: [], nextCursor: null });
    listOrganizations.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      ManagerOrdersPage({ searchParams: Promise.resolve({}) })
    );

    expect(listOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: SESSION, unassigned: false })
    );
    expect(container.textContent).toContain('Заказы ваших организаций');
  });

  it('парсит ?unassigned=1 в boolean для listOrders и пробрасывает raw-значение в фильтр', async () => {
    requireManager.mockResolvedValue(SESSION);
    listOrders.mockResolvedValue({ rows: [], nextCursor: null });
    listOrganizations.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      ManagerOrdersPage({ searchParams: Promise.resolve({ unassigned: '1' }) })
    );

    expect(listOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: SESSION, unassigned: true })
    );
    expect(container.textContent).toContain('"unassigned":"1"');
  });
});

// ─── Этап 9 PR-3 (ФТ-12.2): кнопка выгрузки заказов ──────────────────────────

describe('ManagerOrdersPage — выгрузка в Excel', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listOrders.mockReset();
    listOrganizations.mockReset();
    requireManager.mockResolvedValue(SESSION);
    listOrders.mockResolvedValue({ rows: [], nextCursor: null });
    listOrganizations.mockResolvedValue([]);
  });

  it('ссылка несёт активные фильтры экрана и не несёт scope=company', async () => {
    const { container } = await renderServerComponent(
      ManagerOrdersPage({
        searchParams: Promise.resolve({
          search: 'abc',
          executionStatus: 'pending',
          organizationId: 'org1',
          unassigned: '1',
        }),
      })
    );
    const link = container.querySelector('a[href*="/api/manager/orders/export"]');
    expect(link).toBeTruthy();
    const href = link!.getAttribute('href')!;
    expect(href).toContain('search=abc');
    expect(href).toContain('executionStatus=pending');
    expect(href).toContain('organizationId=org1');
    expect(href).toContain('unassigned=1');
    expect(href).not.toContain('scope=company');
  });

  it('без фильтров — голая ссылка', async () => {
    const { container } = await renderServerComponent(
      ManagerOrdersPage({ searchParams: Promise.resolve({}) })
    );
    expect(container.querySelector('a[href="/api/manager/orders/export"]')).toBeTruthy();
  });
});
