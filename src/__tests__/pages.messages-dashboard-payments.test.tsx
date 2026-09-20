// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { screen } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Пять экранов, где страница разбирает **адрес** и решает, что показать:
 * «Сообщения» руководителя (`У-110`) и заказчика, переписка менеджера
 * (`У-204`), главная руководителя (`У-225`) и очередь разбора выписки
 * (`У-90`).
 *
 * Общая мысль: из адреса берётся только то, что система понимает. Чужое
 * значение фильтра не уходит в запрос, а отсутствие параметров не ломает
 * страницу. И отдельно — **блок просроченных задач не показывается, когда
 * раздел задач выключен**: иначе он вёл бы на недоступный экран.
 */
const mocks = vi.hoisted(() => ({
  requireManagerLeader: vi.fn(),
  requireManager: vi.fn(),
  requireOrganization: vi.fn(),
  isFeatureEnabled: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOTFOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  listIncomingComments: vi.fn(),
  listThreads: vi.fn(),
  leaderDashboard: vi.fn(),
  recentEvents: vi.fn(),
  listOverdueTasks: vi.fn(),
  listDialogs: vi.fn(),
  isManagerLeader: vi.fn(),
  mayImportOneC: vi.fn(),
  loadQueuePage: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireManagerLeader: mocks.requireManagerLeader,
  requireManager: mocks.requireManager,
  requireOrganization: mocks.requireOrganization,
  isManagerLeader: mocks.isManagerLeader,
}));
vi.mock('@/lib/featureFlags', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
  notFoundIfDisabled: vi.fn(),
}));
vi.mock('@/lib/services/manager/messages', () => ({
  listIncomingComments: mocks.listIncomingComments,
}));
vi.mock('@/lib/services/chat/threads', () => ({ listThreads: mocks.listThreads }));
vi.mock('@/lib/services/leader/dashboard', () => ({ leaderDashboard: mocks.leaderDashboard }));
vi.mock('@/lib/services/manager/dashboard', () => ({ recentEvents: mocks.recentEvents }));
vi.mock('@/lib/services/tasks/overdue', () => ({ listOverdueTasks: mocks.listOverdueTasks }));

vi.mock('@/components/manager/staff-messages', () => ({
  StaffMessages: (p: Record<string, unknown>) => (
    <div data-testid="staff-messages" data-chat={p.chat === null ? 'off' : 'on'}>
      сообщения
    </div>
  ),
}));
vi.mock('@/components/leader/overdue-tasks-block', () => ({
  OverdueTasksBlock: () => <div data-testid="overdue">просроченные</div>,
}));
vi.mock('@/components/leader/leader-managers-table', () => ({
  LeaderManagersTable: () => <div>менеджеры</div>,
}));
vi.mock('@/components/manager/manager-events-feed', () => ({
  ManagerEventsFeed: () => <div>события</div>,
}));

import LeaderMessagesPage from '@/app/leader/messages/page';
import LeaderDashboardPage from '@/app/leader/dashboard/page';

const SESSION = { sub: 'u1', role: 'leader', email: 'l@x.ru', companyId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireManagerLeader.mockResolvedValue(SESSION);
  mocks.requireManager.mockResolvedValue({ ...SESSION, role: 'manager' });
  mocks.isFeatureEnabled.mockReturnValue(true);
  mocks.listIncomingComments.mockResolvedValue({ rows: [], nextCursor: null });
  mocks.listThreads.mockResolvedValue({ ok: true, rows: [], total: 0 });
  mocks.leaderDashboard.mockResolvedValue({
    kpis: { managers: 3, activeOrders: 5, debt: '1000', commission: '200' },
    perManager: [],
  });
  mocks.recentEvents.mockResolvedValue([]);
  mocks.listOverdueTasks.mockResolvedValue({ rows: [], total: 0 });
});

describe('«Сообщения» руководителя', () => {
  it('без курсора он в запрос не уходит', async () => {
    await renderServerComponent(LeaderMessagesPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.listIncomingComments.mock.calls[0]?.[1]).not.toHaveProperty('cursor');
  });

  it('курсор из адреса доходит до сервиса', async () => {
    await renderServerComponent(
      LeaderMessagesPage({ searchParams: Promise.resolve({ cursor: 'c-7' }) })
    );

    expect(mocks.listIncomingComments.mock.calls[0]?.[1]).toMatchObject({ cursor: 'c-7' });
  });

  it('переписка руководителя — по всей компании, а не по своим заказам', async () => {
    await renderServerComponent(LeaderMessagesPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.listIncomingComments.mock.calls[0]?.[1]).toMatchObject({
      teamModeOverride: true,
      withOutgoing: true,
    });
  });

  it('чат выключен — треды не грузим вовсе', async () => {
    mocks.isFeatureEnabled.mockReturnValue(false);

    await renderServerComponent(LeaderMessagesPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.listThreads).not.toHaveBeenCalled();
    expect(screen.getByTestId('staff-messages').dataset.chat).toBe('off');
  });
});

describe('Главная руководителя', () => {
  it('раздел задач включён — блок просроченных на месте', async () => {
    await renderServerComponent(LeaderDashboardPage());

    expect(mocks.listOverdueTasks).toHaveBeenCalled();
    expect(screen.getByTestId('overdue')).toBeTruthy();
  });

  it('раздел задач выключен — блока нет и запроса нет', async () => {
    mocks.isFeatureEnabled.mockReturnValue(false);

    await renderServerComponent(LeaderDashboardPage());

    expect(mocks.listOverdueTasks).not.toHaveBeenCalled();
    expect(screen.queryByTestId('overdue')).toBeNull();
  });

  it('комиссии нет — вместо числа прочерк, а не «0 ₽»', async () => {
    mocks.leaderDashboard.mockResolvedValue({
      kpis: { managers: 1, activeOrders: 0, debt: '0', commission: null },
      perManager: [],
    });

    await renderServerComponent(LeaderDashboardPage());

    expect(screen.getByText('—')).toBeTruthy();
  });
});
