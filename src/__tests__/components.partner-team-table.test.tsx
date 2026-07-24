import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('@/components/partner/member-row-actions', () => ({
  MemberRowActions: ({ userId }: { userId: string }) =>
    React.createElement('button', { 'data-testid': `actions-${userId}` }, 'actions')
}));

// InviteResendButtons — 'use client' с server-action импортом; для SSR-string
// тестов достаточно заглушить экшен, компонент рендерим настоящий.
vi.mock('@/server-actions/invite-resend', () => ({ resendInviteAction: vi.fn() }));

import { TeamTable } from '@/components/partner/team-table';
import type { TeamRow } from '@/lib/services/partner/team';

const orgs = [
  { id: 'org1', name: 'ООО Ромашка' },
  { id: 'org2', name: 'ООО Вторая' },
  { id: 'org3', name: 'ООО Третья' },
  { id: 'org4', name: 'ООО Четвёртая' },
  { id: 'org5', name: 'ООО Пятая' }
];

function makeRow(overrides: Partial<TeamRow> = {}): TeamRow {
  return {
    userId: 'u1',
    partnerUserId: 'pu1',
    email: 'ivan@x.com',
    name: 'Иван Петров',
    roleInPartner: 'manager',
    assignedOrgIds: [],
    isActive: true,
    invitePending: false,
    createdAt: new Date('2026-01-01'),
    ...overrides
  };
}

describe('TeamTable', () => {
  it('renders the empty state when there are no rows', () => {
    const html = renderToString(React.createElement(TeamTable, { rows: [], orgs, currentUserId: 'me' }));
    expect(html).toContain('В команде пока никого нет');
  });

  it('renders an active manager row with email, role badge, scope summary ("Все организации") and actions', () => {
    const html = renderToString(
      React.createElement(TeamTable, { rows: [makeRow()], orgs, currentUserId: 'me' })
    );
    expect(html).toContain('Иван Петров');
    expect(html).toContain('ivan@x.com');
    expect(html).toContain('Менеджер');
    expect(html).toContain('Все организации');
    expect(html).toContain('data-testid="actions-u1"');
  });

  it('renders the admin role badge', () => {
    const html = renderToString(
      React.createElement(TeamTable, { rows: [makeRow({ roleInPartner: 'admin' })], orgs, currentUserId: 'me' })
    );
    expect(html).toContain('Админ');
  });

  it('marks the current user with "(вы)" and hides actions for self', () => {
    const html = renderToString(
      React.createElement(TeamTable, { rows: [makeRow({ userId: 'me' })], orgs, currentUserId: 'me' })
    );
    expect(html).toContain('(вы)');
    expect(html).not.toContain('data-testid="actions-me"');
  });

  it('dims an inactive row, shows "деактивирован", em-dash role and no actions', () => {
    const html = renderToString(
      React.createElement(TeamTable, { rows: [makeRow({ isActive: false })], orgs, currentUserId: 'me' })
    );
    expect(html).toContain('bg-gray-50/50 text-gray-400');
    expect(html).toContain('деактивирован');
    expect(html).not.toContain('data-testid="actions-u1"');
  });

  it('scope summary lists up to 2 org names', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        rows: [makeRow({ assignedOrgIds: ['org1', 'org2'] })],
        orgs,
        currentUserId: 'me'
      })
    );
    expect(html).toContain('ООО Ромашка, ООО Вторая');
  });

  it('scope summary falls back to em-dash when assigned ids do not resolve', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        rows: [makeRow({ assignedOrgIds: ['unknown'] })],
        orgs,
        currentUserId: 'me'
      })
    );
    expect(html).toContain('—');
  });

  it('scope summary shows "организации" for 3-4 assigned orgs', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        rows: [makeRow({ assignedOrgIds: ['org1', 'org2', 'org3'] })],
        orgs,
        currentUserId: 'me'
      })
    );
    expect(html).toContain('организации');
  });

  it('scope summary shows "организаций" for 5+ assigned orgs', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        rows: [makeRow({ assignedOrgIds: ['org1', 'org2', 'org3', 'org4', 'org5'] })],
        orgs,
        currentUserId: 'me'
      })
    );
    expect(html).toContain('организаций');
  });

  it('invitePending=true у активного чужого сотрудника: бейдж «Ожидает установки пароля» и кнопки переотправки', () => {
    const html = renderToString(
      React.createElement(TeamTable, { rows: [makeRow({ invitePending: true })], orgs, currentUserId: 'me' })
    );
    expect(html).toContain('Ожидает установки пароля');
    expect(html).toContain('Отправить повторно');
    expect(html).toContain('Скопировать ссылку');
  });

  it('invitePending=true у self: бейдж есть, кнопок переотправки нет', () => {
    const html = renderToString(
      React.createElement(TeamTable, { rows: [makeRow({ userId: 'me', invitePending: true })], orgs, currentUserId: 'me' })
    );
    expect(html).toContain('Ожидает установки пароля');
    expect(html).not.toContain('Отправить повторно');
    expect(html).not.toContain('Скопировать ссылку');
  });

  it('деактивированная строка с invitePending=true: ни бейджа, ни кнопок', () => {
    const html = renderToString(
      React.createElement(TeamTable, { rows: [makeRow({ invitePending: true, isActive: false })], orgs, currentUserId: 'me' })
    );
    expect(html).not.toContain('Ожидает установки пароля');
    expect(html).not.toContain('Отправить повторно');
  });

  it('invitePending=false: бейджа и кнопок переотправки нет', () => {
    const html = renderToString(
      React.createElement(TeamTable, { rows: [makeRow()], orgs, currentUserId: 'me' })
    );
    expect(html).not.toContain('Ожидает установки пароля');
    expect(html).not.toContain('Отправить повторно');
  });

  it('renders multiple rows', () => {
    const html = renderToString(
      React.createElement(TeamTable, {
        rows: [makeRow({ userId: 'u1' }), makeRow({ userId: 'u2', name: 'Второй' })],
        orgs,
        currentUserId: 'me'
      })
    );
    expect(html).toContain('Иван Петров');
    expect(html).toContain('Второй');
  });
});
