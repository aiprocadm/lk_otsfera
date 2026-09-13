// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager, requireManagerLeader } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager, requireManagerLeader }));

const { prismaMock } = vi.hoisted(() => ({ prismaMock: {} }));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

// Справочник организаций компании уехал в сервис (A1): страница его только
// вызывает, а пустой список для сессии без компании — забота сервиса
// (регресс — services.manager.organizations.unit).
const { listCompanyOrgOptions } = vi.hoisted(() => ({ listCompanyOrgOptions: vi.fn() }));
vi.mock('@/lib/services/manager/organizations', () => ({ listCompanyOrgOptions }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getDealBoard } = vi.hoisted(() => ({ getDealBoard: vi.fn() }));
vi.mock('@/lib/services/deals/board', () => ({ getDealBoard }));

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

// Этап 1 ТЗ 12.09.2026 (`У-180`): поле «Контакт» формы сделки — список людей в
// охвате сотрудника; режим команды читается свежим (C8). Оба — сервисы, стабим.
const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));
const { listContactOptions } = vi.hoisted(() => ({ listContactOptions: vi.fn() }));
vi.mock('@/lib/services/contacts/options', () => ({ listContactOptions }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

// `contacts` печатаем в атрибут; `undefined` — словом, потому что
// JSON.stringify(undefined) даёт undefined и атрибут бы просто пропал, а нам
// важно отличить «флаг выключен» (undefined) от «список пуст» ([]).
vi.mock('@/components/deals/deal-board', () => ({
  DealBoard: (props: {
    board: unknown;
    contacts?: unknown[] | undefined;
    contactHrefBase?: string | undefined;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'deal-board',
        'data-contacts':
          props.contacts === undefined ? 'undefined' : JSON.stringify(props.contacts),
        'data-contact-href-base': props.contactHrefBase ?? 'undefined',
      },
      JSON.stringify(props.board)
    ),
}));

vi.mock('@/components/deals/deal-dialog', () => ({
  NewDealButton: (props: {
    managers: unknown;
    currentUserId: string;
    contacts?: unknown[] | undefined;
  }) =>
    React.createElement(
      'button',
      {
        'data-testid': 'new-deal-button',
        'data-user': props.currentUserId,
        'data-contacts':
          props.contacts === undefined ? 'undefined' : JSON.stringify(props.contacts),
      },
      '+ Сделка',
      JSON.stringify(props.managers)
    ),
}));

vi.mock('@/components/deals/deal-stage-config', () => ({
  DealStageConfig: (props: { stages: unknown[]; isDefault: boolean }) =>
    React.createElement('div', { 'data-testid': 'stage-config' }, String(props.isDefault)),
}));

vi.mock('@/components/deals/deals-manager-filter', () => ({
  DealsManagerFilter: (props: { managerId?: string }) =>
    React.createElement('div', { 'data-testid': 'manager-filter' }, props.managerId ?? 'all'),
}));

import ManagerDealsPage from '@/app/manager/deals/page';
import LeaderDealsPage from '@/app/leader/deals/page';

const MANAGER_SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};
const LEADER_SESSION = {
  sub: 'u2',
  role: 'leader' as const,
  companyId: 'c1',
};

const BOARD = {
  stages: [{ id: 'default:new', name: 'Новая' }],
  columns: [],
  shown: 1,
  total: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  nav.notFound.mockImplementation(() => {
    throw new Error('NOT_FOUND');
  });
  listCompanyOrgOptions.mockResolvedValue([{ id: 'org-1', name: 'ООО Ромашка' }]);
  listCompanyManagers.mockResolvedValue([
    { id: 'm-active', name: 'Иван', isActive: true },
    { id: 'm-inactive', name: 'Пётр', isActive: false },
  ]);
  getDealBoard.mockResolvedValue(BOARD);
  // Умолчания контактов: команда выключена, список пуст — прежние тесты
  // включают все флаги разом и не должны упираться в незамоканный prisma.
  getCompanyTeamVisibility.mockResolvedValue(false);
  listContactOptions.mockResolvedValue([]);
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
    const session = { ...MANAGER_SESSION, companyId: null };
    requireManager.mockResolvedValue(session);
    listCompanyOrgOptions.mockResolvedValue([]);

    const { getByTestId } = await renderServerComponent(ManagerDealsPage());

    // Сессия уходит в сервис как есть — пустой ответ без запроса к БД
    // проверяется на его уровне.
    expect(listCompanyOrgOptions).toHaveBeenCalledWith(prismaMock, session);
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

    expect(getDealBoard).toHaveBeenCalledWith(prismaMock, LEADER_SESSION, {
      managerId: 'm-active',
    });
    expect(getByTestId('manager-filter').textContent).toBe('m-active');
  });

  it('custom stages → DealStageConfig gets isDefault=false', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(LEADER_SESSION);
    getDealBoard.mockResolvedValue({
      stages: [{ id: 'custom-1', name: 'Своя' }],
      columns: [],
      shown: 0,
      total: 0,
    });

    const { getByTestId } = await renderLeader();

    expect(getByTestId('stage-config').textContent).toBe('false');
  });

  it('руководитель без компании: списки пустые, БД не опрашивается', async () => {
    isFeatureEnabled.mockReturnValue(true);
    const session = { ...LEADER_SESSION, companyId: null };
    requireManagerLeader.mockResolvedValue(session);
    listCompanyOrgOptions.mockResolvedValue([]);

    await renderServerComponent(LeaderDealsPage({ searchParams: Promise.resolve({}) }));

    expect(listCompanyOrgOptions).toHaveBeenCalledWith(prismaMock, session);
    expect(listCompanyManagers).not.toHaveBeenCalled();
  });

  it('a requireManagerLeader rejection propagates — the page never renders', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockRejectedValue(new Error('REDIRECT'));

    await expect(renderLeader()).rejects.toThrow('REDIRECT');
    expect(getDealBoard).not.toHaveBeenCalled();
  });
});

