// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Канбан заказов (этап 6 ТЗ 13.10.2026, `У-303`): перетаскивание зовёт то же
 * действие, что кнопки карточки заказа; каждый отказ объясняется словами;
 * отмена спрашивает причину; в «Без этапа» не бросают.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));
const { transitionOrderStatusAction } = vi.hoisted(() => ({
  transitionOrderStatusAction: vi.fn(),
}));
vi.mock('@/server-actions/orderStatuses', () => ({ transitionOrderStatusAction }));

import { ManagerOrdersKanban } from '@/components/manager/manager-orders-kanban';
import type { OrderKanban } from '@/lib/services/manager/orders';

const card = (id: string) => ({
  id,
  title: `Заказ ${id}`,
  orderNumber: id === 'o1' ? '2026-1' : null,
  organizationName: 'ООО Ромашка',
  totalAmount: '1500',
});

const BOARD: OrderKanban = {
  columns: [
    { id: '', label: 'Без этапа', isTerminal: false, droppable: false, orders: [card('o9')] },
    {
      id: 's1',
      label: 'Черновик заявки',
      isTerminal: false,
      droppable: true,
      orders: [card('o1')],
    },
    { id: 's2', label: 'Оплата поступила', isTerminal: false, droppable: true, orders: [] },
    { id: 's9', label: 'Отменена', isTerminal: true, droppable: true, orders: [] },
  ],
  shown: 2,
  total: 2,
};

/** Перетащить карточку `orderId` из столбца `from` в столбец с подписью `to`. */
function drag(orderId: string, from: string, to: string) {
  const data: Record<string, string> = {
    'text/plain': orderId,
    'application/x-order-status': from,
  };
  const dataTransfer = { getData: (k: string) => data[k] ?? '', setData: vi.fn() };
  const column = screen.getByRole('region', { name: to });
  fireEvent.dragOver(column, { dataTransfer });
  fireEvent.drop(column, { dataTransfer });
}

beforeEach(() => vi.clearAllMocks());

describe('ManagerOrdersKanban', () => {
  it('столбцы с числом карточек; карточка ведёт в заказ; пустой столбец подсказывает', () => {
    const { container } = render(<ManagerOrdersKanban board={BOARD} />);
    expect(screen.getByRole('region', { name: 'Черновик заявки' })).toBeTruthy();
    expect(container.querySelector('a[href="/manager/orders/o1"]')?.textContent).toBe(
      '№2026-1 · Заказ o1'
    );
    expect(screen.getAllByText('Перетащите сюда заказ, чтобы сменить этап.')).toHaveLength(2);
  });

  it('перенос в соседний этап — действие смены статуса и обновление доски', async () => {
    transitionOrderStatusAction.mockResolvedValue({ ok: true, changed: true, statusId: 's2' });
    render(<ManagerOrdersKanban board={BOARD} />);
    drag('o1', 's1', 'Оплата поступила');
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(transitionOrderStatusAction).toHaveBeenCalledWith({ orderId: 'o1', toId: 's2' });
    expect(toastMock.success).toHaveBeenCalledWith('Статус заказа обновлён');
  });

  it('в свой же столбец и в «Без этапа» — ничего не происходит', () => {
    render(<ManagerOrdersKanban board={BOARD} />);
    drag('o1', 's1', 'Черновик заявки');
    drag('o1', 's1', 'Без этапа');
    expect(transitionOrderStatusAction).not.toHaveBeenCalled();
  });

  it('закрыть нельзя — объяснение с условиями; назад нельзя — объяснение', async () => {
    transitionOrderStatusAction.mockResolvedValue({
      ok: false,
      error: 'completion_conditions_unmet',
      unmet: ['accounting_signed', 'documents_uploaded', 'новое_условие'],
    });
    render(<ManagerOrdersKanban board={BOARD} />);
    drag('o1', 's1', 'Оплата поступила');
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        // Незнакомое условие — его код, а не пустота.
        'Заказ пока нельзя закрыть: бухгалтерия не подписана, нет чистого документа, новое_условие.'
      )
    );
    transitionOrderStatusAction.mockResolvedValue({ ok: false, error: 'backward_forbidden' });
    drag('o1', 's1', 'Оплата поступила');
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenLastCalledWith(
        'Вернуть заказ на предыдущий этап могут руководитель и администратор.'
      )
    );
    transitionOrderStatusAction.mockResolvedValue({ ok: false, error: 'странное' });
    drag('o1', 's1', 'Оплата поступила');
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenLastCalledWith('Не удалось сменить статус заказа.')
    );
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('отмена без причины — спрашиваем причину и повторяем; без ответа — ничего', async () => {
    transitionOrderStatusAction
      .mockResolvedValueOnce({ ok: false, error: 'reason_required' })
      .mockResolvedValueOnce({ ok: true, changed: true, statusId: 's9' });
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce('  Клиент передумал ');
    render(<ManagerOrdersKanban board={BOARD} />);
    drag('o1', 's1', 'Отменена');
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(transitionOrderStatusAction).toHaveBeenLastCalledWith({
      orderId: 'o1',
      toId: 's9',
      reason: 'Клиент передумал',
    });
    transitionOrderStatusAction.mockResolvedValueOnce({ ok: false, error: 'reason_required' });
    prompt.mockReturnValueOnce(null);
    drag('o1', 's1', 'Отменена');
    await waitFor(() => expect(transitionOrderStatusAction).toHaveBeenCalledTimes(3));
    prompt.mockRestore();
  });

  it('статус не изменился (уже стоял) — без «обновлён»', async () => {
    transitionOrderStatusAction.mockResolvedValue({ ok: true, changed: false, statusId: 's2' });
    render(<ManagerOrdersKanban board={BOARD} />);
    drag('o1', 's1', 'Оплата поступила');
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('карточка при захвате передаёт свой заказ и свой этап; уход со столбца снимает подсветку', () => {
    const { container } = render(<ManagerOrdersKanban board={BOARD} />);
    const setData = vi.fn();
    fireEvent.dragStart(container.querySelector('article')!, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', 'o9');
    expect(setData).toHaveBeenCalledWith('application/x-order-status', '');
    const column = screen.getByRole('region', { name: 'Оплата поступила' });
    fireEvent.dragOver(column, { dataTransfer: { getData: () => '' } });
    expect(column.className).toContain('ring-2');
    fireEvent.dragLeave(column);
    expect(column.className).not.toContain('ring-2');
    // Другой столбец не трогает чужую подсветку.
    fireEvent.dragOver(column, { dataTransfer: { getData: () => '' } });
    fireEvent.dragLeave(screen.getByRole('region', { name: 'Черновик заявки' }));
    expect(column.className).toContain('ring-2');
  });
});
