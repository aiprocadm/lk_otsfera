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

/**
 * Контекст кабинета заказчика: сессия плюс всё, что нужно оболочке
 * (активная организация, список членств, роль). Страница берёт сессию
 * оттуда же — `getOrgPageContext` сам зовёт `requireOrganization`.
 */
const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

// Оболочка кабинета — тяжёлый клиентский блок с меню и шапкой. Здесь важно
// только то, что страница В НЕЙ, а не рядом: сухой прогон приёмки (этап 10)
// нашёл этот экран без оболочки, и человек оставался без меню и без выхода.
vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-shell' }, props.children),
}));

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
  getOrgPageContext.mockResolvedValue({
    session: SESSION,
    activeOrgId: 'org-1',
    activeOrgName: 'ООО «Пример»',
    memberships: [],
    viewerRole: 'admin',
  });
  listCabinetDialogs.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);
  getCabinetDialog.mockResolvedValue({ ok: true, dialog: { id: 'd1' } });
  listThreads.mockResolvedValue({ ok: true, rows: [], total: 3 });
});

describe('OrganizationMessagesPage', () => {
  it('оба флага выключены — notFound, до сессии и сервисов дело не доходит', async () => {
    flags({});
    await expect(render()).rejects.toThrow('NOT_FOUND');
    // Сессию страница берёт из контекста кабинета — он же даёт оболочке
    // активную организацию. Проверяем именно его: `requireOrganization`
    // теперь зовётся внутри контекста, а не страницей напрямую.
    expect(getOrgPageContext).not.toHaveBeenCalled();
    expect(listCabinetDialogs).not.toHaveBeenCalled();
  });

  /**
   * Экран живёт В оболочке кабинета, а не рядом с ней.
   *
   * Сухой прогон приёмки (этап 10) нашёл его без оболочки: ни бокового меню,
   * ни шапки, ни кнопки «Выйти». Человек приходит сюда с кнопки «Написать» на
   * главной и оказывается в тупике — уйти можно только кнопкой «назад» в
   * браузере. Страница отвечала 200, заголовок был на месте, сервисы отдавали
   * данные; не было только всего остального, и ни один тест этого не замечал.
   */
  it('страница рисуется внутри оболочки кабинета (У-120)', async () => {
    flags({ cabinet_questions: true });
    const { container } = await render();
    const shell = container.querySelector('[data-testid="org-shell"]');
    expect(shell, 'экран без оболочки — человек без меню и без выхода').toBeTruthy();
    expect(shell?.textContent).toContain('Сообщения');
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

  it('чат отвечает отказом — список пуст, экран живёт (зеркало партнёра)', async () => {
    // Отказ выборки обсуждений не должен уносить весь экран: вкладка
    // «Переписка с менеджером» человеку по-прежнему нужна.
    flags({ chat: true });
    listThreads.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await render({ tab: 'orders' });
    expect(container.querySelector('[data-testid="order-threads"]')?.textContent).toBe('0');
  });

  it('пришёл по недоступной ссылке — объяснение на экране', async () => {
    flags({ cabinet_questions: true });
    const { container } = await render({ missing: '1' });
    expect(container.textContent).toContain('Переписка');
    expect(container.textContent?.toLowerCase()).toContain('недоступ');
  });
});
