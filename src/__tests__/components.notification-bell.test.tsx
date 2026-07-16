// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { useClientResource } = vi.hoisted(() => ({ useClientResource: vi.fn() }));
vi.mock('@/hooks/useClientResource', () => ({ useClientResource }));

import { NotificationBell } from '@/components/notifications/notification-bell';

type Row = {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  meta: unknown;
};

const ROWS: Row[] = [
  {
    id: 'n1',
    type: 'chat_message',
    title: 'Новое сообщение по заказу №42',
    body: 'Здравствуйте, есть вопрос по срокам обучения сотрудников.',
    isRead: false,
    createdAt: '2026-07-10T12:00:00.000Z',
    meta: { orderId: 'ord-1' }
  },
  {
    id: 'n2',
    type: 'sync_error',
    title: 'Ошибка синхронизации 1С',
    body: 'Не удалось обработать заказ.',
    isRead: true,
    createdAt: '2026-07-01T08:00:00.000Z',
    meta: {}
  }
];

/** Управляемое состояние обоих ресурсов + перехват опций хука. */
type ResourceStub = { data: unknown; loading: boolean; error: boolean };

const unreadRefetch = vi.fn();
const listRefetch = vi.fn();
let unreadStub: ResourceStub;
let listStub: ResourceStub;
let unreadOpts: { intervalMs?: number; select?: (d: unknown) => number } | undefined;
let listEnabledCalls: Array<boolean | undefined>;

function installResourceMock() {
  useClientResource.mockImplementation((url: string, opts?: Record<string, unknown>) => {
    if (url === '/api/notifications/unread') {
      unreadOpts = opts as typeof unreadOpts;
      return { ...unreadStub, refetch: unreadRefetch };
    }
    listEnabledCalls.push(opts?.enabled as boolean | undefined);
    return { ...listStub, refetch: listRefetch };
  });
}

const fetchMock = vi.fn();

function renderBell(role: 'admin' | 'manager' | 'partner' | 'organization' = 'manager') {
  return render(React.createElement(NotificationBell, { role }));
}

function openPanel() {
  // regex: aria-label кнопки включает счётчик при count>0 («Уведомления, непрочитанных: N»)
  fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }));
}

