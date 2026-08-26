import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
// usePathname нужен общему сайдбару (этап 2): подсветка активного пункта.
vi.mock('next/navigation', () => ({
  redirect,
  usePathname: () => '/partner/dashboard',
  // Палитра Ctrl/Cmd+K (У-75) стоит в шапке каркаса и зовёт useRouter.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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

  it('шапка называет кабинет и того, кто в нём (У-115)', async () => {
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

    // `У-115`: подпись одна на все шесть кабинетов — «<Кабинет> · <кто>».
    expect(html).toContain('Кабинет администратора');
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

  it('партнёру рисуется колокольчик — и уже без тёмной подложки (У-115)', async () => {
    getSession.mockResolvedValue({ sub: 'u5', role: 'partner', name: 'P', partnerRole: null });

    const el = await AppShell({ children: 'c' });
    const html = renderToString(el);

    expect(html).toContain('data-role="partner"');
    // Подложка под чёрную шапку уехала вместе с самой чёрной шапкой.
    expect(html).not.toContain('hover:bg-white/10');
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

  it('сессия без имени — в шапке только роль, без висящей точки-разделителя', async () => {
    getSession.mockResolvedValue({ sub: 'u7', role: 'partner' });

    const html = renderToString(await AppShell({ children: 'c' }));

    expect(html).toContain('Партнёр');
    expect(html).not.toContain('·');
  });

  it('non-partner session (student fallback of /student) does not render NotificationBell', async () => {
    getSession.mockResolvedValue({ sub: 'u6', role: 'student', name: 'S' });

    const el = await AppShell({ children: 'c' });
    const html = renderToString(el);

    expect(html).not.toContain('data-testid="notification-bell"');
  });

  it('прокидывает признак руководителя в реестр меню', async () => {
    // `isPartnerAdmin` больше не передаётся: признак `partnerAdminOnly` удалён
    // этапом 9 — его не носил ни один пункт меню с этапа 4.
    getSession.mockResolvedValue({ sub: 'u4', role: 'manager', name: 'M', partnerRole: 'admin' });
    isManagerLeader.mockReturnValue(true);
    navItemsFor.mockReturnValue([]);

    await AppShell({ children: 'c' });

    expect(navItemsFor).toHaveBeenCalledWith('manager', { isManagerLeader: true });
  });
});
