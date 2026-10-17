// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerMessagesPage from '@/app/manager/messages/page';
import ManagerMessagesChatsPage from '@/app/manager/messages/chats/page';
import ManagerMessagesTeamPage from '@/app/manager/messages/team/page';
import LeaderMessagesPage from '@/app/leader/messages/page';
import LeaderMessagesChatsPage from '@/app/leader/messages/chats/page';
import LeaderMessagesTeamPage from '@/app/leader/messages/team/page';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * «Сообщения» сотрудника — три подраздела (этап 7 ТЗ 13.10.2026, `У-313`):
 * «Комментарии по заказам» (по умолчанию), «Чаты с клиентами» (`chat`),
 * «Чаты команды» (`staff_chat`). У менеджера и руководителя одинаково
 * (правило зеркала); подраздел без флага отвечает 404 и пропадает из вкладок.
 */
const { requireManager, requireManagerLeader } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager, requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listIncomingComments } = vi.hoisted(() => ({ listIncomingComments: vi.fn() }));
vi.mock('@/lib/services/manager/messages', () => ({ listIncomingComments }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listThreads } = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ listThreads }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/manager/manager-messages-inbox', () => ({
  ManagerMessagesInbox: (props: { rows: unknown[]; nextCursor: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'messages-inbox' },
      JSON.stringify(props.rows),
      String(props.nextCursor)
    ),
}));
vi.mock('@/components/chat/order-thread-inbox', () => ({
  OrderThreadInbox: (props: {
    threads: unknown[];
    total?: number;
    currentUserId: string;
    variant: string;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'thread-inbox', 'data-total': props.total },
      JSON.stringify(props.threads),
      props.currentUserId,
      props.variant
    ),
}));
vi.mock('@/components/chat/unread-badge', () => ({
  UnreadBadge: () => React.createElement('span', { 'data-testid': 'unread-badge' }),
}));
vi.mock('@/components/staff-chat/staff-chat-section', () => ({
  StaffChatSection: (props: { currentUserId: string }) =>
    React.createElement('div', { 'data-testid': 'staff-chat-section' }, props.currentUserId),
}));
vi.mock('@/components/staff-chat/staff-unread-badge', () => ({
  StaffUnreadBadge: () => React.createElement('span', { 'data-testid': 'staff-unread-badge' }),
}));

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

function setFlags(flags: Record<string, boolean>) {
  isFeatureEnabled.mockImplementation((flag: string) => flags[flag] ?? false);
}

const tabs = (c: HTMLElement) =>
  [...c.querySelectorAll('nav[aria-label="Подразделы сообщений"] a')].map((a) => [
    a.textContent,
    a.getAttribute('href'),
    a.getAttribute('aria-current'),
  ]);

const CABINETS = [
  {
    cab: 'manager',
    guard: requireManager,
    comments: ManagerMessagesPage,
    chats: ManagerMessagesChatsPage,
    team: ManagerMessagesTeamPage,
    teamMode: undefined,
  },
  {
    cab: 'leader',
    guard: requireManagerLeader,
    comments: LeaderMessagesPage,
    chats: LeaderMessagesChatsPage,
    team: LeaderMessagesTeamPage,
    teamMode: true,
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(SESSION);
  requireManagerLeader.mockResolvedValue({ ...SESSION, role: 'leader' });
  listIncomingComments.mockResolvedValue({ rows: [{ id: 'c1' }], nextCursor: 'n1' });
});

describe.each(CABINETS)('«Сообщения» ($cab)', ({ cab, guard, comments, chats, team, teamMode }) => {
  it('«Комментарии по заказам» — по умолчанию; чат не грузится; три вкладки при всех флагах', async () => {
    setFlags({ chat: true, staff_chat: true });
    const { container } = await renderServerComponent(
      comments({ searchParams: Promise.resolve({ cursor: 'x1' }) })
    );
    expect(guard).toHaveBeenCalled();
    expect(listIncomingComments).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ withOutgoing: true, cursor: 'x1' })
    );
    expect(listIncomingComments.mock.calls[0]![1].teamModeOverride).toBe(teamMode);
    expect(listThreads).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="messages-inbox"]')?.textContent).toBe(
      '[{"id":"c1"}]n1'
    );
    expect(container.querySelector('[data-testid="thread-inbox"]')).toBeNull();
    expect(container.querySelector('[data-testid="staff-chat-section"]')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toContain('Сообщения');
    expect(tabs(container)).toEqual([
      ['Комментарии по заказам', `/${cab}/messages`, 'page'],
      ['Чаты с клиентами', `/${cab}/messages/chats`, null],
      ['Чаты команды', `/${cab}/messages/team`, null],
    ]);
  });

  it('без курсора он в запрос не уходит; оба флага выключены — вкладок нет', async () => {
    setFlags({});
    const { container } = await renderServerComponent(
      comments({ searchParams: Promise.resolve({}) })
    );
    expect(listIncomingComments.mock.calls[0]![1]).not.toHaveProperty('cursor');
    expect(tabs(container)).toEqual([]);
  });

  it('«Чаты с клиентами»: без флага chat — 404 до входа; с флагом — треды и счётчик', async () => {
    setFlags({});
    await expect(renderServerComponent(chats())).rejects.toThrow('NOT_FOUND');
    expect(guard).not.toHaveBeenCalled();

    setFlags({ chat: true });
    listThreads.mockResolvedValue({ ok: true, rows: [{ id: 't1' }], total: 7 });
    const { container } = await renderServerComponent(chats());
    const inbox = container.querySelector('[data-testid="thread-inbox"]');
    expect(inbox?.getAttribute('data-total')).toBe('7');
    expect(inbox?.textContent).toBe('[{"id":"t1"}]u1team');
    expect(container.querySelector('[data-testid="unread-badge"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="messages-inbox"]')).toBeNull();
    // Без staff_chat вкладки «Чаты команды» нет.
    expect(tabs(container).map((t) => t[0])).toEqual([
      'Комментарии по заказам',
      'Чаты с клиентами',
    ]);
  });

  it('«Чаты с клиентами»: сервис отказал — пустой список, а не падение', async () => {
    setFlags({ chat: true });
    listThreads.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(chats());
    const inbox = container.querySelector('[data-testid="thread-inbox"]');
    expect(inbox?.getAttribute('data-total')).toBe('0');
    expect(inbox?.textContent).toBe('[]u1team');
  });

  it('«Чаты команды»: без флага staff_chat — 404 до входа; с флагом — чат и счётчик', async () => {
    setFlags({});
    await expect(renderServerComponent(team())).rejects.toThrow('NOT_FOUND');
    expect(guard).not.toHaveBeenCalled();

    setFlags({ staff_chat: true });
    const { container } = await renderServerComponent(team());
    expect(container.querySelector('[data-testid="staff-chat-section"]')?.textContent).toBe('u1');
    expect(container.querySelector('[data-testid="staff-unread-badge"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="unread-badge"]')).toBeNull();
    expect(tabs(container).find((t) => t[2] === 'page')?.[0]).toBe('Чаты команды');
  });
});
