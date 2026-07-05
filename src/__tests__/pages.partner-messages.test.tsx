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

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

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

import PartnerMessagesPage from '@/app/partner/messages/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1' };

describe('PartnerMessagesPage', () => {
  beforeEach(() => {
    isFeatureEnabled.mockReset();
    nav.notFound.mockClear();
    requirePartner.mockReset();
    listThreads.mockReset();
  });

  it('calls notFound() when the chat flag is disabled (defense-in-depth)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(PartnerMessagesPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('chat');
    expect(requirePartner).not.toHaveBeenCalled();
  });

  it('renders the thread inbox with rows when listThreads succeeds', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requirePartner.mockResolvedValue(SESSION);
    listThreads.mockResolvedValue({
      ok: true,
      rows: [
        {
          id: 't1',
          orderId: 'o1',
          side: 'partner' as const,
          orderNumber: '123',
          orderTitle: 'Заказ 1',
          lastMessageAt: new Date(),
          unread: true
        }
      ]
    });

    const { container } = await renderServerComponent(PartnerMessagesPage());

    expect(container.textContent).toContain('Сообщения');
  });

  it('falls back to an empty thread list when the service returns ok:false', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requirePartner.mockResolvedValue(SESSION);
    listThreads.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(PartnerMessagesPage());

    expect(container.textContent).toContain('Сообщения');
  });
});
