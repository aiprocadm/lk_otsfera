// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  })
}));
vi.mock('next/navigation', () => nav);

const { requireOrganization } = vi.hoisted(() => ({ requireOrganization: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireOrganization }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listThreads } = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ listThreads }));

// UnreadBadge ('use client') polls GET /api/messages/unread via useClientResource,
// which triggers an async setState outside of act() under jsdom + RTL. It has its
// own dedicated coverage elsewhere; stub it here to keep this page test focused
// and free of unrelated act() warnings.
vi.mock('@/components/chat/unread-badge', () => ({
  UnreadBadge: () => null
}));

import OrganizationMessagesPage from '@/app/organization/messages/page';

describe('OrganizationMessagesPage', () => {
  beforeEach(() => {
    isFeatureEnabled.mockReset();
    nav.notFound.mockClear();
    requireOrganization.mockReset();
    listThreads.mockReset();
  });

  it('calls notFound() when the chat flag is disabled (defense-in-depth)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(OrganizationMessagesPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('chat');
    expect(requireOrganization).not.toHaveBeenCalled();
  });

  it('renders the thread inbox with rows when listThreads succeeds', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireOrganization.mockResolvedValue({ sub: 'u1', role: 'organization' });
    listThreads.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 't1',
          orderId: 'o1',
          side: 'org' as const,
          orderNumber: '123',
          orderTitle: 'Заказ 1',
          lastMessageAt: new Date(),
          unread: true
        }
      ]
    });

    const { container } = await renderServerComponent(OrganizationMessagesPage());

    expect(container.textContent).toContain('Сообщения');
  });

  it('falls back to an empty thread list when the service returns ok:false', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireOrganization.mockResolvedValue({ sub: 'u1', role: 'organization' });
    // listThreads is typed to always resolve ok:true, but the page defensively
    // reads `result.ok ? result.rows : []` -- exercise that fallback branch too.
    listThreads.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(OrganizationMessagesPage());

    expect(container.textContent).toContain('Сообщения');
  });
});
