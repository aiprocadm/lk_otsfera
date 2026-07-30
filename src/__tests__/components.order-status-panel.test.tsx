// @vitest-environment jsdom
/**
 * §10 ТЗ v0.5 (этап 2, PR-3) — панель рабочего статуса на карточке заявки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { transitionOrderStatusAction } = vi.hoisted(() => ({
  transitionOrderStatusAction: vi.fn()
}));
vi.mock('@/server-actions/orderStatuses', () => ({ transitionOrderStatusAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { OrderStatusPanel } from '@/components/orders/order-status-panel';

const OPT = (id: string, label: string, extra = {}) => ({
  id,
  label,
  isTerminal: false,
  isAuto: false,
  ...extra
});

beforeEach(() => {
  transitionOrderStatusAction.mockReset().mockResolvedValue({ ok: true, changed: true });
  toastSuccess.mockClear();
  toastError.mockClear();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('OrderStatusPanel — показ', () => {
  it('текущий статус в бейдже; без статуса — «Без статуса»', () => {
    const { rerender } = render(
      <OrderStatusPanel
        orderId='o1'
        current={{ id: 'a', label: 'Принято в работу', isTerminal: false }}
        forward={[]}
        backward={[]}
        terminal={null}
        history={[]}
      />
    );
    expect(screen.getByText('Принято в работу')).toBeTruthy();

    rerender(
      <OrderStatusPanel orderId='o1' current={null} forward={[]} backward={[]} terminal={null} history={[]} />
    );
    expect(screen.getByText('Без статуса')).toBeTruthy();
  });

  it('нет переходов — так и написано', () => {
    render(
      <OrderStatusPanel orderId='o1' current={null} forward={[]} backward={[]} terminal={null} history={[]} />
    );
    expect(screen.getByText('Доступных переходов нет.')).toBeTruthy();
  });

  it('кнопки вперёд и назад подписаны по-разному', () => {
    render(
      <OrderStatusPanel
        orderId='o1'
        current={{ id: 'p', label: 'Оплата поступила', isTerminal: false }}
        forward={[OPT('c', 'Заявка закрыта')]}
        backward={[OPT('a', 'Принято в работу')]}
        terminal={OPT('x', 'Отменена', { isTerminal: true })}
        history={[]}
      />
    );
    expect(screen.getByRole('button', { name: 'Заявка закрыта' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '← Принято в работу' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отменена' })).toBeTruthy();
  });

  it('у отменённой заявки кнопки отмены нет', () => {
    render(
      <OrderStatusPanel
        orderId='o1'
        current={{ id: 'x', label: 'Отменена', isTerminal: true }}
        forward={[]}
        backward={[OPT('a', 'Принято в работу')]}
        terminal={OPT('x', 'Отменена', { isTerminal: true })}
        history={[]}
      />
    );
    expect(screen.queryByRole('button', { name: 'Отменена' })).toBeNull();
  });

  it('история показывает переход, автора и причину', () => {
    render(
      <OrderStatusPanel
        orderId='o1'
        current={null}
        forward={[]}
        backward={[]}
        terminal={null}
        history={[
          {
            id: 'h1',
            createdAt: new Date('2026-07-01T10:05:00Z'),
            fromLabel: 'Принято в работу',
            toLabel: 'Отменена',
            userName: 'Иванов',
            reason: 'клиент отказался'
          },
          {
            id: 'h2',
            createdAt: '2026-07-01T09:00:00Z',
            fromLabel: null,
            toLabel: 'Принято в работу',
            userName: null,
            reason: null
          }
        ]}
      />
    );
    expect(screen.getByText(/Принято в работу → /)).toBeTruthy();
    expect(screen.getByText(/Иванов/)).toBeTruthy();
    expect(screen.getByText(/клиент отказался/)).toBeTruthy();
    // у второй строки «откуда» пустое — показывается прочерк
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items.some((t) => t.includes('— →'))).toBe(true);
  });
});

describe('OrderStatusPanel — переходы', () => {
  it('обычный переход уходит без причины', async () => {
    render(
      <OrderStatusPanel
        orderId='o7'
        current={{ id: 'a', label: 'Принято в работу', isTerminal: false }}
        forward={[OPT('c', 'Заявка закрыта')]}
        backward={[]}
        terminal={null}
        history={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Заявка закрыта' }));

    await waitFor(() =>
      expect(transitionOrderStatusAction).toHaveBeenCalledWith({ orderId: 'o7', toId: 'c' })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Статус заявки обновлён'));
  });

  it('отмена требует причину и шлёт её', async () => {
    render(
      <OrderStatusPanel
        orderId='o7'
        current={{ id: 'a', label: 'Принято в работу', isTerminal: false }}
        forward={[]}
        backward={[]}
        terminal={OPT('x', 'Отменена', { isTerminal: true })}
        history={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Отменена' }));
    const dialog = document.querySelector('dialog[open]') as HTMLElement;
    fireEvent.change(within(dialog).getByLabelText(/Причина/), {
      target: { value: '  клиент передумал  ' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() =>
      expect(transitionOrderStatusAction).toHaveBeenCalledWith({
        orderId: 'o7',
        toId: 'x',
        reason: 'клиент передумал'
      })
    );
  });

  it('невыполненные условия закрытия показываются списком, а не ошибкой', async () => {
    transitionOrderStatusAction.mockResolvedValue({
      ok: false,
      error: 'completion_conditions_unmet',
      unmet: ['documents_uploaded', 'accounting_signed']
    });
    render(
      <OrderStatusPanel
        orderId='o7'
        current={{ id: 'a', label: 'Принято в работу', isTerminal: false }}
        forward={[OPT('c', 'Заявка закрыта')]}
        backward={[]}
        terminal={null}
        history={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Заявка закрыта' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Нет чистого документа')).toBeTruthy();
    expect(screen.getByText('Бухгалтерия не подписана')).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('прочие ошибки показываются по-русски', async () => {
    transitionOrderStatusAction.mockResolvedValue({ ok: false, error: 'backward_forbidden' });
    render(
      <OrderStatusPanel
        orderId='o7'
        current={{ id: 'p', label: 'Оплата поступила', isTerminal: false }}
        forward={[]}
        backward={[OPT('a', 'Принято в работу')]}
        terminal={null}
        history={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '← Принято в работу' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Вернуть заявку на предыдущую стадию могут администратор и руководитель.'
      )
    );
  });

  it('окно отмены закрывается кнопкой «Не отменять»', async () => {
    render(
      <OrderStatusPanel
        orderId='o7'
        current={{ id: 'a', label: 'Принято в работу', isTerminal: false }}
        forward={[]}
        backward={[]}
        terminal={OPT('x', 'Отменена', { isTerminal: true })}
        history={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Отменена' }));
    const dialog = document.querySelector('dialog[open]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Не отменять' }));

    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
    expect(transitionOrderStatusAction).not.toHaveBeenCalled();
  });
});
