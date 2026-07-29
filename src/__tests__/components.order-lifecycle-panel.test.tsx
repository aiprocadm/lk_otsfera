// @vitest-environment jsdom
/**
 * Отметка «Бухгалтерия подписана» на карточке заявки.
 *
 * §10 ТЗ v0.5 (этап 2, PR-3): переходы статуса переехали в OrderStatusPanel —
 * он строит кнопки из справочника, а не из захардкоженной матрицы, и
 * проверяется собственными тестами. Прежние проверки переходов удалены вместе
 * с кнопками: дублировать логику, которой в компоненте больше нет, незачем.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { setOrderAccountingSignedAction } = vi.hoisted(() => ({
  setOrderAccountingSignedAction: vi.fn()
}));
vi.mock('@/server-actions/manager/orderLifecycle', () => ({ setOrderAccountingSignedAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { OrderLifecyclePanel } from '@/components/manager/order-lifecycle-panel';

beforeEach(() => {
  setOrderAccountingSignedAction.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe('OrderLifecyclePanel — отметка бухгалтерии', () => {
  it('галочка отражает текущее состояние', () => {
    const { rerender } = render(
      <OrderLifecyclePanel orderId='o1' accountingSigned={false} returnReason={null} />
    );
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);

    rerender(<OrderLifecyclePanel orderId='o1' accountingSigned={true} returnReason={null} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('простановка галочки сохраняется и подтверждается', async () => {
    setOrderAccountingSignedAction.mockResolvedValue({ ok: true });
    render(<OrderLifecyclePanel orderId='o1' accountingSigned={false} returnReason={null} />);

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(setOrderAccountingSignedAction).toHaveBeenCalledWith({ orderId: 'o1', signed: true })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Отметка бухгалтерии обновлена'));
  });

  it('снятие галочки шлёт signed=false', async () => {
    setOrderAccountingSignedAction.mockResolvedValue({ ok: true });
    render(<OrderLifecyclePanel orderId='o2' accountingSigned={true} returnReason={null} />);

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(setOrderAccountingSignedAction).toHaveBeenCalledWith({ orderId: 'o2', signed: false })
    );
  });

  it('отказ сервера показывает понятную ошибку', async () => {
    setOrderAccountingSignedAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<OrderLifecyclePanel orderId='o1' accountingSigned={false} returnReason={null} />);

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет доступа к этому заказу.'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('причина последнего возврата показывается, если она есть', () => {
    const { rerender } = render(
      <OrderLifecyclePanel orderId='o1' accountingSigned={false} returnReason='Ждём документы' />
    );
    expect(screen.getByText(/Ждём документы/)).toBeTruthy();

    rerender(<OrderLifecyclePanel orderId='o1' accountingSigned={false} returnReason={null} />);
    expect(screen.queryByText(/Причина последнего возврата/)).toBeNull();
  });

  it('заголовок больше не про жизненный цикл — статусом занимается другая панель', () => {
    render(<OrderLifecyclePanel orderId='o1' accountingSigned={false} />);
    expect(screen.getByText('Бухгалтерия')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
