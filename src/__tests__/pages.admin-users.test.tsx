// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminUsersPage from '@/app/admin/users/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// `У-119`: экран берёт список компаний для фильтра/формы — сервис стабим.
const { listCompanyOptions } = vi.hoisted(() => ({ listCompanyOptions: vi.fn(async () => []) }));
vi.mock('@/lib/services/admin/orders', () => ({ listCompanyOptions }));

const { listUsers } = vi.hoisted(() => ({ listUsers: vi.fn() }));
vi.mock('@/lib/services/admin/users', () => ({ listUsers }));

vi.mock('@/components/admin/users-filters', () => ({
  UsersFilters: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'users-filters' }, JSON.stringify(props)),
}));

vi.mock('@/components/admin/users-table', () => ({
  UsersTable: (props: { rows: unknown[]; currentUserId: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'users-table' },
      JSON.stringify(props.rows),
      props.currentUserId
    ),
}));

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminUsersPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listUsers.mockReset();
  });

  /**
   * `У-119`: `parseRole` не знал про `leader`, и фильтр «Руководители» молча
   * превращался во «все роли» — значение приходило из адреса и отбрасывалось.
   * Список выглядел рабочим, а показывал не то.
   */
  it('фильтр «Руководители» доезжает до сервиса, а не отбрасывается', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listUsers.mockResolvedValue({ rows: [], total: 0 });

    await renderServerComponent(
      AdminUsersPage({ searchParams: Promise.resolve({ role: 'leader', companyId: 'c1' }) })
    );

    expect(listUsers).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ role: 'leader', companyId: 'c1' })
    );
  });

  it('parses role/active/q/partnerId/organizationId/skip filters and renders the users table + total', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listUsers.mockResolvedValue({ rows: [{ id: 'u1' }], total: 1 });

    const { container } = await renderServerComponent(
      AdminUsersPage({
        searchParams: Promise.resolve({
          role: 'manager',
          active: 'true',
          q: ' test ',
          partnerId: 'p1',
          organizationId: 'o1',
          skip: '10',
        }),
      })
    );

    expect(requireAdmin).toHaveBeenCalled();
    expect(listUsers).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({
        role: 'manager',
        active: true,
        q: 'test',
        partnerId: 'p1',
        organizationId: 'o1',
        skip: 10,
        take: 50,
      })
    );
    expect(container.textContent).toContain('Пользователи');
    expect(container.textContent).toContain('1 всего');
    expect(container.querySelector('a[href="/admin/users/new"]')).not.toBeNull();
  });

  it('rejects an invalid role, parses active:false, negative skip clamps to 0', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listUsers.mockResolvedValue({ rows: [], total: 0 });

    await renderServerComponent(
      AdminUsersPage({
        searchParams: Promise.resolve({ role: 'bogus', active: 'false', skip: '-5' }),
      })
    );

    expect(listUsers).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ role: undefined, active: false, skip: 0 })
    );
  });

  it('leaves active undefined for any other value and renders the paginator mid-set with both links', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listUsers.mockResolvedValue({ rows: [], total: 200 });

    const { container } = await renderServerComponent(
      AdminUsersPage({ searchParams: Promise.resolve({ skip: '50', q: 'abc' }) })
    );

    expect(listUsers).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ active: undefined })
    );
    const links = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.textContent === 'Назад' || a.textContent === 'Вперёд'
    );
    expect(links.length).toBe(2);
    const back = links.find((a) => a.textContent === 'Назад')?.getAttribute('href');
    expect(back).toContain('q=abc');
    expect(back).not.toContain('skip=');
    const forward = links.find((a) => a.textContent === 'Вперёд')?.getAttribute('href');
    expect(forward).toContain('skip=100');
  });

  it('renders a bare "Назад" link (no querystring) when it points back to skip=0 with no other filters', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listUsers.mockResolvedValue({ rows: [], total: 200 });

    const { container } = await renderServerComponent(
      AdminUsersPage({ searchParams: Promise.resolve({ skip: '50' }) })
    );

    const back = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'Назад');
    expect(back?.getAttribute('href')).toBe('/admin/users');
  });

  it('omits the paginator when total <= PAGE_SIZE', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listUsers.mockResolvedValue({ rows: [], total: 1 });

    const { container } = await renderServerComponent(
      AdminUsersPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).not.toContain('Страница');
  });
});
