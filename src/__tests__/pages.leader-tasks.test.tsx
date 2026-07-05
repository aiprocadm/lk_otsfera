// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

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

vi.mock('@/components/tasks/column-config', () => ({
  ColumnConfig: (props: { columns: unknown[]; isDefault: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'column-config' },
      String(props.isDefault),
      JSON.stringify(props.columns)
    )
}));

import LeaderTasksPage from '@/app/leader/tasks/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'leader' as const, companyId: 'c1' };

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

    await expect(renderServerComponent(LeaderTasksPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('internal_tasks');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('renders with default columns (isDefault: true when the first column id starts with "default:")', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [{ id: 'default:todo', name: 'К выполнению' }], tasks: [] });
    getTaskFormOptions.mockResolvedValue({ users: [], organizations: [], orders: [] });

    const { container } = await renderServerComponent(LeaderTasksPage());

    expect(listTaskBoard).toHaveBeenCalledWith({}, SESSION);
    expect(getTaskFormOptions).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Задачи');
    expect(container.textContent).toContain('true');
  });

  it('renders with custom columns (isDefault: false)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [{ id: 'custom-1', name: 'Своя колонка' }], tasks: [] });
    getTaskFormOptions.mockResolvedValue({ users: [], organizations: [], orders: [] });

    const { container } = await renderServerComponent(LeaderTasksPage());

    expect(container.textContent).toContain('false');
  });

  it('renders with an empty columns array (isDefault stays false, no crash on columns[0])', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listTaskBoard.mockResolvedValue({ columns: [], tasks: [] });
    getTaskFormOptions.mockResolvedValue({ users: [], organizations: [], orders: [] });

    const { container } = await renderServerComponent(LeaderTasksPage());

    expect(container.textContent).toContain('false');
  });
});
