// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager, requireManagerLeader } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn()
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager, requireManagerLeader }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { organization: { findMany: vi.fn() } }
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getDealBoard } = vi.hoisted(() => ({ getDealBoard: vi.fn() }));
vi.mock('@/lib/services/deals/board', () => ({ getDealBoard }));

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/deals/deal-board', () => ({
  DealBoard: (props: { board: unknown }) =>
    React.createElement('div', { 'data-testid': 'deal-board' }, JSON.stringify(props.board))
}));

vi.mock('@/components/deals/deal-dialog', () => ({
  NewDealButton: (props: { managers: unknown; currentUserId: string }) =>
    React.createElement(
      'button',
      { 'data-testid': 'new-deal-button', 'data-user': props.currentUserId },
      '+ Сделка',
      JSON.stringify(props.managers)
    )
}));

vi.mock('@/components/deals/deal-stage-config', () => ({
  DealStageConfig: (props: { stages: unknown[]; isDefault: boolean }) =>
    React.createElement('div', { 'data-testid': 'stage-config' }, String(props.isDefault))
}));

vi.mock('@/components/deals/deals-manager-filter', () => ({
  DealsManagerFilter: (props: { managerId?: string }) =>
    React.createElement('div', { 'data-testid': 'manager-filter' }, props.managerId ?? 'all')
}));

import ManagerDealsPage from '@/app/manager/deals/page';
import LeaderDealsPage from '@/app/leader/deals/page';

const MANAGER_SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };
const LEADER_SESSION = { sub: 'u2', role: 'manager' as const, managerRole: 'leader' as const, companyId: 'c1' };

const BOARD = { stages: [{ id: 'default:new', name: 'Новая' }], columns: [] };

beforeEach(() => {
  vi.clearAllMocks();
  nav.notFound.mockImplementation(() => {
    throw new Error('NOT_FOUND');
  });
  prismaMock.organization.findMany.mockResolvedValue([{ id: 'org-1', name: 'ООО Ромашка' }]);
  listCompanyManagers.mockResolvedValue([
    { id: 'm-active', name: 'Иван', isActive: true },
    { id: 'm-inactive', name: 'Пётр', isActive: false }
  ]);
  getDealBoard.mockResolvedValue(BOARD);
});

describe('ManagerDealsPage', () => {
  it('calls notFound() when the deals_pipeline flag is off — before the auth gate', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(ManagerDealsPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('deals_pipeline');
    expect(requireManager).not.toHaveBeenCalled();
    expect(getDealBoard).not.toHaveBeenCalled();
  });

  it('happy path: gates via requireManager, renders the heading, the board and the "+ Сделка" button', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(MANAGER_SESSION);

    const { container, getByTestId } = await renderServerComponent(ManagerDealsPage());

    expect(requireManager).toHaveBeenCalledTimes(1);
    expect(getDealBoard).toHaveBeenCalledWith(prismaMock, MANAGER_SESSION);
    expect(container.textContent).toContain('Сделки');
    expect(container.textContent).toContain('+ Сделка');
    expect(getByTestId('deal-board').textContent).toContain('default:new');
    // Только активные менеджеры попадают в опции формы
    expect(getByTestId('new-deal-button').textContent).toContain('Иван');
    expect(getByTestId('new-deal-button').textContent).not.toContain('Пётр');
    expect(getByTestId('new-deal-button').getAttribute('data-user')).toBe('u1');
  });

  it('сотрудник без компании: списки организаций и менеджеров пустые, БД не опрашивается', async () => {
    // Компании в сессии может не быть (например, сотрудник ещё не привязан).
    // Страница обязана открыться с пустыми списками, а не упасть на запросе
    // «организации компании undefined».
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue({ ...MANAGER_SESSION, companyId: null });

    const { getByTestId } = await renderServerComponent(ManagerDealsPage());

    expect(prismaMock.organization.findMany).not.toHaveBeenCalled();
    expect(listCompanyManagers).not.toHaveBeenCalled();
    expect(getByTestId('new-deal-button').textContent).not.toContain('Иван');
  });

  it('a requireManager rejection (non-staff viewer) propagates — the page never renders', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockRejectedValue(new Error('REDIRECT'));

    await expect(renderServerComponent(ManagerDealsPage())).rejects.toThrow('REDIRECT');
    expect(getDealBoard).not.toHaveBeenCalled();
  });
});

describe('LeaderDealsPage', () => {
  function renderLeader(searchParams: { manager?: string } = {}) {
    return renderServerComponent(LeaderDealsPage({ searchParams: Promise.resolve(searchParams) }));
  }

  it('calls notFound() when the deals_pipeline flag is off — before the auth gate', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderLeader()).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('deals_pipeline');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('happy path: gates via requireManagerLeader, renders the board, filter and DealStageConfig (isDefault=true)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(LEADER_SESSION);

    const { container, getByTestId } = await renderLeader();

    expect(requireManagerLeader).toHaveBeenCalledTimes(1);
    expect(getDealBoard).toHaveBeenCalledWith(prismaMock, LEADER_SESSION, { managerId: undefined });
    expect(container.textContent).toContain('Сделки');
    expect(container.textContent).toContain('+ Сделка');
    expect(getByTestId('deal-board')).toBeTruthy();
    expect(getByTestId('manager-filter').textContent).toBe('all');
    // default:-стадии → isDefault true
    expect(getByTestId('stage-config').textContent).toBe('true');
  });

  it('forwards the ?manager= filter into getDealBoard and the filter component', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(LEADER_SESSION);

    const { getByTestId } = await renderLeader({ manager: 'm-active' });

    expect(getDealBoard).toHaveBeenCalledWith(prismaMock, LEADER_SESSION, { managerId: 'm-active' });
    expect(getByTestId('manager-filter').textContent).toBe('m-active');
  });

  it('custom stages → DealStageConfig gets isDefault=false', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(LEADER_SESSION);
    getDealBoard.mockResolvedValue({ stages: [{ id: 'custom-1', name: 'Своя' }], columns: [] });

    const { getByTestId } = await renderLeader();

    expect(getByTestId('stage-config').textContent).toBe('false');
  });

  it('руководитель без компании: списки пустые, БД не опрашивается', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue({ ...LEADER_SESSION, companyId: null });

    await renderServerComponent(LeaderDealsPage({ searchParams: Promise.resolve({}) }));

    expect(prismaMock.organization.findMany).not.toHaveBeenCalled();
    expect(listCompanyManagers).not.toHaveBeenCalled();
  });

  it('a requireManagerLeader rejection propagates — the page never renders', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockRejectedValue(new Error('REDIRECT'));

    await expect(renderLeader()).rejects.toThrow('REDIRECT');
    expect(getDealBoard).not.toHaveBeenCalled();
  });
});
