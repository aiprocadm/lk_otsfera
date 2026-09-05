// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerTasksPage from '@/app/manager/tasks/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

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

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
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

describe('ManagerTasksPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    isFeatureEnabled.mockReset();
    listTaskBoard.mockReset();
    getTaskFormOptions.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when the internal_tasks flag is disabled (before auth check)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(ManagerTasksPage(sp()))).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('internal_tasks');
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('renders the task board when the flag is enabled (default filters, no assignee filter for manager)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 0, total: 0 });
    getTaskFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const { container } = await renderServerComponent(ManagerTasksPage(sp()));

    expect(listTaskBoard).toHaveBeenCalledWith({}, SESSION, { scope: 'all', overdue: false });
    expect(getTaskFormOptions).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Задачи');
    expect(container.querySelector('[data-testid="task-board"]')).not.toBeNull();
    // Менеджер без фильтра по исполнителю (ФТ-7.3 — только руководитель).
    expect(container.querySelector('[data-testid="tasks-toolbar"]')?.textContent).toBe('null');
  });

  it('passes scope=mine and overdue=1 from searchParams to the service', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 0, total: 0 });
    getTaskFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    await renderServerComponent(ManagerTasksPage(sp({ scope: 'mine', overdue: '1' })));

    expect(listTaskBoard).toHaveBeenCalledWith({}, SESSION, { scope: 'mine', overdue: true });
  });

  it('renders the list view when view=list (ФТ-7.4)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 0, total: 0 });
    getTaskFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const { container } = await renderServerComponent(ManagerTasksPage(sp({ view: 'list' })));

    expect(container.querySelector('[data-testid="task-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="task-board"]')).toBeNull();
  });
});

// `Р-27` (В-3): доска режется по `BOARD_CAP`, открытые задачи идут первыми —
// экран честно говорит, сколько скрыто, и как сузить охват.
describe('ManagerTasksPage — подпись «Показаны первые N из M» (Р-27)', () => {
  beforeEach(() => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    getTaskFormOptions.mockResolvedValue(EMPTY_OPTIONS);
  });

  it('total > shown → подпись с подсказкой про фильтры (и в списке тоже)', async () => {
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 500, total: 812 });

    const board = await renderServerComponent(ManagerTasksPage(sp()));
    expect(board.container.textContent).toContain('Показаны первые 500 из 812.');
    expect(board.container.textContent).toContain('Открытые задачи идут первыми и не теряются');
    expect(board.container.textContent).toContain('сузьте охват фильтрами');

    const list = await renderServerComponent(ManagerTasksPage(sp({ view: 'list' })));
    expect(list.container.textContent).toContain('Показаны первые 500 из 812.');
  });

  it('total === shown → подписи нет', async () => {
    listTaskBoard.mockResolvedValue({ columns: [], board: [], shown: 7, total: 7 });

    const { container } = await renderServerComponent(ManagerTasksPage(sp()));

    expect(container.textContent).not.toContain('Показаны первые');
  });
});
