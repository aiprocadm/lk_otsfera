// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
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

import ManagerMessagesPage from '@/app/manager/messages/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

describe('ManagerMessagesPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listIncomingComments.mockReset();
    isFeatureEnabled.mockReset();
    listThreads.mockReset();
  });

  it('renders order comments only (no chat section, no UnreadBadge) when chat is disabled', async () => {
    requireManager.mockResolvedValue(SESSION);
    listIncomingComments.mockResolvedValue({ rows: [{ id: 'c1' }], nextCursor: null });
    isFeatureEnabled.mockReturnValue(false);

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
  });

  it('renders the chat section with team-scoped threads when chat is enabled and listThreads succeeds', async () => {
    requireManager.mockResolvedValue(SESSION);
    listIncomingComments.mockResolvedValue({ rows: [], nextCursor: 'c2' });
    isFeatureEnabled.mockReturnValue(true);
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
  });

  it('falls back to an empty thread list when chat is enabled but listThreads returns ok:false', async () => {
    requireManager.mockResolvedValue(SESSION);
    listIncomingComments.mockResolvedValue({ rows: [], nextCursor: null });
    isFeatureEnabled.mockReturnValue(true);
    listThreads.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      ManagerMessagesPage({ searchParams: Promise.resolve({}) })
    );

    const threadInbox = container.querySelector('[data-testid="thread-inbox"]');
    expect(threadInbox?.textContent).toContain('[]');
  });
});
