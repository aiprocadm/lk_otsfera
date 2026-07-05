// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listThreads } = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ listThreads }));

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

import AdminMessagesPage from '@/app/admin/messages/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminMessagesPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    isFeatureEnabled.mockReset();
    listThreads.mockReset();
  });

  it('shows the graceful "chat not enabled" state without UnreadBadge when chat is disabled', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    isFeatureEnabled.mockReturnValue(false);

    const { container } = await renderServerComponent(AdminMessagesPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(listThreads).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Сообщения');
    expect(container.textContent).toContain('Чат не включён');
    expect(container.querySelector('[data-testid="unread-badge"]')).toBeNull();
  });

  it('renders the team chat thread inbox when chat is enabled and listThreads succeeds', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    isFeatureEnabled.mockReturnValue(true);
    listThreads.mockResolvedValue({ ok: true, rows: [{ id: 't1' }] });

    const { container } = await renderServerComponent(AdminMessagesPage());

    expect(listThreads).toHaveBeenCalledWith({}, SESSION);
    expect(container.querySelector('[data-testid="unread-badge"]')).not.toBeNull();
    const inbox = container.querySelector('[data-testid="thread-inbox"]');
    expect(inbox?.textContent).toContain('t1');
    expect(inbox?.textContent).toContain('team');
  });

  it('falls back to an empty thread list when listThreads returns ok:false', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    isFeatureEnabled.mockReturnValue(true);
    listThreads.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(AdminMessagesPage());

    const inbox = container.querySelector('[data-testid="thread-inbox"]');
    expect(inbox?.textContent).toContain('[]');
  });
});
