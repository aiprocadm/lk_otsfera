import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
// usePathname нужен общему сайдбару (этап 2): подсветка активного пункта.
vi.mock('next/navigation', () => ({ redirect, usePathname: () => '/partner/dashboard' }));

const { navItemsFor } = vi.hoisted(() => ({ navItemsFor: vi.fn() }));
vi.mock('@/lib/navigation/cabinet', () => ({ navItemsFor }));

const { isManagerLeader } = vi.hoisted(() => ({ isManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ isManagerLeader }));

vi.mock('next/link', () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement('a', { href: props.href, className: props.className }, props.children),
}));

vi.mock('@/components/ui', () => ({
  LogoutButton: (props: { className?: string }) =>
    React.createElement('button', { className: props.className }, 'Выйти'),
}));

vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: (props: { role: string; buttonClassName?: string }) =>
    React.createElement(
      'span',
      {
        'data-testid': 'notification-bell',
        'data-role': props.role,
        'data-button-class': props.buttonClassName,
      },
      '🔔'
    ),
}));

import { AppShell } from '@/components/dashboard/app-shell';

describe('AppShell', () => {
  beforeEach(() => {
    getSession.mockReset();
    redirect.mockReset();
    navItemsFor.mockReset();
    isManagerLeader.mockReset();
    navItemsFor.mockReturnValue([]);
    isManagerLeader.mockReturnValue(false);
  });

  it('redirects to /login when there is no session', async () => {
    getSession.mockResolvedValue(null);
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(AppShell({ children: 'content' })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('renders role label from the known map, name, and children', async () => {
    getSession.mockResolvedValue({
      sub: 'u1',
      role: 'admin',
      name: 'Иван Иванов',
      partnerRole: null,
    });
    navItemsFor.mockReturnValue([
      { href: '/admin/dashboard', label: 'Главная', iconKey: 'dashboard' },
    ]);

    const el = await AppShell({ children: React.createElement('p', null, 'дочерний контент') });
    const html = renderToString(el);

    expect(html).toContain('Администратор');
    expect(html).toContain('Иван Иванов');
    expect(html).toContain('дочерний контент');
    expect(html).toContain('Главная');
    expect(html).toContain('href="/admin/dashboard"');
  });

  it('falls back to the raw role string when unmapped', async () => {
    getSession.mockResolvedValue({ sub: 'u2', role: 'unknown-role', name: 'X' });
    navItemsFor.mockReturnValue([]);

    const el = await AppShell({ children: 'c' });
    const html = renderToString(el);

    expect(html).toContain('unknown-role');
  });

  it('renders disabled nav items with the "скоро" badge instead of a link', async () => {
    getSession.mockResolvedValue({ sub: 'u3', role: 'manager', name: 'M' });
    navItemsFor.mockReturnValue([
      { href: '/manager/team', label: 'Команда', iconKey: 'team', disabled: true },
    ]);

    const el = await AppShell({ children: 'c' });
    const html = renderToString(el);

    expect(html).toContain('скоро');
    expect(html).toContain('cursor-not-allowed');
    expect(html).not.toContain('href="/manager/team"');
  });

  it('partner session renders NotificationBell with role="partner" and dark-header hover variant', async () => {
    getSession.mockResolvedValue({ sub: 'u5', role: 'partner', name: 'P', partnerRole: null });

    const el = await AppShell({ children: 'c' });
    const html = renderToString(el);

    expect(html).toContain('data-role="partner"');
    expect(html).toContain('data-button-class="hover:bg-white/10"');
  });

  it('«Задать вопрос» показывается партнёру только при включённом флаге', async () => {
    // cabinet_questions включают явно (staged rollout). Кнопка предназначена
    // клиентским ролям кабинета — партнёру, и только когда функция раскатана.
    getSession.mockResolvedValue({ sub: 'u5', role: 'partner', name: 'P', partnerRole: null });
    const prev = process.env.FEATURE_CABINET_QUESTIONS;
    process.env.FEATURE_CABINET_QUESTIONS = '1';
    try {
      const html = renderToString(await AppShell({ children: 'c' }));
      expect(html).toContain('Задать вопрос');
    } finally {
      if (prev === undefined) delete process.env.FEATURE_CABINET_QUESTIONS;
      else process.env.FEATURE_CABINET_QUESTIONS = prev;
    }
  });

  it('non-partner session (student fallback of /student) does not render NotificationBell', async () => {
    getSession.mockResolvedValue({ sub: 'u6', role: 'student', name: 'S' });

    const el = await AppShell({ children: 'c' });
    const html = renderToString(el);

    expect(html).not.toContain('data-testid="notification-bell"');
  });

  it('passes isManagerLeader and isPartnerAdmin through to navItemsFor', async () => {
    getSession.mockResolvedValue({ sub: 'u4', role: 'manager', name: 'M', partnerRole: 'admin' });
    isManagerLeader.mockReturnValue(true);
    navItemsFor.mockReturnValue([]);

    await AppShell({ children: 'c' });

    expect(navItemsFor).toHaveBeenCalledWith('manager', {
      isManagerLeader: true,
      isPartnerAdmin: true,
    });
  });
});
