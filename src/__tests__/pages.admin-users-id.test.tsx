// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import EditUserPage from '@/app/admin/users/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

// Справочник партнёров уехал в сервис (аудит A1): страница мокает сервис,
// форма запроса проверяется в services.admin.partners.test.ts.
const { listActivePartnerOptions } = vi.hoisted(() => ({ listActivePartnerOptions: vi.fn() }));
vi.mock('@/lib/services/admin/partners', () => ({ listActivePartnerOptions }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/services/admin/users', () => ({ getUser }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/admin/user-edit-form', () => ({
  UserEditForm: (props: { user: unknown; partners: unknown[]; isSelf: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'user-edit-form' },
      JSON.stringify(props.user),
      JSON.stringify(props.partners),
      String(props.isSelf)
    ),
}));


const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('@/components/admin/admin-backup-codes-control', () => ({
  AdminBackupCodesControl: (props: { userId: string }) =>
    React.createElement('div', { 'data-testid': 'admin-backup-codes' }, props.userId),
}));

const SESSION = { sub: 'admin1', role: 'admin' as const };

const USER = {
  id: 'u1',
  name: 'Иван Иванов',
  email: 'ivan@x.com',
  role: 'manager',
};

describe('EditUserPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listActivePartnerOptions.mockReset();
    getUser.mockReset();
    nav.notFound.mockClear();
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(false);
  });

  it('calls notFound() when user is missing', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getUser.mockResolvedValue(null);
    listActivePartnerOptions.mockResolvedValue([]);

    await expect(
      renderServerComponent(EditUserPage({ params: Promise.resolve({ id: 'missing' }) }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('рендерит карточку менеджера БЕЗ прежнего переключателя суб-роли (ТЗ 2026-08-17: роль меняется формой)', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getUser.mockResolvedValue(USER);
    listActivePartnerOptions.mockResolvedValue([{ id: 'p1', name: 'Партнёр' }]);

    const { container } = await renderServerComponent(
      EditUserPage({ params: Promise.resolve({ id: 'u1' }) })
    );

    expect(getUser).toHaveBeenCalledWith(expect.anything(), SESSION, 'u1');
    expect(container.textContent).toContain('Иван Иванов');
    expect(container.textContent).toContain('ivan@x.com');
    expect(container.querySelector('[data-testid="manager-role-control"]')).toBeNull();
    const editForm = container.querySelector('[data-testid="user-edit-form"]');
    expect(editForm?.textContent).toContain('false');
  });

  it('sets isSelf:true when session.sub === user.id', async () => {
    requireAdmin.mockResolvedValue({ sub: 'u1', role: 'admin' as const });
    getUser.mockResolvedValue({ ...USER, role: 'admin' });
    listActivePartnerOptions.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      EditUserPage({ params: Promise.resolve({ id: 'u1' }) })
    );

    const editForm = container.querySelector('[data-testid="user-edit-form"]');
    expect(editForm?.textContent).toContain('true');
  });

  it('shows the admin backup-codes control for a staff user when staff_2fa is enabled', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getUser.mockResolvedValue(USER); // role: manager = staff
    listActivePartnerOptions.mockResolvedValue([]);
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(
      EditUserPage({ params: Promise.resolve({ id: 'u1' }) })
    );

    expect(isFeatureEnabled).toHaveBeenCalledWith('staff_2fa');
    expect(container.querySelector('[data-testid="admin-backup-codes"]')).not.toBeNull();
  });

  it('роль leader — staff: секция кодов видна (ТЗ 2026-08-17)', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getUser.mockResolvedValue({ ...USER, role: 'leader' });
    listActivePartnerOptions.mockResolvedValue([]);
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(
      EditUserPage({ params: Promise.resolve({ id: 'u1' }) })
    );

    expect(container.querySelector('[data-testid="admin-backup-codes"]')).not.toBeNull();
  });

  it('hides the backup-codes control for a non-staff user even with the flag on', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getUser.mockResolvedValue({ ...USER, role: 'organization' });
    listActivePartnerOptions.mockResolvedValue([]);
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(
      EditUserPage({ params: Promise.resolve({ id: 'u1' }) })
    );

    expect(container.querySelector('[data-testid="admin-backup-codes"]')).toBeNull();
  });

  it('у пользователя без имени в крошке стоит почта, а не пустое место (У-72)', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getUser.mockResolvedValue({ ...USER, name: null });
    listActivePartnerOptions.mockResolvedValue([]);
    isFeatureEnabled.mockReturnValue(true);

    const { container } = await renderServerComponent(
      EditUserPage({ params: Promise.resolve({ id: 'u1' }) })
    );

    expect(container.textContent).toContain('ivan@x.com');
  });
});
