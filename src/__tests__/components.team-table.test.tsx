import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('@/server-actions/organization/team', () => ({
  updateOrgMemberRoleFormAction: vi.fn(),
  deactivateOrgMemberFormAction: vi.fn(),
  reactivateOrgMemberFormAction: vi.fn()
}));

// InviteResendButtons — 'use client' с server-action импортом; для SSR-string
// тестов достаточно заглушить экшен, компонент рендерим настоящий.
vi.mock('@/server-actions/invite-resend', () => ({ resendInviteAction: vi.fn() }));

import { TeamTable } from '@/components/organization/team-table';
import type { OrgMemberRow } from '@/lib/services/organization/team';

function member(overrides: Partial<OrgMemberRow> = {}): OrgMemberRow {
  return {
    organizationUserId: 'ou1',
    userId: 'u1',
    email: 'user@x.com',
    name: 'Иван Иванов',
    roleInOrg: 'member',
    isActive: true,
    invitePending: false,
    invitedAt: new Date('2026-01-01'),
    lastLoginAt: null,
    ...overrides
  };
}

describe('TeamTable', () => {
  it('renders the empty state when there are no members', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('В команде пока нет участников');
  });

  it('marks the current user row as "(это вы)" and hides action controls for self', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'me' })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('(это вы)');
    expect(html).not.toContain('Деактивировать');
  });

  it('active member row shows Активен status and role-update/deactivate controls for another user', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'other', roleInOrg: 'member', isActive: true })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('Активен');
    expect(html).toContain('Деактивировать');
    expect(html).not.toContain('Возобновить');
  });

  it('inactive member row shows Деактивирован status and a Возобновить control', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'other', isActive: false })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('Деактивирован');
    expect(html).toContain('Возобновить');
    // Role-update form is gated on isActive — an inactive row has no role select.
    expect(html).not.toContain('Применить');
  });

  it('an admin viewer sees the admin role option in the role select', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'other', roleInOrg: 'member' })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('Администратор');
  });

  it('a leader viewer cannot manage an admin row (canManageTarget=false) and sees only a dash', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'other', roleInOrg: 'admin', isActive: true })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'leader'
      })
    );
    expect(html).not.toContain('Деактивировать');
    expect(html).not.toContain('Возобновить');
    expect(html).not.toContain('<option value="admin">');
  });

  it('a leader viewer CAN manage a non-admin row (canManageTarget=true) but never sees the admin option', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'other', roleInOrg: 'leader', isActive: true })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'leader'
      })
    );
    expect(html).toContain('Деактивировать');
    expect(html).not.toContain('Администратор');
  });

  it('invitePending=true у активного чужого участника: бейдж «Ожидает установки пароля» и кнопки переотправки', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'other', invitePending: true })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('Ожидает установки пароля');
    expect(html).toContain('Отправить повторно');
    expect(html).toContain('Скопировать ссылку');
  });

  it('invitePending=true у self: бейдж есть, кнопок переотправки нет', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'me', invitePending: true })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('Ожидает установки пароля');
    expect(html).not.toContain('Отправить повторно');
    expect(html).not.toContain('Скопировать ссылку');
  });

  it('leader-зритель не видит кнопок переотправки у admin-строки (canManageTarget=false), но бейдж видит', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'other', roleInOrg: 'admin', invitePending: true })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'leader'
      })
    );
    expect(html).toContain('Ожидает установки пароля');
    expect(html).not.toContain('Отправить повторно');
  });

  it('деактивированная строка с invitePending=true: ни бейджа, ни кнопок', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'other', invitePending: true, isActive: false })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).not.toContain('Ожидает установки пароля');
    expect(html).not.toContain('Отправить повторно');
  });

  it('invitePending=false: бейджа и кнопок переотправки нет', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [member({ userId: 'other' })],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).not.toContain('Ожидает установки пароля');
    expect(html).not.toContain('Отправить повторно');
  });

  it('renders each role label correctly (admin/leader/member)', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        members: [
          member({ organizationUserId: 'a', userId: 'a', roleInOrg: 'admin' }),
          member({ organizationUserId: 'l', userId: 'l', roleInOrg: 'leader' }),
          member({ organizationUserId: 'm', userId: 'm', roleInOrg: 'member' })
        ],
        organizationId: 'org1',
        currentUserId: 'me',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('>Администратор<');
    expect(html).toContain('>Руководитель<');
    expect(html).toContain('>Сотрудник<');
  });
});
