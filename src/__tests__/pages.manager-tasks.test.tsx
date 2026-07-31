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
  getTaskFormOptions: vi.fn()
}));
vi.mock('@/lib/services/tasks/board', () => ({ listTaskBoard, getTaskFormOptions }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/tasks/task-board', () => ({
  TaskBoard: (props: { board: unknown; options: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'task-board' },
      JSON.stringify(props.board),
      JSON.stringify(props.options)
    )
}));

vi.mock('@/components/tasks/task-list', () => ({
  TaskList: () => React.createElement('div', { 'data-testid': 'task-list' })
}));

vi.mock('@/components/tasks/tasks-toolbar', () => ({
  TasksToolbar: (props: { state: unknown; assigneeOptions: unknown }) =>
    React.createElement('div', { 'data-testid': 'tasks-toolbar' }, JSON.stringify(props.assigneeOptions))
}));


const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

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
    listTaskBoard.mockResolvedValue({ columns: [], board: [] });
    getTaskFormOptions.mockResolvedValue({ users: [], organizations: [], orders: [] });

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
    listTaskBoard.mockResolvedValue({ columns: [], board: [] });
    getTaskFormOptions.mockResolvedValue({ users: [], organizations: [], orders: [] });

    await renderServerComponent(ManagerTasksPage(sp({ scope: 'mine', overdue: '1' })));

    expect(listTaskBoard).toHaveBeenCalledWith({}, SESSION, { scope: 'mine', overdue: true });
  });

  it('renders the list view when view=list (ФТ-7.4)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [], board: [] });
    getTaskFormOptions.mockResolvedValue({ users: [], organizations: [], orders: [] });

    const { container } = await renderServerComponent(ManagerTasksPage(sp({ view: 'list' })));

    expect(container.querySelector('[data-testid="task-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="task-board"]')).toBeNull();
  });
});