describe('NotificationBell', () => {
  beforeEach(() => {
    push.mockReset();
    useClientResource.mockReset();
    unreadRefetch.mockReset();
    listRefetch.mockReset();
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    unreadStub = { data: 0, loading: false, error: false };
    listStub = { data: null, loading: false, error: false };
    unreadOpts = undefined;
    listEnabledCalls = [];
    installResourceMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('бейдж', () => {
    it('не показывает пилл при count=0 и при data=null; aria-label без счётчика', () => {
      const { unmount } = renderBell();
      expect(screen.getByRole('button', { name: 'Уведомления' }).textContent).toBe('🔔');
      unmount();
      unreadStub = { data: null, loading: false, error: false };
      renderBell();
      expect(screen.getByRole('button', { name: 'Уведомления' }).textContent).toBe('🔔');
    });

    it('показывает пилл с числом при count>0; счётчик озвучен в aria-label кнопки', () => {
      unreadStub = { data: 7, loading: false, error: false };
      renderBell();
      const bell = screen.getByRole('button', { name: 'Уведомления, непрочитанных: 7' });
      expect(bell.textContent).toContain('7');
    });

    it('поллит /api/notifications/unread с intervalMs=30000; select даёт count ?? 0', () => {
      renderBell();
      expect(unreadOpts?.intervalMs).toBe(30_000);
      expect(unreadOpts?.select?.({})).toBe(0);
      expect(unreadOpts?.select?.({ count: 3 })).toBe(3);
    });
  });

  describe('открытие/закрытие панели', () => {
    it('панель закрыта по умолчанию: aria-expanded=false, haspopup=dialog, список с enabled=false', () => {
      renderBell();
      const bell = screen.getByRole('button', { name: 'Уведомления' });
      expect(bell.getAttribute('aria-expanded')).toBe('false');
      expect(bell.getAttribute('aria-haspopup')).toBe('dialog');
      expect(screen.queryByText('Прочитать все')).toBeNull();
      expect(listEnabledCalls.at(-1)).toBe(false);
    });

    it('клик по кнопке открывает панель (enabled=true, aria-controls → dialog), повторный клик закрывает', () => {
      renderBell();
      openPanel();
      const bell = screen.getByRole('button', { name: 'Уведомления' });
      expect(bell.getAttribute('aria-expanded')).toBe('true');
      const panelId = bell.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      const panel = document.getElementById(panelId!);
      expect(panel?.textContent).toContain('Прочитать все');
      expect(screen.getByText('Уведомления', { selector: 'span' })).toBeTruthy();
      expect(listEnabledCalls.at(-1)).toBe(true);
      openPanel();
      expect(bell.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText('Прочитать все')).toBeNull();
    });

    it('Escape закрывает панель и возвращает фокус на кнопку; другие клавиши — нет', () => {
      renderBell();
      openPanel();
      fireEvent.keyDown(document, { key: 'Enter' });
      expect(screen.getByText('Прочитать все')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByText('Прочитать все')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Уведомления' }));
    });

    it('клик вне панели закрывает её, клик внутри — нет', () => {
      listStub = { data: ROWS, loading: false, error: false };
      renderBell();
      openPanel();
      fireEvent.mouseDown(screen.getByText('Ошибка синхронизации 1С'));
      expect(screen.getByText('Прочитать все')).toBeTruthy();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByText('Прочитать все')).toBeNull();
    });
  });

  describe('список уведомлений', () => {
    it('рендерит строки: непрочитанный title жирный, прочитанный — нет; body и дата на месте', () => {
      listStub = { data: ROWS, loading: false, error: false };
      renderBell();
      openPanel();
      const unreadTitle = screen.getByText('Новое сообщение по заказу №42');
      const readTitle = screen.getByText('Ошибка синхронизации 1С');
      expect(unreadTitle.className).toContain('font-semibold');
      expect(readTitle.className).not.toContain('font-semibold');
      expect(screen.getByText(/есть вопрос по срокам/)).toBeTruthy();
      // fmtDate — московское время, дата ISO 2026-07-10T12:00Z → 10.07.2026
      expect(screen.getByText('10.07.2026')).toBeTruthy();
      expect(screen.getByText('01.07.2026')).toBeTruthy();
    });

    it('пустой список → «Нет уведомлений»', () => {
      listStub = { data: [], loading: false, error: false };
      renderBell();
      openPanel();
      expect(screen.getByText('Нет уведомлений')).toBeTruthy();
    });

    it('ошибка → «Не удалось загрузить»', () => {
      listStub = { data: null, loading: false, error: true };
      renderBell();
      openPanel();
      expect(screen.getByText('Не удалось загрузить')).toBeTruthy();
    });

    it('загрузка → спиннер', () => {
      listStub = { data: null, loading: true, error: false };
      const { container } = renderBell();
      openPanel();
      expect(container.querySelector('.animate-spin')).toBeTruthy();
      expect(screen.queryByText('Нет уведомлений')).toBeNull();
    });
  });

  describe('клик по строке', () => {
    it('PATCH {id} → refetch обоих → push(href) и закрытие панели (manager + orderId)', async () => {
      listStub = { data: ROWS, loading: false, error: false };
      renderBell('manager');
      openPanel();
      fireEvent.click(screen.getByText('Новое сообщение по заказу №42'));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/manager/orders/ord-1'));
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'n1' })
      });
      expect(listRefetch).toHaveBeenCalled();
      expect(unreadRefetch).toHaveBeenCalled();
      expect(screen.queryByText('Прочитать все')).toBeNull();
    });

    it('без href (null) — PATCH уходит, push не вызывается, панель остаётся открытой', async () => {
      listStub = { data: ROWS, loading: false, error: false };
      renderBell('manager');
      openPanel();
      fireEvent.click(screen.getByText('Ошибка синхронизации 1С'));
      await waitFor(() => expect(listRefetch).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notifications',
        expect.objectContaining({ body: JSON.stringify({ id: 'n2' }) })
      );
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByText('Прочитать все')).toBeTruthy();
    });

    it('сбой PATCH не роняет UI: refetch всё равно вызывается', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      listStub = { data: ROWS, loading: false, error: false };
      renderBell('manager');
      openPanel();
      fireEvent.click(screen.getByText('Ошибка синхронизации 1С'));
      await waitFor(() => expect(listRefetch).toHaveBeenCalled());
      expect(unreadRefetch).toHaveBeenCalled();
      expect(screen.getByText('Прочитать все')).toBeTruthy();
    });
  });

  describe('«Прочитать все»', () => {
    it('PATCH {ids: unreadIds} → refetch обоих', async () => {
      listStub = { data: ROWS, loading: false, error: false };
      renderBell();
      openPanel();
      const btn = screen.getByRole('button', { name: 'Прочитать все' });
      expect((btn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(btn);
      await waitFor(() => expect(listRefetch).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['n1'] })
      });
      expect(unreadRefetch).toHaveBeenCalled();
    });

    it('disabled при 0 непрочитанных в списке', () => {
      listStub = { data: [ROWS[1]], loading: false, error: false };
      renderBell();
      openPanel();
      const btn = screen.getByRole('button', { name: 'Прочитать все' }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      fireEvent.click(btn);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
