// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
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

import ManagerTasksPage from '@/app/manager/tasks/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

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

    await expect(renderServerComponent(ManagerTasksPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('internal_tasks');
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('renders the task board when the flag is enabled', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [], tasks: [] });
    getTaskFormOptions.mockResolvedValue({ users: [], organizations: [], orders: [] });

    const { container } = await renderServerComponent(ManagerTasksPage());

    expect(listTaskBoard).toHaveBeenCalledWith({}, SESSION);
    expect(getTaskFormOptions).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Задачи');
  });
});
