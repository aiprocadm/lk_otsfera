// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

// Справочник партнёров уехал в сервис (аудит A1): страница мокает сервис,
// форма запроса проверяется в services.admin.partners.test.ts.
const { listActivePartnerOptions } = vi.hoisted(() => ({ listActivePartnerOptions: vi.fn() }));
vi.mock('@/lib/services/admin/partners', () => ({ listActivePartnerOptions }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

vi.mock('@/components/admin/user-invite-form', () => ({
  UserInviteForm: (props: { partners: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'user-invite-form' },
      JSON.stringify(props.partners)
    ),
}));

import NewUserPage from '@/app/admin/users/new/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('NewUserPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listActivePartnerOptions.mockReset();
  });

  it('requires admin, loads active partners, and renders the invite form', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listActivePartnerOptions.mockResolvedValue([{ id: 'p1', name: 'Партнёр' }]);

    const { container } = await renderServerComponent(NewUserPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(listActivePartnerOptions).toHaveBeenCalledWith(expect.anything());
    expect(container.textContent).toContain('Пригласить пользователя');
    expect(container.textContent).toContain('Партнёр');
  });
});
