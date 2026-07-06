import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

const { navItemsFor } = vi.hoisted(() => ({ navItemsFor: vi.fn() }));
vi.mock('@/lib/navigation/cabinet', () => ({ navItemsFor }));

const { isManagerLeader } = vi.hoisted(() => ({ isManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ isManagerLeader }));

vi.mock('next/link', () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement('a', { href: props.href, className: props.className }, props.children)
}));

vi.mock('@/components/ui', () => ({
  LogoutButton: (props: { className?: string }) =>
    React.createElement('button', { className: props.className }, 'Выйти')
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
    getSession.mockResolvedValue({ sub: 'u1', role: 'admin', name: 'Иван Иванов', partnerRole: null });
    navItemsFor.mockReturnValue([{ href: '/admin/dashboard', label: 'Главная' }]);

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
    navItemsFor.mockReturnValue([{ href: '/manager/team', label: 'Команда', disabled: true }]);

    const el = await AppShell({ children: 'c' });
    const html = renderToString(el);

    expect(html).toContain('скоро');
    expect(html).toContain('cursor-not-allowed');
    expect(html).not.toContain('href="/manager/team"');
  });

  it('passes isManagerLeader and isPartnerAdmin through to navItemsFor', async () => {
    getSession.mockResolvedValue({ sub: 'u4', role: 'manager', name: 'M', partnerRole: 'admin' });
    isManagerLeader.mockReturnValue(true);
    navItemsFor.mockReturnValue([]);

    await AppShell({ children: 'c' });

    expect(navItemsFor).toHaveBeenCalledWith('manager', { isManagerLeader: true, isPartnerAdmin: true });
  });
});
