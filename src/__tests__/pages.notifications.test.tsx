// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Шесть страниц «Уведомления» (`У-228`, `Р-Э5-1`) — зеркало по правилу §0.2.
 *
 * Проверяется то, что ломается тихо: флаг закрывает страницу целиком, гард
 * роли зовётся, фильтры из адреса доезжают до сервиса, а экран получает адрес
 * СВОЕГО кабинета — иначе «Отметить все» сбросит кэш чужого раздела.
 */

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { requireAdmin, requireManager, requireManagerLeader, requirePartner } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
  requirePartner: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireAdmin,
  requireManager,
  requireManagerLeader,
  requirePartner,
}));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { listNotificationsPage } = vi.hoisted(() => ({ listNotificationsPage: vi.fn() }));
vi.mock('@/lib/services/notifications/inbox', () => ({ listNotificationsPage }));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-shell' }, props.children),
}));
vi.mock('@/components/dashboard/app-shell', () => ({
  AppShell: (props: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'app-shell' }, props.children),
}));
vi.mock('@/components/notifications/notifications-screen', () => ({
  NotificationsScreen: (props: {
    role: string;
    basePath: string;
    homeHref: string;
    unreadOnly: boolean;
    group: string | null;
    type: string | null;
    total: number;
    groupOptions: unknown[];
  }) =>
    React.createElement('div', {
      'data-testid': 'screen',
      'data-role': props.role,
      'data-base': props.basePath,
      'data-home': props.homeHref,
      'data-unread': String(props.unreadOnly),
      'data-group': props.group ?? '',
      'data-type': props.type ?? '',
      'data-groups': JSON.stringify(props.groupOptions),
      'data-total': String(props.total),
    }),
}));

import AdminPage from '@/app/admin/notifications/page';
import LeaderPage from '@/app/leader/notifications/page';
import ManagerPage from '@/app/manager/notifications/page';
import PartnerPage from '@/app/partner/notifications/page';
import OrganizationPage from '@/app/organization/notifications/page';
import StudentPage from '@/app/student/notifications/page';

const DATA = {
  ok: true,
  rows: [],
  total: 3,
  unreadTotal: 1,
  page: 1,
  pageSize: 50,
  groupOptions: [{ key: 'tasks', label: 'Задачи', types: ['task_assigned'] }],
  group: 'tasks',
  type: null,
};

const sp = (q: Record<string, string> = {}) => Promise.resolve(q);
const screen = (c: HTMLElement) => c.querySelector('[data-testid="screen"]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  listNotificationsPage.mockResolvedValue(DATA);
  requireAdmin.mockResolvedValue({ sub: 'a', role: 'admin' });
  requireManager.mockResolvedValue({ sub: 'm', role: 'manager', companyId: 'co' });
  requireManagerLeader.mockResolvedValue({ sub: 'l', role: 'leader', companyId: 'co' });
  requirePartner.mockResolvedValue({ sub: 'p', role: 'partner', partnerId: 'p1' });
  getSession.mockResolvedValue({ sub: 's', role: 'student' });
  getOrgPageContext.mockResolvedValue({
    session: { sub: 'o', role: 'organization', organizationId: 'org1' },
    activeOrgName: 'Альфа',
    memberships: [],
    activeOrgId: 'org1',
    viewerRole: 'admin',
  });
});

const CABINETS: Array<{
  name: string;
  Page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
  role: string;
  guard: () => ReturnType<typeof vi.fn>;
}> = [
  { name: 'admin', Page: AdminPage, role: 'admin', guard: () => requireAdmin },
  { name: 'leader', Page: LeaderPage, role: 'leader', guard: () => requireManagerLeader },
  { name: 'manager', Page: ManagerPage, role: 'manager', guard: () => requireManager },
  { name: 'partner', Page: PartnerPage, role: 'partner', guard: () => requirePartner },
];

describe.each(CABINETS)('страница «Уведомления» — $name', ({ Page, role, guard }) => {
  it('без флага — 404, гард и сервис не зовутся', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(Page({ searchParams: sp() })).rejects.toThrow('NOTFOUND');
    expect(guard()).not.toHaveBeenCalled();
    expect(listNotificationsPage).not.toHaveBeenCalled();
  });

  it('гард роли зовётся, экран получает адрес СВОЕГО кабинета', async () => {
    const { container } = await renderServerComponent(await Page({ searchParams: sp() }));
    expect(guard()).toHaveBeenCalled();
    const el = screen(container);
    expect(el.getAttribute('data-role')).toBe(role);
    expect(el.getAttribute('data-base')).toBe(`/${role}/notifications`);
    expect(el.getAttribute('data-home')).toBe(`/${role}`);
    expect(el.getAttribute('data-total')).toBe('3');
    // `У-348`: группы и применённая группа — из сервиса, страница их не пересчитывает.
    expect(el.getAttribute('data-group')).toBe('tasks');
    expect(JSON.parse(el.getAttribute('data-groups') ?? '[]')).toEqual(DATA.groupOptions);
  });

  it('фильтры из адреса доезжают до сервиса', async () => {
    await renderServerComponent(
      await Page({
        searchParams: sp({ unread: '1', group: 'tasks', type: 'task_assigned', page: '2' }),
      })
    );
    expect(listNotificationsPage.mock.calls[0][2]).toEqual({
      unread: true,
      group: 'tasks',
      type: 'task_assigned',
      page: 2,
    });
  });
});

describe('страница «Уведомления» — заказчик', () => {
  it('без флага — 404', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(OrganizationPage({ searchParams: sp() })).rejects.toThrow('NOTFOUND');
  });

  it('оболочка организации, сессия из контекста организации', async () => {
    const { container } = await renderServerComponent(
      await OrganizationPage({ searchParams: sp() })
    );
    expect(container.querySelector('[data-testid="org-shell"]')).toBeTruthy();
    expect(listNotificationsPage.mock.calls[0][1]).toMatchObject({ role: 'organization' });
    expect(screen(container).getAttribute('data-base')).toBe('/organization/notifications');
  });
});

describe('страница «Уведомления» — слушатель', () => {
  it('без флага — 404; без сессии — 404', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(StudentPage({ searchParams: sp() })).rejects.toThrow('NOTFOUND');
    isFeatureEnabled.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    await expect(StudentPage({ searchParams: sp() })).rejects.toThrow('NOTFOUND');
  });

  it('слушатель — общий шелл; страница есть ради зеркала, даже когда всегда пуста', async () => {
    const { container } = await renderServerComponent(await StudentPage({ searchParams: sp() }));
    expect(container.querySelector('[data-testid="app-shell"]')).toBeTruthy();
    expect(screen(container).getAttribute('data-role')).toBe('student');
  });

  it('орг-пользователь на /student остаётся в оболочке организации', async () => {
    getSession.mockResolvedValue({ sub: 'o', role: 'organization', organizationId: 'org1' });
    const { container } = await renderServerComponent(await StudentPage({ searchParams: sp() }));
    expect(container.querySelector('[data-testid="org-shell"]')).toBeTruthy();
  });
});