// `Р-27` (В-3): доска режется по `BOARD_CAP`, открытые сделки идут первыми.
// Экран обязан честно сказать, сколько скрыто, и где искать остальное.
describe('страницы сделок — подпись «Показаны первые N из M» (Р-27)', () => {
  it('менеджер: total > shown → подпись с подсказкой про карточку организации', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(MANAGER_SESSION);
    getDealBoard.mockResolvedValue({ ...BOARD, shown: 500, total: 750 });

    const { container } = await renderServerComponent(ManagerDealsPage());

    expect(container.textContent).toContain('Показаны первые 500 из 750.');
    expect(container.textContent).toContain('Открытые сделки идут первыми и не теряются');
    expect(container.textContent).toContain('вкладка «Сделки»');
  });

  it('менеджер: total === shown → подписи нет', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(MANAGER_SESSION);
    getDealBoard.mockResolvedValue({ ...BOARD, shown: 12, total: 12 });

    const { container } = await renderServerComponent(ManagerDealsPage());

    expect(container.textContent).not.toContain('Показаны первые');
  });

  it('руководитель: total > shown → та же подпись', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(LEADER_SESSION);
    getDealBoard.mockResolvedValue({ ...BOARD, shown: 500, total: 501 });

    const { container } = await renderServerComponent(
      LeaderDealsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('Показаны первые 500 из 501.');
    expect(container.textContent).toContain('Открытые сделки идут первыми и не теряются');
  });

  it('руководитель: total === shown → подписи нет', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(LEADER_SESSION);
    getDealBoard.mockResolvedValue({ ...BOARD, shown: 3, total: 3 });

    const { container } = await renderServerComponent(
      LeaderDealsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).not.toContain('Показаны первые');
  });
});

