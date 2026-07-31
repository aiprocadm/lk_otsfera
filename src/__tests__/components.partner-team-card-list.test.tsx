import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('@/components/partner/member-row-actions', () => ({
  MemberRowActions: ({ userId }: { userId: string }) =>
    React.createElement('button', { 'data-testid': `actions-${userId}` }, 'actions'),
}));

// InviteResendButtons — 'use client' с server-action импортом; для SSR-string
// тестов достаточно заглушить экшен, компонент рендерим настоящий.
vi.mock('@/server-actions/invite-resend', () => ({ resendInviteAction: vi.fn() }));

import { TeamCardList } from '@/components/partner/team-card-list';
import type { TeamRow } from '@/lib/services/partner/team';

const orgs = [
  { id: 'org1', name: 'ООО Ромашка' },
  { id: 'org2', name: 'ООО Вторая' },
  { id: 'org3', name: 'ООО Третья' },
  { id: 'org4', name: 'ООО Четвёртая' },
  { id: 'org5', name: 'ООО Пятая' },
  { id: 'org6', name: 'ООО Шестая' },
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
    lastLoginAt: null,
    ...overrides,
  };
}

describe('TeamCardList', () => {
  it('renders null (nothing) when rows is empty', () => {
    const html = renderToString(
      React.createElement(TeamCardList, { rows: [], orgs, currentUserId: 'me' })
    );
    expect(html).toBe('');
  });

  it('renders active member with manager badge and scope summary ("все организации")', () => {
    const html = renderToString(
      React.createElement(TeamCardList, { rows: [makeRow()], orgs, currentUserId: 'me' })
    );
    expect(html).toContain('Иван Петров');
    expect(html).toContain('ivan@x.com');
    expect(html).toContain('Менеджер');
    expect(html).toContain('Доступ: все организации');
  });

  it('renders admin role badge for roleInPartner=admin', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ roleInPartner: 'admin' })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('Админ');
  });

  it('marks the current user with "(вы)" and omits the actions button for self', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ userId: 'me' })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('(вы)');
    expect(html).not.toContain('data-testid="actions-me"');
  });

  it('renders the deactivated label and dims the row for inactive members, omitting the actions button', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ isActive: false })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('opacity-60');
    expect(html).toContain('деактивирован');
    expect(html).not.toContain('data-testid="actions-u1"');
  });

  it('renders MemberRowActions for an active non-self member', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ userId: 'other' })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('data-testid="actions-other"');
  });

  it('scope summary lists up to 2 org names when 1-2 orgs assigned', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ assignedOrgIds: ['org1', 'org2'] })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('ООО Ромашка, ООО Вторая');
  });

  it('scope summary falls back to em-dash when assigned org ids do not resolve to known orgs', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ assignedOrgIds: ['unknown1', 'unknown2'] })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('Доступ: <!-- -->—');
  });

  it('scope summary shows a count with "организации" for 3-4 assigned orgs', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ assignedOrgIds: ['org1', 'org2', 'org3'] })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('3');
    expect(html).toContain('организации');
  });

  it('scope summary shows a count with "организаций" for 5+ assigned orgs', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ assignedOrgIds: ['org1', 'org2', 'org3', 'org4', 'org5'] })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('5');
    expect(html).toContain('организаций');
  });

  // ФТ-10.2 (этап 4): мобильная карточка тоже показывает переотправку приглашения.
  it('invitePending у чужого активного: бейдж «Ожидает установки пароля» и кнопки', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ userId: 'other', invitePending: true })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('Ожидает установки пароля');
    expect(html).toContain('Отправить повторно');
    expect(html).toContain('Скопировать ссылку');
  });

  it('invitePending у себя: бейдж есть, кнопок нет', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ userId: 'me', invitePending: true })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('Ожидает установки пароля');
    expect(html).not.toContain('Отправить повторно');
  });

  // ФТ-11.3 (этап 9): мобильное зеркало колонки «Последний вход».
  // Дата фикстуры намеренно в прошлом — иначе форматтер отдал бы «сегодня, HH:mm»
  // в тот единственный день, когда прогон совпал бы с датой фикстуры.
  it('строка «Последний вход» с отформатированной датой', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ lastLoginAt: new Date('2025-11-05T10:00:00Z') })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('Последний вход: <!-- -->05.11.2025');
  });

  it('сотрудник ни разу не входил (lastLoginAt=null): в строке прочерк', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ lastLoginAt: null })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).toContain('Последний вход: <!-- -->—');
  });

  it('деактивированный с invitePending: ни бейджа, ни кнопок', () => {
    const html = renderToString(
      React.createElement(TeamCardList, {
        rows: [makeRow({ userId: 'other', invitePending: true, isActive: false })],
        orgs,
        currentUserId: 'me',
      })
    );
    expect(html).not.toContain('Ожидает установки пароля');
    expect(html).not.toContain('Отправить повторно');
  });
});
