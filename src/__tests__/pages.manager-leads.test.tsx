// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerLeadsPage from '@/app/manager/leads/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { prismaMock } = vi.hoisted(() => ({ prismaMock: {} }));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { listManagerLeads } = vi.hoisted(() => ({ listManagerLeads: vi.fn() }));
vi.mock('@/lib/services/manager/leads', () => ({ listManagerLeads }));

// A1: справочник организаций компании — сервис (форма запроса и пустой ответ
// для сессии без компании проверяются в services.manager.organizations.unit).
const { listCompanyOrgOptions } = vi.hoisted(() => ({ listCompanyOrgOptions: vi.fn() }));
vi.mock('@/lib/services/manager/organizations', () => ({ listCompanyOrgOptions }));

vi.mock('@/components/manager/lead-create-staff-form', () => ({
  LeadCreateStaffForm: (props: { organizations: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'lead-create-form' },
      JSON.stringify(props.organizations)
    ),
}));

vi.mock('@/components/manager/manager-leads-filter', () => ({
  ManagerLeadsFilter: (props: { query: unknown }) =>
    React.createElement('div', { 'data-testid': 'leads-filter' }, JSON.stringify(props.query)),
}));

vi.mock('@/components/manager/manager-leads-table', () => ({
  ManagerLeadsTable: (props: { rows: unknown[]; nextCursor: unknown; query: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'leads-table' },
      JSON.stringify(props.rows),
      String(props.nextCursor),
      JSON.stringify(props.query)
    ),
}));

// `У-312`: воронка — вид внутри «Лидов», за прежним флагом `sales_funnel`.
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(() => true) }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
const { getFunnelBoard } = vi.hoisted(() => ({ getFunnelBoard: vi.fn() }));
vi.mock('@/lib/services/funnel/board', () => ({ getFunnelBoard }));
vi.mock('@/components/funnel/funnel-board', () => ({
  FunnelBoard: (props: { board: unknown }) =>
    React.createElement('div', { 'data-testid': 'funnel-board' }, JSON.stringify(props.board)),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};

describe('ManagerLeadsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listManagerLeads.mockReset();
    listCompanyOrgOptions.mockReset();
    listCompanyOrgOptions.mockResolvedValue([]);
  });

  it('passes an undefined status for an unrecognized status value', async () => {
    requireManager.mockResolvedValue(SESSION);
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });

    await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({ status: 'bogus' }) })
    );

    // `У-288`: нейтральный подзаголовок, без «клиент их не видит»;
    // `У-311`: он же объясняет, чем лид отличается от сделки и заказа.
    expect(document.body.textContent).toContain(
      'Лид — возможная продажа: клиент проявил интерес, договорённости ещё нет.'
    );
    expect(document.body.textContent).not.toContain('клиент их не видит');
    expect(listManagerLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: undefined,
        search: undefined,
        assignedToUserId: undefined,
        cursor: undefined,
      })
    );
  });

  it('passes a recognized status through and assignedToUserId when assignedToMe=1', async () => {
    requireManager.mockResolvedValue(SESSION);
    listManagerLeads.mockResolvedValue({ rows: [{ id: 'l1' }], nextCursor: 'c2' });

    const { container } = await renderServerComponent(
      ManagerLeadsPage({
        searchParams: Promise.resolve({ status: 'new', q: 'ООО', assignedToMe: '1', cursor: 'c1' }),
      })
    );

    // Этап 4 ТЗ 28.10.2026 (`У-349`): сессия доезжает до выборки — по ней сервис
    // применяет охват лидов из профиля доступа (own/assigned/all). До этапа
    // страница звала список без сессии и показывала всю очередь даже тем, кому
    // профиль разрешал только свои лиды (API и воронка охват соблюдали).
    expect(listManagerLeads).toHaveBeenCalledWith(expect.anything(), {
      session: SESSION,
      status: 'new',
      search: 'ООО',
      assignedToUserId: 'u1',
      cursor: 'c1',
    });
    expect(listCompanyOrgOptions).toHaveBeenCalledWith(prismaMock, SESSION);
    expect(container.textContent).toContain('Лиды');
    expect(container.textContent).toContain('l1');
  });

  it('passes an empty organizations list when the manager has no companyId', async () => {
    const session = { ...SESSION, companyId: null };
    requireManager.mockResolvedValue(session);
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });

    const { container } = await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({}) })
    );

    expect(listCompanyOrgOptions).toHaveBeenCalledWith(prismaMock, session);
    expect(container.textContent).toContain('[]');
  });

  it('does not scope to assignedToUserId when assignedToMe is not "1"', async () => {
    requireManager.mockResolvedValue(SESSION);
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });

    await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({ assignedToMe: '0' }) })
    );

    expect(listManagerLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignedToUserId: undefined })
    );
  });
});

describe('ManagerLeadsPage — «Список / Воронка» (`У-312`)', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listManagerLeads.mockReset();
    getFunnelBoard.mockReset();
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listCompanyOrgOptions.mockResolvedValue([]);
  });

  const link = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('a')].find((a) => a.textContent === text);

  it('по умолчанию — список; воронка не грузится; переключатель ведёт в воронку', async () => {
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });
    const { container } = await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({}) })
    );
    expect(getFunnelBoard).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="leads-table"]')).not.toBeNull();
    expect(link(container, 'Список')?.getAttribute('aria-current')).toBe('page');
    expect(link(container, 'Воронка')?.getAttribute('href')).toBe('/manager/leads?view=funnel');
  });

  it('?view=funnel — доска воронки с подсказкой и пределом; список и фильтр не грузятся', async () => {
    getFunnelBoard.mockResolvedValue({ stages: [], columns: [], shown: 300, total: 450 });
    const { container } = await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({ view: 'funnel' }) })
    );
    expect(listManagerLeads).not.toHaveBeenCalled();
    expect(getFunnelBoard).toHaveBeenCalledWith(prismaMock, SESSION);
    expect(container.querySelector('[data-testid="funnel-board"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="leads-filter"]')).toBeNull();
    expect(container.textContent).toContain('Перетаскивайте карточки между стадиями.');
    expect(link(container, 'Воронка')?.getAttribute('aria-current')).toBe('page');
    expect(link(container, 'Список')?.getAttribute('href')).toBe('/manager/leads');
  });

  it('флаг воронки выключен — переключателя нет, ?view=funnel даёт список', async () => {
    isFeatureEnabled.mockReturnValue(false);
    listManagerLeads.mockResolvedValue({ rows: [], nextCursor: null });
    const { container } = await renderServerComponent(
      ManagerLeadsPage({ searchParams: Promise.resolve({ view: 'funnel' }) })
    );
    expect(getFunnelBoard).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="leads-table"]')).not.toBeNull();
    expect(link(container, 'Воронка')).toBeUndefined();
  });
});
