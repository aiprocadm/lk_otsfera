// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listDocuments, listManagerOrderLessDocuments } = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listManagerOrderLessDocuments: vi.fn(),
}));
vi.mock('@/lib/services/manager/documents', () => ({
  listDocuments,
  listManagerOrderLessDocuments,
}));

const { listManagerCounterparties } = vi.hoisted(() => ({ listManagerCounterparties: vi.fn() }));
vi.mock('@/lib/services/manager/counterparties', () => ({ listManagerCounterparties }));

const { listIncomingComments } = vi.hoisted(() => ({ listIncomingComments: vi.fn() }));
vi.mock('@/lib/services/manager/messages', () => ({ listIncomingComments }));

const { listThreads } = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ listThreads }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('@/components/partner/documents-list', () => ({
  DocumentsList: (props: { cardHrefBase?: string }) =>
    React.createElement('div', { 'data-testid': 'documents-list' }, props.cardHrefBase),
}));
vi.mock('@/components/manager/manager-order-less-upload-form', () => ({
  ManagerOrderLessUploadForm: () => React.createElement('div', { 'data-testid': 'upload-form' }),
}));
vi.mock('@/components/manager/manager-messages-inbox', () => ({
  ManagerMessagesInbox: () => React.createElement('div', { 'data-testid': 'messages-inbox' }),
}));
vi.mock('@/components/chat/order-thread-inbox', () => ({
  OrderThreadInbox: () => React.createElement('div', { 'data-testid': 'thread-inbox' }),
}));
vi.mock('@/components/chat/unread-badge', () => ({
  UnreadBadge: () => React.createElement('span', { 'data-testid': 'unread' }),
}));
vi.mock('@/components/staff-chat/staff-chat-section', () => ({
  StaffChatSection: () => React.createElement('div', { 'data-testid': 'staff-chat' }),
}));
vi.mock('@/components/staff-chat/staff-unread-badge', () => ({
  StaffUnreadBadge: () => React.createElement('span'),
}));

import LeaderDocumentsPage from '@/app/leader/documents/page';
import LeaderMessagesPage from '@/app/leader/messages/page';

const LEADER = { sub: 'l1', role: 'leader' as const, companyId: 'c1' };

beforeEach(() => {
  requireManagerLeader.mockReset().mockResolvedValue(LEADER);
  listDocuments.mockReset().mockResolvedValue({ rows: [], nextCursor: null });
  listManagerOrderLessDocuments.mockReset().mockResolvedValue({ rows: [] });
  listManagerCounterparties.mockReset().mockResolvedValue({ organizations: [], partners: [] });
  listIncomingComments.mockReset().mockResolvedValue({ rows: [], nextCursor: null });
  listThreads.mockReset().mockResolvedValue({ ok: true, rows: [] });
  isFeatureEnabled.mockReset().mockReturnValue(false);
});

/**
 * `У-110`: разделов «Документы» и «Сообщения» у руководителя не было. За
 * документами он уходил в кабинет менеджера и видел там **свой** срез вместо
 * среза компании, а пункт «Сообщения» вёл прямо в чужой кабинет.
 */
describe('«Документы» руководителя (У-110)', () => {
  const render = (sp: Record<string, string> = {}) =>
    renderServerComponent(LeaderDocumentsPage({ searchParams: Promise.resolve(sp) }));

  it('раздел свой: ссылки ведут в кабинет руководителя, а не менеджера', async () => {
    const { container } = await render();
    expect(container.querySelector('[data-testid="documents-list"]')?.textContent).toBe(
      '/leader/documents'
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter((h) => h?.startsWith('/manager/'))).toEqual([]);
  });

  it('охват — вся компания, а не свои заказы', async () => {
    await render();
    expect(listDocuments).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: LEADER, teamModeOverride: true })
    );
  });

  it('на вкладке «Общие документы» контрагенты тоже по всей компании', async () => {
    const { container } = await render({ tab: 'general' });
    expect(listManagerCounterparties).toHaveBeenCalledWith({}, LEADER, true);
    expect(container.querySelector('[data-testid="upload-form"]')).not.toBeNull();
  });

  it('§15: экран говорит, как называется и что здесь делают', async () => {
    const { container } = await render();
    expect(container.querySelector('h1')?.textContent).toBe('Документы');
    expect(container.textContent).toContain('Договоры, счета и акты');
  });
});

describe('«Сообщения» руководителя (У-110)', () => {
  const render = () =>
    renderServerComponent(LeaderMessagesPage({ searchParams: Promise.resolve({}) }));

  it('переписка по всей компании, а не по своим заказам', async () => {
    await render();
    expect(listIncomingComments).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ session: LEADER, teamModeOverride: true, withOutgoing: true })
    );
  });

  it('комментарии к заказам видны без флага chat, чат — только с ним', async () => {
    const off = await render();
    expect(off.container.querySelector('[data-testid="messages-inbox"]')).not.toBeNull();
    expect(off.container.querySelector('[data-testid="thread-inbox"]')).toBeNull();

    isFeatureEnabled.mockImplementation((f: string) => f === 'chat');
    const on = await render();
    expect(on.container.querySelector('[data-testid="thread-inbox"]')).not.toBeNull();
  });

  it('§15: заголовок равен пункту меню', async () => {
    const { container } = await render();
    expect(container.querySelector('h1')?.textContent).toContain('Сообщения');
  });
});
