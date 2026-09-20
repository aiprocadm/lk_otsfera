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

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listThreads } = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ listThreads }));

const { listCabinetDialogs, getCabinetDialog } = vi.hoisted(() => ({
  listCabinetDialogs: vi.fn(),
  getCabinetDialog: vi.fn(),
}));
vi.mock('@/lib/services/cabinetDialogs/list', () => ({ listCabinetDialogs }));
vi.mock('@/lib/services/cabinetDialogs/get', () => ({ getCabinetDialog }));

vi.mock('@/components/cabinet-dialogs/cabinet-dialogs-panel', () => ({
  CabinetDialogsPanel: (props: { basePath: string; dialogs: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'cabinet-panel' },
      `${props.basePath}|${props.dialogs.length}`
    ),
}));
vi.mock('@/components/chat/order-thread-inbox', () => ({
  OrderThreadInbox: (props: { total: number }) =>
    React.createElement('div', { 'data-testid': 'order-threads' }, String(props.total)),
}));
vi.mock('@/components/chat/unread-badge', () => ({ UnreadBadge: () => null }));

import PartnerMessagesPage from '@/app/partner/messages/page';

/** «Сообщения» партнёра — зеркало экрана заказчика (`У-234`, §0.2). */
const SESSION = { sub: 'u2', role: 'partner' as const, partnerId: 'p1' };

function flags(map: Record<string, boolean>) {
  isFeatureEnabled.mockImplementation((f: string) => map[f] ?? false);
}
const render = (sp: Record<string, string> = {}) =>
  renderServerComponent(PartnerMessagesPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  vi.clearAllMocks();
  requirePartner.mockResolvedValue(SESSION);
  listCabinetDialogs.mockResolvedValue([{ id: 'd1' }]);
  getCabinetDialog.mockResolvedValue({ ok: true, dialog: { id: 'd1' } });
  listThreads.mockResolvedValue({ ok: true, rows: [], total: 5 });
});

describe('PartnerMessagesPage', () => {
  it('оба флага выключены — notFound; сервисы не зовутся', async () => {
    flags({});
    await expect(render()).rejects.toThrow('NOT_FOUND');
    expect(requirePartner).not.toHaveBeenCalled();
  });

  it('переписка партнёра ведёт на свой адрес и берёт свои диалоги', async () => {
    flags({ cabinet_questions: true });
    const { container } = await render();
    expect(listCabinetDialogs).toHaveBeenCalledWith({}, SESSION);
    expect(container.querySelector('[data-testid="cabinet-panel"]')?.textContent).toBe(
      '/partner/messages|1'
    );
  });

  it('вкладка «По заказам» под флагом чата', async () => {
    flags({ chat: true, cabinet_questions: true });
    const { container } = await render({ tab: 'orders' });
    expect(container.querySelector('[data-testid="order-threads"]')?.textContent).toBe('5');
    expect(container.textContent).toContain('Переписка с менеджером');
    expect(container.textContent).toContain('По заказам');
  });

  it('чат отвечает отказом — список пуст, экран живёт', async () => {
    flags({ chat: true });
    listThreads.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await render({ tab: 'orders' });
    expect(container.querySelector('[data-testid="order-threads"]')?.textContent).toBe('0');
  });

  it('недоступная переписка — список с пометкой', async () => {
    flags({ cabinet_questions: true });
    getCabinetDialog.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(render({ dialog: 'zz' })).rejects.toThrow(
      'REDIRECT:/partner/messages?tab=manager&missing=1'
    );
  });

  it('`?dialog=` открывает выбранную переписку, а не только список', async () => {
    // Ссылку на переписку присылают в уведомлении. Не подставь страница сам
    // диалог — человек попадал бы в список и искал бы нужный разговор заново.
    flags({ cabinet_questions: true });
    await render({ dialog: 'd1' });
    expect(getCabinetDialog).toHaveBeenCalledWith({}, SESSION, 'd1');
  });

  it('вкладка из адреса, которой нет под флагами, открывает доступную', async () => {
    // `?tab=orders` при выключенном чате — обычная старая ссылка. Пустой
    // экран вместо переписки был бы тупиком (§15).
    flags({ cabinet_questions: true });
    const { container } = await render({ tab: 'orders' });
    expect(container.textContent).toContain('Переписка с менеджером');
    expect(container.querySelector('[data-testid="order-threads"]')).toBeNull();
  });

  it('пришёл по недоступной ссылке — объяснение на экране, а не пустой список', async () => {
    flags({ cabinet_questions: true });
    const { container } = await render({ missing: '1' });
    expect(container.textContent).toContain('Переписка');
  });
});
