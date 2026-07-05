import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/dashboard' }));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children)
}));

vi.mock('@/components/ui', () => ({
  LogoutButton: () => React.createElement('button', null, 'Выйти')
}));

import { AdminAppShell } from '@/components/admin/admin-app-shell';

describe('AdminAppShell', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
  });

  it('renders the admin email, sidebar, and children after requireAdmin resolves', async () => {
    requireAdmin.mockResolvedValue({ userId: 'u1', role: 'admin', email: 'admin@example.com' });

    const el = await AdminAppShell({ children: React.createElement('p', null, 'дочерний контент') });
    const html = renderToString(el);

    expect(html).toContain('admin@example.com');
    expect(html).toContain('дочерний контент');
    expect(html).toContain('Выйти');
    expect(html).toContain('Админ');
  });

  it('propagates a rejection from requireAdmin (e.g. redirect throw) instead of swallowing it', async () => {
    requireAdmin.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(AdminAppShell({ children: 'x' })).rejects.toThrow('NEXT_REDIRECT');
  });
});
