/**
 * Layout'ы кабинетов сотрудников после схлопывания шеллов (`У-11`, этап 2).
 *
 * Заменяет `components.{admin,manager,leader}-app-shell.test.tsx`: собственных
 * шеллов больше нет, роль-специфичное собирается прямо в layout и передаётся
 * пропсами в общий каркас. Проверяется то же, что и раньше: гард вызван, шапка
 * своя, колокольчик своей роли, «Настройки» фильтруются по правам.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

const guards = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => guards);

const { hasAnySettingsAccess } = vi.hoisted(() => ({ hasAnySettingsAccess: vi.fn(() => true) }));
vi.mock('@/lib/auth/settingsAccess', () => ({ hasAnySettingsAccess }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(() => true) }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound, usePathname: () => '/admin/dashboard' }));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('@/components/ui', () => ({
  LogoutButton: () => React.createElement('button', null, 'Выйти'),
}));
vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: (props: { role: string }) =>
    React.createElement('span', { 'data-testid': 'bell', 'data-role': props.role }, '🔔'),
}));
vi.mock('@/components/navigation/nav-badge', () => ({
  NavBadge: () => React.createElement('span', null, '!'),
}));

import AdminLayout from '@/app/admin/layout';
import ManagerLayout from '@/app/manager/layout';
import LeaderLayout from '@/app/leader/layout';

const CHILD = React.createElement('p', null, 'дочерний контент');

beforeEach(() => {
  vi.clearAllMocks();
  hasAnySettingsAccess.mockReturnValue(true);
  isFeatureEnabled.mockReturnValue(true);
});

describe('AdminLayout', () => {
  it('рендерит почту админа, меню и контент после requireAdmin', async () => {
    guards.requireAdmin.mockResolvedValue({ sub: 'u1', role: 'admin', email: 'admin@example.com' });

    const html = renderToString(await AdminLayout({ children: CHILD }));

    expect(guards.requireAdmin).toHaveBeenCalled();
    expect(html).toContain('admin@example.com');
    expect(html).toContain('дочерний контент');
    expect(html).toContain('Админ');
    expect(html).toContain('Выйти');
  });

  it('колокольчик — с ролью admin', async () => {
    guards.requireAdmin.mockResolvedValue({ sub: 'u1', role: 'admin', email: 'a@b.c' });
    expect(renderToString(await AdminLayout({ children: CHILD }))).toContain('data-role="admin"');
  });

  it('без прав ни на один раздел пункт «Настройки» из меню исчезает', async () => {
    guards.requireAdmin.mockResolvedValue({ sub: 'u1', role: 'admin', email: 'a@b.c' });
    hasAnySettingsAccess.mockReturnValue(false);

    const html = renderToString(await AdminLayout({ children: CHILD }));
    expect(html).not.toContain('admin-nav--admin-settings');
  });
});

describe('ManagerLayout', () => {
  it('рендерит шапку кабинета менеджера и колокольчик manager', async () => {
    guards.requireManager.mockResolvedValue({ sub: 'm1', role: 'manager', email: 'm@b.c' });

    const html = renderToString(await ManagerLayout({ children: CHILD }));

    expect(guards.requireManager).toHaveBeenCalled();
    expect(html).toContain('Кабинет менеджера');
    expect(html).toContain('m@b.c');
    expect(html).toContain('data-role="manager"');
    expect(html).toContain('дочерний контент');
  });

  it('без почты в сессии шапка не ломается', async () => {
    guards.requireManager.mockResolvedValue({ sub: 'm1', role: 'manager' });
    const html = renderToString(await ManagerLayout({ children: CHILD }));
    expect(html).toContain('Кабинет менеджера');
  });
});

describe('LeaderLayout', () => {
  it('рендерит шапку руководителя; колокольчик — менеджерский (scope тот же)', async () => {
    guards.requireManagerLeader.mockResolvedValue({ sub: 'l1', role: 'manager', email: 'l@b.c' });

    const html = renderToString(await LeaderLayout({ children: CHILD }));

    expect(html).toContain('Кабинет руководителя');
    expect(html).toContain('data-role="manager"');
    expect(html).toContain('Руководитель');
  });

  it('при выключенном флаге leader_cabinet — 404 (третья точка гейтинга)', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(LeaderLayout({ children: CHILD })).rejects.toThrow('NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
    expect(guards.requireManagerLeader).not.toHaveBeenCalled();
  });

  // Переехало из cov.gap-components-misc (там это проверялось на LeaderAppShell,
  // которого больше нет): ТЗ 2026-08-04 §5.2 — нет доступа ни к одному разделу,
  // нет и пункта «Настройки».
  it('оставляет «Настройки», когда доступен хотя бы один раздел', async () => {
    const session = { sub: 'l1', role: 'manager', managerRole: 'leader' };
    guards.requireManagerLeader.mockResolvedValue(session);
    hasAnySettingsAccess.mockReturnValue(true);

    const html = renderToString(await LeaderLayout({ children: CHILD }));

    // Право спрашивается именно для кабинета руководителя.
    expect(hasAnySettingsAccess).toHaveBeenCalledWith(session, 'leader');
    expect(html).toContain('href="/leader/settings"');
  });

  it('убирает «Настройки», когда не доступен ни один раздел (остальное меню цело)', async () => {
    guards.requireManagerLeader.mockResolvedValue({
      sub: 'l1',
      role: 'manager',
      managerRole: 'leader',
    });
    hasAnySettingsAccess.mockReturnValue(false);

    const html = renderToString(await LeaderLayout({ children: CHILD }));

    expect(html).not.toContain('href="/leader/settings"');
    // Проверка спрашивается только у пункта настроек — остальные не фильтруются.
    expect(hasAnySettingsAccess).toHaveBeenCalledTimes(1);
    expect(html).toContain('href="/leader/dashboard"');
  });
});
