// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerInboxPage from '@/app/manager/inbox/page';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Куда ведёт обратная ссылка из переписки (`У-215`, этап 3 PR-6).
 *
 * Человек нажал в диалоге «Открыть во «Входящих»» и попал на
 * `/manager/inbox?message=<id>`. Экран показывает ОДНО письмо — и обязан об
 * этом сказать: без объяснения он выглядит как «во «Входящих» осталось одно
 * письмо, остальные пропали». Поэтому вместо фильтров стоит полоса с выходом
 * «Показать все входящие» (§15: «где я» и «что дальше»).
 */

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(() => true) }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listInbox, listOrganizations } = vi.hoisted(() => ({
  listInbox: vi.fn(),
  listOrganizations: vi.fn(),
}));
vi.mock('@/lib/services/inbound/listInbox', () => ({ listInbox }));
vi.mock('@/lib/services/manager/organizations', () => ({ listOrganizations }));

vi.mock('@/components/manager/inbox-filters', () => ({
  InboxFiltersBar: () => React.createElement('div', { 'data-testid': 'inbox-filters' }),
}));
vi.mock('@/components/manager/inbox-list', () => ({
  InboxList: (props: { items: Array<{ id: string }> }) =>
    React.createElement(
      'div',
      { 'data-testid': 'inbox-list' },
      props.items.map((i) => i.id).join(',')
    ),
}));

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

async function renderPage(sp: Record<string, string>) {
  const { container } = await renderServerComponent(
    ManagerInboxPage({ searchParams: Promise.resolve(sp) })
  );
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  requireManager.mockResolvedValue(SESSION);
  listInbox.mockResolvedValue({ items: [{ id: 'msg-1' }], total: 1 });
  listOrganizations.mockResolvedValue([]);
});

describe('ManagerInboxPage — ?message=<id> (У-215)', () => {
  it('сужает выборку до одного письма — сужением занимается сервис, не экран', async () => {
    await renderPage({ message: 'msg-1' });
    expect(listInbox).toHaveBeenCalledWith({}, SESSION, {
      messageId: 'msg-1',
      page: 1,
      pageSize: 25,
    });
  });

  it('объясняет, почему письмо одно, и даёт выход ко всем входящим', async () => {
    const container = await renderPage({ message: 'msg-1' });
    expect(container.textContent).toContain('Показано одно письмо');
    expect(container.querySelector('a[href="/manager/inbox"]')?.textContent).toBe(
      'Показать все входящие'
    );
    // Фильтры в этом режиме не нужны: они бы обещали то, чего не делают.
    expect(container.querySelector('[data-testid="inbox-filters"]')).toBeNull();
  });

  it('без параметра экран прежний: фильтры на месте, полосы нет', async () => {
    const container = await renderPage({});
    expect(container.querySelector('[data-testid="inbox-filters"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Показано одно письмо');
    expect(listInbox).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
  });

  it('пустой `?message=` сужением не считается', async () => {
    const container = await renderPage({ message: '' });
    expect(listInbox).toHaveBeenCalledWith({}, SESSION, { page: 1, pageSize: 25 });
    expect(container.querySelector('[data-testid="inbox-filters"]')).not.toBeNull();
  });

  it('чужое письмо по прямой ссылке даёт пустой список, а не чужие данные', async () => {
    // Скоуп остаётся поверх: сервис просто ничего не найдёт. Экран при этом
    // обязан остаться понятным — полоса с выходом на месте.
    listInbox.mockResolvedValue({ items: [], total: 0 });
    const container = await renderPage({ message: 'чужое' });
    expect(container.querySelector('[data-testid="inbox-list"]')?.textContent).toBe('');
    expect(container.textContent).toContain('Показано одно письмо');
  });
});
