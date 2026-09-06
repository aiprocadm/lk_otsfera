// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminMessagesPage from '@/app/admin/messages/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listThreads } = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ listThreads }));

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

const SESSION = { sub: 'admin1', role: 'admin' as const };

/** Per-flag control — the page now reads both 'chat' and 'staff_chat'. */
function setFlags(flags: Record<string, boolean>) {
  isFeatureEnabled.mockImplementation((flag: string) => flags[flag] ?? false);
}

describe('AdminMessagesPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    isFeatureEnabled.mockReset();
    listThreads.mockReset();
  });

  it('shows the graceful "chat not enabled" state without any badge when both flags are disabled', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    setFlags({ chat: false, staff_chat: false });

    const { container } = await renderServerComponent(AdminMessagesPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(listThreads).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Сообщения');
    expect(container.textContent).toContain('Чат не включён');
    expect(container.querySelector('[data-testid="unread-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="staff-chat-section"]')).toBeNull();
    expect(container.querySelector('[data-testid="staff-unread-badge"]')).toBeNull();
  });

  it('renders the team chat thread inbox when chat is enabled and listThreads succeeds (staff_chat off)', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    setFlags({ chat: true, staff_chat: false });
    listThreads.mockResolvedValue({ ok: true, rows: [{ id: 't1' }], total: 60 });

    const { container } = await renderServerComponent(AdminMessagesPage());

    expect(listThreads).toHaveBeenCalledWith({}, SESSION);
    expect(container.querySelector('[data-testid="unread-badge"]')).not.toBeNull();
    const inbox = container.querySelector('[data-testid="thread-inbox"]');
    expect(inbox?.textContent).toContain('t1');
    expect(inbox?.textContent).toContain('team');
    // `С-6`: полный счётчик доходит до списка — иначе подписи «показаны N из M» нет.
    expect(inbox?.getAttribute('data-total')).toBe('60');
    expect(container.querySelector('[data-testid="staff-chat-section"]')).toBeNull();
  });

  it('falls back to an empty thread list when listThreads returns ok:false', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    setFlags({ chat: true, staff_chat: false });
    listThreads.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(AdminMessagesPage());

    const inbox = container.querySelector('[data-testid="thread-inbox"]');
    expect(inbox?.textContent).toContain('[]');
  });

  it('renders the staff-chat section (with badge and currentUserId) when staff_chat is enabled, independently of chat', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    setFlags({ chat: false, staff_chat: true });

    const { container } = await renderServerComponent(AdminMessagesPage());

    expect(listThreads).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Чат не включён');
    expect(container.textContent).toContain('Чат команды');
    expect(container.querySelector('[data-testid="staff-unread-badge"]')).not.toBeNull();
    const staffSection = container.querySelector('[data-testid="staff-chat-section"]');
    expect(staffSection).not.toBeNull();
    expect(staffSection?.textContent).toBe('admin1');
  });
});