// Этап 1 ТЗ 12.09.2026 (`У-180`): «контакт из всех точек» — поле «Контакт» в
// форме сделки и на карточках доски. Список один и тот же для кнопки и доски,
// адрес карточки контакта — свой у каждого кабинета (правило зеркала §0.2).
describe('страницы сделок — контакты для формы сделки (`У-180`)', () => {
  const CONTACTS = [{ id: 'ct-1', name: 'Пётр Петров', position: null, organizationId: 'org-1' }];
  const onlyDeals = (flag: string) => flag === 'deals_pipeline';
  const dealsAndContacts = (flag: string) => flag === 'deals_pipeline' || flag === 'contacts';

  it('менеджер, флаг contacts включён: список читается со свежим teamMode и уходит и в кнопку, и в доску', async () => {
    isFeatureEnabled.mockImplementation(dealsAndContacts);
    requireManager.mockResolvedValue(MANAGER_SESSION);
    getCompanyTeamVisibility.mockResolvedValue(true);
    listContactOptions.mockResolvedValue(CONTACTS);

    const { getByTestId } = await renderServerComponent(ManagerDealsPage());

    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(prismaMock, 'c1');
    expect(listContactOptions).toHaveBeenCalledWith(prismaMock, MANAGER_SESSION, true);
    expect(getByTestId('new-deal-button').getAttribute('data-contacts')).toBe(
      JSON.stringify(CONTACTS)
    );
    expect(getByTestId('deal-board').getAttribute('data-contacts')).toBe(JSON.stringify(CONTACTS));
    expect(getByTestId('deal-board').getAttribute('data-contact-href-base')).toBe(
      '/manager/contacts'
    );
  });

  it('менеджер, флаг contacts выключен: сервисы не зовутся, в компоненты уходит undefined', async () => {
    // `undefined`, а не `[]`: пустой список означал бы «контактов нет», а форма
    // должна вовсе спрятать поле, пока справочник выключен.
    isFeatureEnabled.mockImplementation(onlyDeals);
    requireManager.mockResolvedValue(MANAGER_SESSION);

    const { getByTestId } = await renderServerComponent(ManagerDealsPage());

    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(listContactOptions).not.toHaveBeenCalled();
    expect(getByTestId('new-deal-button').getAttribute('data-contacts')).toBe('undefined');
    expect(getByTestId('deal-board').getAttribute('data-contacts')).toBe('undefined');
    // Адрес карточки — свойство кабинета, от флага не зависит.
    expect(getByTestId('deal-board').getAttribute('data-contact-href-base')).toBe(
      '/manager/contacts'
    );
  });

  it('руководитель, флаг contacts включён: тот же список, что у менеджера, адрес карточки — свой', async () => {
    isFeatureEnabled.mockImplementation(dealsAndContacts);
    requireManagerLeader.mockResolvedValue(LEADER_SESSION);
    getCompanyTeamVisibility.mockResolvedValue(false);
    listContactOptions.mockResolvedValue(CONTACTS);

    const { getByTestId } = await renderServerComponent(
      LeaderDealsPage({ searchParams: Promise.resolve({}) })
    );

    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(prismaMock, 'c1');
    expect(listContactOptions).toHaveBeenCalledWith(prismaMock, LEADER_SESSION, false);
    expect(getByTestId('new-deal-button').getAttribute('data-contacts')).toBe(
      JSON.stringify(CONTACTS)
    );
    expect(getByTestId('deal-board').getAttribute('data-contacts')).toBe(JSON.stringify(CONTACTS));
    expect(getByTestId('deal-board').getAttribute('data-contact-href-base')).toBe(
      '/leader/contacts'
    );
  });

  it('руководитель, флаг contacts выключен: сервисы не зовутся, в компоненты уходит undefined', async () => {
    isFeatureEnabled.mockImplementation(onlyDeals);
    requireManagerLeader.mockResolvedValue(LEADER_SESSION);

    const { getByTestId } = await renderServerComponent(
      LeaderDealsPage({ searchParams: Promise.resolve({}) })
    );

    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(listContactOptions).not.toHaveBeenCalled();
    expect(getByTestId('new-deal-button').getAttribute('data-contacts')).toBe('undefined');
    expect(getByTestId('deal-board').getAttribute('data-contacts')).toBe('undefined');
    expect(getByTestId('deal-board').getAttribute('data-contact-href-base')).toBe(
      '/leader/contacts'
    );
  });
});
