// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import LeaderTasksPage from '@/app/leader/tasks/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listTaskBoard, getTaskFormOptions } = vi.hoisted(() => ({
  listTaskBoard: vi.fn(),
  getTaskFormOptions: vi.fn(),
}));
vi.mock('@/lib/services/tasks/board', () => ({ listTaskBoard, getTaskFormOptions }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/tasks/task-board', () => ({
  TaskBoard: (props: { board: unknown; options: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'task-board' },
      JSON.stringify(props.board),
      JSON.stringify(props.options)
    ),
}));

vi.mock('@/components/tasks/task-list', () => ({
  TaskList: () => React.createElement('div', { 'data-testid': 'task-list' }),
}));

vi.mock('@/components/tasks/tasks-toolbar', () => ({
  TasksToolbar: (props: { state: unknown; assigneeOptions: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'tasks-toolbar' },
      JSON.stringify(props.assigneeOptions)
    ),
}));

vi.mock('@/components/tasks/column-config', () => ({
  ColumnConfig: (props: { columns: unknown[]; isDefault: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'column-config' },
      String(props.isDefault),
      JSON.stringify(props.columns)
    ),
}));

const SESSION = {
  sub: 'u1',
  role: 'leader' as const,
  companyId: 'c1',
};

const EMPTY_OPTIONS = {
  users: [],
  organizations: [],
  orders: [],
  organizationsTotal: 0,
  ordersTotal: 0,
};

function sp(params: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(params) };
}

describe('LeaderTasksPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    isFeatureEnabled.mockReset();
    listTaskBoard.mockReset();
    getTaskFormOptions.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when the internal_tasks flag is disabled (before auth check)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(LeaderTasksPage(sp()))).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('internal_tasks');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('renders with default columns (isDefault: true) and passes assignee filter options (ФТ-7.3)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({
      columns: [{ id: 'default:todo', name: 'К выполнению' }],
      board: [],
      shown: 0,
      total: 0,
    });
    getTaskFormOptions.mockResolvedValue({
      ...EMPTY_OPTIONS,
      users: [{ id: 'm1', name: 'Менеджер' }],
    });

    const { container } = await renderServerComponent(LeaderTasksPage(sp()));

    expect(listTaskBoard).toHaveBeenCalledWith({}, SESSION, {
      scope: 'all',
      overdue: false,
      assigneeId: null,
    });
    expect(getTaskFormOptions).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Задачи');
    expect(container.textContent).toContain('true');
    // Руководителю доступен фильтр по исполнителю.
    expect(container.querySelector('[data-testid="tasks-toolbar"]')?.textContent).toContain(
      'Менеджер'
    );
  });

  it('passes assignee/scope/overdue searchParams to the service', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 0, total: 0 });
    getTaskFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    await renderServerComponent(
      LeaderTasksPage(sp({ assignee: 'm2', scope: 'mine', overdue: '1' }))
    );

    expect(listTaskBoard).toHaveBeenCalledWith({}, SESSION, {
      scope: 'mine',
      overdue: true,
      assigneeId: 'm2',
    });
  });

  it('renders with custom columns (isDefault: false)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({
      columns: [{ id: 'custom-1', name: 'Своя колонка' }],
      board: [],
      shown: 0,
      total: 0,
    });
    getTaskFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const { container } = await renderServerComponent(LeaderTasksPage(sp()));

    expect(container.textContent).toContain('false');
  });

  it('renders with an empty columns array (isDefault stays false, no crash on columns[0])', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 0, total: 0 });
    getTaskFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const { container } = await renderServerComponent(LeaderTasksPage(sp()));

    expect(container.textContent).toContain('false');
  });

  it('renders the list view when view=list (ФТ-7.4)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 0, total: 0 });
    getTaskFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const { container } = await renderServerComponent(LeaderTasksPage(sp({ view: 'list' })));

    expect(container.querySelector('[data-testid="task-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="task-board"]')).toBeNull();
  });
});

// `Р-27` (В-3): доска режется по `BOARD_CAP`, открытые задачи идут первыми —
// экран честно говорит, сколько скрыто, и как сузить охват.
describe('LeaderTasksPage — подпись «Показаны первые N из M» (Р-27)', () => {
  beforeEach(() => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    getTaskFormOptions.mockResolvedValue(EMPTY_OPTIONS);
  });

  it('total > shown → подпись с подсказкой про фильтры', async () => {
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 500, total: 812 });

    const { container } = await renderServerComponent(LeaderTasksPage(sp()));

    expect(container.textContent).toContain('Показаны первые 500 из 812.');
    expect(container.textContent).toContain('Открытые задачи идут первыми и не теряются');
    expect(container.textContent).toContain('сузьте охват фильтрами');
  });

  it('total === shown → подписи нет', async () => {
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 7, total: 7 });

    const { container } = await renderServerComponent(LeaderTasksPage(sp()));

    expect(container.textContent).not.toContain('Показаны первые');
  });
});
