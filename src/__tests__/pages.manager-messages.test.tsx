// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerMessagesPage from '@/app/manager/messages/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listIncomingComments } = vi.hoisted(() => ({ listIncomingComments: vi.fn() }));
vi.mock('@/lib/services/manager/messages', () => ({ listIncomingComments }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listThreads } = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ listThreads }));

vi.mock('@/components/manager/manager-messages-inbox', () => ({
  ManagerMessagesInbox: (props: { rows: unknown[]; nextCursor: unknown }) =>
    React.createElement('div', { 'data-testid': 'messages-inbox' }, JSON.stringify(props.rows), String(props.nextCursor))
}));

vi.mock('@/components/chat/order-thread-inbox', () => ({
  OrderThreadInbox: (props: { threads: unknown[]; currentUserId: string; variant: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'thread-inbox' },
      JSON.stringify(props.threads),
      props.currentUserId,
      props.variant
    )
}));

vi.mock('@/components/chat/unread-badge', () => ({
  UnreadBadge: () => React.createElement('span', { 'data-testid': 'unread-badge' })
}));

vi.mock('@/components/staff-chat/staff-chat-section', () => ({
  StaffChatSection: (props: { currentUserId: string }) =>
    React.createElement('div', { 'data-testid': 'staff-chat-section' }, props.currentUserId)
}));

vi.mock('@/components/staff-chat/staff-unread-badge', () => ({
  StaffUnreadBadge: () => React.createElement('span', { 'data-testid': 'staff-unread-badge' })
}));


const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

/** Per-flag control — the page now reads both 'chat' and 'staff_chat'. */
function setFlags(flags: Record<string, boolean>) {
  isFeatureEnabled.mockImplementation((flag: string) => flags[flag] ?? false);
}

describe('ManagerMessagesPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listIncomingComments.mockReset();
    isFeatureEnabled.mockReset();
    listThreads.mockReset();
  });

  it('renders order comments only (no chat section, no staff-chat section, no badges) when both flags are disabled', async () => {
    requireManager.mockResolvedValue(SESSION);
    listIncomingComments.mockResolvedValue({ rows: [{ id: 'c1' }], nextCursor: null });
    setFlags({ chat: false, staff_chat: false });

    const { container } = await renderServerComponent(
      ManagerMessagesPage({ searchParams: Promise.resolve({}) })
    );

    expect(listIncomingComments).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: SESSION, withOutgoing: true })
    );
    expect(listThreads).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Сообщения');
    expect(container.textContent).toContain('Комментарии к заказам');
    expect(container.querySelector('[data-testid="unread-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="thread-inbox"]')).toBeNull();
    expect(container.querySelector('[data-testid="staff-chat-section"]')).toBeNull();
    expect(container.querySelector('[data-testid="staff-unread-badge"]')).toBeNull();
  });

  it('renders the chat section with team-scoped threads when chat is enabled and listThreads succeeds (staff_chat off)', async () => {
    requireManager.mockResolvedValue(SESSION);
    listIncomingComments.mockResolvedValue({ rows: [], nextCursor: 'c2' });
    setFlags({ chat: true, staff_chat: false });
    listThreads.mockResolvedValue({ ok: true, rows: [{ id: 't1' }] });

    const { container } = await renderServerComponent(
      ManagerMessagesPage({ searchParams: Promise.resolve({ cursor: 'c1' }) })
    );

    expect(listIncomingComments).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ cursor: 'c1' })
    );
    expect(listThreads).toHaveBeenCalledWith({}, SESSION);
    expect(container.querySelector('[data-testid="unread-badge"]')).not.toBeNull();
    const threadInbox = container.querySelector('[data-testid="thread-inbox"]');
    expect(threadInbox).not.toBeNull();
    expect(threadInbox?.textContent).toContain('t1');
    expect(threadInbox?.textContent).toContain('team');
    expect(container.querySelector('[data-testid="staff-chat-section"]')).toBeNull();
    expect(container.querySelector('[data-testid="staff-unread-badge"]')).toBeNull();
  });

  it('falls back to an empty thread list when chat is enabled but listThreads returns ok:false', async () => {
    requireManager.mockResolvedValue(SESSION);
    listIncomingComments.mockResolvedValue({ rows: [], nextCursor: null });
    setFlags({ chat: true, staff_chat: false });
    listThreads.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      ManagerMessagesPage({ searchParams: Promise.resolve({}) })
    );

    const threadInbox = container.querySelector('[data-testid="thread-inbox"]');
    expect(threadInbox?.textContent).toContain('[]');
  });

  it('renders the staff-chat section (with badge and currentUserId) when staff_chat is enabled, independently of chat', async () => {
    requireManager.mockResolvedValue(SESSION);
    listIncomingComments.mockResolvedValue({ rows: [], nextCursor: null });
    setFlags({ chat: false, staff_chat: true });

    const { container } = await renderServerComponent(
      ManagerMessagesPage({ searchParams: Promise.resolve({}) })
    );

    expect(listThreads).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="thread-inbox"]')).toBeNull();
    expect(container.textContent).toContain('Чат команды');
    expect(container.querySelector('[data-testid="staff-unread-badge"]')).not.toBeNull();
    const staffSection = container.querySelector('[data-testid="staff-chat-section"]');
    expect(staffSection).not.toBeNull();
    expect(staffSection?.textContent).toBe('u1');
  });
});
