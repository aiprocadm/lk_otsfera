// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

const { partnerFindMany } = vi.hoisted(() => ({ partnerFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { partner: { findMany: partnerFindMany } },
}));

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
    partnerFindMany.mockReset();
  });

  it('requires admin, loads active partners, and renders the invite form', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    partnerFindMany.mockResolvedValue([{ id: 'p1', name: 'Партнёр' }]);

    const { container } = await renderServerComponent(NewUserPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(partnerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } })
    );
    expect(container.textContent).toContain('Пригласить пользователя');
    expect(container.textContent).toContain('Партнёр');
  });
});
