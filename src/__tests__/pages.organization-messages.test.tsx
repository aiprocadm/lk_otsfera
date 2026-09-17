// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock('next/navigation', () => nav);

const { requireOrganization } = vi.hoisted(() => ({ requireOrganization: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireOrganization }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listThreads } = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ listThreads }));

const { listCabinetDialogs, getCabinetDialog } = vi.hoisted(() => ({
  listCabinetDialogs: vi.fn(),
  getCabinetDialog: vi.fn(),
}));
vi.mock('@/lib/services/cabinetDialogs/list', () => ({ listCabinetDialogs }));
vi.mock('@/lib/services/cabinetDialogs/get', () => ({ getCabinetDialog }));

// Оба тяжёлых блока — клиентские: страница проверяется по переданным данным.
vi.mock('@/components/cabinet-dialogs/cabinet-dialogs-panel', () => ({
  CabinetDialogsPanel: (props: { dialogs: unknown[]; selected: { id: string } | null }) =>
    React.createElement(
      'div',
      { 'data-testid': 'cabinet-panel' },
      `${props.dialogs.length}|${props.selected?.id ?? 'none'}`
    ),
}));
vi.mock('@/components/chat/order-thread-inbox', () => ({
  OrderThreadInbox: (props: { total: number }) =>
    React.createElement('div', { 'data-testid': 'order-threads' }, String(props.total)),
}));
vi.mock('@/components/chat/unread-badge', () => ({ UnreadBadge: () => null }));

import OrganizationMessagesPage from '@/app/organization/messages/page';

/**
 * «Сообщения» заказчика (`У-234`): вкладка переписки под `cabinet_questions`,
 * вкладка чата по заказам под `chat`; страница живёт, пока включён хотя бы один.
 */
const SESSION = { sub: 'u1', role: 'organization' as const };

function flags(map: Record<string, boolean>) {
  isFeatureEnabled.mockImplementation((f: string) => map[f] ?? false);
}
const render = (sp: Record<string, string> = {}) =>
  renderServerComponent(OrganizationMessagesPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganization.mockResolvedValue(SESSION);
  listCabinetDialogs.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);
  getCabinetDialog.mockResolvedValue({ ok: true, dialog: { id: 'd1' } });
  listThreads.mockResolvedValue({ ok: true, rows: [], total: 3 });
});

describe('OrganizationMessagesPage', () => {
  it('оба флага выключены — notFound, до сессии и сервисов дело не доходит', async () => {
    flags({});
    await expect(render()).rejects.toThrow('NOT_FOUND');
    expect(requireOrganization).not.toHaveBeenCalled();
    expect(listCabinetDialogs).not.toHaveBeenCalled();
  });

  it('только переписка: обе вкладки не рисуются, чат не грузится', async () => {
    flags({ cabinet_questions: true });
    const { container } = await render();
    expect(container.textContent).toContain('Сообщения');
    expect(container.querySelector('[data-testid="cabinet-panel"]')?.textContent).toBe('2|none');
    expect(listThreads).not.toHaveBeenCalled();
  });

  it('только чат: открывается вкладка «По заказам», переписка не грузится', async () => {
    flags({ chat: true });
    const { container } = await render();
    expect(container.querySelector('[data-testid="order-threads"]')?.textContent).toBe('3');
    expect(listCabinetDialogs).not.toHaveBeenCalled();
  });

  it('оба флага: по умолчанию переписка, `?tab=orders` переключает', async () => {
    flags({ chat: true, cabinet_questions: true });
    const first = await render();
    expect(first.container.querySelector('[data-testid="cabinet-panel"]')).toBeTruthy();
    expect(first.container.textContent).toContain('Переписка с менеджером');
    const second = await render({ tab: 'orders' });
    expect(second.container.querySelector('[data-testid="order-threads"]')).toBeTruthy();
  });

  it('`?dialog=` открывает переписку; недоступная — список с пометкой', async () => {
    flags({ cabinet_questions: true });
    const { container } = await render({ dialog: 'd1' });
    expect(getCabinetDialog).toHaveBeenCalledWith({}, SESSION, 'd1');
    expect(container.querySelector('[data-testid="cabinet-panel"]')?.textContent).toBe('2|d1');

    getCabinetDialog.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(render({ dialog: 'zz' })).rejects.toThrow(
      'REDIRECT:/organization/messages?tab=manager&missing=1'
    );
  });

  it('пришёл по недоступной ссылке — объяснение на экране', async () => {
    flags({ cabinet_questions: true });
    const { container } = await render({ missing: '1' });
    expect(container.textContent).toContain('Переписка');
    expect(container.textContent?.toLowerCase()).toContain('недоступ');
  });
});
