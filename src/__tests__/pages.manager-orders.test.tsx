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

// Этап 6 ТЗ 13.10.2026 (`У-306`): кнопка «Создать заказ» — клиентский компонент
// со своим тестом; здесь видно лишь, что она есть и получила организации.
vi.mock('@/components/manager/create-order-button', () => ({
  CreateOrderButton: (props: { organizations: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'create-order' },
      JSON.stringify(props.organizations)
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
    // `У-306`: «Создать заказ» рядом с выгрузкой — со своими организациями.
    expect(container.querySelector('[data-testid="create-order"]')?.textContent).toBe(
      JSON.stringify([{ id: 'org1', name: 'Org' }])
    );
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

// ─── Этап 4 ТЗ 13.10.2026 (`У-295`, `У-297`, `Р-4-3`): фокус с карточки главной ─

describe('ManagerOrdersPage — фокус с карточки главной', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listOrders.mockReset();
    listOrganizations.mockReset();
    requireManager.mockResolvedValue(SESSION);
    listOrders.mockResolvedValue({ rows: [], nextCursor: null });
    listOrganizations.mockResolvedValue([]);
  });

  it('фокус уходит в сервис, в форму, в листание и в выгрузку; видна пометка с «Сбросить»', async () => {
    const { container } = await renderServerComponent(
      ManagerOrdersPage({ searchParams: Promise.resolve({ focus: 'overdue', search: 'x' }) })
    );
    expect(listOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: SESSION, focus: 'overdue', search: 'x' })
    );
    const mark = container.querySelector('[data-testid="orders-focus"]');
    expect(mark?.textContent).toContain('Показаны: Просроченные заказы');
    expect(mark?.querySelector('a[href="/manager/orders"]')?.textContent).toBe('Сбросить');
    expect(container.querySelector('[data-testid="orders-filter"]')?.textContent).toContain(
      '"focus":"overdue"'
    );
    expect(container.querySelector('[data-testid="orders-table"]')?.textContent).toContain(
      '"focus":"overdue"'
    );
    expect(
      container.querySelector('a[href*="/api/manager/orders/export"]')?.getAttribute('href')
    ).toContain('focus=overdue');
  });

  it('незнакомый фокус из адреса — как будто его нет, без пометки и без ошибки', async () => {
    const { container } = await renderServerComponent(
      ManagerOrdersPage({ searchParams: Promise.resolve({ focus: 'всё-сразу' }) })
    );
    const opts = listOrders.mock.calls[0][1] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('focus');
    expect(container.querySelector('[data-testid="orders-focus"]')).toBeNull();
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

// `У-232` (спека §3.7): пришли по ссылке из уведомления на удалённый или чужой
// заказ — карточка увела в список с `?missing=1`, список объясняет, что случилось.
describe('ManagerOrdersPage — плашка «объект недоступен» (У-232)', () => {
  beforeEach(() => {
    requireManager.mockReset().mockResolvedValue(SESSION);
    listOrders.mockReset().mockResolvedValue({ rows: [], nextCursor: null });
    listOrganizations.mockReset().mockResolvedValue([]);
  });

  it('?missing=1 → плашка над списком, с названием объекта', async () => {
    const { container } = await renderServerComponent(
      ManagerOrdersPage({ searchParams: Promise.resolve({ missing: '1' }) })
    );
    expect(container.querySelector('[data-testid="missing-object-notice"]')).not.toBeNull();
    expect(container.textContent).toContain('Заказ недоступен');
  });

  it('без параметра плашки нет — обычный вид экрана не меняется', async () => {
    const { container } = await renderServerComponent(
      ManagerOrdersPage({ searchParams: Promise.resolve({}) })
    );
    expect(container.querySelector('[data-testid="missing-object-notice"]')).toBeNull();
  });
});
